import { Message } from 'discord.js';

export interface DetectionContext {
    guildId: string;
    userId: string;
    channelId: string;
    recentMessages?: Message[];
    userTrustScore?: number;
    settings: GuildAntiCheatSettings;
    isMessageDeleted?: () => boolean;
    receivedAt?: number;
}

export interface DetectionNoticeField {
    name: string;
    value: string;
    inline?: boolean;
}

export interface DetectionNotice {
    title: string;
    description: string;
    level?: 'info' | 'warning' | 'danger';
    fields?: DetectionNoticeField[];
    footer?: string;
}

export interface DetectionResult {
    aiExplanation?: string;
    contentDeletion?: { content: string; editedTimestamp: number | null; attachmentIds: string };
    spoilerRepost?: {
        files: Array<{ data: Buffer; name: string; sourceUrl?: string }>;
        categories: string[];
        aiExplanation?: string;
        expected?: { content: string; editedTimestamp: number | null; attachmentIds: string };
    };
    scoreDelta: number;
    reasons: string[];
    metadata?: Record<string, any>;
    deleteMessage?: boolean;
    publicNotice?: DetectionNotice | null;
}

export interface Detector {
    name: string;
    detect(message: Message, context: DetectionContext): Promise<DetectionResult>;
}

export interface PunishmentAction {
    type: 'timeout' | 'kick' | 'ban';
    durationSeconds?: number;
    reasonTemplate?: string;
    notify?: boolean;
}

export interface PunishmentThreshold {
    threshold: number;
    actions: PunishmentAction[];
}

export interface WordFilterRule {
    id: string;
    label: string;
    pattern: string;
    mode: 'contains' | 'exact' | 'regex';
    score: number;
    deleteMessage?: boolean;
    enabled: boolean;
}

export interface DetectorConfig {
    enabled: boolean;
    score: number;
    deleteMessage?: boolean;
    notifyChannel?: boolean;
    config?: Record<string, any>;
}

export interface UserTrustData {
    score: number;
    lastUpdated: string;
    history: TrustHistoryEntry[];
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

export interface RaidModeState {
    active: boolean;
    activatedAt: string | null;
    reason: string | null;
    recentJoinCount: number;
    lastJoinAt: string | null;
}

export interface RaidDetectionConfig {
    /** Joins within one hour that activate raid mode. */
    joinsPerHour: number;
    /** Joins within burstWindowSeconds that activate raid mode. */
    burstCount: number;
    burstWindowSeconds: number;
    /** Inactivity after which raid mode deactivates itself. */
    cooldownMinutes: number;
    /** When false, raid mode only activates and logs (legacy behavior). */
    autoKick: boolean;
    /** On activation, kick members who joined within this many seconds. */
    kickWindowSeconds: number;
    /** Join-interval entropy (regular cadence) activation condition. */
    automation: RaidJoinEntropyConfig;
}

/** Parameters of the pure join-interval entropy check (see JoinEntropy.ts). */
export interface RaidJoinEntropyConfig {
    /** Minimum joins in the window before the metric is considered. */
    minJoins: number;
    /** Mechanical cadence: mean inter-arrival gap must be below this. */
    meanGapSeconds: number;
    /** Coefficient of variation (std/mean) must be below this. */
    cvThreshold: number;
}

/** Defaults from brief 4A: 8 joins, 60 s mean gap, CV < 0.35. */
export const DEFAULT_RAID_JOIN_ENTROPY: RaidJoinEntropyConfig = {
    minJoins: 8,
    meanGapSeconds: 60,
    cvThreshold: 0.35
};

// ---------------------------------------------------------------------------
// AntiNuke (brief AN1)
// ---------------------------------------------------------------------------

export type NukeAction =
    | 'channelDelete'
    | 'roleDelete'
    | 'memberBan'
    | 'memberKick'
    | 'channelCreate'
    | 'roleCreate'
    | 'webhookCreate'
    | 'emojiDelete';

export interface NukeVelocityRule {
    enabled: boolean;
    /** Events by the same actor inside windowSeconds that trigger a response. */
    threshold: number;
    windowSeconds: number;
}

export interface AntiNukeInstantRules {
    /** A bot grants or creates a role with Administrator, or this bot receives Administrator. */
    adminRoleGrant: boolean;
    /** A bot is added to the guild with Administrator by a non-owner, non-whitelisted actor. */
    adminBotInvite: boolean;
    /** Guild vanity URL or name changed by a bot account. */
    vanityNameChange: boolean;
}

export interface AntiNukeSelfDefense {
    /** Pre-empt tampering with this bot's roles / permissions. */
    enabled: boolean;
    /** Report actors positioned above this bot that hold dangerous permissions. */
    positionAudit: boolean;
    /** DM the guild owner on incidents (falls back to the log channel only). */
    ownerDm: boolean;
}

/** Snapshot / restore knobs (brief AN2 §A). */
export interface AntiNukeSnapshotSettings {
    /** Scheduled capture. Manual capture and the pre-restore snapshot always work. */
    enabled: boolean;
    /** Hours between scheduled snapshots. */
    intervalHours: number;
    /** Newest snapshots kept per guild; older documents are deleted. */
    keep: number;
    includeBans: boolean;
    includeEmojis: boolean;
    includeMemberRoles: boolean;
    /** Upper bound on members scanned for role assignments per snapshot. */
    memberRoleCap: number;
}

/**
 * Automatic recovery after an AntiNuke trigger (brief AN3).
 * - off: staff-only restore, exactly as before AN3.
 * - cleanup: delete what the attacker created and unban who they banned.
 * - full: cleanup, then the AN2 snapshot restore from the newest snapshot
 *   taken *before* the incident started.
 */
export type AntiNukeAutoRestoreMode = 'off' | 'cleanup' | 'full';

export const ANTINUKE_AUTO_RESTORE_MODES: readonly AntiNukeAutoRestoreMode[] = ['off', 'cleanup', 'full'];

export interface AntiNukeSettings {
    enabled: boolean;
    whitelistUsers: string[];
    whitelistRoles: string[];
    whitelistBots: string[];
    rules: Record<NukeAction, NukeVelocityRule>;
    instant: AntiNukeInstantRules;
    selfDefense: AntiNukeSelfDefense;
    snapshots: AntiNukeSnapshotSettings;
    /** Automatic recovery after a trigger; default 'full' (brief AN3). */
    autoRestore: AntiNukeAutoRestoreMode;
}

/** Defaults from brief AN1 (thresholds from shipping anti-nuke products). */
export const DEFAULT_ANTINUKE_SETTINGS: AntiNukeSettings = {
    enabled: true,
    whitelistUsers: [],
    whitelistRoles: [],
    whitelistBots: [],
    rules: {
        channelDelete: { enabled: true, threshold: 3, windowSeconds: 60 },
        roleDelete: { enabled: true, threshold: 3, windowSeconds: 60 },
        memberBan: { enabled: true, threshold: 4, windowSeconds: 60 },
        memberKick: { enabled: true, threshold: 5, windowSeconds: 60 },
        channelCreate: { enabled: true, threshold: 8, windowSeconds: 60 },
        roleCreate: { enabled: true, threshold: 8, windowSeconds: 60 },
        webhookCreate: { enabled: true, threshold: 3, windowSeconds: 60 },
        emojiDelete: { enabled: true, threshold: 3, windowSeconds: 60 }
    },
    instant: {
        adminRoleGrant: true,
        adminBotInvite: true,
        vanityNameChange: true
    },
    selfDefense: {
        enabled: true,
        positionAudit: true,
        ownerDm: true
    },
    snapshots: {
        enabled: true,
        intervalHours: 6,
        keep: 10,
        includeBans: true,
        includeEmojis: true,
        includeMemberRoles: true,
        memberRoleCap: 5000
    },
    autoRestore: 'full'
};

/** Signals used to auto-classify a member as a 警戒 (watch) user. */
export type WatchSignal =
    | 'name-match'
    | 'id-like-name'
    | 'new-account'
    | 'batch-creation'
    | 'shared-avatar'
    | 'similar-name'
    | 'webauth-match'
    | 'graph';

/** Where the classification was triggered from. */
export type WatchSource = 'join' | 'member-update' | 'message' | 'webauth-match' | 'graph';

/** One applied detection-point event inside the rolling watch window. */
export interface WatchDangerPoint {
    ts: number;
    points: number;
    detector?: string;
    reason?: string;
}

export interface WatchUserEntry {
    /** Human readable flag reason (joined signal labels). */
    reason: string;
    /** Machine readable signals that matched at flag time. */
    signals: string[];
    since: string;
    source: WatchSource;
    /** Display name at flag time; staff dismissal compares against it. */
    nameSnapshot: string;
    accountCreatedAt?: string | null;
    avatarHash?: string | null;
    normalizedName?: string;
    /** Name snapshot the staff dismissed. Same name is never re-flagged. */
    dismissed?: string | null;
    /** Rolling 24 h applied-point events. Pruned on read/write. */
    dangerPoints?: WatchDangerPoint[];
    lastDangerAt?: string | null;
}

export interface WatchSettings {
    enabled: boolean;
    notifyOnFlag: boolean;
    newAccountDays: number;
    kickThresholdPoints: number;
    autoKickOnDanger: boolean;
    purgeWindowHours: number;
}

/** Edge weights of the alt-account graph (brief 4A §4). */
export interface AltGraphWeights {
    ipHash: number;
    fpHash: number;
    fuzzyFingerprint: number;
    subnetAsn: number;
    avatarHash: number;
    creationCluster: number;
    similarName: number;
}

export interface AltGraphSettings {
    enabled: boolean;
    /** Total edge weight toward bad nodes required to auto-flag. */
    flagThreshold: number;
    /** Fuzzy fingerprint ratio (0..1) required for a fuzzy edge. */
    fuzzyThreshold: number;
    /** Accounts created within this distance form one creation cluster. */
    creationClusterSeconds: number;
    weights: AltGraphWeights;
}

export const DEFAULT_ALT_GRAPH_SETTINGS: AltGraphSettings = {
    enabled: true,
    flagThreshold: 5,
    fuzzyThreshold: 0.75,
    creationClusterSeconds: 10 * 60,
    weights: {
        ipHash: 5,
        fpHash: 5,
        fuzzyFingerprint: 3,
        subnetAsn: 2,
        avatarHash: 2,
        creationCluster: 2,
        similarName: 1
    }
};

/**
 * Auth-point block rules for the WebAuth flow (brief 8). Each rule is a
 * separate switch so staff can soften one rule without losing the others.
 * A user who is merely watch-flagged is never blocked by these rules alone.
 */
export interface WebAuthBlockSettings {
    /**
     * Block when the page reported `navigator.webdriver === true` (brief 9).
     * A normally browsed Chrome/Edge/Safari never reports true.
     */
    automation: boolean;
    /** Block when the device/IP exactly matches a kicked user's record. */
    exact: boolean;
    /** Block when the fuzzy device score meets the 4A threshold against a kicked user. */
    fuzzy: boolean;
    /** Block when the alt-graph weight toward bad nodes meets the 4A threshold. */
    graph: boolean;
}

export const DEFAULT_WEBAUTH_BLOCK_SETTINGS: WebAuthBlockSettings = {
    automation: true,
    exact: true,
    fuzzy: true,
    graph: true
};

export interface GuildAntiCheatSettings {
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
    altGraph: AltGraphSettings;
    /** Auth-point block rules for WebAuth (brief 8). */
    webAuthBlock: WebAuthBlockSettings;
    /** AntiNuke destruction detection (brief AN1). */
    antiNuke: AntiNukeSettings;
    userTrust: Record<string, UserTrustData>;
    watchUsers: Record<string, WatchUserEntry>;
    recentLogs: DetectionLog[];
}

export const DEFAULT_ANTICHEAT_SETTINGS: GuildAntiCheatSettings = {
    enabled: false,
    detectors: {
        crossChannelSpam: {
            enabled: true, score: 3, deleteMessage: true, notifyChannel: false,
            config: { windowSeconds: 120, duplicateThreshold: 2, minChannels: 2, rapidWindowSeconds: 10, rapidMessageCount: 6 }
        },
        contentSafety: {
            enabled: false,
            score: 0,
            deleteMessage: false,
            notifyChannel: true,
            config: {
                action: 'spoiler', awardScore: 0, maxAiScore: 10, fallbackScore: 20,
                similarCache: 1, similarityThreshold: 0.9, cacheTtlMinutes: 129600,
                imageThreshold: 0.7, textThreshold: 0.8,
                imageSuggestiveThreshold: 0.65, textSuggestiveThreshold: 0.7,
                suggestive: 1, explicit: 1, harassment: 1, hate: 1, threat: 1, violence: 1, spam: 1,
                scanImages: 1, scanText: 1, scanUrls: 1,
                maxSampleFrames: 6, maxFileSizeMb: 8, maxImages: 4, timeoutMs: 600000,
                customRulesChannelId: '', customRulesMessageId: '1381971374947438703'
            }
        },
        textSpam: {
            enabled: true,
            score: 2,
            deleteMessage: false,
            notifyChannel: false,
            config: {
                windowSeconds: 5,
                rapidMessageCount: 6,
                duplicateThreshold: 3,
                repeatedLineThreshold: 3,
                inviteDuplicateThreshold: 2
            }
        },
        inviteReferral: {
            enabled: true,
            score: 3,
            deleteMessage: true,
            notifyChannel: false,
            config: {
                blockedDomains: [],
                blockedPatterns: []
            }
        },
        redirectLink: {
            enabled: true,
            score: 2,
            deleteMessage: true,
            notifyChannel: true,
            config: {
                allowDomains: [
                    'discord.com',
                    'discordapp.com',
                    'discord.gg',
                    'google.com',
                    'x.com',
                    'twitter.com',
                    't.co',
                    'youtube.com',
                    'youtu.be',
                    'github.com'
                ],
                maxDepth: 5,
                timeoutMs: 2500
            }
        },
        copyPaste: {
            enabled: true,
            score: 2,
            deleteMessage: true,
            notifyChannel: false,
            config: {
                minLength: 80
            }
        },
        everyoneMention: {
            enabled: true,
            score: 2,
            deleteMessage: true,
            notifyChannel: false,
            config: {}
        },
        duplicateMessage: {
            enabled: true,
            score: 1,
            deleteMessage: true,
            notifyChannel: false,
            config: {
                windowSeconds: 180,
                deleteFrom: 2,
                scoreFrom: 4
            }
        },
        gifFlash: {
            enabled: true,
            score: 3,
            deleteMessage: true,
            notifyChannel: true,
            config: {
                timeoutMs: 3000,
                maxSampleFrames: 12,
                luminanceDeltaThreshold: 80,
                pixelDeltaThreshold: 70,
                minimumTransitions: 2,
                minimumFlashScore: 0.55
            }
        },
        duplicateImage: {
            enabled: true,
            score: 2,
            deleteMessage: true,
            notifyChannel: false,
            config: {
                windowSeconds: 300,
                deleteFrom: 2,
                scoreFrom: 3,
                perceptualDistance: 5,
                maxFileSizeMb: 8,
                timeoutMs: 3000,
                serverWide: false
            }
        },
        mentionSpam: {
            enabled: true,
            score: 2,
            deleteMessage: true,
            notifyChannel: false,
            config: {
                windowSeconds: 30,
                sameUserMentionThreshold: 5,
                roleMentionThreshold: 5,
                totalMentionThreshold: 10,
                uniqueUserMentionThreshold: 8
            }
        },
        mentionLimit: {
            enabled: true,
            score: 1,
            deleteMessage: true,
            notifyChannel: false,
            config: {
                maxUserMentions: 200,
                maxRoleMentions: 200
            }
        },
        maxLines: {
            enabled: true,
            score: 1,
            deleteMessage: true,
            notifyChannel: false,
            config: {
                maxLines: 10
            }
        },
        wordFilter: {
            enabled: false,
            score: 1,
            deleteMessage: true,
            notifyChannel: false,
            config: {
                rules: [] as WordFilterRule[]
            }
        },
        raidDetection: {
            enabled: true,
            score: 0,
            deleteMessage: false,
            notifyChannel: true,
            config: {
                joinsPerHour: 20,
                burstCount: 8,
                burstWindowSeconds: 60,
                cooldownMinutes: 60,
                autoKick: 1,
                kickWindowSeconds: 60,
                automation: { ...DEFAULT_RAID_JOIN_ENTROPY }
            }
        }
    },
    punishments: [],
    excludedRoles: [],
    excludedChannels: [],
    channelDetectorExclusions: {},
    logChannelId: null,
    avatarLogChannelId: null,
    chatLogChannelId: null,
    aiLogChannelId: null,
    autoTimeout: {
        enabled: false,
        durationSeconds: 600
    },
    autoDelete: {
        enabled: true,
        windowSeconds: 600
    },
    raidMode: {
        active: false,
        activatedAt: null,
        reason: null,
        recentJoinCount: 0,
        lastJoinAt: null
    },
    watch: {
        enabled: true,
        notifyOnFlag: true,
        newAccountDays: 7,
        kickThresholdPoints: 5,
        autoKickOnDanger: true,
        purgeWindowHours: 24
    },
    altGraph: {
        enabled: true,
        flagThreshold: 5,
        fuzzyThreshold: 0.75,
        creationClusterSeconds: 10 * 60,
        weights: {
            ipHash: 5,
            fpHash: 5,
            fuzzyFingerprint: 3,
            subnetAsn: 2,
            avatarHash: 2,
            creationCluster: 2,
            similarName: 1
        }
    },
    webAuthBlock: { ...DEFAULT_WEBAUTH_BLOCK_SETTINGS },
    antiNuke: structuredClone(DEFAULT_ANTINUKE_SETTINGS),
    userTrust: {},
    watchUsers: {},
    recentLogs: []
};
