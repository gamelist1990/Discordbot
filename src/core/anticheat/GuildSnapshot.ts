import { ChannelType } from 'discord.js';

/**
 * AntiNuke server snapshots (brief AN2 §A/§B): the pure half.
 *
 * A snapshot is plain JSON so it can live in the bot's own Database and
 * survive the bot being kicked. Everything here is Discord-object free: the
 * capture, restore and scheduling live in SnapshotManager. Keeping the
 * ordering, the ID-map application, the unban diff and the skip accounting
 * pure makes them directly testable.
 */

export const SNAPSHOT_VERSION = 1;
export const DEFAULT_SNAPSHOT_KEEP = 10;
export const DEFAULT_SNAPSHOT_INTERVAL_HOURS = 6;
export const DEFAULT_SNAPSHOT_MEMBER_ROLE_CAP = 5000;
/** Discord hard limits the report has to name when a restore hits them. */
export const DISCORD_ROLE_LIMIT = 250;
export const DISCORD_CHANNEL_LIMIT = 500;

export type SnapshotTrigger = 'scheduled' | 'manual' | 'prerestore';

export interface SnapshotCounts {
    roles: number;
    categories: number;
    channels: number;
    emojis: number;
    bans: number;
    membersWithRoles: number;
}

export interface SnapshotRole {
    id: string;
    name: string;
    /** Decimal string of the permission bitfield (JSON-safe). */
    permissions: string;
    color: number;
    hoist: boolean;
    mentionable: boolean;
    position: number;
    /** @everyone is captured as the base permission set. */
    everyone: boolean;
    managed: boolean;
    unicodeEmoji: string | null;
    iconUrl: string | null;
}

export interface SnapshotOverwrite {
    targetId: string;
    type: 'role' | 'member';
    allow: string;
    deny: string;
}

export interface SnapshotChannel {
    id: string;
    name: string;
    type: number;
    topic: string | null;
    position: number;
    parentId: string | null;
    overwrites: SnapshotOverwrite[];
    nsfw: boolean;
    rateLimitPerUser: number | null;
    bitrate: number | null;
    userLimit: number | null;
    rtcRegion: string | null;
    forumTags: string[];
}

export interface SnapshotEmoji {
    id: string;
    name: string | null;
    url: string;
    animated: boolean;
}

export interface SnapshotBan {
    userId: string;
    reason: string | null;
}

export interface SnapshotMemberRoles {
    memberId: string;
    roleIds: string[];
}

export interface SnapshotGuildSettings {
    name: string;
    iconUrl: string | null;
    /** Only settable through raw REST; captured best-effort for COMMUNITY guilds. */
    description: string | null;
    verificationLevel: number;
    defaultMessageNotifications: number;
    explicitContentFilter: number;
    afkChannelId: string | null;
    afkTimeout: number;
    systemChannelId: string | null;
    systemChannelFlags: number;
    preferredLocale: string | null;
}

export interface SnapshotLimits {
    memberRoleCap: number;
    /** Members scanned before the cap stopped the capture. */
    membersScanned: number;
    memberCount: number;
    memberRolesTruncated: boolean;
    banCap: number;
    bansTruncated: boolean;
}

export interface GuildSnapshot {
    version: number;
    id: string;
    guildId: string;
    guildName: string;
    createdAt: string;
    trigger: SnapshotTrigger;
    requestedBy: string | null;
    counts: SnapshotCounts;
    limits: SnapshotLimits;
    guild: SnapshotGuildSettings;
    roles: SnapshotRole[];
    channels: SnapshotChannel[];
    emojis: SnapshotEmoji[];
    bans: SnapshotBan[];
    memberRoles: SnapshotMemberRoles[];
    /** Honest notes recorded at capture time (missing permissions, caps). */
    warnings: string[];
}

export interface SnapshotMeta {
    id: string;
    createdAt: string;
    trigger: SnapshotTrigger;
    requestedBy: string | null;
    counts: SnapshotCounts;
    bytes: number;
}

export interface SnapshotIndex {
    latestSnapshotId: string | null;
    /** Newest first. */
    snapshots: SnapshotMeta[];
}

/** Threads are not recreated by a restore (their history is gone anyway). */
export const THREAD_CHANNEL_TYPES: readonly number[] = [
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread
];

export const emptySnapshotCounts = (): SnapshotCounts => ({
    roles: 0,
    categories: 0,
    channels: 0,
    emojis: 0,
    bans: 0,
    membersWithRoles: 0
});

export const emptySnapshotIndex = (): SnapshotIndex => ({
    latestSnapshotId: null,
    snapshots: []
});

export function countSnapshot(snapshot: Pick<GuildSnapshot, 'roles' | 'channels' | 'emojis' | 'bans' | 'memberRoles'>): SnapshotCounts {
    const counts = emptySnapshotCounts();
    for (const role of snapshot.roles) {
        if (!role.everyone) counts.roles += 1;
    }
    for (const channel of snapshot.channels) {
        if (channel.type === ChannelType.GuildCategory) counts.categories += 1;
        else if (!THREAD_CHANNEL_TYPES.includes(channel.type)) counts.channels += 1;
    }
    counts.emojis = snapshot.emojis.length;
    counts.bans = snapshot.bans.length;
    counts.membersWithRoles = snapshot.memberRoles.filter((entry) => entry.roleIds.length > 0).length;
    return counts;
}

const asString = (value: unknown, fallback = ''): string =>
    typeof value === 'string' ? value : fallback;

const asNullableString = (value: unknown): string | null =>
    typeof value === 'string' ? value : null;

const asNumber = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asNullableNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

const asBoolean = (value: unknown, fallback = false): boolean =>
    typeof value === 'boolean' ? value : fallback;

const asTrigger = (value: unknown): SnapshotTrigger =>
    value === 'manual' || value === 'prerestore' ? value : 'scheduled';

/**
 * Validate and normalise a stored snapshot. A snapshot that cannot be trusted
 * (wrong version, missing guild, wrong container types) is rejected as a whole
 * instead of being half-restored.
 */
export function normalizeSnapshot(input: unknown): GuildSnapshot | null {
    if (!input || typeof input !== 'object') return null;
    const raw = input as Partial<GuildSnapshot>;
    if (raw.version !== SNAPSHOT_VERSION) return null;
    if (!raw.guildId || !raw.id) return null;
    if (!Array.isArray(raw.roles) || !Array.isArray(raw.channels)) return null;

    const guild: SnapshotGuildSettings = {
        name: asString(raw.guild?.name),
        iconUrl: asNullableString(raw.guild?.iconUrl),
        description: asNullableString(raw.guild?.description),
        verificationLevel: asNumber(raw.guild?.verificationLevel, 0),
        defaultMessageNotifications: asNumber(raw.guild?.defaultMessageNotifications, 0),
        explicitContentFilter: asNumber(raw.guild?.explicitContentFilter, 0),
        afkChannelId: asNullableString(raw.guild?.afkChannelId),
        afkTimeout: asNumber(raw.guild?.afkTimeout, 300),
        systemChannelId: asNullableString(raw.guild?.systemChannelId),
        systemChannelFlags: asNumber(raw.guild?.systemChannelFlags, 0),
        preferredLocale: asNullableString(raw.guild?.preferredLocale)
    };

    const roles: SnapshotRole[] = [];
    for (const role of raw.roles as SnapshotRole[]) {
        if (!role || typeof role.id !== 'string') return null;
        roles.push({
            id: role.id,
            name: asString(role.name, `role-${role.id}`),
            permissions: typeof role.permissions === 'string' ? role.permissions : '0',
            color: asNumber(role.color, 0),
            hoist: asBoolean(role.hoist),
            mentionable: asBoolean(role.mentionable),
            position: asNumber(role.position, 0),
            everyone: asBoolean(role.everyone, role.id === raw.guildId),
            managed: asBoolean(role.managed),
            unicodeEmoji: asNullableString(role.unicodeEmoji),
            iconUrl: asNullableString(role.iconUrl)
        });
    }

    const channels: SnapshotChannel[] = [];
    for (const channel of raw.channels as SnapshotChannel[]) {
        if (!channel || typeof channel.id !== 'string') return null;
        const overwrites: SnapshotOverwrite[] = [];
        for (const overwrite of Array.isArray(channel.overwrites) ? channel.overwrites : []) {
            if (!overwrite || typeof overwrite.targetId !== 'string') continue;
            if (overwrite.type !== 'role' && overwrite.type !== 'member') continue;
            overwrites.push({
                targetId: overwrite.targetId,
                type: overwrite.type,
                allow: typeof overwrite.allow === 'string' ? overwrite.allow : '0',
                deny: typeof overwrite.deny === 'string' ? overwrite.deny : '0'
            });
        }
        channels.push({
            id: channel.id,
            name: asString(channel.name, `channel-${channel.id}`),
            type: asNumber(channel.type, ChannelType.GuildText),
            topic: asNullableString(channel.topic),
            position: asNumber(channel.position, 0),
            parentId: asNullableString(channel.parentId),
            overwrites,
            nsfw: asBoolean(channel.nsfw),
            rateLimitPerUser: asNullableNumber(channel.rateLimitPerUser),
            bitrate: asNullableNumber(channel.bitrate),
            userLimit: asNullableNumber(channel.userLimit),
            rtcRegion: asNullableString(channel.rtcRegion),
            forumTags: Array.isArray(channel.forumTags)
                ? channel.forumTags.filter((tag): tag is string => typeof tag === 'string')
                : []
        });
    }

    const memberRoles: SnapshotMemberRoles[] = [];
    for (const entry of Array.isArray(raw.memberRoles) ? raw.memberRoles : []) {
        if (!entry || typeof entry.memberId !== 'string') continue;
        memberRoles.push({
            memberId: entry.memberId,
            roleIds: Array.isArray(entry.roleIds)
                ? entry.roleIds.filter((id): id is string => typeof id === 'string')
                : []
        });
    }

    const snapshot: GuildSnapshot = {
        version: SNAPSHOT_VERSION,
        id: raw.id,
        guildId: raw.guildId,
        guildName: asString(raw.guildName),
        createdAt: asString(raw.createdAt, new Date(0).toISOString()),
        trigger: asTrigger(raw.trigger),
        requestedBy: asNullableString(raw.requestedBy),
        counts: emptySnapshotCounts(),
        limits: {
            memberRoleCap: asNumber(raw.limits?.memberRoleCap, DEFAULT_SNAPSHOT_MEMBER_ROLE_CAP),
            membersScanned: asNumber(raw.limits?.membersScanned, 0),
            memberCount: asNumber(raw.limits?.memberCount, 0),
            memberRolesTruncated: asBoolean(raw.limits?.memberRolesTruncated),
            banCap: asNumber(raw.limits?.banCap, 0),
            bansTruncated: asBoolean(raw.limits?.bansTruncated)
        },
        guild,
        roles,
        channels,
        emojis: (Array.isArray(raw.emojis) ? raw.emojis : [])
            .filter((emoji): emoji is SnapshotEmoji => Boolean(emoji) && typeof emoji.id === 'string')
            .map((emoji) => ({
                id: emoji.id,
                name: asNullableString(emoji.name),
                url: asString(emoji.url),
                animated: asBoolean(emoji.animated)
            })),
        bans: (Array.isArray(raw.bans) ? raw.bans : [])
            .filter((ban): ban is SnapshotBan => Boolean(ban) && typeof ban.userId === 'string')
            .map((ban) => ({ userId: ban.userId, reason: asNullableString(ban.reason) })),
        memberRoles,
        warnings: Array.isArray(raw.warnings)
            ? raw.warnings.filter((warning): warning is string => typeof warning === 'string')
            : []
    };
    snapshot.counts = countSnapshot(snapshot);
    return snapshot;
}

export function snapshotToJson(snapshot: GuildSnapshot): string {
    return JSON.stringify(snapshot);
}

export function snapshotFromJson(text: string): GuildSnapshot | null {
    try {
        return normalizeSnapshot(JSON.parse(text));
    } catch {
        return null;
    }
}

/** UTF-8 byte size, i.e. what the Database file actually costs. */
export function snapshotSizeBytes(snapshot: GuildSnapshot): number {
    return Buffer.byteLength(snapshotToJson(snapshot), 'utf8');
}

export function snapshotMeta(snapshot: GuildSnapshot): SnapshotMeta {
    return {
        id: snapshot.id,
        createdAt: snapshot.createdAt,
        trigger: snapshot.trigger,
        requestedBy: snapshot.requestedBy,
        counts: snapshot.counts,
        bytes: snapshotSizeBytes(snapshot)
    };
}

export function readSnapshotIndex(value: unknown): SnapshotIndex {
    if (!value || typeof value !== 'object') return emptySnapshotIndex();
    // AN1 also tolerated a bare `[id]` / `[{ id }]` array; keep reading it.
    const container: Partial<SnapshotIndex> = Array.isArray(value)
        ? { snapshots: value as SnapshotMeta[] }
        : value as Partial<SnapshotIndex>;
    const list = Array.isArray(container.snapshots) ? container.snapshots : [];
    const snapshots: SnapshotMeta[] = [];
    for (const entry of list) {
        if (!entry || typeof entry.id !== 'string') continue;
        snapshots.push({
            id: entry.id,
            createdAt: asString(entry.createdAt, new Date(0).toISOString()),
            trigger: asTrigger(entry.trigger),
            requestedBy: asNullableString(entry.requestedBy),
            counts: { ...emptySnapshotCounts(), ...(entry.counts || {}) },
            bytes: asNumber(entry.bytes, 0)
        });
    }
    // AN1 may also leave a bare id or `{ latest: { id } }` behind.
    const latest = typeof container.latestSnapshotId === 'string'
        ? container.latestSnapshotId
        : snapshots[0]?.id ?? null;
    return { latestSnapshotId: latest, snapshots };
}

/**
 * Insert the newest snapshot and prune the oldest beyond `keep`.
 * Returns the pruned ids so the caller can delete their documents.
 */
export function addSnapshotToIndex(
    index: SnapshotIndex,
    meta: SnapshotMeta,
    keep = DEFAULT_SNAPSHOT_KEEP
): { index: SnapshotIndex; pruned: string[] } {
    const limit = Math.max(1, Math.floor(keep));
    const merged = [meta, ...index.snapshots.filter((entry) => entry.id !== meta.id)]
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    const kept = merged.slice(0, limit);
    const pruned = merged.slice(limit).map((entry) => entry.id);
    return {
        index: {
            latestSnapshotId: kept[0]?.id ?? null,
            snapshots: kept
        },
        pruned
    };
}

// ---------------------------------------------------------------------------
// Restore planning
// ---------------------------------------------------------------------------

export interface RestoreOrder {
    everyone: SnapshotRole | null;
    /** Bottom-up (ascending position). */
    roles: SnapshotRole[];
    categories: SnapshotChannel[];
    channels: SnapshotChannel[];
}

/**
 * Roles are recreated bottom-up so hierarchy is respected; categories before
 * channels so a channel can be created with its parent in place.
 */
export function planRestoreOrder(snapshot: GuildSnapshot): RestoreOrder {
    const byPosition = (left: { position: number }, right: { position: number }) =>
        left.position - right.position;
    return {
        everyone: snapshot.roles.find((role) => role.everyone) || null,
        roles: snapshot.roles.filter((role) => !role.everyone).sort(byPosition),
        categories: snapshot.channels
            .filter((channel) => channel.type === ChannelType.GuildCategory)
            .sort(byPosition),
        channels: snapshot.channels
            .filter((channel) => channel.type !== ChannelType.GuildCategory
                && !THREAD_CHANNEL_TYPES.includes(channel.type))
            .sort(byPosition)
    };
}

export type RoleIdMap = Record<string, string>;
export type OverwriteSkipReason = 'role-not-restored' | 'member-not-in-guild' | 'unknown-target';

export interface MappedOverwrite {
    targetId: string;
    type: 'role' | 'member';
    allow: string;
    deny: string;
}

export interface SkippedOverwrite {
    targetId: string;
    type: 'role' | 'member';
    reason: OverwriteSkipReason;
}

/**
 * Translate a snapshot's overwrites onto live ids. Role targets go through the
 * old→new map; member targets survive as-is only while the member is present.
 * Anything else is skipped and reported (never silently dropped).
 */
export function applyIdMap(
    overwrites: readonly SnapshotOverwrite[],
    idMap: RoleIdMap,
    memberExists: (memberId: string) => boolean
): { applied: MappedOverwrite[]; skipped: SkippedOverwrite[] } {
    const applied: MappedOverwrite[] = [];
    const skipped: SkippedOverwrite[] = [];
    const seen = new Set<string>();
    for (const overwrite of overwrites) {
        if (overwrite.type === 'role') {
            const mapped = idMap[overwrite.targetId];
            if (!mapped) {
                skipped.push({ targetId: overwrite.targetId, type: 'role', reason: 'role-not-restored' });
                continue;
            }
            const key = `role:${mapped}`;
            if (seen.has(key)) continue;
            seen.add(key);
            applied.push({ targetId: mapped, type: 'role', allow: overwrite.allow, deny: overwrite.deny });
            continue;
        }
        if (!memberExists(overwrite.targetId)) {
            skipped.push({ targetId: overwrite.targetId, type: 'member', reason: 'member-not-in-guild' });
            continue;
        }
        const key = `member:${overwrite.targetId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        applied.push({ targetId: overwrite.targetId, type: 'member', allow: overwrite.allow, deny: overwrite.deny });
    }
    return { applied, skipped };
}

export interface UnbanSelection {
    /** Currently banned, banned inside the incident window, not in the snapshot list. */
    unban: string[];
    /** Banned in the window but already unbanned manually — nothing to do. */
    alreadyLifted: string[];
    /** In both lists: an intentional ban that predates the attack. Kept. */
    keptFromSnapshot: string[];
    /** AntiNuke's own bans (the actor, the bot, the owner) are never lifted. */
    protectedUsers: string[];
}

/**
 * Mass-ban undo. Default restore only lifts bans that the attack added; it
 * never invents bans. A user the snapshot already recorded as banned stays
 * banned because staff chose that before the incident, and the attacker that
 * AntiNuke banned is protected rather than un-banned.
 */
export function selectUnbanTargets(input: {
    incidentBannedIds: readonly string[];
    snapshotBannedIds: readonly string[];
    currentBannedIds: readonly string[];
    /** Never lifted (incident actor, this bot, guild owner). */
    protectIds?: readonly string[];
}): UnbanSelection {
    const incident = new Set(input.incidentBannedIds);
    const snapshot = new Set(input.snapshotBannedIds);
    const current = new Set(input.currentBannedIds);
    const protect = new Set(input.protectIds ?? []);
    const selection: UnbanSelection = {
        unban: [],
        alreadyLifted: [],
        keptFromSnapshot: [],
        protectedUsers: []
    };
    for (const userId of incident) {
        if (protect.has(userId)) {
            selection.protectedUsers.push(userId);
            continue;
        }
        if (snapshot.has(userId)) {
            selection.keptFromSnapshot.push(userId);
            continue;
        }
        if (current.has(userId)) selection.unban.push(userId);
        else selection.alreadyLifted.push(userId);
    }
    return selection;
}

/**
 * Opt-in only (staff has to ask for it): re-ban users the snapshot listed but
 * the guild no longer has banned. Never applied by default.
 */
export function selectRebanTargets(input: {
    snapshotBannedIds: readonly string[];
    currentBannedIds: readonly string[];
}): string[] {
    const current = new Set(input.currentBannedIds);
    return input.snapshotBannedIds.filter((userId) => !current.has(userId));
}

// ---------------------------------------------------------------------------
// Restore accounting
// ---------------------------------------------------------------------------

export type RestoreKind =
    | 'role'
    | 'category'
    | 'channel'
    | 'overwrite'
    | 'guildSettings'
    | 'emoji'
    | 'memberRoles'
    | 'ban';

export type RestoreOutcome = 'restored' | 'skipped' | 'failed';

export interface RestoreLogEntry {
    kind: RestoreKind;
    name: string;
    sourceId: string | null;
    targetId: string | null;
    outcome: RestoreOutcome;
    reason?: string;
}

export interface RestoreTotals {
    restored: number;
    skipped: number;
    failed: number;
}

export const RESTORE_KINDS: readonly RestoreKind[] = [
    'role',
    'category',
    'channel',
    'overwrite',
    'guildSettings',
    'emoji',
    'memberRoles',
    'ban'
];

export const RESTORE_KIND_LABELS: Record<RestoreKind, string> = {
    role: 'ロール',
    category: 'カテゴリ',
    channel: 'チャンネル',
    overwrite: '権限上書き',
    guildSettings: 'サーバー設定',
    emoji: '絵文字',
    memberRoles: 'メンバーのロール',
    ban: 'BAN解除'
};

export const emptyRestoreTotals = (): RestoreTotals => ({ restored: 0, skipped: 0, failed: 0 });

export function emptyRestoreTotalsByKind(): Record<RestoreKind, RestoreTotals> {
    return RESTORE_KINDS.reduce((totals, kind) => {
        totals[kind] = emptyRestoreTotals();
        return totals;
    }, {} as Record<RestoreKind, RestoreTotals>);
}

export interface RestoreReport {
    safetySnapshotId: string | null;
    /** Window used for the unban diff (incident window or snapshot age). */
    incidentWindowStart: string | null;
    startedAt: string;
    finishedAt: string | null;
    entries: RestoreLogEntry[];
    totals: Record<RestoreKind, RestoreTotals>;
    roleIdMap: Array<{ oldId: string; newId: string; mode: 'reused' | 'recreated' }>;
    unbanned: string[];
    alreadyLifted: string[];
    keptFromSnapshot: string[];
    protectedUsers: string[];
    rebanned: string[];
    errors: string[];
}

export function emptyRestoreReport(safetySnapshotId: string | null, startedAt = new Date().toISOString()): RestoreReport {
    return {
        safetySnapshotId,
        incidentWindowStart: null,
        startedAt,
        finishedAt: null,
        entries: [],
        totals: emptyRestoreTotalsByKind(),
        roleIdMap: [],
        unbanned: [],
        alreadyLifted: [],
        keptFromSnapshot: [],
        protectedUsers: [],
        rebanned: [],
        errors: []
    };
}

export function recordRestore(report: RestoreReport, entry: RestoreLogEntry): RestoreLogEntry {
    report.entries.push(entry);
    const totals = report.totals[entry.kind] || (report.totals[entry.kind] = emptyRestoreTotals());
    totals[entry.outcome] += 1;
    return entry;
}

export function finalizeRestoreReport(report: RestoreReport, finishedAt = new Date().toISOString()): RestoreReport {
    report.finishedAt = finishedAt;
    return report;
}

export function formatRestoreTotals(totals: Record<RestoreKind, RestoreTotals>): string[] {
    return RESTORE_KINDS.map((kind) => {
        const value = totals[kind];
        const parts = [`復元 ${value.restored}`];
        if (value.skipped) parts.push(`スキップ ${value.skipped}`);
        if (value.failed) parts.push(`失敗 ${value.failed}`);
        return `${RESTORE_KIND_LABELS[kind]}: ${parts.join(' / ')}`;
    });
}

/** What a restore can never bring back. Stated in preview, embed and API. */
export const RESTORE_LIMITATIONS: readonly string[] = [
    'メッセージ履歴（削除された投稿・添付・ピン留めは復元できません）',
    'スナップショット後に退出したメンバー（本人の再参加が必要です）',
    'WebhookのURL（再作成はできますが、元のURL・トークンは戻りません）',
    '元のID（ロール・チャンネルは新しいIDで作成されます）',
    'スレッドとその内容（親チャンネルごと作り直すため復元対象外です）',
    '招待リンク・監査ログ・進行中のタイムアウト・Botの参加状態',
    'サーバー説明（APIから取得できない場合は復元しません）'
];

/** Channels cannot exceed 500; roles 250. Used by preview + report notes. */
export function capacityNotes(totalChannels: number, totalRoles: number): string[] {
    const notes: string[] = [];
    if (totalChannels > DISCORD_CHANNEL_LIMIT) {
        notes.push(`チャンネルはDiscordの上限${DISCORD_CHANNEL_LIMIT}件を超えるため、超過分は作成できません`);
    }
    if (totalRoles > DISCORD_ROLE_LIMIT - 1) {
        notes.push(`ロールはDiscordの上限${DISCORD_ROLE_LIMIT}件（@everyone含む）を超えるため、超過分は作成できません`);
    }
    return notes;
}
