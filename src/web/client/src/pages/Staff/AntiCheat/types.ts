export interface WordFilterRule {
    id: string;
    label: string;
    pattern: string;
    mode: 'contains' | 'exact' | 'regex';
    score: number;
    deleteMessage?: boolean;
    enabled: boolean;
}

export interface AntiCheatSettings {
    enabled: boolean;
    detectors: Record<string, DetectorConfig>;
    punishments: PunishmentThreshold[];
    excludedRoles: string[];
    excludedChannels: string[];
    channelDetectorExclusions: Record<string, string[]>;
    logChannelId: string | null;
    avatarLogChannelId: string | null;
    chatLogChannelId: string | null;
    aiLogChannelId: string | null;
    autoTimeout: {
        enabled: boolean;
        durationSeconds: number;
    };
    autoDelete: {
        enabled: boolean;
        windowSeconds: number;
    };
    raidMode: RaidModeState;
    watch: WatchSettings;
    antiNuke: AntiNukeSettings;
}

export interface AntiNukeVelocityRule {
    enabled: boolean;
    threshold: number;
    windowSeconds: number;
}

export interface AntiNukeSettings {
    enabled: boolean;
    whitelistUsers: string[];
    whitelistRoles: string[];
    whitelistBots: string[];
    rules: Record<string, AntiNukeVelocityRule>;
    instant: {
        adminRoleGrant: boolean;
        adminBotInvite: boolean;
        vanityNameChange: boolean;
    };
    selfDefense: {
        enabled: boolean;
        positionAudit: boolean;
        ownerDm: boolean;
    };
    snapshots: AntiNukeSnapshotSettings;
}

export interface WatchSettings {
    enabled: boolean;
    notifyOnFlag: boolean;
    newAccountDays: number;
    kickThresholdPoints: number;
    autoKickOnDanger: boolean;
    purgeWindowHours: number;
}

/** 警戒ユーザー entry as returned by GET /anticheat/:guildId/watch-users. */
export interface WatchUserEntryView {
    userId: string;
    reason: string;
    signals: string[];
    since: string;
    source: 'join' | 'member-update' | 'message' | 'webauth-match' | 'graph';
    nameSnapshot: string;
    accountCreatedAt?: string | null;
    dangerPoints24h: number;
    username: string;
    displayName: string;
    avatar: string | null;
}

/** Web認証 record as returned by GET /anticheat/:guildId/webauth. */
export interface WebAuthRecordView {
    id: string;
    userId: string;
    createdAt: string;
    source: 'web' | 'staff';
    verified: boolean;
    browser: {
        name: 'chrome' | 'edge' | 'safari' | null;
        reason: string;
    };
    intel: {
        verdict: 'clean' | 'blocked' | 'unavailable' | 'staff';
        flags: string[];
        source: string;
    };
    /** Automation/headless summary (brief 9); null on old/staff records. */
    automation: {
        webdriver: boolean;
        pluginCount: number;
        outerWidth: number;
        outerHeight: number;
        notificationPermission: string;
        notificationApiState: string;
        notificationMismatch: boolean;
    } | null;
    /** Software rasterizer (SwiftShader/llvmpipe/…) detected. */
    softwareRenderer: boolean;
    /** ISO 3166-1 alpha-2 country from ip-api. */
    countryCode: string | null;
    /** IP country vs browser timezone/language consistency. */
    geoMismatch: 'none' | 'tz' | 'lang' | 'both';
    presetId: string | null;
    note: string | null;
    roleGranted: boolean;
    matchCount: number;
    matchedUserIds: string[];
    username: string;
    displayName: string;
    avatar: string | null;
}

export interface DetectorConfig {
    enabled: boolean;
    score: number;
    deleteMessage?: boolean;
    notifyChannel?: boolean;
    config?: Record<string, any>;
}

export interface RaidModeState {
    active: boolean;
    activatedAt: string | null;
    reason: string | null;
    recentJoinCount: number;
    lastJoinAt: string | null;
}

export interface PunishmentThreshold {
    threshold: number;
    actions: PunishmentAction[];
}

export interface PunishmentAction {
    type: 'timeout' | 'kick' | 'ban';
    durationSeconds?: number;
    reasonTemplate?: string;
    notify?: boolean;
}

export interface UserTrustData {
    score: number;
    lastUpdated: string;
    history: TrustHistoryEntry[];
}

export interface UserTrustDataWithUser extends UserTrustData {
    username: string;
    displayName: string;
    avatar: string | null;
}

export interface TrustHistoryEntry {
    delta: number;
    reason: string;
    timestamp: string;
    detector?: string;
}

export interface DetectionLog {
    userId: string;
    messageId: string;
    detector: string;
    scoreDelta: number;
    reason: string;
    timestamp: string;
    status?: 'active' | 'revoked';
    metadata?: Record<string, any>;
}

export interface ActiveTimeoutEntry {
    userId: string;
    username: string;
    displayName: string;
    avatar: string | null;
    timeoutUntil: string | null;
    remainingMs: number;
    trustScore: number;
    lastUpdated: string | null;
    sourceMessageId: string | null;
    sourceDetector: string | null;
    sourceReason: string | null;
}

export interface AntiCheatApiResponse {
    settings: AntiCheatSettings;
    userTrustCount: number;
}

export interface AntiNukeSnapshotSettings {
    enabled: boolean;
    intervalHours: number;
    keep: number;
    includeBans: boolean;
    includeEmojis: boolean;
    includeMemberRoles: boolean;
    memberRoleCap: number;
}

export interface SnapshotCounts {
    roles: number;
    categories: number;
    channels: number;
    emojis: number;
    bans: number;
    membersWithRoles: number;
}

export interface SnapshotMetaView {
    id: string;
    createdAt: string;
    trigger: 'scheduled' | 'manual' | 'prerestore';
    requestedBy: string | null;
    counts: SnapshotCounts;
    bytes: number;
}

export interface RestoreUnbanSelectionView {
    unban: string[];
    alreadyLifted: string[];
    keptFromSnapshot: string[];
    protectedUsers: string[];
}

export interface RestorePreviewView {
    snapshotId: string;
    guildName: string;
    createdAt: string;
    ageSeconds: number;
    counts: SnapshotCounts;
    recreate: {
        roles: number;
        categories: number;
        channels: number;
        emojis: number;
        memberRoleHolders: number;
        bansInSnapshot: number;
    };
    limitations: string[];
    notes: string[];
    unban: RestoreUnbanSelectionView;
    rebanCandidates: string[];
    incidentWindowStart: string;
    incidents: Array<{ id: string; rule: string; detectedAt: string; windowStart: string }>;
}

export interface RestoreTotalsView {
    restored: number;
    skipped: number;
    failed: number;
}

export interface RestoreReportView {
    safetySnapshotId: string | null;
    incidentWindowStart: string | null;
    startedAt: string;
    finishedAt: string | null;
    totals: Record<string, RestoreTotalsView>;
    entries: Array<{
        kind: string;
        name: string;
        sourceId: string | null;
        targetId: string | null;
        outcome: 'restored' | 'skipped' | 'failed';
        reason?: string;
    }>;
    unbanned: string[];
    alreadyLifted: string[];
    protectedUsers: string[];
    rebanned: string[];
    errors: string[];
}

export interface RestoreJobView {
    id: string;
    guildId: string;
    snapshotId: string;
    safetySnapshotId: string | null;
    status: 'running' | 'done' | 'failed';
    startedAt: string;
    finishedAt: string | null;
    requestedBy: string | null;
    options: { unbanAdded: boolean; rebanSnapshotBans: boolean; incidentIds: string[] };
    phase: string;
    progress: { done: number; total: number };
    report: RestoreReportView | null;
    error: string | null;
}
