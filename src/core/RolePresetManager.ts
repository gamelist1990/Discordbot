import { database } from './Database.js';
import { Logger } from '../utils/Logger.js';

/**
 * ロールプリセットの型定義
 */
export interface RolePreset {
    id: string;
    name: string;
    description: string;
    roles: string[]; // Role IDs
    allowMulti: boolean;
    createdBy: string; // User ID
    createdAt: string; // ISO timestamp
    updatedAt?: string;
}

/**
 * ギルドのロールプリセット集合
 */
export interface GuildRolePresets {
    guildId: string;
    presets: Record<string, RolePreset>;
}

/**
 * ロール変更ログエントリ
 */
export interface RoleChangeLog {
    timestamp: string;
    guildId: string;
    userId: string;
    executorId: string;
    presetId: string;
    action: 'add' | 'remove';
    roleId: string;
    roleName: string;
    success: boolean;
    error?: string;
}

/**
 * ロールプリセット管理クラス
 */
export class RolePresetManager {
    private static readonly PRESET_KEY = 'role_presets';
    private static readonly LOG_KEY = 'logs/role_changes';

    /**
     * ギルドのロールプリセットを取得
     */
    static async getGuildPresets(guildId: string): Promise<GuildRolePresets> {
        try {
            const data = await database.get<GuildRolePresets>(
                guildId,
                `Guild/${guildId}/${this.PRESET_KEY}`
            );

            if (!data) {
                return {
                    guildId,
                    presets: {}
                };
            }

            return data;
        } catch (error) {
            Logger.error(`Failed to get role presets for guild ${guildId}:`, error);
            return {
                guildId,
                presets: {}
            };
        }
    }

    /**
     * プリセットを取得
     */
    static async getPreset(guildId: string, presetId: string): Promise<RolePreset | null> {
        const guildPresets = await this.getGuildPresets(guildId);
        return guildPresets.presets[presetId] || null;
    }

    /**
     * プリセットを作成
     */
    static async createPreset(
        guildId: string,
        preset: Omit<RolePreset, 'createdAt' | 'updatedAt'>
    ): Promise<RolePreset> {
        const guildPresets = await this.getGuildPresets(guildId);

        if (guildPresets.presets[preset.id]) {
            throw new Error(`Preset with ID '${preset.id}' already exists`);
        }

        const newPreset: RolePreset = {
            ...preset,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        guildPresets.presets[preset.id] = newPreset;

        await database.set(
            guildId,
            `Guild/${guildId}/${this.PRESET_KEY}`,
            guildPresets
        );

        Logger.info(`Created role preset '${preset.id}' in guild ${guildId}`);

        return newPreset;
    }

    /**
     * プリセットを更新
     */
    static async updatePreset(
        guildId: string,
        presetId: string,
        updates: Partial<Omit<RolePreset, 'id' | 'createdAt' | 'createdBy'>>
    ): Promise<RolePreset> {
        const guildPresets = await this.getGuildPresets(guildId);

        if (!guildPresets.presets[presetId]) {
            throw new Error(`Preset '${presetId}' not found`);
        }

        const updatedPreset: RolePreset = {
            ...guildPresets.presets[presetId],
            ...updates,
            updatedAt: new Date().toISOString()
        };

        guildPresets.presets[presetId] = updatedPreset;

        await database.set(
            guildId,
            `Guild/${guildId}/${this.PRESET_KEY}`,
            guildPresets
        );

        Logger.info(`Updated role preset '${presetId}' in guild ${guildId}`);

        return updatedPreset;
    }

    /**
     * プリセットを削除
     */
    static async deletePreset(guildId: string, presetId: string): Promise<boolean> {
        const guildPresets = await this.getGuildPresets(guildId);

        if (!guildPresets.presets[presetId]) {
            return false;
        }

        delete guildPresets.presets[presetId];

        await database.set(
            guildId,
            `Guild/${guildId}/${this.PRESET_KEY}`,
            guildPresets
        );

        Logger.info(`Deleted role preset '${presetId}' from guild ${guildId}`);

        return true;
    }

    /**
     * すべてのプリセットIDを取得
     */
    static async listPresetIds(guildId: string): Promise<string[]> {
        const guildPresets = await this.getGuildPresets(guildId);
        return Object.keys(guildPresets.presets);
    }

    /**
     * ロール変更をログに記録
     */
    static async logRoleChange(log: RoleChangeLog): Promise<void> {
        try {
            // ログファイルパス
            const logPath = `${this.LOG_KEY}`;
            
            // 既存のログを取得
            const existingLogs = await database.get<RoleChangeLog[]>(
                log.guildId,
                `Guild/${log.guildId}/${logPath}`
            ) || [];

            // 新しいログを追加
            existingLogs.push(log);

            // ログが1000件を超えたら古いものを削除
            if (existingLogs.length > 1000) {
                existingLogs.splice(0, existingLogs.length - 1000);
            }

            await database.set(
                log.guildId,
                `Guild/${log.guildId}/${logPath}`,
                existingLogs
            );

            Logger.info(`Role change logged: ${log.action} ${log.roleName} for user ${log.userId}`);
        } catch (error) {
            Logger.error('Failed to log role change:', error);
        }
    }

    /**
     * ロール変更ログを取得
     */
    static async getRoleChangeLogs(
        guildId: string,
        limit: number = 100
    ): Promise<RoleChangeLog[]> {
        try {
            const logs = await database.get<RoleChangeLog[]>(
                guildId,
                `Guild/${guildId}/${this.LOG_KEY}`
            ) || [];

            return logs.slice(-limit);
        } catch (error) {
            Logger.error(`Failed to get role change logs for guild ${guildId}:`, error);
            return [];
        }
    }
}
