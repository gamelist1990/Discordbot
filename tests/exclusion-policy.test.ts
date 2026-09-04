import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { AntiCheatManager, antiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';
import { exclusionChannelIds, validateExclusions } from '../src/core/anticheat/ExclusionPolicy.ts';
import { AntiCheatController } from '../src/web/controllers/staff/AntiCheatController.ts';
(globalThis as any)._cacheCleanupInterval?.unref?.();
const role = '111111111111111111', channel = '222222222222222222', parent = '333333333333333333', category = '444444444444444444';
const makeSettings = () => structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
const makeMessage = (id = channel) => ({ id: `message-${id}`, author: { id: 'user', bot: false }, guild: { id: 'guild' }, channel: { id }, content: 'hello', attachments: new Map(), embeds: [], member: { roles: { cache: new Map() } } } as any);

test('per-channel exclusions skip only selected detectors including the cross-channel preflight', async () => {
    const manager = new AntiCheatManager();
    const settings = makeSettings(); settings.enabled = true;
    for (const [key, value] of Object.entries(settings.detectors)) value.enabled = ['contentSafety', 'crossChannelSpam', 'textSpam'].includes(key);
    settings.channelDetectorExclusions = { [channel]: ['contentSafety', 'crossChannelSpam'] };
    manager.getSettings = async () => settings;
    const calls: string[] = [];
    for (const name of ['contentSafety', 'crossChannelSpam', 'textSpam']) manager.registerDetector({ name, detect: async () => { calls.push(name); return { scoreDelta: 0, reasons: [] }; } });
    await manager.onMessage(makeMessage());
    assert.deepEqual(calls, ['textSpam']);
    calls.length = 0;
    await manager.onMessage(makeMessage(parent));
    assert.deepEqual(calls.sort(), ['contentSafety', 'crossChannelSpam', 'textSpam'].sort());
    calls.length = 0;
    await manager.onMessage(makeMessage(), true);
    assert.deepEqual(calls, []);
});

test('role/full-category exclusions take precedence and selected parent exclusions reach threads', async () => {
    const manager = new AntiCheatManager();
    const settings = makeSettings(); settings.enabled = true;
    for (const [key, value] of Object.entries(settings.detectors)) value.enabled = key === 'contentSafety';
    manager.getSettings = async () => settings;
    let calls = 0;
    manager.registerDetector({ name: 'contentSafety', detect: async () => { calls++; return { scoreDelta: 0, reasons: [] }; } });
    const message = makeMessage();
    message.channel = { id: channel, parentId: parent, parent: { parentId: category } };
    assert.deepEqual(exclusionChannelIds(message), [channel, parent, category]);
    settings.channelDetectorExclusions = { [parent]: ['contentSafety'] };
    await manager.onMessage(message); assert.equal(calls, 0);
    settings.channelDetectorExclusions = {};
    settings.excludedChannels = [category];
    await manager.onMessage(message); assert.equal(calls, 0);
    settings.excludedChannels = [];
    settings.excludedRoles = [role]; message.member.roles.cache.set(role, {});
    await manager.onMessage(message); assert.equal(calls, 0);
    settings.excludedRoles = [];
    await manager.onMessage(message); assert.equal(calls, 1);
});

test('channel exclusions survive partial updates and can be cleared without restoring old keys', () => {
    const manager = new AntiCheatManager();
    const base = manager.mergeSettings(makeSettings(), { channelDetectorExclusions: { [channel]: ['contentSafety'] } });
    assert.deepEqual(manager.mergeSettings(base, { enabled: true }).channelDetectorExclusions, base.channelDetectorExclusions);
    assert.deepEqual(manager.mergeSettings(base, { channelDetectorExclusions: {} }).channelDetectorExclusions, {});
    assert.deepEqual(manager.mergeSettings({}, {}).channelDetectorExclusions, {});
});

const guild = {
    id: 'guild',
    roles: { fetch: async (id?: string) => id ? id === role ? { id } : null : new Collection([[role, { id: role, name: '信頼ロール' }]]) },
    channels: { cache: new Collection(), fetch: async (id?: string) => id ? id === channel ? { id, guildId: 'guild', name: '一般', type: 0 } : null
        : new Collection([[channel, { id: channel, guildId: 'guild', name: '一般', type: 0 }]]) }
} as any;

test('validation rejects swapped types, foreign IDs and unknown detector names', async () => {
    const current = makeSettings();
    assert.equal(await validateExclusions({ excludedRoles: [role], channelDetectorExclusions: { [channel]: ['contentSafety'] } }, current, guild), null);
    assert.match((await validateExclusions({ excludedRoles: [channel] }, current, guild))!, /ロール/);
    assert.match((await validateExclusions({ excludedChannels: [role] }, current, guild))!, /チャンネル/);
    assert.match((await validateExclusions({ channelDetectorExclusions: { [channel]: ['raidDetection'] } }, current, guild))!, /除外できない/);
    assert.ok(await validateExclusions({ channelDetectorExclusions: { [channel]: ['not-a-detector'] } }, current, guild));
    assert.ok(await validateExclusions({ excludedRoles: ['123'] }, current, guild));
    current.excludedChannels = [category];
    assert.equal(await validateExclusions({ excludedChannels: [category] }, current, guild), null);
});

test('target catalog is guild-authorized and reports real names and channel types', async () => {
    let fetched = 0;
    const controller = new AntiCheatController({ client: { guilds: { fetch: async () => { fetched++; return guild; } } } } as any);
    let status = 200, body: any;
    const res: any = { status: (value: number) => { status = value; return res; }, json: (value: any) => { body = value; } };
    await controller.getExclusionTargets({ params: { guildId: 'other' }, query: {}, session: { guildIds: ['guild'] } } as any, res);
    assert.equal(status, 403); assert.equal(fetched, 0);
    await controller.getExclusionTargets({ params: { guildId: 'guild' }, query: {}, session: { guildIds: ['guild'] } } as any, res);
    assert.equal(body.roles[0].name, '信頼ロール'); assert.equal(body.channels[0].type, 'テキスト');
});

test('settings endpoint saves valid selective exclusions and refuses an ID of the wrong type', async () => {
    const controller = new AntiCheatController({ client: { guilds: { fetch: async () => guild } } } as any);
    const oldGet = antiCheatManager.getSettings, oldSet = antiCheatManager.setSettings;
    let stored = makeSettings(), status = 200;
    const res: any = { status: (value: number) => { status = value; return res; }, json: () => {} };
    antiCheatManager.getSettings = async () => stored;
    antiCheatManager.setSettings = async (_id, value) => { stored = value; };
    try {
        const req = { params: { guildId: 'guild' }, session: { guildIds: ['guild'] }, body: { channelDetectorExclusions: { [channel]: ['contentSafety'] } } };
        await controller.updateSettings(req as any, res);
        assert.deepEqual(stored.channelDetectorExclusions, req.body.channelDetectorExclusions);
        await controller.updateSettings({ ...req, body: { excludedRoles: [channel] } } as any, res);
        assert.equal(status, 400); assert.deepEqual(stored.excludedRoles, []);
    } finally { antiCheatManager.getSettings = oldGet; antiCheatManager.setSettings = oldSet; }
});
