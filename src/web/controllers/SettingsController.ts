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

        try {
            const settings = await database.get<GuildSettings>(session.guildId, 'guild_settings');

            res.json(settings || {
                guildId: session.guildId,
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
        const { staffRoleId, adminRoleId } = req.body;

        try {
            const settings: GuildSettings = {
                guildId: session.guildId,
                staffRoleId: staffRoleId || undefined,
                adminRoleId: adminRoleId || undefined,
                updatedAt: Date.now(),
            };

            await database.set(session.guildId, 'guild_settings', settings);

            console.log(`設定を保存しました: Guild=${session.guildId}, Staff=${staffRoleId}, Admin=${adminRoleId}`);
            res.json({ success: true });
        } catch (error) {
            console.error('設定の保存に失敗:', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    }
}
