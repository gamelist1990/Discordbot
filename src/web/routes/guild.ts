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
        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }
        // Botが参加しているかチェック
        const guild = botClient.client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }
        // サーバー設定取得
        let settings = null;
        try {
            settings = await database.get(guildId, 'guild_settings');
        } catch {}
        res.json({
            id: guild.id,
            name: guild.name,
            icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
            memberCount: guild.memberCount,
            settings: settings || null
        });
    });

    return router;
}
