import test from 'node:test';
import assert from 'node:assert/strict';
import {
FREE_STYLE_PRESET_ID,
STYLE_PRESETS,
buildPlanMessages,
generatePlanWithRepair,
getStylePreset,
planContextFromStructure,
summarizePlan,
validatePlan,
type GuildStructure,
} from '../src/core/serverBuilder/ServerBuilder.ts';

// 命名スタイル拡張（v7）のテスト。
// - プリセット拡充: 有名サーバーの実例に倣った4形式（二重バー/ブラケット/ツリー/アロー）を追加。
// - AI自由スタイル: スタイル選択に「おまかせ」を追加。プランナーは独自スタイルを設計し、
// プランに styleProposal として含める。検証は緩く（整形して保持）、自由スタイル選択時に
// styleProposal が欠けていれば検証エラーとして自動修復にかける。

const GUILD_ID = '777777777777777777';
const CAT_INFO = '100000000000000021';
const CAT_CHAT = '100000000000000022';
const CH_NEWS = '200000000000000021';
const CH_CHAT = '200000000000000022';

function makeStructure(): GuildStructure {
const noOverwrites: GuildStructure['channels'][number]['permissionOverwrites'] = [];
return {
guildId: GUILD_ID, guildName: 'テスト鯖',
categories: [
{ id: CAT_INFO, name: '情報', position: 0, permissionOverwrites: [], isPrivate: false},
{ id: CAT_CHAT, name: '雑談', position: 1, permissionOverwrites: [], isPrivate: false},
],
channels: [
{ id: CAT_INFO, name: '情報', kind: 'category', position: 0, permissionOverwrites: noOverwrites, permissionsSynced: null, isPrivate: false},
{ id: CH_NEWS, name: 'お知らせ', kind: 'announcement', parentId: CAT_INFO, position: 1, permissionOverwrites: noOverwrites, permissionsSynced: true, isPrivate: false},
{ id: CH_CHAT, name: '雑談', kind: 'text', parentId: CAT_CHAT, position: 2, permissionOverwrites: noOverwrites, permissionsSynced: true, isPrivate: false},
],
roles: [],
channelCount: 3,
};
}

const PROPOSAL = {
name: '星詠みブラケット',
channelFormat: '・名前',
categoryFormat: '（英字は大文字）',
description: '星詠みの世界観に合わせ、ブラケットで絵文字を囲む書式に統一しました',
examples: ['・お知らせ', '・雑談', '・ゲーム募集'],
};

test('プリセット: id一意・必須フィールド完備・新規プリセットが存在する', () => {
const ids = STYLE_PRESETS.map(p => p.id);
assert.equal(new Set(ids).size, ids.length, 'プリセットIDが重複していない');
for (const preset of STYLE_PRESETS) {
assert.ok(preset.label.length > 0, `${preset.id}: label がある`);
assert.ok(preset.description.length > 0, `${preset.id}: description がある`);
assert.ok(preset.example && preset.example.length > 0, `${preset.id}: example がある`);
assert.ok(preset.instruction.length > 0, `${preset.id}: 書式指示（instruction）がある`);
}
for (const id of ['doubleBar', 'bracket', 'tree', 'arrow', FREE_STYLE_PRESET_ID]) {
assert.ok(getStylePreset(id), `プリセット ${id} が解決できる`);
}
assert.equal(getStylePreset('does-not-exist'), null, '未知のIDは null');
assert.equal(getStylePreset(undefined)?.id, 'emoji', '未指定時のデフォルトは従来通り emoji');
});

test('プリセット: 新規4形式の書式指示にチャンネル/カテゴリ両方の型が含まれる', () => {
const expectations: Record<string, string[]> = {
doubleBar: ['║', '📢-announcements'],
bracket: ['【', '・', ''],
tree: ['├', '┌'],
arrow: ['»', '━information━'],
};
for (const [id, needles] of Object.entries(expectations)) {
const preset = getStylePreset(id)!;
for (const needle of needles) {
assert.ok(preset.instruction.includes(needle), `${id} の instruction に ${needle} が含まれる`);
}
}
});

test('プロンプト: 自由スタイルでは styleProposal スキーマと設計・品質規律が入る', () => {
const messages = buildPlanMessages({
request: '新しいカテゴリとチャンネルを作って',
style: getStylePreset(FREE_STYLE_PRESET_ID)!,
structure: makeStructure(),
});
const system = messages[0].content;
assert.ok(system.includes('"styleProposal"'), '出力スキーマに styleProposal がある');
assert.ok(system.includes('独自の命名スタイルを設計'), 'スタイル設計の指示がある');
assert.ok(system.includes('自由スタイルの品質規律'), '品質規律セクションがある');
assert.ok(system.includes('装飾体系は1つに統一'), '装飾統一の規律がある');
assert.ok(system.includes('名前の本文'), '本文を変えない規律がある');
assert.ok(system.includes('必ず同じ書式で一致させること'), '宣言と実名の一致ルールがある');
});

test('プロンプト: 通常プリセットでは自由スタイル用の指示は入らない', () => {
const messages = buildPlanMessages({
request: '新しいカテゴリとチャンネルを作って',
style: getStylePreset('doubleBar')!,
structure: makeStructure(),
});
const system = messages[0].content;
assert.ok(system.includes('║絵文字-名前'), 'プリセットの書式指示が入る');
assert.ok(system.includes('名前の本文'), '依頼文の名前を本文として扱う指示が入る');
assert.ok(!system.includes('自由スタイルの品質規律'), '自由スタイル用セクションは入らない');
assert.ok(!system.includes('"styleProposal"'), 'スキーマに styleProposal は入らない');
});

test('検証: 正しい styleProposal は整形されてプランに保持される', () => {
const ctx = planContextFromStructure(makeStructure());
const result = validatePlan({
version: 1,
summary: 'ブラケット形式に統一しました',
styleProposal: {
...PROPOSAL,
name: ' 星詠みブラケット ',
examples: ['・お知らせ', '・雑談', '・ゲーム募集', '・読書', '・創作', '・音楽'],
},
operations: [
{ type: 'renameChannel', channelId: CH_NEWS, name: '・お知らせ'},
],
}, ctx);
assert.ok(result.ok, result.ok? '': result.errors.join(' | '));
assert.ok(result.plan.styleProposal, 'styleProposal が保持される');
assert.equal(result.plan.styleProposal!.name, '星詠みブラケット', '前後空白は除去される');
assert.equal(result.plan.styleProposal!.channelFormat, '・名前');
assert.equal(result.plan.styleProposal!.examples.length, 5, 'examples は最大5件に切り詰められる');
});

test('検証: 形式の崩れた styleProposal はプランを落とさず提案だけ捨てる', () => {
const ctx = planContextFromStructure(makeStructure());
for (const broken of ['ただの文字列', { name: '名前だけ'}, { channelFormat: 'x'}, 42, null]) {
const result = validatePlan({
version: 1,
summary: 'テスト',
styleProposal: broken,
operations: [{ type: 'renameChannel', channelId: CH_CHAT, name: '💬｜雑談'}],
}, ctx);
assert.ok(result.ok, `styleProposal=${JSON.stringify(broken)} でもプランは通る`);
assert.equal(result.plan.styleProposal, undefined, '崩れた提案は保持しない');
}
});

test('検証: 未知のトップレベルフィールドは従来通り却下される', () => {
const ctx = planContextFromStructure(makeStructure());
const result = validatePlan({
version: 1,
summary: 'テスト',
unknownField: true,
operations: [],
}, ctx);
assert.ok(!result.ok, '未知フィールドは却下');
});

test('生成: 自由スタイルで styleProposal が欠けたら自動修復がかかり、含めば通る', async () => {
let calls = 0;
const outcome = await generatePlanWithRepair({
request: 'お知らせと雑談の名前をサーバーに合うスタイルで整えて',
style: getStylePreset(FREE_STYLE_PRESET_ID)!,
structure: makeStructure(),
generate: async () => {
calls += 1;
if (calls === 1) {
// 1回目: styleProposal なし → 検証エラーになるはず
return JSON.stringify({
version: 1,
summary: '整えました',
operations: [{ type: 'renameChannel', channelId: CH_NEWS, name: '・お知らせ'}],
});
}
return JSON.stringify({
version: 1,
summary: 'ブラケット形式に整えました',
styleProposal: PROPOSAL,
operations: [{ type: 'renameChannel', channelId: CH_NEWS, name: '・お知らせ'}],
});
},
});
assert.ok(outcome.ok, outcome.ok? '': outcome.errors.join(' | '));
assert.equal(calls, 2, '修復含め2回生成される');
assert.equal(outcome.repaired, true);
assert.equal(outcome.attempts, 2);
assert.equal(outcome.plan.styleProposal?.name, '星詠みブラケット');
});

test('生成: 自由スタイルで最初から styleProposal があれば1回で通る', async () => {
let calls = 0;
const outcome = await generatePlanWithRepair({
request: 'お知らせの名前を整えて',
style: getStylePreset(FREE_STYLE_PRESET_ID)!,
structure: makeStructure(),
generate: async () => {
calls += 1;
return JSON.stringify({
version: 1,
summary: '整えました',
styleProposal: PROPOSAL,
operations: [{ type: 'renameChannel', channelId: CH_NEWS, name: '・お知らせ'}],
});
},
});
assert.ok(outcome.ok, outcome.ok? '': outcome.errors.join(' | '));
assert.equal(calls, 1);
assert.equal(outcome.repaired, false);
});

test('生成: 通常プリセットでは styleProposal が無くても通る', async () => {
const outcome = await generatePlanWithRepair({
request: '雑談にアイコンを付けて',
style: getStylePreset('emoji')!,
structure: makeStructure(),
generate: async () => JSON.stringify({
version: 1,
summary: '付けました',
operations: [{ type: 'renameChannel', channelId: CH_CHAT, name: '💬｜雑談'}],
}),
});
assert.ok(outcome.ok, outcome.ok? '': outcome.errors.join(' | '));
assert.equal(outcome.attempts, 1);
assert.equal(outcome.plan.styleProposal, undefined);
});

test('プリセット: 装飾系プリセットに機械チェック用マーカーがある', () => {
assert.equal(getStylePreset('doubleBar')!.createMarker?.channelPrefix, '║');
assert.equal(getStylePreset('doubleBar')!.createMarker?.categoryPrefix, '║');
assert.equal(getStylePreset('bracket')!.createMarker?.channelPrefix, '【');
assert.equal(getStylePreset('tree')!.createMarker?.channelPrefix, '├');
assert.equal(getStylePreset('tree')!.createMarker?.categoryPrefix, '┌');
assert.equal(getStylePreset('arrow')!.createMarker?.channelPrefix, '»');
assert.equal(getStylePreset('emoji')!.createMarker?.channelContains, '｜');
assert.equal(getStylePreset('plain')!.createMarker, undefined);
assert.equal(getStylePreset(FREE_STYLE_PRESET_ID)!.createMarker, undefined, '自由スタイルは機械チェックしない');
});

test('生成: 装飾系プリセットで新規名が書式外れなら自動修復で書式通りに直る', async () => {
let calls = 0;
const outcome = await generatePlanWithRepair({
request: '新しいカテゴリ「ゲーム募集」とテキスト「募集掲示板」を作って',
style: getStylePreset('doubleBar')!,
structure: makeStructure(),
generate: async () => {
calls += 1;
if (calls === 1) {
return JSON.stringify({
version: 1,
summary: '作りました',
operations: [
{ type: 'createCategory', name: 'ゲーム募集' },
{ type: 'createChannel', name: '募集掲示板', channelType: 'text', categoryRef: { newIndex: 0 } },
],
});
}
return JSON.stringify({
version: 1,
summary: '二重バー形式で作りました',
operations: [
{ type: 'createCategory', name: '║ ゲーム募集 ║' },
{ type: 'createChannel', name: '║🎮-募集掲示板', channelType: 'text', categoryRef: { newIndex: 0 } },
],
});
},
});
assert.ok(outcome.ok, outcome.ok ? '' : outcome.errors.join(' | '));
assert.equal(calls, 2, '書式外れで修復が1回かかる');
assert.equal(outcome.repaired, true);
assert.deepEqual(outcome.plan.operations.map(o => (o as { name?: string }).name), ['║ ゲーム募集 ║', '║🎮-募集掲示板']);
});

test('生成: 書式外れが修復でも直らなければエラーとして返る', async () => {
const outcome = await generatePlanWithRepair({
request: '新しいカテゴリ「ゲーム募集」を作って',
style: getStylePreset('doubleBar')!,
structure: makeStructure(),
generate: async () => JSON.stringify({
version: 1,
summary: '作りました',
operations: [{ type: 'createCategory', name: 'ゲーム募集' }],
}),
});
assert.ok(!outcome.ok, '書式外れのままでは通らない');
assert.ok(outcome.errors.some(e => e.includes('書式')), `エラーに書式の指摘が含まれる: ${outcome.errors.join(' | ')}`);
assert.equal(outcome.attempts, 2);
});

test('生成: 絵文字プリセットでは「｜」のない新規チャンネル名が修復対象になる', async () => {
let calls = 0;
const outcome = await generatePlanWithRepair({
request: 'テキスト「読書記録」を作って',
style: getStylePreset('emoji')!,
structure: makeStructure(),
generate: async () => {
calls += 1;
return JSON.stringify({
version: 1,
summary: '作りました',
operations: [
{ type: 'createChannel', name: calls === 1 ? '読書記録' : '📚｜読書記録', channelType: 'text', categoryRef: CAT_CHAT },
],
});
},
});
assert.ok(outcome.ok, outcome.ok ? '' : outcome.errors.join(' | '));
assert.equal(calls, 2);
assert.equal((outcome.plan.operations[0] as { name?: string }).name, '📚｜読書記録');
});

test('監査サマリ: styleProposal があるプランはスタイル名が付く', () => {
const ctx = planContextFromStructure(makeStructure());
const result = validatePlan({
version: 1,
summary: '整えました',
styleProposal: PROPOSAL,
operations: [{ type: 'renameChannel', channelId: CH_NEWS, name: '・お知らせ'}],
}, ctx);
assert.ok(result.ok);
const summary = summarizePlan(result.plan);
assert.ok(summary.startsWith('[style:星詠みブラケット]'), `サマリにスタイル名が付く: ${summary}`);
});
