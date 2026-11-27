import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection } from 'discord.js';
import {
    DEFAULT_SNAPSHOT_KEEP,
    RESTORE_LIMITATIONS,
    SNAPSHOT_VERSION,
    addSnapshotToIndex,
    applyIdMap,
    capacityNotes,
    countSnapshot,
    emptyRestoreReport,
    emptySnapshotIndex,
    finalizeRestoreReport,
    formatRestoreTotals,
    normalizeSnapshot,
    planRestoreOrder,
    readSnapshotIndex,
    recordRestore,
    selectRebanTargets,
    selectUnbanTargets,
    snapshotFromJson,
    snapshotMeta,
    snapshotSizeBytes,
    snapshotToJson,
    type GuildSnapshot,
    type SnapshotMeta,
    type SnapshotOverwrite
} from '../src/core/anticheat/GuildSnapshot.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A compact but representative large-community shape. */
function makeSnapshot(overrides: Partial<GuildSnapshot> = {}): GuildSnapshot {
    const snapshot: GuildSnapshot = {
        version: SNAPSHOT_VERSION,
        id: 'snap-guild-1700000000000-abc123',
        guildId: 'guild',
        guildName: 'テストサーバー',
        createdAt: '2026-11-27T00:00:00.000Z',
        trigger: 'scheduled',
        requestedBy: null,
        counts: { roles: 0, categories: 0, channels: 0, emojis: 0, bans: 0, membersWithRoles: 0 },
        limits: {
            memberRoleCap: 5000,
            membersScanned: 120,
            memberCount: 120,
            memberRolesTruncated: false,
            banCap: 1000,
            bansTruncated: false
        },
        guild: {
            name: 'テストサーバー',
            iconUrl: 'https://cdn.discordapp.com/icons/guild/hash.png',
            description: '説明',
            verificationLevel: 2,
            defaultMessageNotifications: 1,
            explicitContentFilter: 2,
            afkChannelId: 'ch-afk',
            afkTimeout: 300,
            systemChannelId: 'ch-general',
            systemChannelFlags: 0,
            preferredLocale: 'ja'
        },
        roles: [
            {
                id: 'guild', name: '@everyone', permissions: '104324673', color: 0, hoist: false,
                mentionable: false, position: 0, everyone: true, managed: false,
                unicodeEmoji: null, iconUrl: null
            },
            {
                id: 'r-mod', name: 'モデレーター', permissions: '268435456', color: 3447003, hoist: true,
                mentionable: true, position: 5, everyone: false, managed: false,
                unicodeEmoji: null, iconUrl: null
            },
            {
                id: 'r-member', name: 'メンバー', permissions: '0', color: 0, hoist: false,
                mentionable: false, position: 1, everyone: false, managed: false,
                unicodeEmoji: '🦊', iconUrl: null
            },
            {
                id: 'r-bot', name: 'BOT', permissions: '8', color: 0, hoist: false,
                mentionable: false, position: 9, everyone: false, managed: true,
                unicodeEmoji: null, iconUrl: null
            }
        ],
        channels: [
            {
                id: 'cat-1', name: 'カテゴリ', type: ChannelType.GuildCategory, topic: null,
                position: 1, parentId: null, overwrites: [], nsfw: false, rateLimitPerUser: null,
                bitrate: null, userLimit: null, rtcRegion: null, forumTags: []
            },
            {
                id: 'ch-general', name: 'general', type: ChannelType.GuildText, topic: '雑談',
                position: 2, parentId: 'cat-1', overwrites: [
                    { targetId: 'guild', type: 'role', allow: '1024', deny: '0' },
                    { targetId: 'r-mod', type: 'role', allow: '2048', deny: '0' },
                    { targetId: 'u-1', type: 'member', allow: '0', deny: '2048' }
                ], nsfw: false, rateLimitPerUser: 5, bitrate: null, userLimit: null,
                rtcRegion: null, forumTags: []
            },
            {
                id: 'ch-afk', name: 'AFK', type: ChannelType.GuildVoice, topic: null,
                position: 3, parentId: 'cat-1', overwrites: [], nsfw: false, rateLimitPerUser: null,
                bitrate: 64000, userLimit: 0, rtcRegion: 'japan', forumTags: []
            },
            {
                id: 'ch-forum', name: 'forum', type: ChannelType.GuildForum, topic: null,
                position: 4, parentId: 'cat-1', overwrites: [], nsfw: true, rateLimitPerUser: 0,
                bitrate: null, userLimit: null, rtcRegion: null, forumTags: ['質問', '要望']
            },
            {
                id: 'thread-1', name: 'スレッド', type: ChannelType.PublicThread, topic: null,
                position: 5, parentId: 'ch-general', overwrites: [], nsfw: false, rateLimitPerUser: null,
                bitrate: null, userLimit: null, rtcRegion: null, forumTags: []
            }
        ],
        emojis: [{ id: 'e-1', name: 'fox', url: 'https://cdn.discordapp.com/emojis/e-1.png', animated: false }],
        bans: [
            { userId: 'u-banned-before', reason: '荒らし' },
            { userId: 'u-attack-ban', reason: '大量BAN' }
        ],
        memberRoles: [
            { memberId: 'u-1', roleIds: ['r-mod', 'r-member'] },
            { memberId: 'u-2', roleIds: ['r-member'] }
        ],
        warnings: ['メンバーのロールは120人まで取得しました（上限5000人）']
    };
    const merged = { ...snapshot, ...overrides };
    merged.counts = countSnapshot(merged);
    return merged;
}

// ---------------------------------------------------------------------------
// A. Snapshot serialization round-trip
// ---------------------------------------------------------------------------

test('snapshot: JSON round trip keeps every captured field and recomputes counts', () => {
    const snapshot = makeSnapshot();
    const restored = snapshotFromJson(snapshotToJson(snapshot));
    assert.ok(restored, 'round trip must normalise');
    assert.deepEqual(restored, snapshot);
    assert.equal(restored!.counts.roles, 3);
    assert.equal(restored!.counts.categories, 1);
    assert.equal(restored!.counts.channels, 3);
    assert.equal(restored!.counts.emojis, 1);
    assert.equal(restored!.counts.bans, 2);
    assert.equal(restored!.counts.membersWithRoles, 2);
});

test('snapshot: thread channels are neither counted nor recreated', () => {
    const snapshot = makeSnapshot();
    const order = planRestoreOrder(snapshot);
    const ids = [...order.categories, ...order.channels].map((channel) => channel.id);
    assert.ok(!ids.includes('thread-1'));
    assert.equal(snapshot.counts.categories + snapshot.counts.channels, ids.length);
});

test('snapshot: corrupt or foreign documents are rejected whole', () => {
    const snapshot = makeSnapshot();
    assert.equal(normalizeSnapshot({ ...snapshot, version: 99 }), null);
    assert.equal(normalizeSnapshot({ ...snapshot, roles: 'nope' }), null);
    assert.equal(normalizeSnapshot({ ...snapshot, guildId: '' }), null);
    assert.equal(snapshotFromJson('{not json'), null);
    assert.equal(normalizeSnapshot(null), null);
});

test('snapshot: unknown overwrite types are dropped instead of guessed', () => {
    const snapshot = makeSnapshot();
    const normalised = normalizeSnapshot({
        ...snapshot,
        channels: [{
            ...snapshot.channels[1],
            overwrites: [
                { targetId: 'x', type: 'role', allow: '1', deny: '0' },
                { targetId: 'y', type: 'weird', allow: '1', deny: '0' }
            ]
        }]
    });
    assert.ok(normalised);
    assert.equal(normalised!.channels[0].overwrites.length, 1);
    assert.equal(normalised!.channels[0].overwrites[0].type, 'role');
});

test('snapshot: size is the UTF-8 byte size of the stored JSON', () => {
    const snapshot = makeSnapshot();
    assert.equal(snapshotSizeBytes(snapshot), Buffer.byteLength(snapshotToJson(snapshot), 'utf8'));
    assert.ok(snapshotSizeBytes(snapshot) > 0);
});

// ---------------------------------------------------------------------------
// Prune policy
// ---------------------------------------------------------------------------

const meta = (id: string, createdAt: string): SnapshotMeta => ({
    id,
    createdAt,
    trigger: 'scheduled',
    requestedBy: null,
    counts: { roles: 1, categories: 0, channels: 1, emojis: 0, bans: 0, membersWithRoles: 0 },
    bytes: 100
});

test('prune: keeps the newest N and returns the pruned ids', () => {
    let index = emptySnapshotIndex();
    const dates = [
        '2026-11-01T00:00:00.000Z',
        '2026-11-02T00:00:00.000Z',
        '2026-11-03T00:00:00.000Z',
        '2026-11-04T00:00:00.000Z',
        '2026-11-05T00:00:00.000Z'
    ];
    let pruned: string[] = [];
    dates.forEach((date, indexNumber) => {
        const result = addSnapshotToIndex(index, meta(`s${indexNumber}`, date), 3);
        index = result.index;
        pruned = pruned.concat(result.pruned);
    });
    assert.deepEqual(index.snapshots.map((entry) => entry.id), ['s4', 's3', 's2']);
    assert.equal(index.latestSnapshotId, 's4');
    assert.deepEqual(pruned, ['s0', 's1']);
    assert.deepEqual(index.snapshots.map((entry) => entry.createdAt),
        ['2026-11-05T00:00:00.000Z', '2026-11-04T00:00:00.000Z', '2026-11-03T00:00:00.000Z']);
});

test('prune: default keep is 10 and keep below 1 clamps to 1', () => {
    assert.equal(DEFAULT_SNAPSHOT_KEEP, 10);
    let index = emptySnapshotIndex();
    for (let i = 0; i < 13; i += 1) {
        index = addSnapshotToIndex(index, meta(`s${i}`, `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`)).index;
    }
    assert.equal(index.snapshots.length, 10);
    assert.equal(index.snapshots[0].id, 's12');

    const clamped = addSnapshotToIndex(emptySnapshotIndex(), meta('only', '2026-11-01T00:00:00.000Z'), 0);
    assert.equal(clamped.index.snapshots.length, 1);
    assert.deepEqual(clamped.pruned, []);
});

test('prune: re-capturing the same id does not duplicate the index entry', () => {
    const first = addSnapshotToIndex(emptySnapshotIndex(), meta('s1', '2026-11-01T00:00:00.000Z'), 10);
    const second = addSnapshotToIndex(first.index, meta('s1', '2026-11-02T00:00:00.000Z'), 10);
    assert.equal(second.index.snapshots.length, 1);
    assert.equal(second.index.snapshots[0].createdAt, '2026-11-02T00:00:00.000Z');
});

test('index: AN1-compatible shapes are readable (latestSnapshotId / legacy array)', () => {
    const fromObject = readSnapshotIndex({
        latestSnapshotId: 'snap-2',
        snapshots: [meta('snap-2', '2026-11-02T00:00:00.000Z')]
    });
    assert.equal(fromObject.latestSnapshotId, 'snap-2');

    const legacy = readSnapshotIndex([{ id: 'snap-old', createdAt: '2026-11-01T00:00:00.000Z' }]);
    assert.equal(legacy.snapshots.length, 1);
    assert.equal(legacy.latestSnapshotId, 'snap-old');

    assert.deepEqual(readSnapshotIndex(null), emptySnapshotIndex());
});

// ---------------------------------------------------------------------------
// B2. ID-map application to permission overwrites
// ---------------------------------------------------------------------------

const overwrites: SnapshotOverwrite[] = [
    { targetId: 'r-mod', type: 'role', allow: '2048', deny: '0' },
    { targetId: 'r-deleted', type: 'role', allow: '16', deny: '0' },
    { targetId: 'u-present', type: 'member', allow: '0', deny: '2048' },
    { targetId: 'u-left', type: 'member', allow: '0', deny: '1024' }
];

test('id-map: role targets are remapped, unmapped roles are skipped with a reason', () => {
    const result = applyIdMap(
        overwrites,
        { 'r-mod': 'new-mod' },
        (memberId) => memberId === 'u-present'
    );
    assert.deepEqual(result.applied.map((entry) => [entry.type, entry.targetId, entry.allow, entry.deny]), [
        ['role', 'new-mod', '2048', '0'],
        ['member', 'u-present', '0', '2048']
    ]);
    assert.deepEqual(result.skipped, [
        { targetId: 'r-deleted', type: 'role', reason: 'role-not-restored' },
        { targetId: 'u-left', type: 'member', reason: 'member-not-in-guild' }
    ]);
});

test('id-map: a reused role maps to itself and duplicate targets collapse', () => {
    const result = applyIdMap(
        [
            { targetId: 'r-keep', type: 'role', allow: '1', deny: '0' },
            { targetId: 'r-keep', type: 'role', allow: '2', deny: '0' }
        ],
        { 'r-keep': 'r-keep' },
        () => false
    );
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0].targetId, 'r-keep');
    assert.equal(result.applied[0].allow, '1');
    assert.equal(result.skipped.length, 0);
});

test('id-map: overwrites survive a recreated role id and @everyone maps in place', () => {
    const snapshot = makeSnapshot();
    const idMap = { guild: 'guild', 'r-member': 'new-member', 'r-mod': 'new-mod' };
    const result = applyIdMap(snapshot.channels[1].overwrites, idMap, () => true);
    assert.equal(result.applied.length, 3);
    assert.deepEqual(result.applied.map((entry) => entry.targetId), ['guild', 'new-mod', 'u-1']);
    assert.equal(result.skipped.length, 0);
});

// ---------------------------------------------------------------------------
// B2. Unban diff (incident window vs snapshot ban list)
// ---------------------------------------------------------------------------

test('unban: only bans added inside the incident window and not in the snapshot list are lifted', () => {
    const selection = selectUnbanTargets({
        incidentBannedIds: ['u-mass-1', 'u-mass-2', 'u-preexisting', 'u-already-lifted'],
        snapshotBannedIds: ['u-preexisting'],
        currentBannedIds: ['u-mass-1', 'u-mass-2', 'u-preexisting']
    });
    assert.deepEqual(selection.unban.sort(), ['u-mass-1', 'u-mass-2']);
    assert.deepEqual(selection.keptFromSnapshot, ['u-preexisting']);
    assert.deepEqual(selection.alreadyLifted, ['u-already-lifted']);
    assert.deepEqual(selection.protectedUsers, []);
});

test('unban: AntiNuke\'s own ban on the attacker is never lifted', () => {
    const selection = selectUnbanTargets({
        incidentBannedIds: ['u-attacker', 'u-victim'],
        snapshotBannedIds: [],
        currentBannedIds: ['u-attacker', 'u-victim'],
        protectIds: ['u-attacker', 'guild-owner', 'self-bot']
    });
    assert.deepEqual(selection.unban, ['u-victim']);
    assert.deepEqual(selection.protectedUsers, ['u-attacker']);
});

test('unban: a ban added after the snapshot but outside any incident is not touched by default', () => {
    const selection = selectUnbanTargets({
        incidentBannedIds: [],
        snapshotBannedIds: ['u-preexisting'],
        currentBannedIds: ['u-preexisting', 'u-staff-ban']
    });
    assert.deepEqual(selection.unban, []);
    assert.deepEqual(selection.keptFromSnapshot, []);
});

test('reban: only computed when staff explicitly opts in, and never for current bans', () => {
    assert.deepEqual(selectRebanTargets({
        snapshotBannedIds: ['u-a', 'u-b'],
        currentBannedIds: ['u-a']
    }), ['u-b']);
    assert.deepEqual(selectRebanTargets({ snapshotBannedIds: [], currentBannedIds: ['u-a'] }), []);
});

// ---------------------------------------------------------------------------
// Restore order
// ---------------------------------------------------------------------------

test('restore order: roles bottom-up, categories before channels, @everyone separated', () => {
    const order = planRestoreOrder(makeSnapshot());
    assert.equal(order.everyone?.id, 'guild');
    assert.deepEqual(order.roles.map((role) => role.id), ['r-member', 'r-mod', 'r-bot']);
    assert.deepEqual(order.categories.map((channel) => channel.id), ['cat-1']);
    assert.deepEqual(order.channels.map((channel) => channel.id), ['ch-general', 'ch-afk', 'ch-forum']);
});

// ---------------------------------------------------------------------------
// Skip accounting
// ---------------------------------------------------------------------------

test('accounting: outcomes land in per-kind totals and the report keeps its entries', () => {
    const report = emptyRestoreReport('snap-safety', '2026-11-27T00:00:00.000Z');
    recordRestore(report, { kind: 'role', name: 'モデレーター', sourceId: 'r-mod', targetId: 'new-mod', outcome: 'restored' });
    recordRestore(report, { kind: 'role', name: 'BOT', sourceId: 'r-bot', targetId: null, outcome: 'skipped', reason: '管理ロール' });
    recordRestore(report, { kind: 'channel', name: 'general', sourceId: 'ch-general', targetId: null, outcome: 'failed', reason: '権限不足またはロール階層が低いため実行できません（50013）' });
    recordRestore(report, { kind: 'overwrite', name: 'general / ロール r-deleted', sourceId: 'r-deleted', targetId: null, outcome: 'skipped', reason: 'role-not-restored' });

    assert.deepEqual(report.totals.role, { restored: 1, skipped: 1, failed: 0 });
    assert.deepEqual(report.totals.channel, { restored: 0, skipped: 0, failed: 1 });
    assert.deepEqual(report.totals.overwrite, { restored: 0, skipped: 1, failed: 0 });
    assert.deepEqual(report.totals.emoji, { restored: 0, skipped: 0, failed: 0 });
    assert.equal(report.entries.length, 4);
    assert.equal(report.safetySnapshotId, 'snap-safety');

    const lines = formatRestoreTotals(report.totals);
    assert.equal(lines.length, 8);
    assert.ok(lines.includes('ロール: 復元 1 / スキップ 1'));
    assert.ok(lines.includes('チャンネル: 復元 0 / 失敗 1'));
    assert.ok(lines.includes('絵文字: 復元 0'));

    finalizeRestoreReport(report, '2026-11-27T00:05:00.000Z');
    assert.equal(report.finishedAt, '2026-11-27T00:05:00.000Z');
});

test('accounting: every kind starts at zero so a report never hides a missing phase', () => {
    const report = emptyRestoreReport(null);
    assert.deepEqual(Object.keys(report.totals).sort(), [
        'ban', 'category', 'channel', 'emoji', 'guildSettings', 'memberRoles', 'overwrite', 'role'
    ]);
    for (const totals of Object.values(report.totals)) {
        assert.deepEqual(totals, { restored: 0, skipped: 0, failed: 0 });
    }
});

test('limits: 500-channel and 250-role capacity notes are stated in the preview', () => {
    assert.deepEqual(capacityNotes(120, 40), []);
    const notes = capacityNotes(501, 250);
    assert.equal(notes.length, 2);
    assert.match(notes[0], /500/);
    assert.match(notes[1], /250/);
});

test('limitations: message history and original ids are always stated', () => {
    assert.ok(RESTORE_LIMITATIONS.some((line) => line.includes('メッセージ履歴')));
    assert.ok(RESTORE_LIMITATIONS.some((line) => line.includes('元のID')));
    assert.ok(RESTORE_LIMITATIONS.some((line) => line.includes('Webhook')));
});

// ---------------------------------------------------------------------------
// Skip accounting on a real snapshot shape
// ---------------------------------------------------------------------------

test('accounting: a snapshot of a real guild shape reports what cannot come back', () => {
    const snapshot = makeSnapshot();
    const metaView = snapshotMeta(snapshot);
    assert.equal(metaView.counts.channels, 3);
    assert.ok(metaView.bytes > 0);
    assert.equal(snapshot.limits.memberRolesTruncated, false);
    assert.ok(snapshot.warnings.length > 0);
});

// ---------------------------------------------------------------------------
// B2-B4. Restore skip accounting through the job runner (fake Discord guild)
// ---------------------------------------------------------------------------

function fakeRole(id: string, name: string, position: number, options: { managed?: boolean; permissions?: bigint } = {}) {
    return {
        id,
        name,
        position,
        managed: options.managed ?? false,
        color: 0,
        hoist: false,
        mentionable: false,
        unicodeEmoji: null,
        permissions: { bitfield: options.permissions ?? 0n },
        iconURL: () => null
    };
}

function fakeGuild() {
    const everyone = fakeRole('guild', '@everyone', 0, { permissions: 1n });
    const createdRoles: any[] = [];
    const createdChannels: any[] = [];
    const unbanned: string[] = [];
    const rebanned: string[] = [];
    const roleCache = new Collection<string, any>([['guild', everyone]]);
    const channelCache = new Collection<string, any>();
    const emojiCache = new Collection<string, any>();
    const memberCache = new Collection<string, any>([['u-1', {
        id: 'u-1',
        manageable: true,
        roles: { add: async () => undefined }
    }]]);
    const bans = new Collection<string, any>([
        ['u-attacker', { user: { id: 'u-attacker' }, reason: 'AntiNuke' }],
        ['u-mass-1', { user: { id: 'u-mass-1' }, reason: '大量BAN' }],
        ['u-preexisting', { user: { id: 'u-preexisting' }, reason: '荒らし' }]
    ]);
    let counter = 0;
    const guild: any = {
        id: 'guild',
        name: '破壊後のサーバー',
        ownerId: 'owner',
        memberCount: 3,
        premiumTier: 'TIER_0',
        verificationLevel: 0,
        defaultMessageNotifications: 0,
        explicitContentFilter: 0,
        afkChannelId: null,
        afkTimeout: 300,
        systemChannelId: null,
        systemChannelFlags: { bitfield: 0 },
        client: { rest: { patch: async () => ({}) } },
        roles: {
            cache: roleCache,
            everyone: { ...everyone, setPermissions: async () => undefined },
            create: async (options: any) => {
                const role = fakeRole(`new-r-${(counter += 1)}`, options.name, options.position, { permissions: 0n });
                createdRoles.push(role);
                roleCache.set(role.id, role);
                return role;
            }
        },
        channels: {
            cache: channelCache,
            fetch: async () => channelCache,
            create: async (options: any) => {
                const channel = { id: `new-ch-${(counter += 1)}`, name: options.name, type: options.type };
                createdChannels.push({ ...channel, options });
                channelCache.set(channel.id, channel);
                return channel;
            }
        },
        emojis: {
            cache: emojiCache,
            create: async () => {
                throw Object.assign(new Error('Maximum number of emojis reached'), { code: 30008 });
            }
        },
        bans: {
            fetch: async () => bans,
            remove: async (userId: string) => {
                unbanned.push(userId);
                bans.delete(userId);
                return {};
            },
            create: async (userId: string) => {
                rebanned.push(userId);
                return {};
            }
        },
        members: {
            cache: memberCache,
            fetch: async (id: string) => memberCache.get(id) ?? null,
            list: async () => new Collection()
        },
        setName: async () => undefined,
        setIcon: async () => undefined,
        setVerificationLevel: async () => undefined,
        setDefaultMessageNotifications: async () => undefined,
        setExplicitContentFilter: async () => undefined,
        setAFKChannel: async () => undefined,
        setAFKTimeout: async () => undefined,
        setSystemChannel: async () => undefined,
        setSystemChannelFlags: async () => undefined
    };
    return { guild, createdRoles, createdChannels, unbanned, rebanned };
}

test('restore: a destroyed guild is rebuilt with per-kind skip accounting', async () => {
    const { SnapshotManager } = await import('../src/core/anticheat/SnapshotManager.ts');
    const { readAntiNukeSettings } = await import('../src/core/anticheat/AntiNuke.ts');

    const snapshot = makeSnapshot({ guild: { ...makeSnapshot().guild, iconUrl: null } });
    // A staff ban that predates the attack: it must survive the unban pass.
    snapshot.bans.push({ userId: 'u-preexisting', reason: '荒らし（攻撃前から）' });
    // An overwrite whose role was deleted from the snapshot's world.
    snapshot.channels[1].overwrites.push({ targetId: 'r-gone', type: 'role', allow: '64', deny: '0' });

    const manager = new SnapshotManager();
    manager.setClock(() => Date.parse('2026-11-27T01:00:00.000Z'));
    manager.setPaceMs(0);
    (manager as any).client = { user: { id: 'self-bot' }, isReady: () => true };
    (manager as any).getSettings = async () => readAntiNukeSettings(undefined);
    (manager as any).captureAndStore = async () => ({ ...snapshot, id: 'snap-safety', trigger: 'prerestore' });
    (manager as any).persistJob = async () => undefined;
    (manager as any).postRestoreReport = async () => undefined;
    manager.setIncidentCloser(async () => 1);
    manager.setIncidentSource(async () => ([{
        id: 'incident-1',
        rule: 'memberBan',
        actorId: 'u-attacker',
        windowStart: '2026-11-26T23:00:00.000Z',
        detectedAt: '2026-11-26T23:05:00.000Z',
        affected: { membersBanned: ['u-attacker', 'u-mass-1', 'u-preexisting', 'u-lifted'] },
        status: 'open'
    }]));

    const { guild, createdRoles, createdChannels, unbanned, rebanned } = fakeGuild();
    const job: any = {
        id: 'job-1',
        guildId: 'guild',
        snapshotId: snapshot.id,
        safetySnapshotId: null,
        status: 'running',
        startedAt: '2026-11-27T01:00:00.000Z',
        finishedAt: null,
        requestedBy: 'staff',
        options: { unbanAdded: true, rebanSnapshotBans: false, incidentIds: [] },
        phase: 'starting',
        progress: { done: 0, total: 0 },
        report: null,
        error: null
    };

    await (manager as any).runRestore(guild, snapshot, job);

    assert.equal(job.status, 'done');
    const report = job.report;
    assert.ok(report);
    assert.equal(report.safetySnapshotId, 'snap-safety');
    assert.equal(report.incidentWindowStart, '2026-11-26T23:00:00.000Z');

    // Roles: @everyone in place + 2 recreated; the managed role is skipped.
    assert.deepEqual(report.totals.role, { restored: 3, skipped: 1, failed: 0 });
    assert.equal(createdRoles.length, 2);
    assert.equal(report.roleIdMap.filter((entry: any) => entry.mode === 'recreated').length, 2);
    // Categories then channels; the thread is never recreated.
    assert.deepEqual(report.totals.category, { restored: 1, skipped: 0, failed: 0 });
    assert.deepEqual(report.totals.channel, { restored: 3, skipped: 0, failed: 0 });
    assert.equal(createdChannels[0].type, ChannelType.GuildCategory);
    // Overwrites: 3 mapped, 1 skipped because its role no longer exists.
    assert.deepEqual(report.totals.overwrite, { restored: 1, skipped: 1, failed: 0 });
    // Parent mapping: general was created inside the recreated category.
    const general = createdChannels.find((channel) => channel.name === 'general');
    assert.equal(general.options.parent, createdChannels[0].id);
    // Guild settings: icon skipped (none captured), name/description/etc restored.
    assert.deepEqual(report.totals.guildSettings, { restored: 7, skipped: 1, failed: 0 });
    // Emojis: the slot limit refuses the upload, and that is reported.
    assert.deepEqual(report.totals.emoji, { restored: 0, skipped: 0, failed: 1 });
    // Bans: only the mass ban added by the attack is lifted.
    assert.deepEqual(report.totals.ban, { restored: 1, skipped: 2, failed: 0 });
    assert.deepEqual(unbanned, ['u-mass-1']);
    assert.deepEqual(rebanned, []);
    assert.deepEqual(report.protectedUsers, ['u-attacker']);
    assert.deepEqual(report.keptFromSnapshot, ['u-preexisting']);
    // Member roles: the member still present is restored, the other is skipped.
    assert.deepEqual(report.totals.memberRoles, { restored: 1, skipped: 1, failed: 0 });
    // Every skip carries a reason in Japanese staff text.
    const skips = report.entries.filter((entry: any) => entry.outcome === 'skipped');
    assert.ok(skips.every((entry: any) => Boolean(entry.reason)));
    assert.ok(report.entries.some((entry: any) => entry.name === '退出済みのため復元できません' || entry.reason === '退出済みのため復元できません'));
    assert.equal(manager.isRestoring('guild'), false);
});

test('restore: re-ban runs only when staff explicitly opts in', async () => {
    const { SnapshotManager } = await import('../src/core/anticheat/SnapshotManager.ts');
    const { readAntiNukeSettings } = await import('../src/core/anticheat/AntiNuke.ts');
    const snapshot = makeSnapshot({ guild: { ...makeSnapshot().guild, name: '破壊後のサーバー', iconUrl: null } });
    const manager = new SnapshotManager();
    manager.setClock(() => Date.parse('2026-11-27T01:00:00.000Z'));
    manager.setPaceMs(0);
    (manager as any).client = { user: { id: 'self-bot' }, isReady: () => true };
    (manager as any).getSettings = async () => readAntiNukeSettings(undefined);
    (manager as any).captureAndStore = async () => ({ ...snapshot, id: 'snap-safety' });
    (manager as any).persistJob = async () => undefined;
    (manager as any).postRestoreReport = async () => undefined;
    manager.setIncidentCloser(async () => 0);
    manager.setIncidentSource(async () => []);

    const { guild, rebanned } = fakeGuild();
    const job: any = {
        id: 'job-2', guildId: 'guild', snapshotId: snapshot.id, safetySnapshotId: null,
        status: 'running', startedAt: '2026-11-27T01:00:00.000Z', finishedAt: null,
        requestedBy: 'staff',
        options: { unbanAdded: false, rebanSnapshotBans: true, incidentIds: [] },
        phase: 'starting', progress: { done: 0, total: 0 }, report: null, error: null
    };

    await (manager as any).runRestore(guild, snapshot, job);

    // No incident window → no automatic bans lifted, and the snapshot list is re-applied
    // only because the option explicitly asked for it.
    assert.deepEqual(job.report.unbanned, []);
    assert.deepEqual(rebanned.sort(), ['u-attack-ban', 'u-banned-before'].sort());
    assert.ok(job.report.entries.some((entry: any) =>
        entry.kind === 'ban' && entry.outcome === 'skipped' && String(entry.reason).includes('BAN解除')));
});

test('preview: summary names what is recreated, what cannot return, and the unban diff', async () => {
    const { SnapshotManager } = await import('../src/core/anticheat/SnapshotManager.ts');
    const snapshot = makeSnapshot();
    const manager = new SnapshotManager();
    manager.setClock(() => Date.parse('2026-11-27T12:00:00.000Z'));
    (manager as any).client = { user: { id: 'self-bot' }, isReady: () => true };
    (manager as any).getSnapshot = async () => snapshot;
    manager.setIncidentSource(async () => ([{
        id: 'incident-1',
        rule: 'memberBan',
        actorId: 'u-attacker',
        windowStart: '2026-11-27T06:00:00.000Z',
        detectedAt: '2026-11-27T06:01:00.000Z',
        affected: { membersBanned: ['u-attacker', 'u-mass-1'] },
        status: 'open'
    }]));

    const { guild } = fakeGuild();
    const preview = await manager.previewRestore(guild, snapshot.id);

    assert.equal(preview.snapshotId, snapshot.id);
    assert.equal(preview.ageSeconds, 12 * 60 * 60);
    assert.deepEqual(preview.recreate, {
        roles: 3,
        categories: 1,
        channels: 3,
        emojis: 1,
        memberRoleHolders: 2,
        bansInSnapshot: 2
    });
    assert.equal(preview.incidentWindowStart, '2026-11-27T06:00:00.000Z');
    assert.equal(preview.incidents.length, 1);
    assert.deepEqual(preview.unban.unban, ['u-mass-1']);
    assert.deepEqual(preview.unban.protectedUsers, ['u-attacker']);
    assert.deepEqual(preview.limitations, [...RESTORE_LIMITATIONS]);
    assert.equal(preview.notes.length, 0);
    // Snapshot banned u-banned-before + u-attack-ban; neither is currently banned.
    assert.deepEqual(preview.rebanCandidates.sort(), ['u-attack-ban', 'u-banned-before'].sort());
});
