import { Message } from 'discord.js';

export interface DetectionContext {
    guildId: string;
    userId: string;
    channelId: string;
    recentMessages?: Message[];
    userTrustScore?: number;
    settings: GuildAntiCheatSettings;
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

export interface GuildAntiCheatSettings {
    enabled: boolean;
    detectors: Record<string, DetectorConfig>;
    punishments: PunishmentThreshold[];
    excludedRoles: string[];
    excludedChannels: string[];
    logChannelId: string | null;
    avatarLogChannelId: string | null;
    autoTimeout: {
        enabled: boolean;
        durationSeconds: number;
    };
    autoDelete: {
        enabled: boolean;
        windowSeconds: number;
    };
    raidMode: RaidModeState;
    userTrust: Record<string, UserTrustData>;
    recentLogs: DetectionLog[];
}

export const DEFAULT_ANTICHEAT_SETTINGS: GuildAntiCheatSettings = {
    enabled: false,
    detectors: {
        textSpam: {
            enabled: true,
            score: 2,
            deleteMessage: false,
            notifyChannel: false,
            config: {
                windowSeconds: 5,
                rapidMessageCount: 6,
                duplicateThreshold: 3,
                capsRatio: 0.88
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
                allowDomains: ['google.com', 'x.com', 'twitter.com', 't.co'],
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
                joinsPerHour: 25,
                burstCount: 10,
                burstWindowSeconds: 10,
                cooldownMinutes: 60
            }
        }
    },
    punishments: [],
    excludedRoles: [],
    excludedChannels: [],
    logChannelId: null,
    avatarLogChannelId: null,
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
    userTrust: {},
    recentLogs: []
};
