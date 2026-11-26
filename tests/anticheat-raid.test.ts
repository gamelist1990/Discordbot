import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits } from 'discord.js';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';
import { CacheManager } from '../src/utils/CacheManager.ts';
import {
    RAID_KICK_REASON,
    RaidJoinRecord,
    raidKickSkipReason,
    readRaidDetectionConfig,
    readRaidJoinRecords
} from '../src/core/anticheat/RaidEnforcement.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function setup(config: Record<string, any> = {}) {
    CacheManager.clear();
    const manager = new AntiCheatManager();
    const settings = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
    settings.enabled = true;
    settings.logChannelId = 'log-channel';
    settings.detectors.raidDetection.enabled = true;
    settings.detectors.raidDetection.config = {
        ...settings.detectors.raidDetection.config,
        ...config
    };
    manager.getSettings = async () => settings;
    manager.setSettings = async () => undefined;

    const sent: any[] = [];
    (manager as any).fetchLogChannel = async () => ({
        send: async (payload: any) => { sent.push(payload); return null; }
    });

    const kicked: string[] = [];
    const reasons: string[] = [];
    const members = new Collection<string, any>();
    const guild: any = {
        id: 'guild',
        name: 'Guild',
        ownerId: 'owner',
        members: {
            cache: members,
            fetch: async (id: string) => members.get(id) ?? null
        },
        channels: { cache: new Map() }
    };

    const member = (id: string, overrides: Record<string, any> = {}) => {
        const created: any = {
            id,
            guild,
            user: { id, bot: false, tag: `${id}#0001`, username: id },
            roles: { cache: new Set<string>() },
            permissions: { has: () => false },
            kickable: true,
            joinedTimestamp: Date.now(),
            kick: async (reason: string) => {
                kicked.push(id);
                reasons.push(reason);
                members.delete(id);
            },
            ...overrides
        };
        members.set(id, created);
        return created;
    };
    // Recent members that did not arrive through onGuildMemberAdd (e.g. the
    // raid started before the process restart) but are still kick candidates.
    const preexisting = (id: string, overrides: Record<string, any> = {}) => member(id, overrides);

    return { manager, settings, sent, kicked, reasons, guild, member, preexisting };
}

const lastEmbed = (sent: any[]) => sent[sent.length - 1].embeds[sent[sent.length - 1].embeds.length - 1];
const fieldNames = (embed: any) => (embed.data?.fields || embed.fields || []).map((field: any) => field.name);

test('activation kicks recent joiners once and reports skipped members with reasons', async () => {
    const { manager, settings, sent, kicked, reasons, member, preexisting } = setup({
        joinsPerHour: 3, burstCount: 3, burstWindowSeconds: 60, cooldownMinutes: 60, autoKick: 1, kickWindowSeconds: 60
    });
    settings.excludedRoles = ['staff-role'];

    // Present in the guild but not part of this activation batch's joins.
    preexisting('owner');
    preexisting('admin1', { permissions: { has: (flag: bigint) => flag === PermissionFlagsBits.Administrator } });
    preexisting('nokick', { kickable: false });

    await manager.onGuildMemberAdd(member('m1'));
    await manager.onGuildMemberAdd(member('m2'));

    // Excluded-role members are never counted (2 counted joins < 3).
    await manager.onGuildMemberAdd(member('staff', { roles: { cache: new Set(['staff-role']) } }));
    assert.equal(settings.raidMode.active, false);
    assert.equal(sent.length, 0);

    await manager.onGuildMemberAdd(member('bot1', { user: { id: 'bot1', bot: true, tag: 'bot1#0001', username: 'bot1' } }));

    assert.equal(settings.raidMode.active, true);
    assert.deepEqual(kicked.sort(), ['m1', 'm2']);
    assert.deepEqual(reasons, [RAID_KICK_REASON, RAID_KICK_REASON]);

    // Activation embed, then exactly one kick-summary message for the batch.
    assert.equal(sent.length, 2);
    assert.equal(sent[0].embeds.length, 1);
    assert.match(sent[0].embeds[0].data.title, /レイドモードを有効化/);
    assert.equal(sent[1].embeds.length, 1);
    const summary = lastEmbed(sent);
    assert.match(summary.data.title, /自動キック/);
    assert.deepEqual(fieldNames(summary), ['キック (2)', 'スキップ (5)']);
    const summaryText = (summary.data.fields || []).map((field: any) => field.value).join('\n');
    assert.match(summaryText, /m1#0001 \(m1\)/);
    assert.match(summaryText, /bot1#0001 \(bot1\) — BOTアカウント/);
    assert.match(summaryText, /staff#0001 \(staff\) — 除外ロール/);
    assert.match(summaryText, /owner#0001 \(owner\) — サーバー所有者/);
    assert.match(summaryText, /admin1#0001 \(admin1\) — 管理者権限/);
    assert.match(summaryText, /nokick#0001 \(nokick\) — キック不可/);
    assert.equal(summary.data.description.includes('2 人をキック'), true);
});

test('autoKick=0 keeps the legacy activate-and-log behavior', async () => {
    const { manager, settings, sent, kicked, member } = setup({
        joinsPerHour: 2, burstCount: 2, autoKick: 0
    });

    await manager.onGuildMemberAdd(member('m1'));
    await manager.onGuildMemberAdd(member('m2'));

    assert.equal(settings.raidMode.active, true);
    assert.deepEqual(kicked, []);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].embeds.length, 1);
    const activation = sent[0].embeds[0];
    assert.match(activation.data.title, /レイドモードを有効化/);
    const autoKickField = (activation.data.fields || []).find((field: any) => field.name === '自動キック');
    assert.match(autoKickField.value, /無効/);
});

test('an active raid kicks each new joiner immediately and refreshes lastJoinAt', async () => {
    const { manager, settings, sent, kicked, member } = setup();
    settings.raidMode = {
        active: true,
        activatedAt: iso(-10 * 60_000),
        reason: 'raid',
        recentJoinCount: 5,
        lastJoinAt: iso(-5 * 60_000)
    };

    await manager.onGuildMemberAdd(member('m1'));
    await (manager as any).flushRaidKickBatch('guild');

    assert.deepEqual(kicked, ['m1']);
    assert.equal(sent.length, 1);
    assert.match(sent[0].embeds[0].data.title, /自動キック/);
    assert.ok(Date.now() - new Date(settings.raidMode.lastJoinAt!).getTime() < 1000);
    assert.equal(settings.raidMode.recentJoinCount, 1);
});

test('raid mode deactivates after cooldownMinutes without joins and logs the release', async () => {
    const { manager, settings, sent, kicked, member } = setup({ joinsPerHour: 20, burstCount: 8, cooldownMinutes: 60 });
    settings.raidMode = {
        active: true,
        activatedAt: iso(-120 * 60_000),
        reason: 'raid',
        recentJoinCount: 25,
        lastJoinAt: iso(-61 * 60_000)
    };

    await manager.onGuildMemberAdd(member('m1'));

    assert.equal(settings.raidMode.active, false);
    assert.equal(settings.raidMode.activatedAt, null);
    assert.deepEqual(kicked, []);
    assert.equal(sent.length, 1);
    assert.match(sent[0].embeds[0].data.title, /レイドモードを解除/);
});

test('raid mode stays active inside the cooldown window', async () => {
    const { manager, settings, sent, kicked, member } = setup({ cooldownMinutes: 60 });
    settings.raidMode = {
        active: true,
        activatedAt: iso(-90 * 60_000),
        reason: 'raid',
        recentJoinCount: 5,
        lastJoinAt: iso(-59 * 60_000)
    };

    await manager.onGuildMemberAdd(member('m1'));
    await (manager as any).flushRaidKickBatch('guild');

    assert.equal(settings.raidMode.active, true);
    assert.deepEqual(kicked, ['m1']);
    assert.equal(sent.length, 1);
    assert.match(sent[0].embeds[0].data.title, /自動キック/);
});

test('the join cache stores { userId, ts } entries within the one hour window', async () => {
    const { manager, member } = setup({ joinsPerHour: 100, burstCount: 100 });
    await manager.onGuildMemberAdd(member('m1'));
    await manager.onGuildMemberAdd(member('m2'));

    const records = CacheManager.get<RaidJoinRecord[]>('anticheat:joins:guild') || [];
    assert.deepEqual(records.map((record) => record.userId), ['m1', 'm2']);
    for (const record of records) {
        assert.equal(typeof record.ts, 'number');
        assert.ok(Date.now() - record.ts < 60_000);
    }
});

test('raid config defaults and toggle parsing tolerate legacy shapes', () => {
    const defaults = readRaidDetectionConfig({});
    assert.equal(defaults.joinsPerHour, 20);
    assert.equal(defaults.burstCount, 8);
    assert.equal(defaults.burstWindowSeconds, 60);
    assert.equal(defaults.cooldownMinutes, 60);
    assert.equal(defaults.autoKick, true);
    assert.equal(defaults.kickWindowSeconds, 60);

    assert.equal(readRaidDetectionConfig({ autoKick: 0 }).autoKick, false);
    assert.equal(readRaidDetectionConfig({ autoKick: false }).autoKick, false);
    assert.equal(readRaidDetectionConfig({ autoKick: 'false' }).autoKick, false);
    assert.equal(readRaidDetectionConfig({ autoKick: 1 }).autoKick, true);
    assert.equal(readRaidDetectionConfig({ joinsPerHour: -5 }).joinsPerHour, 20);

    const now = Date.now();
    const records = readRaidJoinRecords([
        { userId: 'fresh', ts: now - 1000 },
        { userId: 'stale', ts: now - 61 * 60_000 },
        now,
        { userId: '', ts: now },
        { userId: 'future', ts: now + 10_000 }
    ], now);
    assert.deepEqual(records.map((record) => record.userId), ['fresh']);
});

test('stored raid configs keep their thresholds and only gain the new keys', () => {
    const manager = new AntiCheatManager();
    const merged = manager.mergeSettings({
        detectors: {
            raidDetection: {
                enabled: true, score: 0, deleteMessage: false, notifyChannel: true,
                config: { joinsPerHour: 25, burstCount: 10, burstWindowSeconds: 10, cooldownMinutes: 60 }
            }
        },
        excludedRoles: [], excludedChannels: [], punishments: []
    }, {});
    const config = merged.detectors.raidDetection.config || {};
    // Deployment note: stored values win over the new defaults.
    assert.equal(config.joinsPerHour, 25);
    assert.equal(config.burstCount, 10);
    assert.equal(config.burstWindowSeconds, 10);
    assert.equal(config.autoKick, 1);
    assert.equal(config.kickWindowSeconds, 60);
});

test('kick decisions exempt bots, owner, admins, excluded roles and unkickable members', () => {
    const base = { id: 'u1', user: { bot: false }, roles: { cache: new Set<string>() }, permissions: { has: () => false }, kickable: true };
    assert.equal(raidKickSkipReason(base, 'owner', []), null);
    assert.match(raidKickSkipReason({ ...base, user: { bot: true } }, 'owner', [])!, /BOT/);
    assert.match(raidKickSkipReason({ ...base, id: 'owner' }, 'owner', [])!, /所有者/);
    assert.match(raidKickSkipReason({
        ...base,
        permissions: { has: (flag: bigint) => flag === PermissionFlagsBits.ManageGuild }
    }, 'owner', [])!, /管理者権限/);
    assert.match(raidKickSkipReason({ ...base, roles: { cache: new Set(['excluded']) } }, 'owner', ['excluded'])!, /除外ロール/);
    assert.match(raidKickSkipReason({ ...base, kickable: false }, 'owner', [])!, /キック不可/);
});
