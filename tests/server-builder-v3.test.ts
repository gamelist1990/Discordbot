import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPlanMessages,
    generatePlanWithRepair,
    getStylePreset,
    planContextFromStructure,
    resolvePlanFocus,
    validatePlan,
    type GuildStructure,
} from '../src/core/serverBuilder/ServerBuilder.ts';

const GUILD_ID = '999999999999999999';
const CHANNEL_ID = '111111111111111111';
const CHANNEL2_ID = '222222222222222222';
const CATEGORY_ID = '333333333333333333';
const ROLE_ID = '444444444444444444';
const ROLE2_ID = '555555555555555555';

function makeStructure(): GuildStructure {
    return {
        guildId: GUILD_ID, guildName: 'テスト',
        categories: [{ id: CATEGORY_ID, name: '🛡️スタッフ専用', position: 0, permissionOverwrites: [], isPrivate: true }],
        channels: [
            { id: CATEGORY_ID, name: '🛡️スタッフ専用', kind: 'category', position: 0, permissionOverwrites: [], permissionsSynced: null, isPrivate: true },
            { id: CHANNEL_ID, name: '💬｜雑談', kind: 'text', parentId: CATEGORY_ID, position: 0, permissionOverwrites: [], permissionsSynced: true, isPrivate: true },
            { id: CHANNEL2_ID, name: 'スタッフ連絡', kind: 'text', parentId: CATEGORY_ID, position: 1, permissionOverwrites: [], permissionsSynced: false, isPrivate: true },
        ],
        roles: [{ id: ROLE_ID, name: 'Staff' }, { id: ROLE2_ID, name: 'モデレーター' }],
        channelCount: 3,
    };
}

const CATEGORY_PERMS_PLAN = JSON.stringify({
    version: 1,
    summary: 'カテゴリをスタッフだけ見えるようにします',
    operations: [{
        type: 'setPermissions', targetKind: 'category', targetId: CATEGORY_ID,
        overwrites: [
            { targetKind: 'everyone', allow: [], deny: ['ViewChannel'] },
            { targetKind: 'role', roleId: ROLE_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], deny: [] },
            { targetKind: 'role', roleId: ROLE2_ID, allow: ['ViewChannel'], deny: ['SendMessages'] },
        ],
    }],
});

test('検証: 既存カテゴリのロール別権限上書きと既存チャンネルの編集が通る', () => {
    const ctx = planContextFromStructure(makeStructure());
    const parsed = JSON.parse(CATEGORY_PERMS_PLAN);
    const result = validatePlan(parsed, ctx);
    assert.equal(result.ok, true, JSON.stringify(result));
    const editPlan = {
        version: 1, summary: '既存チャンネルの編集',
        operations: [
            { type: 'renameChannel', channelId: CHANNEL_ID, name: '💬｜みんなの雑談' },
            { type: 'setTopic', channelId: CHANNEL_ID, topic: '雑談用です' },
            { type: 'setSlowmode', channelId: CHANNEL_ID, seconds: 3 },
            { type: 'renameCategory', categoryId: CATEGORY_ID, name: '🛡️スタッフ' },
            { type: 'syncPermissions', channelId: CHANNEL2_ID },
        ],
    };
    assert.equal(validatePlan(editPlan, ctx).ok, true);
});

test('検証: 31件プランは実際の件数を含むエラーになる', () => {
    const ctx = planContextFromStructure(makeStructure());
    const ops = Array.from({ length: 31 }, (_, i) => ({ type: 'renameChannel', channelId: CHANNEL_ID, name: `名前${i}` }));
    const result = validatePlan({ version: 1, summary: 'x', operations: ops }, ctx);
    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.ok(result.errors[0].includes('31件'), result.errors[0]);
        assert.ok(result.errors[0].includes('30'), result.errors[0]);
    }
});

test('プロンプト: 件数規律・カテゴリ権限は1件・上書き上限の明記がある', () => {
    const preset = getStylePreset('plain'); assert.ok(preset);
    const msgs = buildPlanMessages({ request: '権限を直して', style: preset, structure: makeStructure() });
    const system = msgs[0].content;
    assert.ok(system.includes('件数の規律'), '件数規律の見出し');
    assert.ok(system.includes('30件を超えるプランは無効'), '上限超過の扱い');
    assert.ok(system.includes('targetKind:"category"'), 'カテゴリ権限の指定');
    assert.ok(system.includes('overwrites は1〜10件'), '上書き件数の上限');
    assert.ok(system.includes('リネーム提案は最大5件まで'), 'リネーム提案の上限');
});

test('focus: 解決と文脈への埋め込み、不正な対象は null', () => {
    const structure = makeStructure();
    const focus = resolvePlanFocus(structure, { kind: 'category', id: CATEGORY_ID });
    assert.deepEqual(focus, { kind: 'category', id: CATEGORY_ID, name: '🛡️スタッフ専用' });
    assert.deepEqual(resolvePlanFocus(structure, { kind: 'channel', id: CHANNEL_ID })?.name, '💬｜雑談');
    assert.equal(resolvePlanFocus(structure, { kind: 'category', id: CHANNEL_ID }), null);
    assert.equal(resolvePlanFocus(structure, { kind: 'channel', id: '999999999999999999' }), null);
    assert.equal(resolvePlanFocus(structure, { kind: 'guild', id: CATEGORY_ID }), null);
    assert.equal(resolvePlanFocus(structure, null), null);
    assert.equal(resolvePlanFocus(structure, 'x'), null);

    const preset = getStylePreset('plain'); assert.ok(preset);
    const msgs = buildPlanMessages({ request: '権限をスタッフだけにして', style: preset, structure, focus });
    assert.ok(msgs[1].content.includes('<focus>'));
    assert.ok(msgs[1].content.includes('🛡️スタッフ専用'));
    assert.ok(msgs[1].content.includes(CATEGORY_ID));
    const noFocus = buildPlanMessages({ request: 'x', style: preset, structure });
    assert.ok(!noFocus[1].content.includes('<focus>'));
});

test('repair文脈: 却下理由と前回出力がデータとして渡る', () => {
    const preset = getStylePreset('plain'); assert.ok(preset);
    const msgs = buildPlanMessages({
        request: '権限を直して', style: preset, structure: makeStructure(),
        repair: { previousOutput: '{"version":1,"operations":[]}', errors: ['操作は最大30件までです（出力は45件でした）'] },
    });
    assert.ok(msgs[0].content.includes('検証で却下されたプランの修正'));
    assert.ok(msgs[1].content.includes('<validation-errors>'));
    assert.ok(msgs[1].content.includes('45件でした'));
    assert.ok(msgs[1].content.includes('<previous-plan>'));
});

function tooManyOpsOutput(): string {
    const ops = Array.from({ length: 31 }, (_, i) => ({ type: 'renameChannel', channelId: CHANNEL_ID, name: `名前${i}` }));
    return JSON.stringify({ version: 1, summary: '全部変えます', operations: ops });
}

test('自動修復: 初回が件数超過→修復でカテゴリ権限プランが通り、理由がフィードバックされる', async () => {
    const preset = getStylePreset('plain'); assert.ok(preset);
    const seen: string[] = [];
    const outcome = await generatePlanWithRepair({
        request: 'スタッフ専用カテゴリの権限を整えて', style: preset, structure: makeStructure(),
        generate: async (messages) => {
            seen.push(messages.map(m => m.content).join('\n'));
            return seen.length === 1 ? tooManyOpsOutput() : CATEGORY_PERMS_PLAN;
        },
    });
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
        assert.equal(outcome.repaired, true);
        assert.equal(outcome.attempts, 2);
        assert.equal(outcome.plan.operations.length, 1);
        assert.equal(outcome.plan.operations[0].type, 'setPermissions');
    }
    assert.equal(seen.length, 2);
    assert.ok(seen[1].includes('<validation-errors>'), '修復リクエストに却下理由が含まれる');
    assert.ok(seen[1].includes('31件'), '件数超過の理由が渡る');
});

test('自動修復: 初回が非JSONでも修復で通る', async () => {
    const preset = getStylePreset('plain'); assert.ok(preset);
    let calls = 0;
    const outcome = await generatePlanWithRepair({
        request: '権限を整えて', style: preset, structure: makeStructure(),
        generate: async () => { calls += 1; return calls === 1 ? 'すみません、プランはこちらです' : CATEGORY_PERMS_PLAN; },
    });
    assert.equal(outcome.ok, true);
    if (outcome.ok) assert.equal(outcome.repaired, true);
});

test('自動修復: 2回とも失敗したら最終理由と初回理由の両方が返る', async () => {
    const preset = getStylePreset('plain'); assert.ok(preset);
    let calls = 0;
    const outcome = await generatePlanWithRepair({
        request: '権限を整えて', style: preset, structure: makeStructure(),
        generate: async () => {
            calls += 1;
            if (calls === 1) return tooManyOpsOutput();
            return JSON.stringify({ version: 1, summary: 'x', operations: [{ type: 'renameChannel', channelId: '999999999999999999', name: 'x' }] });
        },
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
        assert.equal(outcome.attempts, 2);
        assert.ok(outcome.firstErrors[0].includes('31件'), JSON.stringify(outcome.firstErrors));
        assert.ok(outcome.errors.some(e => e.includes('存在しないチャンネルID')), JSON.stringify(outcome.errors));
    }
});

test('自動修復: canRepair=false なら1回で打ち切り、初回の具体的理由が返る', async () => {
    const preset = getStylePreset('plain'); assert.ok(preset);
    let calls = 0;
    const outcome = await generatePlanWithRepair({
        request: '権限を整えて', style: preset, structure: makeStructure(),
        generate: async () => { calls += 1; return tooManyOpsOutput(); },
        canRepair: () => false,
    });
    assert.equal(calls, 1);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
        assert.equal(outcome.attempts, 1);
        assert.ok(outcome.errors[0].includes('31件'));
    }
});

test('自動修復なし: 初回で通れば1回だけ呼ばれる', async () => {
    const preset = getStylePreset('plain'); assert.ok(preset);
    let calls = 0;
    const outcome = await generatePlanWithRepair({
        request: '権限を整えて', style: preset, structure: makeStructure(),
        generate: async () => { calls += 1; return CATEGORY_PERMS_PLAN; },
    });
    assert.equal(calls, 1);
    assert.equal(outcome.ok, true);
    if (outcome.ok) assert.equal(outcome.repaired, false);
});
