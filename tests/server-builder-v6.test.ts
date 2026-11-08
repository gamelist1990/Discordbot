import test from 'node:test';
import assert from 'node:assert/strict';
import {
    STYLE_PRESETS,
    buildPlanMessages,
    generatePlanWithRepair,
    getStylePreset,
    planContextFromStructure,
    validatePlan,
    type GuildStructure,
} from '../src/core/serverBuilder/ServerBuilder.ts';

// 2026-11-08 の実インシデント（PEX鯖）への回帰テスト（v6）。
// 問題1: fcaf3a8 で入れた「同名リネーム却下」ガードが裏目に出た。AIが既にアイコン付きの
//        チャンネルを今の名前のままリネームする無意味な操作（📊｜status→📊｜status 等）を
//        混ぜ、検証エラー→自動修復でも解消できず長いエラー文がユーザーに返った。
//        → 同名リネームは検証時に静かに取り除き（ドロップ）、残りが正しければ通す。
//          全部ドロップなら「すべて既に条件を満たしていた」正常系（plan.operations が0件）。
//          自動修復は同名リネーム起因では発火させない。
// 問題2: 「合ってないアイコンを直して」が1件しか拾わなかった
//        → プランナー規律として全チャンネル走査＋候補全件含有をプロンプトに固定する。
// 問題3: 命名スタイルのデフォルトは主流形式「絵文字｜名前」（plain初期値は装飾なし方向の事故の元）。

const GUILD_ID = '777777777777777777';
const STAFF_CAT = '100000000000000011';
const OTHER_CAT = '100000000000000012';
const CH = {
    status: '200000000000000011', // 📊｜status（付与済み）
    join: '200000000000000012', // 🚪｜join（付与済み）
    chatLog: '200000000000000013', // 📋｜chat-log（付与済み）
    rule: '200000000000000014', // ルール（未付与）
    news: '200000000000000015', // お知らせ（未付与）
};

function makeStructure(): GuildStructure {
    const noOverwrites: GuildStructure['channels'][number]['permissionOverwrites'] = [];
    return {
        guildId: GUILD_ID, guildName: 'テスト鯖',
        categories: [
            { id: STAFF_CAT, name: '🛡️スタッフ専用', position: 0, permissionOverwrites: [], isPrivate: true },
            { id: OTHER_CAT, name: '📁その他', position: 1, permissionOverwrites: [], isPrivate: false },
        ],
        channels: [
            { id: STAFF_CAT, name: '🛡️スタッフ専用', kind: 'category', position: 0, permissionOverwrites: noOverwrites, permissionsSynced: null, isPrivate: true },
            { id: CH.status, name: '📊｜status', kind: 'text', parentId: STAFF_CAT, position: 1, permissionOverwrites: noOverwrites, permissionsSynced: true, isPrivate: true },
            { id: CH.join, name: '🚪｜join', kind: 'text', parentId: STAFF_CAT, position: 2, permissionOverwrites: noOverwrites, permissionsSynced: true, isPrivate: true },
            { id: CH.chatLog, name: '📋｜chat-log', kind: 'text', parentId: STAFF_CAT, position: 3, permissionOverwrites: noOverwrites, permissionsSynced: true, isPrivate: true },
            { id: CH.rule, name: 'ルール', kind: 'text', parentId: STAFF_CAT, position: 4, permissionOverwrites: noOverwrites, permissionsSynced: true, isPrivate: true },
            { id: CH.news, name: 'お知らせ', kind: 'announcement', parentId: STAFF_CAT, position: 5, permissionOverwrites: noOverwrites, permissionsSynced: true, isPrivate: true },
            { id: OTHER_CAT, name: '📁その他', kind: 'category', position: 6, permissionOverwrites: noOverwrites, permissionsSynced: null, isPrivate: false },
        ],
        roles: [],
        channelCount: 7,
    };
}

test('検証: 同名リネームが混在しても、実操作だけ残して検証を通る（ドロップ）', () => {
    const ctx = planContextFromStructure(makeStructure());
    const result = validatePlan({
        version: 1,
        summary: 'スタッフのチャンネルにアイコンを付けました',
        operations: [
            { type: 'renameChannel', channelId: CH.status, name: '📊｜status' }, // 同名 → ドロップ
            { type: 'renameChannel', channelId: CH.rule, name: '🔰｜ルール' }, // 実操作
            { type: 'renameCategory', categoryId: STAFF_CAT, name: '🛡️スタッフ専用' }, // 同名 → ドロップ
            { type: 'setTopic', channelId: CH.news, topic: 'お知らせ用です' }, // 実操作
        ],
    }, ctx);
    assert.ok(result.ok, result.ok ? '' : result.errors.join(' | '));
    assert.equal(result.plan.operations.length, 2, '実操作2件だけが残る');
    assert.deepEqual(result.plan.operations.map(o => o.type), ['renameChannel', 'setTopic']);
    assert.equal(result.droppedNoops.length, 2, '同名リネーム2件がドロップとして記録される');
    assert.deepEqual(
        result.droppedNoops.map(d => `${d.type}:${d.targetId}:${d.name}`),
        [`renameChannel:${CH.status}:📊｜status`, `renameCategory:${STAFF_CAT}:🛡️スタッフ専用`],
    );
});

test('検証: 全部が同名リネームなら operations 0件の正常系（noop）になる', () => {
    const ctx = planContextFromStructure(makeStructure());
    const result = validatePlan({
        version: 1,
        summary: '対象はすべて既にアイコン付与済みでした',
        operations: [
            { type: 'renameChannel', channelId: CH.status, name: '📊｜status' },
            { type: 'renameChannel', channelId: CH.join, name: '🚪｜join' },
            { type: 'renameChannel', channelId: CH.chatLog, name: '📋｜chat-log' },
        ],
    }, ctx);
    assert.ok(result.ok, 'エラーにはならない');
    assert.equal(result.plan.operations.length, 0, '残る操作はない');
    assert.equal(result.droppedNoops.length, 3);
});

test('検証: operations が空配列でも正常系（noop）として通る', () => {
    const ctx = planContextFromStructure(makeStructure());
    const result = validatePlan({ version: 1, summary: '変更不要でした', operations: [] }, ctx);
    assert.ok(result.ok);
    assert.equal(result.plan.operations.length, 0);
    assert.equal(result.droppedNoops.length, 0);
});

test('検証: ドロップで位置がずれても createCategory への参照（newIndex / targetRef）は最終プランの位置に付け替わる', () => {
    const ctx = planContextFromStructure(makeStructure());
    const result = validatePlan({
        version: 1,
        summary: '新規カテゴリと配下チャンネル',
        operations: [
            { type: 'renameChannel', channelId: CH.status, name: '📊｜status' }, // 同名 → ドロップ（先頭）
            { type: 'createCategory', name: '🎮ゲーム' },
            { type: 'createChannel', name: '🎮｜募集', channelType: 'text', categoryRef: { newIndex: 1 } },
            { type: 'setPermissions', targetKind: 'category', targetRef: { index: 1 }, overwrites: [{ targetKind: 'everyone', allow: [], deny: ['ViewChannel'] }] },
        ],
    }, ctx);
    assert.ok(result.ok, result.ok ? '' : result.errors.join(' | '));
    assert.equal(result.droppedNoops.length, 1);
    assert.equal(result.plan.operations.length, 3);
    const created = result.plan.operations[1];
    assert.equal(created.type, 'createChannel');
    if (created.type === 'createChannel') {
        assert.deepEqual(created.categoryRef, { kind: 'new', index: 0 }, 'newIndex はドロップ後の位置（0）を指す');
    }
    const perms = result.plan.operations[2];
    assert.equal(perms.type, 'setPermissions');
    if (perms.type === 'setPermissions') {
        assert.deepEqual(perms.targetRef, { index: 0 }, 'targetRef もドロップ後の位置（0）を指す');
    }
});

test('生成フロー: 同名リネーム混在では自動修復が発火しない（1回で通る）', async () => {
    let calls = 0;
    const outcome = await generatePlanWithRepair({
        request: 'スタッフのチャンネル達にアイコン付いてないのでつけといて',
        style: getStylePreset('emoji')!,
        structure: makeStructure(),
        generate: async () => {
            calls += 1;
            return JSON.stringify({
                version: 1,
                summary: 'アイコン未付与の2件に付けました',
                operations: [
                    { type: 'renameChannel', channelId: CH.status, name: '📊｜status' }, // 同名（AIが混ぜがち）
                    { type: 'renameChannel', channelId: CH.rule, name: '🔰｜ルール' },
                    { type: 'renameChannel', channelId: CH.news, name: '📣｜お知らせ' },
                ],
            });
        },
    });
    assert.equal(calls, 1, '検証が通るので生成は1回だけ');
    assert.ok(outcome.ok);
    assert.equal(outcome.repaired, false);
    assert.equal(outcome.attempts, 1);
    assert.equal(outcome.plan.operations.length, 2);
    assert.equal(outcome.droppedNoops.length, 1);
    assert.equal(outcome.droppedNoops[0].targetId, CH.status);
});

test('生成フロー: 全部同名リネームでも修復せず、operations 0件の成功として返る', async () => {
    let calls = 0;
    const outcome = await generatePlanWithRepair({
        request: 'スタッフカテゴリのチャンネルにアイコンつけて',
        style: getStylePreset('emoji')!,
        structure: makeStructure(),
        generate: async () => {
            calls += 1;
            return JSON.stringify({
                version: 1,
                summary: '対象はすべて既にアイコン付与済みでした',
                operations: [
                    { type: 'renameChannel', channelId: CH.status, name: '📊｜status' },
                    { type: 'renameChannel', channelId: CH.join, name: '🚪｜join' },
                ],
            });
        },
    });
    assert.equal(calls, 1, '同名だけが理由で修復は発火しない');
    assert.ok(outcome.ok);
    assert.equal(outcome.plan.operations.length, 0, 'route 側で「変更不要」の通常表示になる形');
    assert.equal(outcome.droppedNoops.length, 2);
});

test('生成フロー: 同名リネームと本当の形式エラーが混在したら、修復は形式エラーのために発火する', async () => {
    let calls = 0;
    const outcome = await generatePlanWithRepair({
        request: 'アイコンつけて',
        style: getStylePreset('emoji')!,
        structure: makeStructure(),
        generate: async () => {
            calls += 1;
            if (calls === 1) {
                return JSON.stringify({
                    version: 1, summary: 'x',
                    operations: [
                        { type: 'renameChannel', channelId: CH.status, name: '📊｜status' }, // 同名（修復理由にならない）
                        { type: 'renameChannel', channelId: '999999999999999999', name: '💬｜存在しない' }, // 形式エラー
                    ],
                });
            }
            return JSON.stringify({
                version: 1, summary: '直しました',
                operations: [{ type: 'renameChannel', channelId: CH.rule, name: '🔰｜ルール' }],
            });
        },
    });
    assert.equal(calls, 2, '形式エラーがあるので修復が1回走る');
    assert.ok(outcome.ok);
    assert.equal(outcome.repaired, true);
    assert.equal(outcome.plan.operations.length, 1);
});

test('プランナープロンプト: 無意味な操作を出さない規律と、空プランでの正常終了が入っている', () => {
    const messages = buildPlanMessages({
        request: 'アイコン付いてないチャンネル全部に付けて',
        style: getStylePreset('emoji')!,
        structure: makeStructure(),
    });
    const system = messages.find(m => m.role === 'system')!.content;
    assert.ok(system.includes('現在の名前と同じ名前への renameChannel / renameCategory'), '同名リネームを出さない明示がある');
    assert.ok(system.includes('無意味な操作なので絶対に出力しないこと'), '同名リネーム禁止の強さが明記されている');
    assert.ok(system.includes('operations を空配列にし'), '対象が無い場合は空プランで正常終了する指示がある');
    assert.ok(system.includes('対象はすべて既に条件を満たしていました'), '空プラン時の summary の書き方がある');
});

test('プランナープロンプト: 「合ってないアイコンを直して」は全チャンネル走査＋候補全件含有の規律と具体例が入っている', () => {
    const messages = buildPlanMessages({
        request: 'チャンネル名と合ってないアイコンが付いてるものを適切なアイコンに直して欲しい',
        style: getStylePreset('emoji')!,
        structure: makeStructure(),
    });
    const system = messages.find(m => m.role === 'system')!.content;
    assert.ok(system.includes('アイコンの適合チェック'), '適合チェックのセクションがある');
    assert.ok(system.includes('全チャンネルを走査し'), '全チャンネル走査の指示がある');
    assert.ok(system.includes('すべて候補としてプランに含めること'), '候補を全部含める指示がある');
    assert.ok(system.includes('気づいた1件だけを選んで済ませない'), '1件だけで済ませない明示がある');
    assert.ok(system.includes('「📊｜お知らせ」は告知にグラフの絵文字が合わないので「📢｜お知らせ」'), '不一致→付け替えの具体例がある');
    assert.ok(system.includes('「💬｜ボイスチャット」は文字の雑談ではなく通話の場なので「🔊｜ボイスチャット」'), 'ボイス系の具体例がある');
    assert.ok(system.includes('名前と明らかに合っているチャンネルには触れないこと'), '合っているものは対象外の明示がある');
});

test('命名スタイル: 未指定時のデフォルトは「絵文字｜名前」で、全プリセットに見た目の例がある', () => {
    assert.equal(getStylePreset(undefined)?.id, 'emoji');
    assert.equal(getStylePreset(null)?.id, 'emoji');
    assert.equal(getStylePreset('')?.id, 'emoji');
    assert.equal(getStylePreset('plain')?.id, 'plain', '明示指定はそのまま効く');
    for (const preset of STYLE_PRESETS) {
        assert.ok(preset.example && preset.example.length > 0, `${preset.id} に例がある`);
    }
    assert.equal(STYLE_PRESETS.find(p => p.id === 'emoji')?.example, '💬｜雑談');
});
