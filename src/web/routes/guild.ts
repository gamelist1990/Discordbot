import { Router, Request, Response } from 'express';
import { BotClient } from '../../core/BotClient.js';
import { database } from '../../core/Database.js';
import { SettingsSession } from '../types';

/**
 * ギルド情報API
 */
export function createGuildRoutes(sessions: Map<string, SettingsSession>, botClient: BotClient): Router {
    const router = Router();

    // 認証ミドルウェア（簡易）
    function verifyAuth(req: Request, res: Response, next: Function) {
        const sessionId = req.cookies?.sessionId;
        if (!sessionId || !sessions.has(sessionId)) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        (req as any).session = sessions.get(sessionId);
        next();
    }

    // /api/guild/:guildId
    router.get('/guild/:guildId', verifyAuth, async (req: Request, res: Response) => {
        const guildId = req.params.guildId;
        const session = (req as any).session as SettingsSession;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        // Botが参加しているかチェック
        // まずキャッシュを確認し、無ければ API 経由で取得を試みる（キャッシュミス対策）
        let guild = botClient.client.guilds.cache.get(guildId as string) as any;
        if (!guild) {
            try {
                // fetch は Promise を返し、Bot がギルドに参加していれば取得できる
                guild = await botClient.client.guilds.fetch(guildId as string);
            } catch (e) {
                // フェッチ失敗（ボット未参加など）は従来通り 404 を返す
                res.status(404).json({ error: 'Guild not found' });
                return;
            }
        }

        // ユーザーがこのギルドのメンバーであることを確認
        try {
            const member = await guild.members.fetch(session.userId);
            if (!member) {
                res.status(403).json({ error: 'You are not a member of this guild' });
                return;
            }
        } catch (error) {
            res.status(403).json({ error: 'You are not a member of this guild' });
            return;
        }

        // サーバー設定取得 (新しいレイアウト: Data/Guild/<guildId>/settings.json)
        let settings = null;
        try {
            settings = await database.get(guildId, `Guild/${guildId}/settings`);
        } catch {}

        // マップ可能なロール情報をクライアント向けに整形
        let roles: Array<{ id: string; name: string; color: number; position: number }> = [];
        try {
            const roleCollection = (guild.roles && guild.roles.cache) ? Array.from(guild.roles.cache.values()) : [];
            roles = roleCollection.map((r: any) => ({ id: r.id, name: r.name, color: r.color ?? 0, position: r.position ?? 0 }));
        } catch (e) {
            roles = [];
        }

        res.json({
            id: guild.id,
            name: guild.name,
            iconURL: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
            memberCount: guild.memberCount,
            roles,
            settings: settings || null
        });
    });

    return router;
}
