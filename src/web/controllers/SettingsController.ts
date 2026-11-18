import { Request, Response } from 'express';
import { SettingsSession, GuildSettings } from '../types';
import { database } from '../../core/persistence/Database.js';
import { PermissionManager } from '../../utils/PermissionManager.js';
import { CacheManager } from '../../utils/CacheManager.js';
import { BotClient } from '../../core/platform/BotClient.js';
import { Guild } from 'discord.js';
import { resolveGuildPermissionLevel as resolveLiveGuildLevel } from '../../core/permissions/GuildAccess.js';
import { getSessionGuildPermissionLevel } from '../middleware/auth.js';

/**
 * セッションの permissions 配列に含まれていないギルドについて、Bot 経由でリアルタイムに
 * 権限を確認し、セッションを更新したうえで権限レベルを返す。
 */
async function resolveGuildPermissionLevel(
    session: SettingsSession,
    guildId: string,
    botClient: BotClient
): Promise<number> {
    try {
        let guild: Guild | null = botClient.client.guilds.cache.get(guildId) ?? null;
        if (!guild) {
            guild = await botClient.client.guilds.fetch(guildId).catch(() => null);
        }
        if (!guild) return 0;

        const level = await resolveLiveGuildLevel(guild, session.userId);

        if (level > 0) {
            // セッションの permissions を更新して次回以降の呼び出しを高速化
            if (!Array.isArray(session.permissions)) {
                session.permissions = [];
            }
            const existing = session.permissions.find(p => p.guildId === guildId);
            if (existing) {
                existing.level = Math.max(existing.level, level);
            } else {
                session.permissions.push({ guildId, level });
            }
            if (!session.guildIds) session.guildIds = [];
            if (!session.guildIds.includes(guildId)) {
                session.guildIds.push(guildId);
            }
        }

        return level;
    } catch {
        return 0;
    }
}

/**
 * 設定コントローラー
 */
export class SettingsController {
    private botClient?: BotClient;

    constructor(botClient?: BotClient) {
        this.botClient = botClient;
    }

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
        let level = getSessionGuildPermissionLevel(session, guildId);
        // セッションにギルドの権限情報がない場合、Bot 経由でリアルタイムに確認する
        // （新規サーバー追加後にログインし直していないユーザーへの対応）
        if (this.botClient) {
            level = await resolveGuildPermissionLevel(session, guildId as string, this.botClient);
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
                webAuthRoleId: null,
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
        const { staffRoleId, webAuthRoleId, guildId: bodyGuildId } = req.body;
        const guildId = bodyGuildId || req.query.guildId || req.params?.guildId || session.guildId;
        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }
        // サーバーごとの権限を判定
        let level = getSessionGuildPermissionLevel(session, guildId);
        // セッションにギルドの権限情報がない場合、Bot 経由でリアルタイムに確認する
        if (this.botClient) {
            level = await resolveGuildPermissionLevel(session, guildId as string, this.botClient);
        }
        // 権限チェック
        const permissionError = PermissionManager.checkAdminPermission(level, '設定変更には管理者権限が必要です');
        if (permissionError) {
            res.status(permissionError.status).json({ error: permissionError.error });
            return;
        }
        try {
            // Fetch existing settings to preserve adminRoleId and other fields
            const existing = await database.get<GuildSettings>(guildId, `Guild/${guildId}/settings`);
            const settings: GuildSettings = {
                guildId,
                staffRoleId: typeof staffRoleId === 'string' ? (staffRoleId || undefined) : existing?.staffRoleId,
                // adminRoleId is intentionally preserved from existing settings and cannot be modified here
                adminRoleId: existing?.adminRoleId || undefined,
                webAuthRoleId: typeof webAuthRoleId === 'string' ? (webAuthRoleId || undefined) : existing?.webAuthRoleId,
                updatedAt: Date.now(),
            };
            await database.set(guildId, `Guild/${guildId}/settings`, settings);
            console.log(`設定を保存しました: Guild=${guildId}, Staff=${staffRoleId}, WebAuth=${webAuthRoleId}`);

            // キャッシュをクリア
            CacheManager.delete(`settings_${guildId}`);

            res.json({ success: true });
        } catch (error) {
            console.error('設定の保存に失敗:', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    }
}
