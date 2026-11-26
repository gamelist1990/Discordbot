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
}

/** Signals used to auto-classify a member as a 警戒 (watch) user. */
export type WatchSignal =
    | 'name-match'
    | 'id-like-name'
    | 'new-account'
    | 'batch-creation'
    | 'shared-avatar'
    | 'similar-name'
    | 'webauth-match';

/** Where the classification was triggered from. */
export type WatchSource = 'join' | 'member-update' | 'message' | 'webauth-match';

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
                kickWindowSeconds: 60
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
    userTrust: {},
    watchUsers: {},
    recentLogs: []
};
