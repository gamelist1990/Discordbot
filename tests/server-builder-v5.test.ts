import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPlanMessages,
    generatePlanWithRepair,
    getStylePreset,
    planContextFromStructure,
    validatePlan,
    type GuildStructure,
} from '../src/core/serverBuilder/ServerBuilder.ts';

// 2026-11-08 の実インシデント（PEX鯖）への回帰テスト。
// 1回目: 「スタッフカテゴリのスタッフチャンネルにアイコン付いてないのでつけて欲しい」で
//        カテゴリ内の未付与5件中1件だけがリネームされた。
// 2回目: 「ちゃんと複数アイコン付いてないチャンネルお願い」が「重複した装飾の整理」と
//        逆向きに解釈され、既存の絵文字プレフィックスを剥がすプランが出た。
// 範囲解釈の規律はプランナープロンプト（buildPlanMessages）に具体例付きで入っていること、
// 正しい範囲のプラン（対象全件へのアイコン付与）が検証を通ることを固定する。

const GUILD_ID = '888888888888888888';
const STAFF_CAT = '100000000000000001';
const PROG_CAT = '100000000000000002';
const CH = {
    staffVc: '200000000000000001',
    announce: '200000000000000002',
    staffChat: '200000000000000003',
    aiLog: '200000000000000004',
    alert: '200000000000000005',
    mcSupport: '200000000000000006',
    programming: '200000000000000007',
};

function makeStructure(): GuildStructure {
    const noOverwrites: GuildStructure['channels'][number]['permissionOverwrites'] = [];
    return {
        guildId: GUILD_ID, guildName: 'テスト鯖',
        categories: [
            { id: STAFF_CAT, name: '🛡️スタッフ専用', position: 0, permissionOverwrites: [], isPrivate: true },
            { id: PROG_CAT, name: '＝＝＝プログラミング＝＝＝', position: 1, permissionOverwrites: [], isPrivate: false },
        ],
        channels: [
            { id: STAFF_CAT, name: '🛡️スタッフ専用', kind: 'category', position: 0, permissionOverwrites: noOverwrites, permissionsSynced: null, isPrivate: true },
            { id: CH.staffVc, name: 'staff-vc', kind: 'voice', parentId: STAFF_CAT, position: 1, permissionOverwrites: noOverwrites, permissionsSynced: true, isPrivate: true },
            { id: CH.announce, name: 'announce', kind: 'text', parentId: STAFF_CAT, position: 2, permissionOverwrites: noOverwrites, permissionsSynced: true, isPrivate: true },
            { id: CH.staffChat, name: 'staff-chat', kind: 'text', parentId: STAFF_CAT, position: 3, permissionOverwrites: noOverwrites, permissionsSynced: true, isPrivate: true },
            { id: CH.aiLog, name: 'ai-log', kind: 'text', parentId: STAFF_CAT, position: 4, permissionOverwrites: noOverwrites, permissionsSynced: true, isPrivate: true },
            { id: CH.alert, name: 'alert', kind: 'text', parentId: STAFF_CAT, position: 5, permissionOverwrites: noOverwrites, permissionsSynced: true, isPrivate: true },
            { id: CH.mcSupport, name: '🛠️｜マイクラサポート', kind: 'text', parentId: STAFF_CAT, position: 6, permissionOverwrites: noOverwrites, permissionsSynced: true, isPrivate: true },
            { id: PROG_CAT, name: '＝＝＝プログラミング＝＝＝', kind: 'category', position: 7, permissionOverwrites: noOverwrites, permissionsSynced: null, isPrivate: false },
            { id: CH.programming, name: '💻｜プログラミング', kind: 'text', parentId: PROG_CAT, position: 8, permissionOverwrites: noOverwrites, permissionsSynced: false, isPrivate: false },
        ],
        roles: [],
        channelCount: 9,
    };
}

/** スタッフカテゴリ内でアイコン未付与の全5件に絵文字を付ける「正しい」プラン。 */
function goodIconPlan() {
    return {
        version: 1,
        summary: 'スタッフカテゴリでアイコン未付与の5件に絵文字を付けました',
        operations: [
            { type: 'renameChannel', channelId: CH.staffVc, name: '🔊｜staff-vc' },
            { type: 'renameChannel', channelId: CH.announce, name: '📢｜announce' },
            { type: 'renameChannel', channelId: CH.staffChat, name: '💬｜staff-chat' },
            { type: 'renameChannel', channelId: CH.aiLog, name: '📋｜ai-log' },
            { type: 'renameChannel', channelId: CH.alert, name: '🚨｜alert' },
        ],
    };
}

test('プランナープロンプト: 範囲解釈の規律（カテゴリ内全件・複数の意味・除去は明示時のみ）が入っている', () => {
    for (const styleId of ['plain', 'emoji']) {
        const messages = buildPlanMessages({
            request: 'スタッフカテゴリのスタッフチャンネルにアイコン付いてないのでつけて欲しい',
            style: getStylePreset(styleId)!,
            structure: makeStructure(),
        });
        const system = messages.find(m => m.role === 'system')!.content;
        assert.ok(system.includes('依頼の範囲の解釈（厳守）'), `${styleId}: 範囲解釈セクションがある`);
        assert.ok(system.includes('条件に合うチャンネル全部が対象'), `${styleId}: カテゴリ指定は配下の該当全件が対象`);
        assert.ok(system.includes('代表の1件だけを選んで済ませない'), `${styleId}: 1件だけ選ぶことを禁じている`);
        assert.ok(system.includes('「複数」は原則として対象の数のこと'), `${styleId}: 複数＝対象の数と定義している`);
        assert.ok(system.includes('除去の明示がある場合にだけ行う'), `${styleId}: 装飾の除去は明示がある場合だけ`);
        assert.ok(system.includes('正反対の解釈であり厳禁'), `${styleId}: 付与依頼への除去混入を厳禁としている`);
        assert.ok(system.includes('スタイルが「装飾なし」でもアイコンを付けること'), `${styleId}: 依頼の明示指示が命名スタイルに優先する`);
        assert.ok(system.includes('広めに含めること'), `${styleId}: 曖昧な場合は候補を広めに含める`);
    }
});

test('プランナープロンプト: 具体例としてインシデントの言い回し2件と除去が正当な例が入っている', () => {
    const messages = buildPlanMessages({
        request: 'x', style: getStylePreset('plain')!, structure: makeStructure(),
    });
    const system = messages.find(m => m.role === 'system')!.content;
    assert.ok(system.includes('範囲解釈の具体例'));
    assert.ok(system.includes('スタッフカテゴリのスタッフチャンネルにアイコン付いてないのでつけて欲しい'), '例1: 1回目の依頼文がそのまま入っている');
    assert.ok(system.includes('ちゃんと複数アイコン付いてないチャンネルお願い'), '例2: 2回目の依頼文がそのまま入っている');
    assert.ok(system.includes('アイコンが二重に付いてるチャンネルを直して'), '例3: 除去が正当な言い回しも入っている');
    assert.ok(system.includes('対象範囲と件数が分かる文にすること'), 'summary は範囲と件数を書く規律がある');
});

test('検証: カテゴリ内のアイコン未付与チャンネル全件（5件）への付与プランが通る', () => {
    const structure = makeStructure();
    const result = validatePlan(goodIconPlan(), planContextFromStructure(structure));
    assert.ok(result.ok, result.ok ? '' : result.errors.join(' | '));
    assert.equal(result.plan.operations.length, 5);
    const targets = result.plan.operations.map(op => (op.type === 'renameChannel' ? op.channelId : ''));
    // 付与済みの2件（マイクラサポート、プログラミング）には触れていないこと。
    assert.ok(!targets.includes(CH.mcSupport), '付与済みのチャンネルは対象に含まない');
    assert.ok(!targets.includes(CH.programming), '他カテゴリのチャンネルは対象に含まない');
});

test('検証: 現在の名前と同じ名前へのリネーム（無意味な操作）はエラーにせず静かに取り除かれる', () => {
    // v5（fcaf3a8）では同名リネームを検証エラーとして却下していたが、AIが既に条件を満たす
    // チャンネルを同名で混ぜるだけでプラン全体が詰まる事故が起きたため、v6でドロップ方式に変更した。
    const structure = makeStructure();
    const plan = {
        version: 1,
        summary: 'アイコンを付けました',
        operations: [
            // 既に絵文字付きのチャンネルを同名でリネームするだけの操作（実API検証で実際に観測された無駄な操作）。
            { type: 'renameChannel', channelId: CH.mcSupport, name: '🛠️｜マイクラサポート' },
            { type: 'renameCategory', categoryId: STAFF_CAT, name: '🛡️スタッフ専用' },
        ],
    };
    const result = validatePlan(plan, planContextFromStructure(structure));
    assert.ok(result.ok, '同名リネームだけのプランでも検証エラーにはならない');
    assert.equal(result.plan.operations.length, 0, '同名リネームはすべて取り除かれる');
    assert.equal(result.droppedNoops.length, 2);
    assert.deepEqual(result.droppedNoops.map(d => d.targetId), [CH.mcSupport, STAFF_CAT]);
});

test('生成フロー: 「ちゃんと複数アイコン付いてないチャンネルお願い」で複数件の付与プランが検証を通る', async () => {
    const structure = makeStructure();
    const seenSystems: string[] = [];
    const outcome = await generatePlanWithRepair({
        request: 'ちゃんと複数アイコン付いてないチャンネルお願い',
        style: getStylePreset('plain')!,
        structure,
        generate: async messages => {
            seenSystems.push(messages.find(m => m.role === 'system')!.content);
            return JSON.stringify(goodIconPlan());
        },
    });
    assert.ok(outcome.ok, outcome.ok ? '' : outcome.errors.join(' | '));
    assert.equal(outcome.plan.operations.length, 5, '複数件のプランになっている');
    assert.ok(seenSystems[0].includes('依頼の範囲の解釈（厳守）'), '生成に渡るプロンプトに範囲解釈の規律が含まれている');
    const oldNames = new Map(structure.channels.map(c => [c.id, c.name]));
    for (const op of outcome.plan.operations) {
        assert.equal(op.type, 'renameChannel');
        if (op.type === 'renameChannel') {
            const before = oldNames.get(op.channelId)!;
            assert.ok(!before.includes('｜'), `変更前「${before}」は絵文字プレフィックスなし`);
            assert.ok(op.name.includes('｜'), `変更後「${op.name}」には絵文字プレフィックスが付いている（除去方向の操作が混ざっていない）`);
        }
    }
});
