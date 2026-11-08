import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SERVER_BUILDER_BUDGET_LIMIT,
    SERVER_BUILDER_BUDGET_WINDOW_MS,
    ServerBuilderBudget,
    ServerBuilderLimiter,
    buildPlanMessages,
    computeBudgetStatus,
    consumeServerBuilderPreview,
    createServerBuilderPreview,
    estimateTokensFromText,
    executePlan,
    extractPlanJson,
    getStylePreset,
    normalizeBudgetStore,
    validatePlan,
    type BudgetStoreAdapter,
    type GuildStructure,
    type ServerBuilderGuildAdapter,
    type ServerBuilderPlan,
} from '../src/core/serverBuilder/ServerBuilder.ts';
import { canGeneratePersona } from '../src/web/routes/staff/personaGenerationGuard.ts';

const CHANNEL_ID = '111111111111111111';
const CHANNEL2_ID = '222222222222222222';
const CATEGORY_ID = '333333333333333333';
const ROLE_ID = '444444444444444444';

function makeStructure(overrides: Partial<GuildStructure> = {}): GuildStructure {
    return {
        guildId: '999999999999999999',
        guildName: 'テストサーバー',
        categories: [{ id: CATEGORY_ID, name: '一般' }],
        channels: [
            { id: CATEGORY_ID, name: '一般', kind: 'category' },
            { id: CHANNEL_ID, name: '雑談', kind: 'text', parentId: CATEGORY_ID },
            { id: CHANNEL2_ID, name: 'ボイス', kind: 'voice', parentId: CATEGORY_ID },
        ],
        roles: [{ id: ROLE_ID, name: 'スタッフ' }],
        channelCount: 3,
        ...overrides,
    };
}

function ctxFrom(structure: GuildStructure) {
    return {
        channelIds: new Set(structure.channels.filter(c => c.kind !== 'category').map(c => c.id)),
        categoryIds: new Set(structure.categories.map(c => c.id)),
        roleIds: new Set(structure.roles.map(r => r.id)),
        currentChannelCount: structure.channelCount,
    };
}

function memoryBudgetAdapter(): BudgetStoreAdapter & { data: Map<string, unknown> } {
    const data = new Map<string, unknown>();
    return {
        data,
        get: async (_guildId: string, key: string) => data.get(key) ?? null,
        set: async (_guildId: string, key: string, value: unknown) => { data.set(key, value); },
    };
}

// ---------------------------------------------------------------------------
// 認可（personaGenerationGuard の流儀を共用することの確認）
// ---------------------------------------------------------------------------

test('サーバー構築の認可はギルド管理者（レベル2以上）またはBot管理者のみ', () => {
    assert.equal(canGeneratePersona({ permissionLevel: 0, isBotOwner: false }), false);
    assert.equal(canGeneratePersona({ permissionLevel: 1, isBotOwner: false }), false);
    assert.equal(canGeneratePersona({ permissionLevel: 2, isBotOwner: false }), true);
    assert.equal(canGeneratePersona({ permissionLevel: 0, isBotOwner: true }), true);
});

// ---------------------------------------------------------------------------
// 予算
// ---------------------------------------------------------------------------

test('予算: ウィンドウ集計と回復目安', () => {
    const now = Date.parse('2026-11-07T12:00:00Z');
    const status = computeBudgetStatus([
        { at: now - 60_000, tokens: 30_000 },
        { at: now - SERVER_BUILDER_BUDGET_WINDOW_MS - 1, tokens: 50_000 }, // 窓外
        { at: now - 30_000, tokens: 10_000 },
    ], now);
    assert.equal(status.used, 40_000);
    assert.equal(status.limit, SERVER_BUILDER_BUDGET_LIMIT);
    assert.equal(status.remaining, SERVER_BUILDER_BUDGET_LIMIT - 40_000);
    assert.equal(status.nextRecoveryAt, now - 60_000 + SERVER_BUILDER_BUDGET_WINDOW_MS);
    assert.equal(status.fullRecoveryAt, now - 30_000 + SERVER_BUILDER_BUDGET_WINDOW_MS);
    const empty = computeBudgetStatus([], now);
    assert.equal(empty.used, 0);
    assert.equal(empty.nextRecoveryAt, null);
});

test('予算: 上限到達時は生成不可になり、永続化ラウンドトリップできる', async () => {
    let now = Date.parse('2026-11-07T12:00:00Z');
    const adapter = memoryBudgetAdapter();
    const budget = new ServerBuilderBudget(adapter, () => now);
    assert.equal((await budget.checkCanGenerate('g1')).ok, true);
    await budget.record('g1', { tokens: SERVER_BUILDER_BUDGET_LIMIT - 1000, inputTokens: 90000, outputTokens: 9000 });
    const blocked = await budget.checkCanGenerate('g1');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status.remaining, 1000);

    // 別インスタンス（再起動相当）でも保存済みデータから同じ状態を復元できる。
    const revived = new ServerBuilderBudget(adapter, () => now);
    assert.equal((await revived.status('g1')).used, SERVER_BUILDER_BUDGET_LIMIT - 1000);

    // ウィンドウを過ぎれば回復する。
    now += SERVER_BUILDER_BUDGET_WINDOW_MS + 1000;
    assert.equal((await revived.checkCanGenerate('g1')).ok, true);
    assert.equal((await revived.status('g1')).used, 0);
});

test('予算: 保存データの正規化は壊れたイベントを落とす', () => {
    const store = normalizeBudgetStore({
        version: 1,
        events: [
            { at: 1000, tokens: 500 },
            { at: 'x', tokens: 100 },
            { at: 2000, tokens: -5 },
            null,
            { at: 3000, tokens: 250.7, estimated: true },
        ],
    });
    assert.equal(store.events.length, 2);
    assert.equal(store.events[1].tokens, 250);
    assert.equal(store.events[1].estimated, true);
    assert.ok(estimateTokensFromText('あ'.repeat(100)) > 0);
});

// ---------------------------------------------------------------------------
// プラン検証
// ---------------------------------------------------------------------------

test('プラン検証: 正常プランを受理する（新規カテゴリ参照つき）', () => {
    const ctx = ctxFrom(makeStructure());
    const result = validatePlan({
        version: 1,
        summary: 'ゲーム用カテゴリを作る',
        operations: [
            { type: 'createCategory', name: 'ゲーム' },
            { type: 'createChannel', name: 'ゲーム募集', channelType: 'text', categoryRef: { newIndex: 0 }, topic: '募集用' },
            { type: 'createChannel', name: 'ゲームVC', channelType: 'voice', categoryRef: CATEGORY_ID },
            { type: 'renameChannel', channelId: CHANNEL_ID, name: '💬｜雑談' },
            { type: 'setSlowmode', channelId: CHANNEL_ID, seconds: 5 },
            {
                type: 'setPermissions', targetKind: 'channel', targetRef: { index: 1 },
                overwrites: [{ targetKind: 'everyone', allow: ['ViewChannel'], deny: ['SendMessages'] }],
            },
        ],
    }, ctx);
    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.plan.operations.length, 6);
        const created = result.plan.operations[1];
        assert.equal(created.type, 'createChannel');
        if (created.type === 'createChannel') {
            assert.deepEqual(created.categoryRef, { kind: 'new', index: 0 });
        }
    }
});

test('プラン検証: 削除系・未知操作・未知フィールドを拒否する', () => {
    const ctx = ctxFrom(makeStructure());
    for (const bad of [
        { operations: [{ type: 'deleteChannel', channelId: CHANNEL_ID }] },
        { operations: [{ type: 'deleteCategory', categoryId: CATEGORY_ID }] },
        { operations: [{ type: 'kickMember', userId: CHANNEL_ID }] },
        { operations: [{ type: 'createCategory', name: 'x', extra: 1 }] },
        { operations: [{ type: 'createCategory', name: 'x' }], admin: true },
        // 注: 空の operations 配列は「対象がすべて既に条件を満たしていた」正常系として扱う（v6で変更）。
        { operations: 'nope' },
        'not-an-object',
    ]) {
        assert.equal(validatePlan(bad, ctx).ok, false, JSON.stringify(bad));
    }
});

test('プラン検証: 未知権限・存在しない参照・名前長超過・slowmode範囲外を拒否する', () => {
    const ctx = ctxFrom(makeStructure());
    const cases: unknown[] = [
        { operations: [{ type: 'setPermissions', targetKind: 'channel', targetId: CHANNEL_ID, overwrites: [{ targetKind: 'everyone', allow: ['FlyToMoon'], deny: [] }] }] },
        { operations: [{ type: 'setPermissions', targetKind: 'channel', targetId: CHANNEL_ID, overwrites: [{ targetKind: 'role', roleId: '555555555555555555', allow: [], deny: [] }] }] },
        { operations: [{ type: 'renameChannel', channelId: '555555555555555555', name: 'x' }] },
        { operations: [{ type: 'createChannel', name: 'x', channelType: 'text', categoryRef: '555555555555555555' }] },
        { operations: [{ type: 'createChannel', name: 'あ'.repeat(101), channelType: 'text' }] },
        { operations: [{ type: 'createCategory', name: '' }] },
        { operations: [{ type: 'setSlowmode', channelId: CHANNEL_ID, seconds: 21601 }] },
        { operations: [{ type: 'setSlowmode', channelId: CHANNEL_ID, seconds: -1 }] },
        { operations: [{ type: 'createChannel', name: 'x', channelType: 'stage' }] },
        { operations: [{ type: 'setPermissions', targetKind: 'channel', targetId: CHANNEL_ID, overwrites: [{ targetKind: 'everyone', allow: ['ViewChannel'], deny: ['ViewChannel'] }] }] },
        // newIndex が createCategory 以外を指す
        { operations: [{ type: 'createChannel', name: 'a', channelType: 'text' }, { type: 'createChannel', name: 'b', channelType: 'text', categoryRef: { newIndex: 0 } }] },
        // 前方参照
        { operations: [{ type: 'createChannel', name: 'b', channelType: 'text', categoryRef: { newIndex: 1 } }, { type: 'createCategory', name: 'c' }] },
    ];
    for (const bad of cases) {
        assert.equal(validatePlan(bad, ctx).ok, false, JSON.stringify(bad));
    }
});

test('プラン検証: チャンネル総数500上限を概算チェックする', () => {
    const ctx = ctxFrom(makeStructure({ channelCount: 499 }));
    const result = validatePlan({
        operations: [
            { type: 'createCategory', name: 'a' },
            { type: 'createChannel', name: 'b', channelType: 'text' },
        ],
    }, ctx);
    assert.equal(result.ok, false);
});

test('プランJSON抽出: 前後の文字列があってもJSONを取り出す', () => {
    assert.deepEqual(extractPlanJson('前置き {"operations": []} 後書き'), { operations: [] });
    assert.equal(extractPlanJson('JSONなし'), null);
});

// ---------------------------------------------------------------------------
// プレビュートークン / レート制限
// ---------------------------------------------------------------------------

test('プレビューはワンタイムで、ギルドとユーザーに束縛され、期限切れは無効', () => {
    const now = Date.parse('2026-11-07T00:00:00Z');
    const plan: ServerBuilderPlan = { version: 1, summary: 's', operations: [{ type: 'createCategory', name: 'x' }] };
    const id = createServerBuilderPreview({ guildId: 'g1', userId: 'u1', plan, styleId: 'plain', request: 'r' }, now);
    // 別ユーザーでは消費できない（ただし試行時点で消費されるワンタイム性も確認する）
    assert.equal(consumeServerBuilderPreview(id, 'g1', 'u2', now), null);
    assert.equal(consumeServerBuilderPreview(id, 'g1', 'u1', now), null);

    const id2 = createServerBuilderPreview({ guildId: 'g1', userId: 'u1', plan, styleId: 'plain', request: 'r' }, now);
    const record = consumeServerBuilderPreview(id2, 'g1', 'u1', now);
    assert.equal(record?.plan.operations.length, 1);
    assert.equal(consumeServerBuilderPreview(id2, 'g1', 'u1', now), null);

    const id3 = createServerBuilderPreview({ guildId: 'g1', userId: 'u1', plan, styleId: 'plain', request: 'r' }, now);
    assert.equal(consumeServerBuilderPreview(id3, 'g1', 'u1', now + 10 * 60_000 + 1), null);
    assert.equal(consumeServerBuilderPreview('not-a-token', 'g1', 'u1', now), null);
});

test('レート制限: 同時実行1つとクールダウン', () => {
    let now = Date.parse('2026-11-07T00:00:00Z');
    const limiter = new ServerBuilderLimiter(() => now);
    assert.equal(limiter.check('g1', 'u1').ok, true);
    limiter.begin('g1', 'u1');
    assert.equal(limiter.check('g1', 'u2').ok, false);
    limiter.end('g1');
    assert.equal((limiter.check('g1', 'u1') as { reason?: string }).reason, 'cooldown-guild');
    now += 25_000;
    assert.equal(limiter.check('g1', 'u1').ok, true);
});

// ---------------------------------------------------------------------------
// プロンプト / プリセット
// ---------------------------------------------------------------------------

test('生成プロンプトはスキーマ限定とデータ扱いを明記し、プリセット指示を含む', () => {
    const preset = getStylePreset('emoji');
    assert.ok(preset);
    const messages = buildPlanMessages({ request: 'ゲーム用カテゴリを作って', style: preset, structure: makeStructure() });
    const system = messages[0].content;
    assert.ok(system.includes('プランJSONのみ'));
    assert.ok(system.includes('データ'));
    assert.ok(system.includes('削除系の操作は存在しません'));
    assert.ok(system.includes('絵文字｜名前'));
    assert.ok(messages[1].content.includes('<request>'));
    assert.ok(messages[1].content.includes('ゲーム用カテゴリを作って'));
    assert.equal(getStylePreset('unknown-style'), null);
    // 未指定時のデフォルトは主流形式の「絵文字｜名前」（v6で plain から変更）。
    assert.equal(getStylePreset(undefined)?.id, 'emoji');
});

// ---------------------------------------------------------------------------
// 適用（モック）
// ---------------------------------------------------------------------------

interface RecordedCall { method: string; args: unknown[] }

function mockAdapter(failOn?: string): ServerBuilderGuildAdapter & { calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    let seq = 0;
    const makeChannel = (id: string) => ({
        id,
        setName: async (name: string) => { calls.push({ method: 'setName', args: [id, name] }); },
        setParent: async (parentId: string) => { calls.push({ method: 'setParent', args: [id, parentId] }); },
        setTopic: async (topic: string) => { calls.push({ method: 'setTopic', args: [id, topic] }); },
        setRateLimitPerUser: async (seconds: number) => { calls.push({ method: 'setRateLimitPerUser', args: [id, seconds] }); },
        permissionOverwrites: {
            edit: async (targetId: string, permissions: Record<string, boolean>) => {
                calls.push({ method: 'permissionOverwrites.edit', args: [id, targetId, permissions] });
            },
        },
    });
    return {
        calls,
        guildId: '999999999999999999',
        createCategory: async (name: string) => {
            calls.push({ method: 'createCategory', args: [name] });
            if (failOn === 'createCategory') throw new Error('Missing Permissions');
            seq += 1;
            return { id: `newcat${seq}` };
        },
        createChannel: async (options) => {
            calls.push({ method: 'createChannel', args: [options] });
            seq += 1;
            return { id: `newch${seq}` };
        },
        getChannel: async (channelId: string) => {
            if (channelId === 'missing') return null;
            return makeChannel(channelId);
        },
    };
}

test('適用: 作成・リネーム・移動・権限上書きが対応するAPI呼び出しになる', async () => {
    const adapter = mockAdapter();
    const plan: ServerBuilderPlan = {
        version: 1,
        summary: 'test',
        operations: [
            { type: 'createCategory', name: 'ゲーム' },
            { type: 'createChannel', name: '募集', channelType: 'text', categoryRef: { kind: 'new', index: 0 } },
            { type: 'renameChannel', channelId: CHANNEL_ID, name: '💬｜雑談' },
            { type: 'moveChannel', channelId: CHANNEL2_ID, categoryRef: { kind: 'existing', id: CATEGORY_ID } },
            { type: 'setTopic', channelId: CHANNEL_ID, topic: '雑談用' },
            { type: 'setSlowmode', channelId: CHANNEL_ID, seconds: 10 },
            {
                type: 'setPermissions', targetKind: 'channel', targetRef: { index: 1 },
                overwrites: [
                    { targetKind: 'everyone', allow: [], deny: ['ViewChannel'] },
                    { targetKind: 'role', roleId: ROLE_ID, allow: ['ViewChannel', 'SendMessages'], deny: [] },
                ],
            },
        ],
    };
    const results = await executePlan(adapter, plan);
    assert.equal(results.length, 7);
    assert.ok(results.every(r => r.ok), JSON.stringify(results));
    const methods = adapter.calls.map(c => c.method);
    assert.deepEqual(methods, [
        'createCategory', 'createChannel', 'setName', 'setParent', 'setTopic',
        'setRateLimitPerUser', 'permissionOverwrites.edit', 'permissionOverwrites.edit',
    ]);
    // 新規チャンネルは新規カテゴリの下に作られる
    const createArgs = adapter.calls[1].args[0] as { parentId?: string };
    assert.equal(createArgs.parentId, 'newcat1');
    // everyone はギルドID宛、ロールはロールID宛
    assert.equal(adapter.calls[6].args[1], '999999999999999999');
    assert.deepEqual(adapter.calls[6].args[2], { ViewChannel: false });
    assert.equal(adapter.calls[7].args[1], ROLE_ID);
    assert.deepEqual(adapter.calls[7].args[2], { ViewChannel: true, SendMessages: true });
});

test('適用: opIndexes で選択実行でき、1件の失敗で全体は落ちない', async () => {
    const adapter = mockAdapter('createCategory');
    const plan: ServerBuilderPlan = {
        version: 1,
        summary: 'test',
        operations: [
            { type: 'createCategory', name: '失敗するカテゴリ' },
            { type: 'createChannel', name: '子チャンネル', channelType: 'text', categoryRef: { kind: 'new', index: 0 } },
            { type: 'renameChannel', channelId: CHANNEL_ID, name: '新しい名前' },
        ],
    };
    const results = await executePlan(adapter, plan);
    assert.equal(results.length, 3);
    assert.equal(results[0].ok, false);
    assert.match(results[0].detail, /Missing Permissions/);
    // 親カテゴリ作成に失敗した子チャンネルも個別に失敗するが、無関係なリネームは成功する
    assert.equal(results[1].ok, false);
    assert.equal(results[2].ok, true);

    const adapter2 = mockAdapter();
    const partial = await executePlan(adapter2, plan, [2]);
    assert.equal(partial.length, 1);
    assert.equal(partial[0].index, 2);
    assert.deepEqual(adapter2.calls.map(c => c.method), ['setName']);
});
