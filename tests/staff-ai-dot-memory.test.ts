import assert from 'node:assert/strict';
import test from 'node:test';
import {
formatEpisodeForMemory,
matchEpisodesForConversation,
type GuildEpisode,
} from '../src/core/ai/GuildEpisodeMemory.ts';
import {
applyMemberMemoUpdates,
formatMemberMemoLine,
groupMemberMemoAuthors,
loadGuildMemberMemoStore,
normalizeMemberMemoStore,
parseMemberMemoUpdates,
selectMemberMemosForContext,
updateGuildMemberMemos,
type GuildMemberMemo,
MEMBER_MEMOS_PER_GUILD_LIMIT,
} from '../src/core/ai/GuildMemberMemory.ts';
import {
AMBIENT_SYSTEM_RULES,
ADDRESSED_JUDGE_SYSTEM_PROMPT,
PARTICIPATION_JUDGE_SYSTEM_PROMPT,
createAppendOnlySession,
draftHasConcreteAnchor,
formatDotMemoryBlock,
prepareAppendOnlyTurn,
type JudgeLogEntry,
} from '../src/core/ai/StaffAIDotAmbient.ts';

const GOMIMUSHI_ID = '1496700915862868090';

function episode(overrides: Partial<GuildEpisode> = {}): GuildEpisode {
return {
id: overrides.id?? Math.random().toString(36).slice(2),
at: 1_700_000_000_000,
date: '2026-11-05',
channelId: '1482537395986501734',
channelName: 'vc組専用雑談',
actor: '冷笑系熱血ゴミムシ',
actorId: GOMIMUSHI_ID,
summary: 'AIをゴミだと述べた',
messageIds: ['1567659475303800995'],
source: 'dot',
...overrides,
};
}

// ---------------------------------------------------------------------------
// エピソード照合
// ---------------------------------------------------------------------------

test('matchEpisodesForConversation: 同じ話者が同じ話題を蒸し返すと、過去の出来事が一致する', () => {
const matched = matchEpisodesForConversation([episode()], [
{ authorId: GOMIMUSHI_ID, authorName: '冷笑系熱血ゴミムシ', content: 'AIってゴミだよねわかる、ほんと使えねえわ'},
{ authorId: 'u2', authorName: 'たろう', content: 'また始まった'},
]);
assert.equal(matched.length, 1);
assert.equal(matched[0].summary, 'AIをゴミだと述べた');
});

test('matchEpisodesForConversation: 主体がいても話題が無関係なら一致しない（主体だけでは注入しない）', () => {
const matched = matchEpisodesForConversation([episode()], [
{ authorId: GOMIMUSHI_ID, authorName: '冷笑系熱血ゴミムシ', content: '今日の晩ごはんはカレーにした、うまかった'},
{ authorId: 'u2', authorName: 'たろう', content: 'いいな、うちはラーメンだった'},
]);
assert.equal(matched.length, 0);
});

test('matchEpisodesForConversation: 音の断片だけの偶然一致（カレーとグレー等）では一致しない', () => {
const episodes = [
episode({ id: 'gray', summary: 'グレーな事をしてる奴が開示するのはアホだと述べた' }),
episode({ id: 'mention', summary: 'チャンネル生成数200メンション付き宣伝悪質度maxな動画について述べた' }),
episode({ id: 'ramen', actor: '70455xy', actorId: 'u-70455', summary: '「ラーメンは味噌が一番うまい」と述べた' }),
];
const matched = matchEpisodesForConversation(episodes, [
{ authorId: GOMIMUSHI_ID, authorName: '冷笑系熱血ゴミムシ', content: '今日の晩ごはんはカレーにした、うまかった' },
{ authorId: 'u2', authorName: 'たろう', content: 'いいな、うちはラーメンだった' },
]);
// 断片一致の2件は落ちる。本文にいない第三者の出来事は、1語だけの一致では保守的に入れない
assert.deepEqual(matched.map(item => item.id), []);
});

test('matchEpisodesForConversation: 本人のいない会話でも、話題の具体が強く一致すれば拾う', () => {
const target = episode({
actor: 'たろう', actorId: 'u9',
summary: '大会のエントリー受付が始まった',
});
const matched = matchEpisodesForConversation([target], [
{ authorId: 'u2', authorName: 'はなこ', content: '大会のエントリー受付が始まったって本当？'},
]);
assert.equal(matched.length, 1);
});

test('matchEpisodesForConversation: 汎用的な単語が1つだけ被る程度では一致しない', () => {
const target = episode({
actor: 'たろう', actorId: 'u9',
summary: '新しいゲームの感想を語った',
});
const matched = matchEpisodesForConversation([target], [
{ authorId: 'u2', authorName: 'はなこ', content: '新しいスマホ買った'},
]);
assert.equal(matched.length, 0);
});

test('matchEpisodesForConversation: 件数上限と、スコアが高い順→新しい順の並びを守る', () => {
const episodes = [
episode({ id: 'weak', summary: 'ゴミの話で盛り上がった', at: 500}),
episode({ id: 'strong', summary: 'AIの回答をゴミだと酷評した', at: 100}),
episode({ id: 'mid', summary: 'AIについてゴミだと愚痴った', at: 300}),
episode({ id: 'mid-newer', summary: 'AIについてゴミだと愚痴った', at: 400}),
];
const matched = matchEpisodesForConversation(episodes, [
{ authorId: GOMIMUSHI_ID, authorName: '冷笑系熱血ゴミムシ', content: 'AIの回答さ、ゴミだよねほんと。酷評されても仕方ないわ'},
], 3);
assert.equal(matched.length, 3);
assert.equal(matched[0].id, 'strong');
// mid と mid-newer は同じ主体・酷似した要約なので重複として1件に絞られる
assert.deepEqual(matched.map(item => item.id), ['strong', 'weak', 'mid-newer']);
});

test('formatEpisodeForMemory: 日付・話者・要約・チャンネルの1行になる', () => {
assert.equal(
formatEpisodeForMemory(episode()),
'- 2026-11-05 冷笑系熱血ゴミムシ: AIをゴミだと述べた（#vc組専用雑談）',
);
});

// ---------------------------------------------------------------------------
// メンバーメモの保存・選択
// ---------------------------------------------------------------------------

test('normalizeMemberMemoStore: 不正な行と重複を落とし、ユーザIDごとに1件へ寄せる', () => {
const store = normalizeMemberMemoStore({
version: 1,
memos: [
{ userId: 'u1', name: 'A', memo: 'メモ1', messageCount: 3, updatedAt: '2026-11-01T00:00:00Z', lastSeenAt: 1761955200000},
{ userId: 'u1', name: 'A2', memo: 'メモ2', messageCount: 9, updatedAt: '2026-11-02T00:00:00Z', lastSeenAt: 1762041600000},
{ userId: '', name: 'x', memo: '捨てる'},
'not-an-object',
],
});
assert.equal(store.memos.length, 1);
assert.equal(store.memos[0].memo, 'メモ1');
});

test('applyMemberMemoUpdates: 発言数が積み上がり、上限を超えると活動量の少ない人から間引かれる', () => {
const store = normalizeMemberMemoStore(null);
for (let i = 0; i < MEMBER_MEMOS_PER_GUILD_LIMIT + 5; i++) {
applyMemberMemoUpdates(store, [{ userId: `u${i}`, name: `人${i}`, memo: `メモ${i}`}],
[{ userId: `u${i}`, name: `人${i}`, count: i + 1, lastAt: 1_000 + i}], '2026-11-08T00:00:00Z');
}
assert.equal(store.memos.length, MEMBER_MEMOS_PER_GUILD_LIMIT);
// 発言数が最大の人が残る
assert.ok(store.memos.some(memo => memo.userId === `u${MEMBER_MEMOS_PER_GUILD_LIMIT + 4}`));
// 発言数が最小の人は間引かれる
assert.ok(!store.memos.some(memo => memo.userId === 'u0'));
});

test('applyMemberMemoUpdates: 空の更新は既存メモを消さず、発言数だけ積む', () => {
const store = normalizeMemberMemoStore({
memos: [{ userId: 'u1', name: 'A', memo: '既存メモ', messageCount: 2, updatedAt: 'x', lastSeenAt: 0}],
});
applyMemberMemoUpdates(store, [], [{ userId: 'u1', name: 'A', count: 3, lastAt: 5}], '2026-11-08T00:00:00Z');
assert.equal(store.memos[0].memo, '既存メモ');
assert.equal(store.memos[0].messageCount, 5);
});

test('groupMemberMemoAuthors: 最低発言数未満の人は対象外、上限8人まで', () => {
const observations = [
{ authorId: 'u1', authorName: 'A', content: '一回だけ', at: 1},
...Array.from({ length: 10}, (_, i) => ({ authorId: `v${i}`, authorName: `V${i}`, content: `発言${i}-1`, at: i})),
...Array.from({ length: 10}, (_, i) => ({ authorId: `v${i}`, authorName: `V${i}`, content: `発言${i}-2`, at: 100 + i})),
];
const authors = groupMemberMemoAuthors(observations, []);
assert.equal(authors.length, 8);
assert.ok(!authors.some(author => author.userId === 'u1'));
});

test('parseMemberMemoUpdates: 対象外のユーザIDは捨て、200字へ丸める', () => {
const updates = parseMemberMemoUpdates(JSON.stringify({
u1: 'あ'.repeat(300),
uX: '対象外のはず',
}), [{ userId: 'u1', name: 'A', existingMemo: '', messages: [], count: 2, lastAt: 0}]);
assert.equal(updates.length, 1);
assert.equal(updates[0].userId, 'u1');
assert.equal([...updates[0].memo].length, 200);
});

test('selectMemberMemosForContext: 発言している人と言及された人だけが選ばれる', () => {
const memos: GuildMemberMemo[] = [
{ userId: 'u1', name: 'ゴミムシ', memo: 'AIへの文句が定番', messageCount: 10, updatedAt: '', lastSeenAt: 0},
{ userId: 'u2', name: 'たろう', memo: 'マイクラ好き', messageCount: 8, updatedAt: '', lastSeenAt: 0},
{ userId: 'u3', name: 'はなこ', memo: '映画の話が多い', messageCount: 5, updatedAt: '', lastSeenAt: 0},
{ userId: 'u4', name: '不在の人', memo: '出てこない', messageCount: 3, updatedAt: '', lastSeenAt: 0},
];
const selected = selectMemberMemosForContext(memos, new Set(['u1']), 'たろうは昨日マイクラやってた');
assert.deepEqual(selected.map(memo => memo.userId), ['u1', 'u2']);
});

test('formatMemberMemoLine: 名前とメモの1行になる', () => {
assert.equal(
formatMemberMemoLine({ userId: 'u1', name: 'ゴミムシ', memo: 'AIへの文句が定番', messageCount: 1, updatedAt: '', lastSeenAt: 0}),
'- ゴミムシ: AIへの文句が定番',
);
});

test('updateGuildMemberMemos: 実生成コールバックでメモが保存され、失敗時は例外で消費を止められる', async () => {
let saved: unknown = null;
const adapter = {
get: async () => saved,
set: async (_guildId: string, _key: string, value: unknown) => { saved = value;},
};
const observations = [
{ authorId: 'u1', authorName: 'ゴミムシ', content: 'AIってゴミだよねわかる', at: 1},
{ authorId: 'u1', authorName: 'ゴミムシ', content: 'またAIが変な回答したわ', at: 2},
{ authorId: 'u2', authorName: 'たろう', content: 'マイクラやろう', at: 3},
{ authorId: 'u2', authorName: 'たろう', content: '新しいワールド作った', at: 4},
];
const result = await updateGuildMemberMemos('g1', observations, async () => JSON.stringify({
u1: 'AIへの文句が定番ネタ。',
}), adapter as never);
assert.equal(result.updated, 1);
const store = await loadGuildMemberMemoStore('g1', adapter as never);
assert.equal(store.memos.find(memo => memo.userId === 'u1')?.memo, 'AIへの文句が定番ネタ。');
// 観測はあったがメモ本文が無い u2 は、発言数だけ記録される
assert.equal(store.memos.find(memo => memo.userId === 'u2')?.messageCount, 2);

await assert.rejects(() => updateGuildMemberMemos('g1', observations, async () => {
throw new Error('gateway down');
}, adapter as never));
});

// ---------------------------------------------------------------------------
// 注入ブロック・セッション・ゲート整合
// ---------------------------------------------------------------------------

test('formatDotMemoryBlock: 出来事とメモの2セクションになり、両方空なら空文字', () => {
const block = formatDotMemoryBlock([episode()], [
{ userId: 'u1', name: 'たろう', memo: 'マイクラ好き', messageCount: 1, updatedAt: '', lastSeenAt: 0},
]);
assert.ok(block.includes('【過去の出来事（サーバーの記録）】'));
assert.ok(block.includes('- 2026-11-05 冷笑系熱血ゴミムシ: AIをゴミだと述べた（#vc組専用雑談）'));
assert.ok(block.includes('【今の会話に出ている人について（記録メモ）】'));
assert.ok(block.includes('- たろう: マイクラ好き'));
assert.equal(formatDotMemoryBlock([], []), '');
});

function logEntry(id: string, authorName: string, content: string): JudgeLogEntry {
return { id, at: 1_700_000_000_000, text: `[${id}] ${authorName}: ${content}`, mediaNotes: ''};
}

test('prepareAppendOnlyTurn: 記憶ブロックは変わった時だけ末尾へ追記される（dsh規律）', () => {
const session = createAppendOnlySession();
const blockA = formatDotMemoryBlock([episode()], []);
const first = prepareAppendOnlyTurn(session, 'SYS', {
entries: [logEntry('m1', 'たろう', 'おはよう')],
memoryPrompt: blockA,
tailLines: ['候補: m1'],
});
assert.ok(first.messages[1].content.includes('【過去の出来事（サーバーの記録）】'));
first.commit();

const second = prepareAppendOnlyTurn(session, 'SYS', {
entries: [logEntry('m2', 'たろう', 'つづき')],
memoryPrompt: blockA,
tailLines: ['候補: m2'],
});
// 同じブロックは再送しない（新しいターンの本文には含まれない）
assert.ok(!second.messages[second.messages.length - 1].content.includes('【過去の出来事（サーバーの記録）】'));
second.commit();

const blockB = formatDotMemoryBlock([episode({ summary: 'マイクラのサーバーが落ちた'})], []);
const third = prepareAppendOnlyTurn(session, 'SYS', {
entries: [logEntry('m3', 'たろう', 'また落ちた')],
memoryPrompt: blockB,
tailLines: ['候補: m3'],
});
assert.ok(third.messages[third.messages.length - 1].content.includes('マイクラのサーバーが落ちた'));
});

test('判定の下書きゲート: 過去の出来事だけに触れた下書きは、記憶ブロックを照合元に含めると通る', () => {
const decision = {
action: 'reply' as const,
confidence: 0.8,
targetMessageId: undefined,
reaction: undefined,
draft: 'またAIのことゴミって言ってるやん、5日も同じこと言ってたのに',
reason: 'test',
};
const conversationOnly = '[1] たろう: あいつまた始まったな';
const memoryBlock = formatDotMemoryBlock([episode()], []);
// 会話だけでは具体トークンが無く弾かれる
assert.equal(draftHasConcreteAnchor(decision, conversationOnly), false);
// 注入された出来事の文面を含めると、掘り返しの下書きが具体として認められる
assert.equal(draftHasConcreteAnchor(decision, `${conversationOnly}\n${memoryBlock}`), true);
});

test('プロンプト規律: 掘り返しは記録の範囲だけ・メモはラベル貼りに使わない、が明記されている', () => {
assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('過去の出来事（サーバーの記録）'));
assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('渡された記録にない出来事を作って言及してはならない'));
assert.ok(AMBIENT_SYSTEM_RULES.includes('思い出したように語るのは捏造なので禁止'));
assert.ok(AMBIENT_SYSTEM_RULES.includes('繰り返し蒸し返したり'));
assert.ok(AMBIENT_SYSTEM_RULES.includes('決めつけやラベル貼りに使わず'));
assert.ok(ADDRESSED_JUDGE_SYSTEM_PROMPT.includes('今の会話に出ている人について（記録メモ）'));
});
