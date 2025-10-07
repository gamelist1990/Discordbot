export interface SettingsSession {
    guildId: string;
    userId: string;
    username?: string;
    permission?: number;
    expiresAt: number;
    token?: string;
    createdAt?: number;
}

export interface GuildSettings {
    guildId: string;
    adminRoleId?: string;
    staffRoleId?: string;
    settings?: Record<string, any>;
    updatedAt?: number;
}