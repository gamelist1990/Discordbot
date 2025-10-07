import { Router, Request, Response } from 'express';
import { BotClient } from '../../core/BotClient.js';
import { verifyAuth, getCurrentUser } from '../middleware/auth.js';

/**
 * ユーザー統計情報
 */
interface UserStatistics {
    totalMessages: number;
    linkMessages: number;
    mediaMessages: number;
    role?: string;
    joinedAt?: string;
}

/**
 * サーバー情報
 */
interface GuildInfo {
    id: string;
    name: string;
    icon?: string;
    memberCount?: number;
    userStats: UserStatistics;
}

/**
 * ユーザー情報
 */
interface UserProfile {
    id: string;
    username: string;
    discriminator: string;
    avatar?: string;
    banner?: string;
    guilds: GuildInfo[];
    totalStats: {
        totalMessages: number;
        totalLinks: number;
        totalMedia: number;
        totalServers: number;
    };
}

/**
 * ユーザー関連ルート
 */
export function createUserRoutes(
    botClient: BotClient
): Router {
    const router = Router();

    /**
     * ユーザープロフィールを取得
     */
    router.get('/profile', verifyAuth, async (req: Request, res: Response) => {
        try {
            const user = getCurrentUser(req);

            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            // Botクライアントから参加中のサーバーを取得
            const botGuilds = botClient.getGuildList();

            // ユーザーが参加しているサーバーのみをフィルタリング
            // （実際の実装では、Discord APIからユーザーのサーバー情報を取得する必要がある）
            const userGuilds: GuildInfo[] = botGuilds.map(guild => ({
                id: guild.id,
                name: guild.name,
                icon: undefined, // BotにはDiscordからのアイコン情報がない
                memberCount: guild.memberCount,
                userStats: {
                    totalMessages: Math.floor(Math.random() * 10000) + 100, // モックデータ
                    linkMessages: Math.floor(Math.random() * 500) + 10,
                    mediaMessages: Math.floor(Math.random() * 200) + 5,
                    role: 'Member', // モックデータ
                    joinedAt: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
                }
            }));

            // 総統計を計算
            const totalStats = {
                totalMessages: userGuilds.reduce((sum, guild) => sum + guild.userStats.totalMessages, 0),
                totalLinks: userGuilds.reduce((sum, guild) => sum + guild.userStats.linkMessages, 0),
                totalMedia: userGuilds.reduce((sum, guild) => sum + guild.userStats.mediaMessages, 0),
                totalServers: userGuilds.length,
            };

            // Discordユーザー情報（実際の実装ではOAuthトークンを使って取得）
            const userProfile: UserProfile = {
                id: user.userId,
                username: user.username.split('#')[0] || user.userId,
                discriminator: user.username.split('#')[1] || '0000',
                avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.userId}/${user.avatar}.png` : undefined,
                banner: undefined, // モックデータ
                guilds: userGuilds,
                totalStats,
            };

            res.json(userProfile);
        } catch (error) {
            console.error('Failed to get user profile:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}