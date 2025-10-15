import { Request, Response } from 'express';
import { SettingsSession, GuildSettings } from '../types';
import { database } from '../../core/Database.js';
import { PermissionManager } from '../../utils/PermissionManager.js';
import { CacheManager } from '../../utils/CacheManager.js';

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
        // 権限チェック
        const permissionError = PermissionManager.checkPermission(level, 1, '権限がありません');
        if (permissionError) {
            res.status(permissionError.status).json({ error: permissionError.error });
            return;
        }
        try {
            // キャッシュチェック
            const cacheKey = `settings_${guildId}`;
            const cachedSettings = CacheManager.get<GuildSettings>(cacheKey);
            if (cachedSettings) {
                res.json(cachedSettings);
                return;
            }

            const settings = await database.get<GuildSettings>(guildId, `Guild/${guildId}/settings`);

            const result = settings || {
                guildId,
                staffRoleId: null,
                adminRoleId: null,
                updatedAt: Date.now(),
            };

            // キャッシュに保存（10分間）
            CacheManager.set(cacheKey, result, 10 * 60 * 1000);

            res.json(result);
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
    const { staffRoleId, guildId: bodyGuildId } = req.body;
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
        // 権限チェック
        const permissionError = PermissionManager.checkPermission(level, 1, '権限がありません');
        if (permissionError) {
            res.status(permissionError.status).json({ error: permissionError.error });
            return;
        }
        try {
            // Fetch existing settings to preserve adminRoleId and other fields
            const existing = await database.get<GuildSettings>(guildId, `Guild/${guildId}/settings`);
            const settings: GuildSettings = {
                guildId,
                staffRoleId: staffRoleId || existing?.staffRoleId || undefined,
                // adminRoleId is intentionally preserved from existing settings and cannot be modified here
                adminRoleId: existing?.adminRoleId || undefined,
                updatedAt: Date.now(),
            };
            await database.set(guildId, `Guild/${guildId}/settings`, settings);
            console.log(`設定を保存しました: Guild=${guildId}, Staff=${staffRoleId}`);

            // キャッシュをクリア
            CacheManager.delete(`settings_${guildId}`);

            res.json({ success: true });
        } catch (error) {
            console.error('設定の保存に失敗:', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    }
}
