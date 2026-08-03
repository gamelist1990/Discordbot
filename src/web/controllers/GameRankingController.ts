import { Request, Response } from 'express';
import { Client } from 'discord.js';
import { gameRankingManager } from '../../core/ranking/GameRankingManager.js';

export class GameRankingController {
    constructor(private readonly client: Client) {}

    async leaderboard(req: Request, res: Response): Promise<void> {
        try {
            const { guildId, gameKey } = req.params;
            if (!isSafeIdentifier(guildId) || !isSafeIdentifier(gameKey)) {
                res.status(400).json({ error: 'ギルドIDまたはゲームキーが不正です。' });
                return;
            }
            const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
            const offset = Math.max(0, Number(req.query.offset) || 0);
            const entries = await gameRankingManager.getLeaderboard(guildId, gameKey, limit, offset);
            const guild = this.client.guilds.cache.get(guildId);

            const leaderboard = await Promise.all(entries.map(async (entry) => {
                const member = guild
                    ? await guild.members.fetch(entry.userId).catch(() => null)
                    : null;
                const user = member?.user
                    || await this.client.users?.fetch?.(entry.userId).catch(() => null)
                    || null;
                return {
                    ...entry,
                    username: member?.displayName || user?.username || entry.userId,
                    avatar: user?.displayAvatarURL({ size: 128 }) || null
                };
            }));

            res.json({
                guildId,
                gameKey,
                leaderboard
            });
        } catch (error) {
            res.status(500).json({
                error: error instanceof Error ? error.message : 'ゲームランキングの取得に失敗しました。'
            });
        }
    }

    async profile(req: Request, res: Response): Promise<void> {
        try {
            const { guildId, gameKey, userId } = req.params;
            if (![guildId, gameKey, userId].every(isSafeIdentifier)) {
                res.status(400).json({ error: 'ランキング識別子が不正です。' });
                return;
            }
            const profile = await gameRankingManager.getProfile(guildId, gameKey, userId);
            const board = await gameRankingManager.getBoard(guildId, gameKey);
            res.json({
                profile,
                tier: gameRankingManager.getTier(board.tiers, profile.rating)
            });
        } catch (error) {
            res.status(500).json({
                error: error instanceof Error ? error.message : 'ゲームランクの取得に失敗しました。'
            });
        }
    }
}

function isSafeIdentifier(value: string): boolean {
    return /^[A-Za-z0-9_-]{1,100}$/.test(value);
}