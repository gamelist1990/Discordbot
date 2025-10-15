import { Request, Response } from 'express';
import { RolePresetManager, RolePreset } from '../../core/RolePresetManager.js';
import { SettingsSession } from '../types/index.js';
import { BotClient } from '../../core/BotClient.js';
import { Logger } from '../../utils/Logger.js';

/**
 * ロールプリセットコントローラー
 */
export class RolePresetController {
    private botClient: BotClient;

    constructor(botClient: BotClient) {
        this.botClient = botClient;
    }

    /**
     * ギルドのロールプリセット一覧を取得
     */
    async getPresets(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.params.guildId;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        // 権限チェック (STAFF以上)
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        if (level < 1) {
            res.status(403).json({ error: '権限がありません' });
            return;
        }

        try {
            const guildPresets = await RolePresetManager.getGuildPresets(guildId);
            res.json(guildPresets);
        } catch (error) {
            Logger.error('Failed to get presets:', error);
            res.status(500).json({ error: 'Failed to fetch presets' });
        }
    }

    /**
     * ギルドのロール一覧を取得
     */
    async getGuildRoles(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.params.guildId;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        // 権限チェック
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        if (level < 1) {
            res.status(403).json({ error: '権限がありません' });
            return;
        }

        try {
            const guild = this.botClient.client.guilds.cache.get(guildId);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            // ロール一覧を取得（@everyone除外、ボットより下位のみ）
            const botMember = guild.members.me;
            const roles = guild.roles.cache
                .filter(role => {
                    if (role.name === '@everyone') return false;
                    if (!botMember) return true;
                    return role.position < botMember.roles.highest.position;
                })
                .map(role => ({
                    id: role.id,
                    name: role.name,
                    color: role.color,
                    position: role.position,
                    managed: role.managed
                }))
                .sort((a, b) => b.position - a.position);

            res.json({ roles });
        } catch (error) {
            Logger.error('Failed to get guild roles:', error);
            res.status(500).json({ error: 'Failed to fetch guild roles' });
        }
    }

    /**
     * プリセットを作成
     */
    async createPreset(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.params.guildId;
        const { id, name, description, roles, allowMulti } = req.body;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        // 権限チェック
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        if (level < 1) {
            res.status(403).json({ error: '権限がありません' });
            return;
        }

        // バリデーション
        if (!id || !name || !description || !Array.isArray(roles)) {
            res.status(400).json({ error: 'Invalid request body' });
            return;
        }

        try {
            const preset = await RolePresetManager.createPreset(guildId, {
                id,
                name,
                description,
                roles,
                allowMulti: allowMulti ?? true,
                createdBy: session.userId
            });

            Logger.info(`Role preset '${id}' created in guild ${guildId} by user ${session.userId}`);
            res.status(201).json(preset);
        } catch (error) {
            Logger.error('Failed to create preset:', error);
            const message = error instanceof Error ? error.message : 'Failed to create preset';
            res.status(400).json({ error: message });
        }
    }

    /**
     * プリセットを更新
     */
    async updatePreset(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.params.guildId;
        const presetId = req.params.id;
        const { name, description, roles, allowMulti } = req.body;

        if (!guildId || !presetId) {
            res.status(400).json({ error: 'guildId and presetId are required' });
            return;
        }

        // 権限チェック
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        if (level < 1) {
            res.status(403).json({ error: '権限がありません' });
            return;
        }

        try {
            const updates: Partial<RolePreset> = {};
            if (name !== undefined) updates.name = name;
            if (description !== undefined) updates.description = description;
            if (roles !== undefined) updates.roles = roles;
            if (allowMulti !== undefined) updates.allowMulti = allowMulti;

            const preset = await RolePresetManager.updatePreset(guildId, presetId, updates);

            Logger.info(`Role preset '${presetId}' updated in guild ${guildId} by user ${session.userId}`);
            res.json(preset);
        } catch (error) {
            Logger.error('Failed to update preset:', error);
            const message = error instanceof Error ? error.message : 'Failed to update preset';
            res.status(400).json({ error: message });
        }
    }

    /**
     * プリセットを削除
     */
    async deletePreset(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.params.guildId;
        const presetId = req.params.id;

        if (!guildId || !presetId) {
            res.status(400).json({ error: 'guildId and presetId are required' });
            return;
        }

        // 権限チェック
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        if (level < 1) {
            res.status(403).json({ error: '権限がありません' });
            return;
        }

        try {
            const success = await RolePresetManager.deletePreset(guildId, presetId);

            if (!success) {
                res.status(404).json({ error: 'Preset not found' });
                return;
            }

            Logger.info(`Role preset '${presetId}' deleted from guild ${guildId} by user ${session.userId}`);
            res.json({ success: true });
        } catch (error) {
            Logger.error('Failed to delete preset:', error);
            res.status(500).json({ error: 'Failed to delete preset' });
        }
    }

    /**
     * ロール変更ログを取得
     */
    async getRoleChangeLogs(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.params.guildId;
        const limit = parseInt(req.query.limit as string) || 100;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        // 権限チェック
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        if (level < 1) {
            res.status(403).json({ error: '権限がありません' });
            return;
        }

        try {
            const logs = await RolePresetManager.getRoleChangeLogs(guildId, limit);
            res.json({ logs });
        } catch (error) {
            Logger.error('Failed to get role change logs:', error);
            res.status(500).json({ error: 'Failed to fetch logs' });
        }
    }
}
