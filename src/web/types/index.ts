/**
 * 設定セッション情報
 */
export interface SettingsSession {
    token: string;
    guildId: string;
    userId: string;
    createdAt: number;
    expiresAt: number;
}

/**
 * 設定データ
 */
export interface GuildSettings {
    guildId: string;
    staffRoleId?: string;
    adminRoleId?: string;
    updatedAt: number;
}

/**
 * Botステータス
 */
export interface BotStatus {
    uptime: number;
    guildCount: number;
    maxGuilds: number;
    uptimeFormatted: string;
}
