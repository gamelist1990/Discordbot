import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
    ServerBuilderBudget,
    bitfieldToPermissionNames,
    buildGuildStructure,
    buildPlanMessages,
    computePermissionsSynced,
    executePlan,
    getStylePreset,
    isPrivateFromOverwrites,
    planContextFromStructure,
    summarizePermissionOverwrites,
    validateManualPlan,
    validatePlan,
    type BudgetStoreAdapter,
    type GuildStructure,
    type ServerBuilderGuildAdapter,
    type ServerBuilderPlan,
} from '../src/core/serverBuilder/ServerBuilder.ts';

const GUILD_ID = '999999999999999999';
const CHANNEL_ID = '111111111111111111';
const CHANNEL2_ID = '222222222222222222';
const CATEGORY_ID = '333333333333333333';
const ROLE_ID = '444444444444444444';

function makeStructure(overrides: Partial<GuildStructure> = {}): GuildStructure {
    return {
        guildId: GUILD_ID, guildName: 'テスト',
        categories: [{ id: CATEGORY_ID, name: '一般', position: 0, permissionOverwrites: [], isPrivate: false }],
        channels: [
            { id: CATEGORY_ID, name: '一般', kind: 'category', position: 0, permissionOverwrites: [], permissionsSynced: null, isPrivate: false },
            { id: CHANNEL_ID, name: '💬｜雑談', kind: 'text', parentId: CATEGORY_ID, position: 0, permissionOverwrites: [], permissionsSynced: true, isPrivate: false },
            { id: CHANNEL2_ID, name: 'ボイス', kind: 'voice', parentId: CATEGORY_ID, position: 1, permissionOverwrites: [], permissionsSynced: false, isPrivate: true },
        ],
        roles: [{ id: ROLE_ID, name: 'スタッフ' }],
        channelCount: 3, ...overrides,
    };
}

test('構造: bitfield→権限名、everyone拒否でプライベート判定、同期導出', () => {
    assert.deepEqual(bitfieldToPermissionNames(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages).sort(), ['SendMessages', 'ViewChannel']);
    const ows = summarizePermissionOverwrites({ cache: new Map([[GUILD_ID, { id: GUILD_ID, type: 0, allow: 0n, deny: PermissionFlagsBits.ViewChannel }]]) }, GUILD_ID);
    assert.equal(ows[0].targetKind, 'everyone');
    assert.deepEqual(ows[0].deny, ['ViewChannel']);
    assert.equal(isPrivateFromOverwrites(ows), true);
    assert.equal(computePermissionsSynced(ows, ows), true);
    assert.equal(computePermissionsSynced(ows, []), false);
    assert.equal(computePermissionsSynced(ows, null), null);
    assert.equal(computePermissionsSynced([], [], false), false);
});

function mockGuild() {
    const everyoneOw = { id: GUILD_ID, type: 0, allow: PermissionFlagsBits.ViewChannel, deny: 0n };
    const privateOw = { id: GUILD_ID, type: 0, allow: 0n, deny: PermissionFlagsBits.ViewChannel };
    const roleOw = { id: ROLE_ID, type: 0, allow: PermissionFlagsBits.ViewChannel, deny: 0n };
    const mk = (o: any) => ({ isThread: () => false, permissionOverwrites: { cache: new Map((o.ows ?? []).map((x: any) => [x.id, x])) }, ...o, ows: undefined });
    const cat = mk({ id: CATEGORY_ID, name: '===一般===', type: ChannelType.GuildCategory, rawPosition: 2, position: 0, ows: [everyoneOw] });
    const ch1 = mk({ id: CHANNEL_ID, name: '💬｜雑談', type: ChannelType.GuildText, parentId: CATEGORY_ID, rawPosition: 5, position: 0, topic: '雑談用', rateLimitPerUser: 3, permissionsLocked: true, ows: [everyoneOw] });
    const ch2 = mk({ id: CHANNEL2_ID, name: 'スタッフ連絡', type: ChannelType.GuildText, parentId: CATEGORY_ID, rawPosition: 6, position: 1, permissionsLocked: false, ows: [privateOw, roleOw] });
    const forum = mk({ id: '555555555555555555', name: '質問掲示板', type: ChannelType.GuildForum, parentId: CATEGORY_ID, rawPosition: 7, position: 2, ows: [] });
    return {
        id: GUILD_ID, name: 'モック鯖',
        channels: { cache: new Map([[CATEGORY_ID, cat], [CHANNEL_ID, ch1], [CHANNEL2_ID, ch2], ['555555555555555555', forum]]) },
        roles: { cache: new Map([[GUILD_ID, { id: GUILD_ID, name: '@everyone' }], [ROLE_ID, { id: ROLE_ID, name: 'スタッフ' }]]) },
    };
}

test('構造: buildGuildStructureがposition・上書き要約・同期・プライベート・フォーラムを含む', () => {
    const st = buildGuildStructure(mockGuild());
    assert.equal(st.categories[0].position, 2);
    assert.equal(st.categories[0].name, '===一般===');
    const ch1 = st.channels.find(c => c.id === CHANNEL_ID)!;
    assert.equal(ch1.position, 5);
    assert.equal(ch1.permissionsSynced, true);
    assert.equal(ch1.isPrivate, false);
    assert.equal(ch1.slowmodeSeconds, 3);
    const ch2 = st.channels.find(c => c.id === CHANNEL2_ID)!;
    assert.equal(ch2.permissionsSynced, false);
    assert.equal(ch2.isPrivate, true);
    assert.equal(ch2.permissionOverwrites.length, 2);
    assert.equal(ch2.permissionOverwrites.find(o => o.targetKind === 'role')?.targetName, 'スタッフ');
    assert.equal(st.channels.find(c => c.id === '555555555555555555')?.kind, 'forum');
});

test('setPosition/syncPermissions: 検証（正常・範囲外・存在しない・親なし同期不可）', () => {
    const ctx = planContextFromStructure(makeStructure());
    assert.equal(validatePlan({ operations: [{ type: 'setPosition', targetKind: 'channel', targetId: CHANNEL_ID, position: 3 }, { type: 'setPosition', targetKind: 'category', targetId: CATEGORY_ID, position: 0 }, { type: 'syncPermissions', channelId: CHANNEL_ID }] }, ctx).ok, true);
    for (const bad of [
        { operations: [{ type: 'setPosition', targetKind: 'channel', targetId: CHANNEL_ID, position: -1 }] },
        { operations: [{ type: 'setPosition', targetKind: 'channel', targetId: CHANNEL_ID, position: 501 }] },
        { operations: [{ type: 'setPosition', targetKind: 'channel', targetId: CHANNEL_ID, position: 1.5 }] },
        { operations: [{ type: 'setPosition', targetKind: 'channel', targetId: CATEGORY_ID, position: 1 }] },
        { operations: [{ type: 'syncPermissions', channelId: '555555555555555555' }] },
        { operations: [{ type: 'setPosition', targetKind: 'channel', targetId: CHANNEL_ID, position: 1, extra: 1 }] },
    ]) assert.equal(validatePlan(bad, ctx).ok, false, JSON.stringify(bad));
    const orphan = makeStructure({ channels: [...makeStructure().channels, { id: '666666666666666666', name: '孤立', kind: 'text', position: 9, permissionOverwrites: [], permissionsSynced: null, isPrivate: false }] });
    assert.equal(validatePlan({ operations: [{ type: 'syncPermissions', channelId: '666666666666666666' }] }, planContextFromStructure(orphan)).ok, false);
});

test('setPosition/syncPermissions: モック適用で対応APIが呼ばれる', async () => {
    const calls: string[] = [];
    const mkCh = (id: string) => ({
        id, setName: async () => {}, setParent: async () => {}, setTopic: async () => {}, setRateLimitPerUser: async () => {},
        setPosition: async (pos: number) => { calls.push(`setPosition:${id}:${pos}`); },
        lockPermissions: async () => { calls.push(`lockPermissions:${id}`); },
        permissionOverwrites: { edit: async () => {} },
    });
    const adapter: ServerBuilderGuildAdapter = { guildId: GUILD_ID, createCategory: async () => ({ id: 'x' }), createChannel: async () => ({ id: 'y' }), getChannel: async (id) => mkCh(id) };
    const plan: ServerBuilderPlan = { version: 1, summary: 's', operations: [{ type: 'setPosition', targetKind: 'channel', targetId: CHANNEL_ID, position: 4 }, { type: 'syncPermissions', channelId: CHANNEL_ID }] };
    const results = await executePlan(adapter, plan);
    assert.ok(results.every(r => r.ok), JSON.stringify(results));
    assert.deepEqual(calls, [`setPosition:${CHANNEL_ID}:4`, `lockPermissions:${CHANNEL_ID}`]);
});

test('手動プラン: 検証を通り、不正を弾き、AI予算を消費しない', async () => {
    const ctx = planContextFromStructure(makeStructure());
    const ok = validateManualPlan([{ type: 'renameChannel', channelId: CHANNEL_ID, name: '雑談' }, { type: 'syncPermissions', channelId: CHANNEL_ID }], ctx);
    assert.equal(ok.ok, true);
    assert.equal(validateManualPlan([{ type: 'deleteChannel', channelId: CHANNEL_ID }], ctx).ok, false);
    assert.equal(validateManualPlan([{ type: 'renameChannel', channelId: CHANNEL_ID, name: 'x', evil: 1 }], ctx).ok, false);
    assert.equal(validateManualPlan('nope', ctx).ok, false);
    const data = new Map<string, unknown>();
    const adapter: BudgetStoreAdapter = { get: async (_g, k) => data.get(k) ?? null, set: async (_g, k, v) => { data.set(k, v); } };
    const budget = new ServerBuilderBudget(adapter, () => Date.now());
    const before = await budget.status(GUILD_ID);
    validateManualPlan([{ type: 'setSlowmode', channelId: CHANNEL_ID, seconds: 5 }], ctx);
    const after = await budget.status(GUILD_ID);
    assert.equal(after.used, before.used);
    assert.equal(data.size, 0);
});

test('AI文脈: position・同期・プライベート・新操作・カテゴリ権限・様式不揃い検出を含む', () => {
    const preset = getStylePreset('emoji'); assert.ok(preset);
    const msgs = buildPlanMessages({ request: '並びと名前を整えて', style: preset, structure: makeStructure() });
    const all = msgs.map(m => m.content).join('\n');
    assert.ok(all.includes('setPosition')); assert.ok(all.includes('syncPermissions'));
    assert.ok(all.includes('targetKind:"category"') || all.includes('targetKind') );
    assert.ok(all.includes('様式が揃っていない'));
    assert.ok(msgs[1].content.includes('"position":0'));
    assert.ok(msgs[1].content.includes('permissionsSynced'));
    assert.ok(msgs[1].content.includes('isPrivate'));
    assert.ok(msgs[1].content.includes('💬｜雑談'));
});
