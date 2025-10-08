import { Request, Response } from 'express';
import { SettingsSession, GuildSettings } from '../types';
import { database } from '../../core/Database.js';

/**
 * 設定コントローラー
 */
export class SettingsController {
    /**
     * 設定の取得
     */
    async getSettings(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        // クエリやボディ、パスからguildIdを取得（例: /settings/:guildId など）
        const guildId = req.query.guildId || req.body?.guildId || req.params?.guildId || session.guildId;
        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }
        // サーバーごとの権限を判定
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }
        // ここで権限レベルチェック（例: 0=一般, 1=staff, 2=admin など）
        if (level < 1) {
            res.status(403).json({ error: '権限がありません' });
            return;
        }
        try {
            const settings = await database.get<GuildSettings>(guildId, 'guild_settings');
            res.json(settings || {
                guildId,
                staffRoleId: null,
                adminRoleId: null,
                updatedAt: Date.now(),
            });
        } catch (error) {
            console.error('設定の取得に失敗:', error);
            res.status(500).json({ error: 'Failed to fetch settings' });
        }
    }

    /**
     * 設定の保存
     */
    async saveSettings(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { staffRoleId, adminRoleId, guildId: bodyGuildId } = req.body;
        const guildId = bodyGuildId || req.query.guildId || req.params?.guildId || session.guildId;
        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }
        // サーバーごとの権限を判定
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }
        if (level < 2) {
            res.status(403).json({ error: '管理者権限がありません' });
            return;
        }
        try {
            const settings: GuildSettings = {
                guildId,
                staffRoleId: staffRoleId || undefined,
                adminRoleId: adminRoleId || undefined,
                updatedAt: Date.now(),
            };
            await database.set(guildId, 'guild_settings', settings);
            console.log(`設定を保存しました: Guild=${guildId}, Staff=${staffRoleId}, Admin=${adminRoleId}`);
            res.json({ success: true });
        } catch (error) {
            console.error('設定の保存に失敗:', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    }
}
