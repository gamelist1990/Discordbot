export interface GuildPermission {
    guildId: string;
    level: number;
}

export interface SettingsSession {
    guildId?: string; // 後方互換
    guildIds?: string[];
    userId: string;
    username?: string;
    avatar?: string | null;
    permission?: number; // 後方互換
    permissions?: GuildPermission[];
    // Additional fields present in some session objects
    owners?: string[];
    isOwner?: boolean;
    permissionLevel?: number;
    expiresAt: number;
    token?: string;
    createdAt?: number;
}

export interface GuildSettings {
    guildId: string;
    adminRoleId?: string;
    staffRoleId?: string;
    webAuthRoleId?: string; // WEB認証時に付与するロールID
    settings?: Record<string, any>;
    updatedAt?: number;
}

export * from './profile.js';