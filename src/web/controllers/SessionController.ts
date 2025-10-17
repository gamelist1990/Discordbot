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

        res.json({ valid: true, guildIds: session.guildIds || [session.guildId], userId: session.userId });
    }

    /**
     * ギルド情報の取得
     */
    async getGuild(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;

        try {
            // guildId が直接ない場合は guildIds 配列の最初の要素を使用（後方互換性）
            let targetGuildId = session.guildId;
            if (!targetGuildId && session.guildIds && session.guildIds.length > 0) {
                targetGuildId = session.guildIds[0];
            }

            if (!targetGuildId) {
                res.status(400).json({ error: 'Invalid session: missing guild ID' });
                return;
            }

            const guild = this.botClient.client.guilds.cache.get(targetGuildId);

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

    /**
     * 現在のセッション情報を返す
     */
    async getCurrent(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession | undefined;
        if (!session) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        res.json({
            guildId: session.guildId,
            guildIds: session.guildIds,
            userId: session.userId,
            permissionLevel: session.permission,
        });
    }
}
