/**
 * AntiCheat UI types
 */

export interface AntiCheatSettings {
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
}

export interface DetectorConfig {
    enabled: boolean;
    description?: string;
    excludeSettings?: {
        excludedRoles?: string[];
        excludedChannels?: string[];
        excludedUsers?: string[];
    };
    config?: Record<string, any>;
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
    metadata?: Record<string, any>;
}

export interface AntiCheatApiResponse {
    settings: AntiCheatSettings;
    userTrustCount: number;
}
