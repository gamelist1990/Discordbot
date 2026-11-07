import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import {
    searchChannelMessagesHandler,
    searchChannelMessagesDefinition,
} from '../src/commands/staff/subcommands/ai-tools/channelSearch.ts';
import {
    buildSearchQuery,
    scoreSearchMatch,
    tokenizeSearchQuery,
} from '../src/core/ai/SearchText.ts';

test('検索クエリは単語に分割される（連結語・スペース・助詞境界）', () => {
    // 「AIゴミ」のような連結した言い回しでも、英字とカタカナの境界で割れる。
    assert.deepEqual(tokenizeSearchQuery('AIゴミ'), ['ai', 'ゴミ']);
    assert.deepEqual(tokenizeSearchQuery('AI ゴミ'), ['ai', 'ゴミ']);
    assert.deepEqual(tokenizeSearchQuery('ＡＩゴミ'), ['ai', 'ゴミ']);
    // 助詞だけの断片は、複数語に割れた場合に限り落とす。
    assert.deepEqual(tokenizeSearchQuery('ゲームの話'), ['ゲーム', '話']);
    assert.deepEqual(tokenizeSearchQuery('ゲーム、話'), ['ゲーム', '話']);
});

test('一致度: フレーズ一致＞全単語一致＞一部単語一致', () => {
    const built = buildSearchQuery('AIゴミ');
    // スペースを除いた連結形でフレーズ一致。
    assert.equal(scoreSearchMatch('そのAI ゴミ発言はひどい', built).level, 3);
    assert.equal(scoreSearchMatch('AIゴミって言った', built).level, 3);
    // 助詞が挟まっていても全単語が部分一致すれば全単語一致（今回の動機ケース）。
    assert.equal(scoreSearchMatch('AIはゴミだと思う、正直', built).level, 2);
    // 片方だけなら一部単語一致。
    assert.equal(scoreSearchMatch('AIの話はもうやめよう', built).level, 1);
    assert.equal(scoreSearchMatch('ゴミの日は明日だよ', built).level, 1);
    assert.equal(scoreSearchMatch('今日はいい天気だね', built).level, 0);
});

const guildId = '123456789012345678';
const channelId = '223456789012345678';
const userId = '323456789012345678';
const botId = '423456789012345678';
const messages = [
    { id: '523456789012345685', content: '今日はいい天気だね' },
    { id: '523456789012345684', content: 'AIはゴミだと思う、正直' },
    { id: '523456789012345683', content: 'そのAI ゴミ発言はひどい' },
    { id: '523456789012345682', content: 'AIの話はもうやめよう' },
    { id: '523456789012345681', content: 'ゴミの日は明日だよ' },
].map(item => ({
    ...item, createdAt: new Date('2026-11-05T12:00:00Z'),
    author: { id: userId, username: 'test', bot: false },
    attachments: new Collection(), member: null,
}));

function fixture() {
    const calls: unknown[] = [];
    const channel = {
        id: channelId, guildId,
        isTextBased: () => true,
        permissionsFor: (member: { id: string }) => ({
            has: (_: unknown) => true,
        }),
        messages: {
            fetch: async (query: any) => {
                calls.push(query);
                if (typeof query === 'string') return messages.find(x => x.id === query) || null;
                if (query.around) return new Collection(messages.map(x => [x.id, x]));
                return new Collection(messages
                    .filter(x => !query.before || BigInt(x.id) < BigInt(query.before))
                    .slice(0, query.limit).map(x => [x.id, x]));
            },
        },
    };
    const interaction = {
        user: { id: userId }, guildId, channelId, client: { user: { id: botId } },
        guild: {
            channels: { fetch: async (id: string) => id === channelId ? channel : null },
            members: { fetch: async (id: string) => id === userId ? { id: userId } : null },
        },
    };
    return { interaction, calls };
}

test('発言検索は部分一致で助詞入りの実発言を拾い、一致度順に返す', async () => {
    const { interaction } = fixture();
    const result = JSON.parse(await searchChannelMessagesHandler({
        query: 'AIゴミ', limit: 5, include_context: false,
    }, interaction) as string);
    assert.deepEqual(result.results.map((r: any) => r.message_id), [
        '523456789012345683',
        '523456789012345684',
        '523456789012345682',
        '523456789012345681',
    ]);
    assert.deepEqual(result.results.map((r: any) => r.match_level), [3, 2, 1, 1]);
    assert.deepEqual(result.match_summary, { phrase: 1, all_words: 1, partial: 2 });
    assert.equal(result.scanned, 5);
    assert.equal(result.results[1].author, 'test');
});

test('発言検索が0件のとき、試した単語と再検索のヒントを返す', async () => {
    const { interaction } = fixture();
    const result = JSON.parse(await searchChannelMessagesHandler({
        query: '存在しない話題', limit: 5, include_context: false,
    }, interaction) as string);
    assert.equal(result.results.length, 0);
    assert.ok(Array.isArray(result.tried.terms) && result.tried.terms.length >= 1);
    assert.equal(result.tried.query, '存在しない話題');
    assert.ok(typeof result.retry_hint === 'string' && result.retry_hint.length > 0);
});

test('発言検索のスキャン上限は5000件まで拡大されている', () => {
    const params = (searchChannelMessagesDefinition as any).function.parameters.properties;
    assert.equal(params.scan_limit.maximum, 5000);
});
