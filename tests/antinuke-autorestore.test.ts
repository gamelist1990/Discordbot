import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import {
    AUTO_RESTORE_LIMITATIONS,
    emptyAutoRestoreReport,
    formatCleanupTotals,
    incidentStartMs,
    planAutoRestoreCleanup,
    recordCleanup,
    selectPreIncidentSnapshot
} from '../src/core/anticheat/AutoRestore.ts';
import { readAntiNukeSettings, readAutoRestoreMode } from '../src/core/anticheat/AntiNuke.ts';
import {
    AntiNukeManager,
    ANTINUKE_INCIDENTS_KEY,
    antiNukeManager
} from '../src/core/anticheat/AntiNukeManager.ts';
import { SnapshotManager } from '../src/core/anticheat/SnapshotManager.ts';
import { database } from '../src/core/persistence/Database.ts';

const NOW = 1_780_000_000_000; // 2026-11-27T…Z — fixed so dates are deterministic.

// ---------------------------------------------------------------------------
// A. Setting (brief AN3 §A)
// ---------------------------------------------------------------------------

test('setting: autoRestore defaults to full and accepts off/cleanup/full', () => {
    assert.equal(readAntiNukeSettings(undefined).autoRestore, 'full');
    assert.equal(readAntiNukeSettings({}).autoRestore, 'full');
    assert.equal(readAntiNukeSettings({ autoRestore: 'cleanup' }).autoRestore, 'cleanup');
    assert.equal(readAntiNukeSettings({ autoRestore: 'off' }).autoRestore, 'off');
    assert.equal(readAntiNukeSettings({ autoRestore: 'full' }).autoRestore, 'full');
    // Stored values are matched case-insensitively; anything else falls back.
    assert.equal(readAntiNukeSettings({ autoRestore: ' OFF ' }).autoRestore, 'off');
    assert.equal(readAntiNukeSettings({ autoRestore: 'bogus' }).autoRestore, 'full');
    assert.equal(readAutoRestoreMode(undefined), 'full');
    assert.equal(readAutoRestoreMode(42), 'full');
});

test('setting: unrelated antiNuke settings keep their defaults alongside autoRestore', () => {
    const settings = readAntiNukeSettings({ autoRestore: 'cleanup' });
    assert.equal(settings.enabled, true);
    assert.equal(settings.snapshots.keep, 10);
    assert.equal(settings.rules.channelDelete.threshold, 3);
});

// ---------------------------------------------------------------------------
// B. Cleanup target selection (pure)
// ---------------------------------------------------------------------------

const baseIncident = (overrides: Record<string, unknown> = {}) => ({
    id: 'inc-1',
    guildId: 'guild',
    actorId: 'attacker',
    windowStart: '2026-11-27T00:00:00.000Z',
    startedAt: '2026-11-27T00:00:00.000Z',
    detectedAt: '2026-11-27T00:00:30.000Z',
    affected: {
        channelsCreated: ['ch-created', 'ch-created', 'ch-system'],
        rolesCreated: ['r-created', 'guild'],
        webhooksCreated: ['wh-created'],
        emojisCreated: ['e-created'],
        membersBanned: ['attacker', 'u-victim', 'u-preexisting', 'u-staff', 'u-victim'],
        channelsDeleted: ['ch-deleted'],
        rolesDeleted: ['r-deleted'],
        membersKicked: ['u-kicked'],
        emojisDeleted: ['e-deleted']
    },
    ...overrides
});

test('cleanup: only the attacker-created objects are planned, deduplicated', () => {
    const { plan } = planAutoRestoreCleanup({
        incident: baseIncident(),
        snapshotBannedIds: [],
        protectIds: []
    });
    assert.deepEqual(plan.channels, ['ch-created', 'ch-system']);
    assert.deepEqual(plan.roles, ['r-created', 'guild']);
    assert.deepEqual(plan.webhooks, ['wh-created']);
    assert.deepEqual(plan.emojis, ['e-created']);
    // Deleted / kicked objects are never deletion targets.
    assert.ok(!plan.channels.includes('ch-deleted'));
    assert.ok(!plan.roles.includes('r-deleted'));
});

test('cleanup: unbans exclude the attacker, protected ids and snapshot-banned users', () => {
    const { plan } = planAutoRestoreCleanup({
        incident: baseIncident(),
        snapshotBannedIds: ['u-preexisting', 'u-staff'],
        protectIds: ['owner']
    });
    assert.deepEqual(plan.unbans, ['u-victim']);
    const reasons = Object.fromEntries(plan.skipUnbans.map((entry) => [entry.userId, entry.reason]));
    assert.match(reasons['attacker'], /実行者自身/);
    assert.match(reasons['u-preexisting'], /スナップショット時点でBAN済み/);
    assert.match(reasons['u-staff'], /スナップショット時点でBAN済み/);
});

test('cleanup: a protected owner/self id is never unbanned', () => {
    const { plan } = planAutoRestoreCleanup({
        incident: baseIncident({
            affected: { membersBanned: ['u-owner', 'u-self', 'u-victim'] }
        }),
        snapshotBannedIds: [],
        protectIds: ['u-owner', 'u-self']
    });
    assert.deepEqual(plan.unbans, ['u-victim']);
    assert.equal(plan.skipUnbans.length, 2);
});

test('cleanup: with no attributed actor nothing is planned and the report says why', () => {
    const { plan, notes } = planAutoRestoreCleanup({
        incident: baseIncident({ actorId: null }),
        snapshotBannedIds: [],
        protectIds: []
    });
    assert.deepEqual(plan.channels, []);
    assert.deepEqual(plan.roles, []);
    assert.deepEqual(plan.unbans, []);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /実行者を特定できなかった/);
});

// ---------------------------------------------------------------------------
// Pre-incident snapshot selection
// ---------------------------------------------------------------------------

const meta = (id: string, createdAt: string) => ({ id, createdAt });

test('snapshot: the newest snapshot at or before the incident start wins', () => {
    const snapshots = [
        meta('snap-post', '2026-11-27T00:05:00.000Z'),
        meta('snap-latest-pre', '2026-11-26T23:00:00.000Z'),
        meta('snap-old-pre', '2026-11-26T12:00:00.000Z')
    ];
    const chosen = selectPreIncidentSnapshot(snapshots, Date.parse('2026-11-27T00:00:00.000Z'));
    assert.equal(chosen?.id, 'snap-latest-pre');
});

test('snapshot: a post-attack snapshot is never selected', () => {
    const snapshots = [meta('snap-post', '2026-11-27T00:05:00.000Z')];
    assert.equal(selectPreIncidentSnapshot(snapshots, Date.parse('2026-11-27T00:00:00.000Z')), null);
    assert.equal(selectPreIncidentSnapshot(snapshots, null), null);
    assert.equal(selectPreIncidentSnapshot([], NOW), null);
});

test('snapshot: incident start falls back to startedAt then detectedAt', () => {
    assert.equal(incidentStartMs({ id: 'i', guildId: 'g', actorId: null, windowStart: '2026-11-27T00:00:00.000Z' }),
        Date.parse('2026-11-27T00:00:00.000Z'));
    assert.equal(incidentStartMs({ id: 'i', guildId: 'g', actorId: null, startedAt: '2026-11-27T01:00:00.000Z' }),
        Date.parse('2026-11-27T01:00:00.000Z'));
    assert.equal(incidentStartMs({ id: 'i', guildId: 'g', actorId: null, detectedAt: '2026-11-27T02:00:00.000Z' }),
        Date.parse('2026-11-27T02:00:00.000Z'));
    assert.equal(incidentStartMs({ id: 'i', guildId: 'g', actorId: null }), null);
});

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

test('report: totals start empty, record per kind, and state the standing caveats', () => {
    const report = emptyAutoRestoreReport({
        id: 'report-1', guildId: 'guild', incidentId: 'inc-1', mode: 'full',
        startedAt: '2026-11-27T00:00:00.000Z', reDamageRisk: false
    });
    recordCleanup(report, { kind: 'channel', id: 'ch', name: 'general', outcome: 'deleted' });
    recordCleanup(report, { kind: 'role', id: 'r', name: 'role', outcome: 'skipped', reason: '管理ロール' });
    recordCleanup(report, { kind: 'ban', id: 'u', name: 'u', outcome: 'deleted' });

    assert.deepEqual(report.cleanup.totals.channel, { deleted: 1, skipped: 0, failed: 0 });
    assert.deepEqual(report.cleanup.totals.role, { deleted: 0, skipped: 1, failed: 0 });
    assert.deepEqual(report.cleanup.totals.ban, { deleted: 1, skipped: 0, failed: 0 });
    const lines = formatCleanupTotals(report.cleanup.totals);
    assert.equal(lines.length, 5);
    assert.ok(lines[0].startsWith('チャンネル: 削除 1'));
    assert.ok(lines[4].startsWith('BAN解除: 解除 1'));
    assert.ok(AUTO_RESTORE_LIMITATIONS.some((line) => line.includes('メッセージ履歴')));
    assert.ok(AUTO_RESTORE_LIMITATIONS.some((line) => line.includes('スナップショット以降')));
});

// ---------------------------------------------------------------------------
// Immediate start: response → recovery, no timer (brief AN3 §B2)
// ---------------------------------------------------------------------------

function triggerSetup() {
    const manager = new AntiNukeManager();
    manager.setClock(() => NOW);
    (manager as any).client = {
        user: { id: 'self-bot' },
        users: { fetch: async () => ({ send: async () => undefined }) }
    };
    const incidents: any[] = [];
    const order: string[] = [];
    (manager as any).persistIncident = async (incident: any) => {
        order.push(`persist:${incident.actions.ban}`);
        incidents.push(structuredClone(incident));
    };
    (manager as any).resolveLatestSnapshotId = async () => 'snap-1';
    (manager as any).collectAffected = async () => ({
        channelsDeleted: [],
        rolesDeleted: [],
        membersBanned: [],
        membersKicked: [],
        channelsCreated: ['ch-evil'],
        rolesCreated: [],
        webhooksCreated: [],
        emojisCreated: [],
        emojisDeleted: []
    });
    (manager as any).postToLogChannel = async () => {
        order.push('log');
        return true;
    };
    manager.setResponseHooks({
        ban: async () => {
            order.push('ban');
            return { ok: true };
        },
        strip: async () => ({ ok: true })
    });
    const dms: any[] = [];
    (manager as any).dmOwner = async (_guild: any, _settings: any, embed: any) => {
        order.push('dm');
        dms.push(embed);
        return { status: 'sent' as const };
    };
    return { manager, incidents, order, dms };
}

test('trigger: recovery starts immediately after the response, and the DM says started', async () => {
    const { manager, incidents, order, dms } = triggerSetup();
    const requests: any[] = [];
    manager.setAutoRestoreStarter(async (request) => {
        order.push('auto-restore');
        requests.push(request);
    });

    await (manager as any).trigger({
        guild: {
            id: 'guild', name: 'Guild', ownerId: 'owner',
            members: { cache: new Collection(), fetch: async () => null, fetchMe: async () => null },
            bans: { create: async () => undefined },
            fetchAuditLogs: async () => ({ entries: new Collection() }),
            fetchOwner: async () => ({ id: 'owner' })
        },
        settings: readAntiNukeSettings(undefined),
        rule: 'channelDelete',
        kind: 'velocity',
        actor: { id: 'attacker', tag: 'attacker#0001', isBot: false, roleIds: [], member: null },
        hit: { count: 3, threshold: 3, windowSeconds: 60, exceeded: true, windowStart: NOW - 30_000 }
    });

    // No timer, no deferral: the starter is invoked in the same turn, after the
    // log + owner DM completed.
    assert.deepEqual(order, [
        'persist:skipped', 'ban', 'persist:success', 'log', 'dm', 'persist:success', 'auto-restore'
    ]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].mode, 'full');
    assert.equal(requests[0].actorId, 'attacker');
    assert.equal(requests[0].reDamageRisk, false);

    const final = incidents[incidents.length - 1];
    assert.equal(final.autoRestoreStopRequested, false);
    assert.equal(final.autoRestore.mode, 'full');
    assert.equal(final.autoRestore.status, 'running');
    assert.equal(final.autoRestore.startedAt, new Date(NOW).toISOString());
    assert.equal(final.autoRestore.finishedAt, null);

    const dmText = JSON.stringify(dms[dms.length - 1]);
    assert.match(dmText, /自動復旧/);
    assert.match(dmText, /開始しました/);
    assert.match(dmText, /停止/);
    assert.doesNotMatch(dmText, /予約|スケジュール/);
});

test('trigger: autoRestore off keeps the response unchanged and starts nothing', async () => {
    const { manager, incidents, order } = triggerSetup();
    let called = 0;
    manager.setAutoRestoreStarter(async () => {
        called += 1;
    });

    await (manager as any).trigger({
        guild: {
            id: 'guild', name: 'Guild', ownerId: 'owner',
            members: { cache: new Collection(), fetch: async () => null, fetchMe: async () => null },
            bans: { create: async () => undefined },
            fetchAuditLogs: async () => ({ entries: new Collection() }),
            fetchOwner: async () => ({ id: 'owner' })
        },
        settings: readAntiNukeSettings({ autoRestore: 'off' }),
        rule: 'channelDelete',
        kind: 'velocity',
        actor: { id: 'attacker', tag: null, isBot: false, roleIds: [], member: null },
        hit: { count: 3, threshold: 3, windowSeconds: 60, exceeded: true, windowStart: NOW - 30_000 }
    });

    assert.equal(called, 0);
    assert.deepEqual(order, ['persist:skipped', 'ban', 'persist:success', 'log', 'dm', 'persist:success']);
    assert.equal(incidents[incidents.length - 1].autoRestore, undefined);
});

test('trigger: a failed ban still starts recovery and flags the re-damage risk', async () => {
    const { manager, incidents } = triggerSetup();
    manager.setResponseHooks({
        ban: async () => ({ ok: false, error: '権限不足またはロール階層が低いため実行できません（50013）' }),
        strip: async () => ({ ok: false, error: 'ロール階層が低いためロールを剥奪できません' })
    });
    let request: any = null;
    manager.setAutoRestoreStarter(async (value) => {
        request = value;
    });

    await (manager as any).trigger({
        guild: {
            id: 'guild', name: 'Guild', ownerId: 'owner',
            members: { cache: new Collection(), fetch: async () => null, fetchMe: async () => null },
            bans: { create: async () => undefined },
            fetchAuditLogs: async () => ({ entries: new Collection() }),
            fetchOwner: async () => ({ id: 'owner' })
        },
        settings: readAntiNukeSettings(undefined),
        rule: 'roleDelete',
        kind: 'velocity',
        actor: { id: 'attacker', tag: null, isBot: false, roleIds: [], member: null },
        hit: { count: 3, threshold: 3, windowSeconds: 60, exceeded: true, windowStart: NOW - 5_000 }
    });

    assert.ok(request);
    assert.equal(request.reDamageRisk, true);
    assert.equal(incidents[incidents.length - 1].actions.ban, 'failed');
});

// ---------------------------------------------------------------------------
// Cleanup engine on a fake guild
// ---------------------------------------------------------------------------

function fakeAutoRestoreGuild() {
    const deletedChannels: string[] = [];
    const deletedRoles: string[] = [];
    const deletedWebhooks: string[] = [];
    const deletedEmojis: string[] = [];
    const unbanned: string[] = [];

    const channel = (id: string, name: string) => ({
        id, name, delete: async () => { deletedChannels.push(id); return {}; }
    });
    const role = (id: string, name: string, managed = false) => ({
        id, name, managed, delete: async () => { deletedRoles.push(id); return {}; }
    });
    const emoji = (id: string, name: string, managed = false) => ({
        id, name, managed, delete: async () => { deletedEmojis.push(id); return {}; }
    });

    const channelCache = new Collection<string, any>([
        ['ch-created', channel('ch-created', 'evil-channel')],
        ['ch-system', channel('ch-system', 'system')]
    ]);
    const roleCache = new Collection<string, any>([
        ['r-created', role('r-created', 'evil-role')],
        ['guild', role('guild', '@everyone')]
    ]);
    const emojiCache = new Collection<string, any>([
        ['e-created', emoji('e-created', 'evil-emoji')]
    ]);
    const webhook = {
        id: 'wh-created',
        name: 'evil-hook',
        owner: { id: 'attacker' },
        delete: async () => { deletedWebhooks.push('wh-created'); return {}; }
    };
    const bans = new Collection<string, any>([
        ['u-victim', { user: { id: 'u-victim' } }],
        ['u-preexisting', { user: { id: 'u-preexisting' } }]
    ]);

    const guild: any = {
        id: 'guild',
        name: 'Guild',
        ownerId: 'owner',
        systemChannelId: 'ch-system',
        afkChannelId: null,
        channels: {
            cache: channelCache,
            fetch: async (id: string) => channelCache.get(id) ?? null
        },
        roles: {
            cache: roleCache,
            fetch: async (id: string) => roleCache.get(id) ?? null
        },
        emojis: {
            cache: emojiCache,
            fetch: async (id: string) => emojiCache.get(id) ?? null
        },
        fetchWebhooks: async () => new Collection([['wh-created', webhook]]),
        bans: {
            fetch: async () => bans,
            remove: async (id: string) => {
                unbanned.push(id);
                bans.delete(id);
                return {};
            }
        },
        members: {
            cache: new Collection(),
            list: async () => new Collection(),
            fetch: async () => null
        },
        fetchOwner: async () => ({ id: 'owner' })
    };
    return { guild, deletedChannels, deletedRoles, deletedWebhooks, deletedEmojis, unbanned };
}

function autoRestoreIncident() {
    return {
        id: 'inc-1',
        guildId: 'guild',
        guildName: 'Guild',
        rule: 'channelDelete',
        ruleLabel: 'チャンネル削除',
        kind: 'velocity',
        actorId: 'attacker',
        actorTag: 'attacker#0001',
        actorIsBot: false,
        windowStart: '2026-11-27T00:00:00.000Z',
        startedAt: '2026-11-27T00:00:00.000Z',
        detectedAt: '2026-11-27T00:00:30.000Z',
        snapshotId: 'snap-pre',
        affected: {
            channelsDeleted: ['ch-deleted'],
            rolesDeleted: [],
            membersBanned: ['attacker', 'u-victim', 'u-preexisting'],
            membersKicked: [],
            channelsCreated: ['ch-created', 'ch-system'],
            rolesCreated: ['r-created', 'guild'],
            webhooksCreated: ['wh-created'],
            emojisCreated: ['e-created'],
            emojisDeleted: []
        },
        actions: { ban: 'success', rolesStripped: false, logPosted: true, ownerDm: 'sent' },
        status: 'open' as const,
        attribution: 'audit' as const
    };
}

function autoRestoreManager(options: {
    stopSequence?: boolean[];
    storedIncident?: any;
} = {}) {
    const manager = new SnapshotManager();
    manager.setClock(() => NOW);
    manager.setPaceMs(0);
    (manager as any).client = {
        user: { id: 'self-bot' },
        users: { fetch: async () => ({ send: async () => undefined }) },
        isReady: () => true
    };
    (manager as any).getSettings = async () => readAntiNukeSettings(undefined);
    (manager as any).persistAutoRestoreReport = async () => undefined;
    (manager as any).postAutoRestoreReport = async () => undefined;
    manager.setLogChannelSource(async () => null);

    const stopSequence = [...(options.stopSequence ?? [])];
    const updates: any[] = [];
    const starts: any[] = [];
    manager.setAutoRestoreIncidentOps({
        get: async () => options.storedIncident ?? {
            ...autoRestoreIncident(),
            autoRestore: {
                mode: 'cleanup', status: 'running', startedAt: new Date(NOW).toISOString(),
                finishedAt: null, stopRequestedAt: null, stopRequestedBy: null,
                jobId: null, reportId: null, snapshotId: null, error: null
            }
        },
        update: async (_guildId, _incidentId, patch) => {
            updates.push(patch);
            return true;
        },
        stopRequested: async () => (stopSequence.length ? stopSequence.shift()! : false)
    });
    (manager as any).startRestore = async (_guild: any, snapshotId: string, restoreOptions: any, _by: any, _hooks: any) => {
        starts.push({ snapshotId, options: restoreOptions });
        return { id: 'job-1', status: 'running', snapshotId, options: restoreOptions };
    };
    (manager as any).waitForJob = async () => undefined;
    (manager as any).getJob = async () => ({
        id: 'job-1', status: 'done', report: { stopped: false, stopReason: null, totals: { role: { restored: 2, skipped: 0, failed: 0 } } }
    });
    (manager as any).readIndex = async () => ({
        latestSnapshotId: 'snap-post',
        snapshots: [
            meta('snap-post', '2026-11-27T00:05:00.000Z'),
            meta('snap-pre', '2026-11-26T23:00:00.000Z')
        ]
    });
    (manager as any).getSnapshot = async (_guildId: string, snapshotId: string) =>
        snapshotId === 'snap-pre'
            ? { id: 'snap-pre', bans: [{ userId: 'u-preexisting', reason: '荒らし' }], createdAt: '2026-11-26T23:00:00.000Z' }
            : null;
    return { manager, updates, starts };
}

test('engine: cleanup deletes only attacker-created objects and unbans only attack bans', async () => {
    const { manager, updates } = autoRestoreManager();
    const { guild, deletedChannels, deletedRoles, deletedWebhooks, deletedEmojis, unbanned } = fakeAutoRestoreGuild();
    const incident = autoRestoreIncident();

    const report = await manager.startAutoRestore({
        guild,
        incident: incident as any,
        mode: 'cleanup',
        actorId: 'attacker',
        reDamageRisk: false,
        settings: readAntiNukeSettings(undefined)
    });

    assert.equal(report.status, 'done');
    assert.deepEqual(deletedChannels, ['ch-created']); // system channel protected
    assert.deepEqual(deletedRoles, ['r-created']); // @everyone protected
    assert.deepEqual(deletedWebhooks, ['wh-created']);
    assert.deepEqual(deletedEmojis, ['e-created']);
    assert.deepEqual(unbanned, ['u-victim']); // attacker + snapshot bans excluded
    assert.equal(report.restore, null);
    assert.equal(report.snapshotId, 'snap-pre');

    const skipped = report.cleanup.entries.filter((entry) => entry.outcome === 'skipped');
    assert.ok(skipped.some((entry) => entry.id === 'ch-system' && /システム/.test(entry.reason ?? '')));
    assert.ok(skipped.some((entry) => entry.id === 'guild' && /@everyone/.test(entry.reason ?? '')));
    assert.ok(skipped.some((entry) => entry.id === 'attacker' && /実行者自身/.test(entry.reason ?? '')));
    assert.ok(skipped.some((entry) => entry.id === 'u-preexisting' && /スナップショット/.test(entry.reason ?? '')));

    const final = updates[updates.length - 1];
    assert.equal(final.status, 'done');
    assert.equal(final.reportId, report.id);
    assert.equal(final.snapshotId, 'snap-pre');
    assert.equal(final.jobId, null);
});

test('engine: full mode restores from the pre-incident snapshot, never the post-attack one', async () => {
    const { manager, starts, updates } = autoRestoreManager();
    const { guild } = fakeAutoRestoreGuild();
    const incident = autoRestoreIncident();

    const report = await manager.startAutoRestore({
        guild,
        incident: incident as any,
        mode: 'full',
        actorId: 'attacker',
        reDamageRisk: false,
        settings: readAntiNukeSettings(undefined)
    });

    assert.equal(report.status, 'done');
    assert.equal(starts.length, 1);
    assert.equal(starts[0].snapshotId, 'snap-pre');
    assert.deepEqual(starts[0].options.incidentIds, ['inc-1']);
    assert.equal(starts[0].options.rebanSnapshotBans, false);
    assert.equal(report.restore?.jobId, 'job-1');
    assert.equal(report.restore?.status, 'done');
    assert.deepEqual(report.restore?.totals?.role, { restored: 2, skipped: 0, failed: 0 });
    assert.ok(updates.some((patch) => patch.jobId === 'job-1'));
});

test('engine: no pre-incident snapshot → cleanup only, owner note, no unbans, no restore', async () => {
    const { manager, starts } = autoRestoreManager();
    (manager as any).readIndex = async () => ({
        latestSnapshotId: 'snap-post',
        snapshots: [meta('snap-post', '2026-11-27T00:05:00.000Z')]
    });
    const { guild, deletedChannels, unbanned } = fakeAutoRestoreGuild();
    const incident = autoRestoreIncident();

    const report = await manager.startAutoRestore({
        guild,
        incident: incident as any,
        mode: 'full',
        actorId: 'attacker',
        reDamageRisk: false,
        settings: readAntiNukeSettings(undefined)
    });

    assert.equal(report.status, 'done');
    assert.equal(report.snapshotId, null);
    assert.equal(starts.length, 0);
    assert.deepEqual(deletedChannels, ['ch-created']);
    assert.deepEqual(unbanned, []);
    assert.ok(report.notes.some((note) => note.includes('クリーンアップのみ')));
    assert.ok(report.notes.some((note) => note.includes('スナップショット復元は実行できません')));
});

test('engine: the stop flag is honoured at a phase boundary', async () => {
    // First read (before the first phase) says continue, the next says stop.
    const { manager, updates, starts } = autoRestoreManager({ stopSequence: [false, true] });
    const { guild, deletedChannels, deletedRoles, unbanned } = fakeAutoRestoreGuild();

    const report = await manager.startAutoRestore({
        guild,
        incident: autoRestoreIncident() as any,
        mode: 'full',
        actorId: 'attacker',
        reDamageRisk: false,
        settings: readAntiNukeSettings(undefined)
    });

    assert.equal(report.status, 'stopped');
    assert.equal(report.stopped, true);
    assert.deepEqual(deletedChannels, []);
    assert.deepEqual(deletedRoles, []);
    assert.deepEqual(unbanned, []);
    assert.equal(starts.length, 0);
    assert.equal(updates[updates.length - 1].status, 'stopped');
    assert.match(report.stopReason ?? '', /停止操作/);
});

test('engine: a stop requested while the restore runs marks the recovery stopped', async () => {
    const { manager } = autoRestoreManager();
    (manager as any).getJob = async () => ({
        id: 'job-1', status: 'stopped',
        report: { stopped: true, stopReason: 'スタッフの停止操作により中断しました', totals: {} }
    });
    const { guild } = fakeAutoRestoreGuild();

    const report = await manager.startAutoRestore({
        guild,
        incident: autoRestoreIncident() as any,
        mode: 'full',
        actorId: 'attacker',
        reDamageRisk: false,
        settings: readAntiNukeSettings(undefined)
    });

    assert.equal(report.status, 'stopped');
    assert.equal(report.restore?.status, 'stopped');
});

test('engine: auto-recovery runs at most once per incident', async () => {    const stored = {
        ...autoRestoreIncident(),
        autoRestore: {
            mode: 'full', status: 'done', startedAt: '2026-11-27T00:01:00.000Z',
            finishedAt: '2026-11-27T00:02:00.000Z', stopRequestedAt: null, stopRequestedBy: null,
            jobId: 'job-old', reportId: 'report-old', snapshotId: 'snap-pre', error: null
        }
    };
    const { manager, starts } = autoRestoreManager({ storedIncident: stored });
    const { guild, deletedChannels } = fakeAutoRestoreGuild();

    const report = await manager.startAutoRestore({
        guild,
        incident: stored as any,
        mode: 'full',
        actorId: 'attacker',
        reDamageRisk: false,
        settings: readAntiNukeSettings(undefined)
    });

    assert.equal(report.status, 'skipped');
    assert.deepEqual(deletedChannels, []);
    assert.equal(starts.length, 0);
    assert.ok(report.notes.some((note) => note.includes('既に実行済み')));
});

// ---------------------------------------------------------------------------
// Persisted stop flag (brief AN3 §B2 / §C)
// ---------------------------------------------------------------------------

test('incident record: the stop flag is persisted, read back and surfaced by the mutator', async () => {
    const guildId = `an3-test-${Date.now()}`;
    const key = ANTINUKE_INCIDENTS_KEY(guildId);
    const incident = {
        ...autoRestoreIncident(),
        guildId,
        autoRestore: {
            mode: 'cleanup',
            status: 'running',
            startedAt: '2026-11-27T00:01:00.000Z',
            finishedAt: null,
            stopRequestedAt: null,
            stopRequestedBy: null,
            jobId: null,
            reportId: null,
            snapshotId: null,
            error: null
        }
    };
    await database.set(guildId, key, [incident]);
    try {
        assert.equal(await antiNukeManager.isAutoRestoreStopRequested(guildId, 'inc-1'), false);
        assert.equal(await antiNukeManager.requestAutoRestoreStop(guildId, 'inc-1', 'staff-1'), 'set');
        assert.equal(await antiNukeManager.isAutoRestoreStopRequested(guildId, 'inc-1'), true);

        const stored = await antiNukeManager.getIncident(guildId, 'inc-1');
        assert.equal(stored?.autoRestoreStopRequested, true);
        assert.equal(stored?.autoRestore?.stopRequestedBy, 'staff-1');
        assert.ok(stored?.autoRestore?.stopRequestedAt);

        assert.equal(await antiNukeManager.requestAutoRestoreStop(guildId, 'missing', 'staff-1'), 'not-found');

        // A finished run keeps the audit flag but never rewrites its status.
        await database.set(guildId, key, [{
            ...incident,
            autoRestore: { ...incident.autoRestore, status: 'done', finishedAt: '2026-11-27T00:05:00.000Z' }
        }]);
        assert.equal(await antiNukeManager.requestAutoRestoreStop(guildId, 'inc-1', 'staff-2'), 'finished');
        const after = await antiNukeManager.getIncident(guildId, 'inc-1');
        assert.equal(after?.autoRestore?.status, 'done');
        assert.equal(after?.autoRestore?.stopRequestedBy, 'staff-2');
    } finally {
        await database.delete(guildId, key).catch(() => false);
    }
});
