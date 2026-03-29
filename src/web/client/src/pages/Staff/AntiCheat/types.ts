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

export interface AntiCheatApiResponse {
    settings: AntiCheatSettings;
    userTrustCount: number;
}
