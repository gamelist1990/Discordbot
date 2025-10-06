import { Request, Response } from 'express';
import { SettingsSession } from '../types/index.js';
import { BotClient } from '../../core/BotClient.js';

/**
 * セッションコントローラー
 */
export class SessionController {
    private sessions: Map<string, SettingsSession>;
    private botClient: BotClient;

    constructor(sessions: Map<string, SettingsSession>, botClient: BotClient) {
        this.sessions = sessions;
        this.botClient = botClient;
    }

    /**
     * トークンの検証
     */
    async validateToken(req: Request, res: Response): Promise<void> {
        const { token } = req.params;

        const session = this.sessions.get(token);
        if (!session) {
            res.status(404).json({ valid: false, error: 'Session not found' });
            return;
        }

        if (Date.now() > session.expiresAt) {
            this.sessions.delete(token);
            res.status(401).json({ valid: false, error: 'Session expired' });
            return;
        }

        res.json({ valid: true, guildId: session.guildId, userId: session.userId });
    }

    /**
     * ギルド情報の取得
     */
    async getGuild(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;

        try {
            const guild = this.botClient.client.guilds.cache.get(session.guildId);

            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            // ロール情報を取得
            const roles = guild.roles.cache.map(role => ({
                id: role.id,
                name: role.name,
                color: role.color,
                position: role.position,
            }));

            res.json({
                id: guild.id,
                name: guild.name,
                iconURL: guild.iconURL(),
                roles: roles,
            });
        } catch (error) {
            console.error('ギルド情報取得エラー:', error);
            res.status(500).json({ error: 'Failed to fetch guild info' });
        }
    }
}
