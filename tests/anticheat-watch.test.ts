import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits } from 'discord.js';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';
import { CacheManager } from '../src/utils/CacheManager.ts';
import {
    WATCH_KICK_REASON,
    WATCH_POINT_WINDOW_MS,
    readWatchSettings
} from '../src/core/anticheat/WatchUsers.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

const DAY = 24 * 60 * 60 * 1000;

function setup() {
    CacheManager.clear();
    const manager = new AntiCheatManager();
    const settings = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
    settings.enabled = true;
    settings.logChannelId = 'log-channel';
    settings.watch = { ...settings.watch, enabled: true, notifyOnFlag: true };
    // Watch evaluation must not depend on raid detection.
    settings.detectors.raidDetection.enabled = false;

    manager.getSettings = async () => settings;
    manager.setSettings = async (_guildId: string, next: any) => {
        Object.assign(settings, structuredClone(next));
    };

    const sent: any[] = [];
    (manager as any).fetchLogChannel = async () => ({
        send: async (payload: any) => { sent.push(payload); return null; }
    });

    const events: string[] = [];
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
            displayName: id,
            user: {
                id,
                bot: false,
                tag: `${id}#0001`,
                username: id,
                globalName: null,
                avatar: null,
                createdTimestamp: Date.now() - 3 * DAY
            },
            roles: { cache: new Set<string>() },
            permissions: { has: () => false },
            kickable: true,
            kick: async (reason: string) => {
                events.push(`kick:${reason}`);
                members.delete(id);
            },
            ...overrides
        };
        members.set(id, created);
        return created;
    };

    return { manager, settings, sent, events, guild, member };
}

const embedFields = (payload: any) =>
    (payload.embeds[0].data?.fields || payload.embeds[0].fields || []);

const fieldValue = (payload: any, name: string) =>
    embedFields(payload).find((field: any) => field.name === name)?.value ?? '';

test('a throwaway-looking joiner is flagged and reported once', async () => {
    const { manager, settings, sent, member } = setup();
    const joiner = member('900000000000000001', {
        displayName: 'raiduser',
        user: {
            id: '900000000000000001', bot: false, tag: 'raiduser#0001',
            username: 'raiduser', globalName: null, avatar: null,
            createdTimestamp: Date.now() - 3 * DAY
        }
    });

    await manager.onGuildMemberAdd(joiner);

    const entry = settings.watchUsers['900000000000000001'];
    assert.ok(entry, 'watch entry created');
    assert.deepEqual([...entry.signals].sort(), ['name-match', 'new-account']);
    assert.equal(entry.source, 'join');
    assert.equal(entry.nameSnapshot, 'raiduser');
    assert.equal(entry.dismissed, null);
    assert.ok(entry.accountCreatedAt);

    assert.equal(sent.length, 1);
    assert.match(sent[0].embeds[0].data.title, /警戒ユーザーを検出/);
    assert.match(fieldValue(sent[0], 'シグナル'), /表示名がユーザー名と同一/);

    // Re-evaluation of an unchanged flagged member does not spam the log.
    await (manager as any).evaluateWatchMember(joiner, settings, 'message');
    assert.equal(sent.length, 1);
});

test('bots, owner, administrators and excluded roles are never flagged', async () => {
    const { manager, settings, sent, member } = setup();
    settings.excludedRoles = ['staff-role'];

    await manager.onGuildMemberAdd(member('bot1', {
        displayName: 'bot1',
        user: { id: 'bot1', bot: true, tag: 'bot1#0001', username: 'bot1', avatar: null, createdTimestamp: Date.now() }
    }));
    await manager.onGuildMemberAdd(member('owner', { displayName: 'owner' }));
    await manager.onGuildMemberAdd(member('admin1', {
        displayName: 'admin1',
        permissions: { has: (flag: bigint) => flag === PermissionFlagsBits.Administrator }
    }));
    await manager.onGuildMemberAdd(member('staff', {
        displayName: 'staff',
        roles: { cache: new Set(['staff-role']) }
    }));

    assert.deepEqual(settings.watchUsers, {});
    assert.equal(sent.length, 0);
});

test('a new-account-only flag ages out at the next re-evaluation', async () => {
    const { manager, settings, sent, member } = setup();
    const target = member('u1', { displayName: 'Friendly Name' });
    const joinedAt = Date.now();

    await manager.onGuildMemberAdd(target);
    assert.deepEqual(settings.watchUsers.u1.signals, ['new-account']);

    // Eight days later the account is no longer "new".
    await (manager as any).evaluateWatchMember(target, settings, 'message', joinedAt + 8 * DAY);
    assert.equal(settings.watchUsers.u1, undefined);
    // Removal is silent; only the original flag was reported.
    assert.equal(sent.length, 1);
});

test('staff dismissal holds until the name changes, then re-flags', async () => {
    const { manager, settings, sent, member } = setup();
    settings.watchUsers.alice = {
        reason: '表示名がユーザー名と同一',
        signals: ['name-match'],
        since: new Date().toISOString(),
        source: 'join',
        nameSnapshot: 'Alice',
        accountCreatedAt: new Date(Date.now() - 30 * DAY).toISOString(),
        avatarHash: null,
        normalizedName: 'alice',
        dismissed: null,
        dangerPoints: []
    };
    const target = member('alice', {
        displayName: 'Alice',
        user: { id: 'alice', bot: false, tag: 'alice#0001', username: 'alice', globalName: null, avatar: null, createdTimestamp: Date.now() - 30 * DAY }
    });

    const dismissed = await manager.dismissWatchUser('guild', 'alice', 'Alice');
    assert.equal(dismissed, true);
    assert.equal(settings.watchUsers.alice.dismissed, 'Alice');

    // Same name: the dismissal holds.
    await (manager as any).evaluateWatchMember(target, settings, 'member-update');
    assert.equal(settings.watchUsers.alice.dismissed, 'Alice');
    assert.equal(sent.length, 0);

    // Renamed: the stale dismissal no longer applies and the user is flagged again.
    target.displayName = 'ALICE';
    await (manager as any).evaluateWatchMember(target, settings, 'member-update');
    assert.equal(settings.watchUsers.alice.dismissed, null);
    assert.equal(sent.length, 1);
});

test('danger kick purges first, kicks, then logs with the purge count and removes the entry', async () => {
    const { manager, settings, sent, events, member } = setup();
    const target = member('bad1');
    settings.watchUsers.bad1 = {
        reason: '表示名がユーザー名と同一 / 新規アカウント',
        signals: ['name-match', 'new-account'],
        since: new Date().toISOString(),
        source: 'join',
        nameSnapshot: 'bad1',
        accountCreatedAt: new Date(Date.now() - 2 * DAY).toISOString(),
        avatarHash: null,
        normalizedName: 'bad1',
        dismissed: null,
        dangerPoints: [{ ts: Date.now(), points: 4, detector: 'textSpam', reason: '連投' }]
    };
    const purgeWindows: number[] = [];
    (manager as any).deleteRecentMessages = async (_guild: any, userId: string, seconds: number) => {
        assert.equal(userId, 'bad1');
        events.push('purge');
        purgeWindows.push(seconds);
        return 7;
    };

    const config = readWatchSettings(settings.watch);
    const entry = structuredClone(settings.watchUsers.bad1);
    await (manager as any).executeWatchDanger(guildOf(target), settings, 'bad1', entry, config, 5);

    assert.deepEqual(events, ['purge', `kick:${WATCH_KICK_REASON}`]);
    assert.deepEqual(purgeWindows, [24 * 3600]);
    assert.equal(settings.watchUsers.bad1, undefined);

    assert.equal(sent.length, 1);
    assert.match(sent[0].embeds[0].data.title, /危険判定によりキック/);
    assert.match(fieldValue(sent[0], '蓄積ポイント（24時間）'), /5 \/ 5/);
    assert.match(fieldValue(sent[0], 'メッセージ削除'), /7 件/);
    assert.match(fieldValue(sent[0], '結果'), /キックしました/);
});

const guildOf = (member: any) => member.guild;

test('a protected member is not kicked: messages are still purged and autoTimeout is used', async () => {
    const { manager, settings, sent, events, member } = setup();
    const target = member('admin2', {
        permissions: { has: (flag: bigint) => flag === PermissionFlagsBits.ManageGuild }
    });
    settings.watchUsers.admin2 = {
        reason: '新規アカウント',
        signals: ['new-account'],
        since: new Date().toISOString(),
        source: 'join',
        nameSnapshot: 'admin2',
        accountCreatedAt: new Date(Date.now() - DAY).toISOString(),
        avatarHash: null,
        normalizedName: 'admin2',
        dismissed: null,
        dangerPoints: [{ ts: Date.now(), points: 5 }]
    };
    settings.autoTimeout.enabled = true;
    (manager as any).deleteRecentMessages = async () => { events.push('purge'); return 3; };
    (manager as any).executeAutoTimeout = async () => { events.push('timeout'); return true; };

    const config = readWatchSettings(settings.watch);
    const entry = structuredClone(settings.watchUsers.admin2);
    await (manager as any).executeWatchDanger(guildOf(target), settings, 'admin2', entry, config, 5);

    assert.deepEqual(events, ['purge', 'timeout']);
    assert.ok(settings.watchUsers.admin2, 'entry kept for a skipped kick');
    assert.deepEqual(settings.watchUsers.admin2.dangerPoints, []);
    assert.ok(settings.watchUsers.admin2.lastDangerAt);

    assert.equal(sent.length, 1);
    assert.match(sent[0].embeds[0].data.title, /キックなし/);
    assert.match(fieldValue(sent[0], '結果'), /スキップ: 管理者権限/);
    assert.match(fieldValue(sent[0], 'メッセージ削除'), /3 件/);
});

test('autoKickOnDanger=false withholds only the kick', async () => {
    const { manager, settings, sent, events, member } = setup();
    const target = member('bad3');
    settings.watch = { ...settings.watch, autoKickOnDanger: false };
    settings.watchUsers.bad3 = {
        reason: '新規アカウント', signals: ['new-account'],
        since: new Date().toISOString(), source: 'join', nameSnapshot: 'bad3',
        accountCreatedAt: new Date(Date.now() - DAY).toISOString(),
        avatarHash: null, normalizedName: 'bad3', dismissed: null,
        dangerPoints: [{ ts: Date.now(), points: 5 }]
    };
    (manager as any).deleteRecentMessages = async () => { events.push('purge'); return 2; };

    const config = readWatchSettings(settings.watch);
    const entry = structuredClone(settings.watchUsers.bad3);
    await (manager as any).executeWatchDanger(guildOf(target), settings, 'bad3', entry, config, 5);

    assert.deepEqual(events, ['purge']);
    assert.equal(settings.watchUsers.bad3.dismissed, null);
    assert.match(fieldValue(sent[0], '結果'), /自動キックが無効/);
});

test('rolling points accumulate, ignore stale events and trigger the pipeline at the threshold', async () => {
    const { manager, settings } = setup();
    settings.watch = { ...settings.watch, kickThresholdPoints: 5 };
    settings.watchUsers.accum = {
        reason: '新規アカウント', signals: ['new-account'],
        since: new Date().toISOString(), source: 'join', nameSnapshot: 'accum',
        accountCreatedAt: new Date(Date.now() - DAY).toISOString(),
        avatarHash: null, normalizedName: 'accum', dismissed: null,
        dangerPoints: [
            { ts: Date.now() - WATCH_POINT_WINDOW_MS - 60_000, points: 4 },
            { ts: Date.now() - 60_000, points: 2 }
        ]
    };
    const triggered: number[] = [];
    (manager as any).executeWatchDanger = async (...args: any[]) => { triggered.push(args[5]); };

    const guild: any = { id: 'guild', members: { cache: new Collection(), fetch: async () => null } };
    const belowThreshold = (manager as any).recordWatchDangerPoints(
        guild, settings, 'accum', 1, [{ detector: 'textSpam', result: { scoreDelta: 1, reasons: ['連投'] } }]
    );
    assert.equal(belowThreshold, false);
    // 4 points are stale, 2 + 1 are inside the window.
    assert.equal(settings.watchUsers.accum.dangerPoints.length, 2);

    const atThreshold = (manager as any).recordWatchDangerPoints(
        guild, settings, 'accum', 2, [{ detector: 'textSpam', result: { scoreDelta: 2, reasons: ['連投'] } }]
    );
    assert.equal(atThreshold, true);
    assert.deepEqual(triggered, [5]);
});

test('flagged users keep no positive trust and are not skipped for trust leniency', async () => {
    const { manager, settings } = setup();
    settings.watchUsers.watched = {
        reason: '新規アカウント', signals: ['new-account'],
        since: new Date().toISOString(), source: 'join', nameSnapshot: 'watched',
        accountCreatedAt: new Date(Date.now() - DAY).toISOString(),
        avatarHash: null, normalizedName: 'watched', dismissed: null
    };
    settings.userTrust.watched = {
        score: 40, lastUpdated: new Date().toISOString(), history: []
    };

    const score = await (manager as any).applyTrustAdjustment(settings, 'guild', 'watched', 6, '検知');
    assert.equal(score, 40, 'positive delta clamped to 0');
    assert.equal(settings.userTrust.watched.history.at(-1).delta, 0);
    assert.match(settings.userTrust.watched.history.at(-1).reason, /加点停止/);

    const penalty = await (manager as any).applyTrustAdjustment(settings, 'guild', 'watched', -3, '検知');
    assert.equal(penalty, 37, 'penalties still apply');
});
