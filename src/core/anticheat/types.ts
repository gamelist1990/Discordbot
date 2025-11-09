import { Message } from 'discord.js';

/**
 * Detection context provided to detectors
 */
export interface DetectionContext {
    guildId: string;
    userId: string;
    channelId: string;
    recentMessages?: Message[];
    userTrustScore?: number;
}

/**
 * Detection result returned by detectors
 */
export interface DetectionResult {
    scoreDelta: number;
    reasons: string[];
    metadata?: Record<string, any>;
}

/**
 * AntiCheat detector interface
 */
export interface Detector {
    name: string;
    detect(message: Message, context: DetectionContext): Promise<DetectionResult>;
}

/**
 * Punishment action specification
 */
export interface PunishmentAction {
    type: 'timeout' | 'kick' | 'ban';
    durationSeconds?: number;
    reasonTemplate?: string;
    notify?: boolean;
}

/**
 * Punishment threshold configuration
 */
export interface PunishmentThreshold {
    threshold: number;
    actions: PunishmentAction[];
}

/**
 * Detector configuration
 */
export interface DetectorConfig {
    enabled: boolean;
    config?: Record<string, any>;
}

/**
 * Guild AntiCheat settings
 */
export interface GuildAntiCheatSettings {
    enabled: boolean;
    detectors: Record<string, DetectorConfig>;
    punishments: PunishmentThreshold[];
    excludedRoles: string[];
    excludedChannels: string[];
    logChannelId: string | null;
    autoTimeout: {
        enabled: boolean;
        durationSeconds: number;
    };
    autoDelete: {
        enabled: boolean;
        windowSeconds: number; // how far back to delete messages (seconds)
    };
    userTrust: Record<string, UserTrustData>;
    recentLogs: DetectionLog[];
}

/**
 * User trust data
 */
export interface UserTrustData {
    score: number;
    lastUpdated: string;
    history: TrustHistoryEntry[];
}

/**
 * Trust score history entry
 */
export interface TrustHistoryEntry {
    delta: number;
    reason: string;
    timestamp: string;
    detector?: string;
}

/**
 * Detection log entry
 */
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

/**
 * Default guild settings
 */
export const DEFAULT_ANTICHEAT_SETTINGS: GuildAntiCheatSettings = {
    enabled: false,
    detectors: {
        textSpam: {
            enabled: true,
            config: {}
        }
    },
    punishments: [],
    excludedRoles: [],
    excludedChannels: [],
    logChannelId: null,
    autoTimeout: {
        enabled: true,
        durationSeconds: 180
    },
    autoDelete: {
        enabled: true,
        windowSeconds: 600
    },
    userTrust: {},
    recentLogs: []
};
