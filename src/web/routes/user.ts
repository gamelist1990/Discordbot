import { Router, Request, Response } from 'express';
import { BotClient } from '../../core/BotClient.js';
import { verifyAuth, getCurrentUser } from '../middleware/auth.js';
import { SettingsSession } from '../types';
import fs from 'fs';
import path from 'path';

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
    // frontend expects top-level numeric fields; keep optional for compatibility
    totalMessages?: number;
    linkMessages?: number;
    mediaMessages?: number;
    role?: string;
    joinedAt?: string;
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
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    /**
     * ユーザープロフィールを取得
     */
    // verifyAuth is a higher-order function that must be called with the sessions map
    router.get('/profile', verifyAuth(sessions), async (req: Request, res: Response) => {
        try {
            const user = getCurrentUser(req);

            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            // Botクライアントから参加中のサーバーを取得
            // Botが参加しているギルド一覧
            const botGuilds = botClient.getGuildList();

            // Try to read persisted OAuth sessions to get user's access token
            const authPersistPath = path.join(process.cwd(), 'Data', 'Auth', 'sessions.json');
            let userOauth: any = null;
            try {
                if (fs.existsSync(authPersistPath)) {
                    const raw = fs.readFileSync(authPersistPath, 'utf8') || '{}';
                    const obj = JSON.parse(raw) as Record<string, any>;
                    userOauth = obj[user.userId];
                }
            } catch (e) {
                console.warn('[UserProfile] Failed to read OAuth sessions from disk:', e);
            }

            // If we have an OAuth access token, use it to get the user's guilds from Discord API
            let userGuildIds: string[] | null = null;
            if (userOauth && userOauth.accessToken) {
                try {
                    const resp = await fetch('https://discord.com/api/users/@me/guilds', {
                        headers: {
                            Authorization: `Bearer ${userOauth.accessToken}`
                        }
                    });
                    if (resp.ok) {
                        const guilds = await resp.json() as Array<{ id: string; name: string }>;
                        userGuildIds = guilds.map(g => g.id);
                    } else {
                        console.warn('[UserProfile] Failed to fetch user guilds, status=', resp.status);
                    }
                } catch (e) {
                    console.warn('[UserProfile] Error fetching user guilds:', e);
                }
            }

            // Build userGuilds only for mutual guilds (where both user and bot are present)
            const userGuilds: GuildInfo[] = [];

            for (const g of botGuilds) {
                // If we have user's guild list, ensure the user is actually in this guild
                if (Array.isArray(userGuildIds) && userGuildIds.indexOf(g.id) === -1) continue;

                // Try to fetch member info from bot cache for roles/joinedAt details
                let role: string | undefined = undefined;
                let roles: string[] = [];
                let joinedAt: string | undefined = undefined;
                try {
                    const guildObj = botClient.client.guilds.cache.get(g.id as string);
                    if (guildObj) {
                        const member = await guildObj.members.fetch(user.userId).catch(() => null);
                        if (member) {
                            role = member.roles?.highest?.name || undefined;
                            joinedAt = member.joinedAt ? member.joinedAt.toISOString() : undefined;
                            // get full role names (exclude @everyone)
                            roles = member.roles.cache
                                .filter(r => r.name !== '@everyone')
                                .map(r => r.name);
                        }
                    }
                } catch (e) {
                    // ignore
                }

                // Read real counts from StatsManager/database if available
                let totalMessages = 0;
                let linkMessages = 0;
                let mediaMessages = 0;
                try {
                    const statsMgr = (await import('../../core/StatsManager.js')).statsManagerSingleton.instance;
                    if (statsMgr) {
                        const s = await statsMgr.getUserStats(g.id, user.userId);
                        totalMessages = s.totalMessages || 0;
                        linkMessages = s.linkMessages || 0;
                        mediaMessages = s.mediaMessages || 0;
                    } else {
                        // fallback: attempt to read persisted DB directly
                        const persisted = (await import('../../core/Database.js')).database;
                        const rec = await persisted.get(g.id, 'user_stats', {} as any) as Record<string, any> || {};
                        const u = rec[user.userId] || { totalMessages: 0, linkMessages: 0, mediaMessages: 0 };
                        totalMessages = u.totalMessages || 0;
                        linkMessages = u.linkMessages || 0;
                        mediaMessages = u.mediaMessages || 0;
                    }
                } catch (e) {
                    // ignore and keep zeros
                }

                userGuilds.push({
                    id: g.id,
                    name: g.name,
                    icon: undefined,
                    memberCount: g.memberCount,
                    userStats: {
                        totalMessages,
                        linkMessages,
                        mediaMessages,
                        role: role || 'Member',
                        joinedAt,
                    },
                    totalMessages,
                    linkMessages,
                    mediaMessages,
                    role: role || 'Member',
                    // expose full roles array in a new property for frontend use (not breaking existing role)
                    // Use a string joined representation in UserProfile if you prefer
                    // but here we add joinedAt already above
                    // add roles as well
                    // @ts-ignore - extend GuildInfo at runtime
                    roles,
                    joinedAt,
                });
            }
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

    /**
     * 管理者権限のあるサーバー一覧を返す
     */
    router.get('/guilds', verifyAuth(sessions), async (req: Request, res: Response) => {
        try {
            const user = getCurrentUser(req);
            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            // Botが参加しているギルド一覧
            const botGuilds = botClient.getGuildList();

            // OAuthセッションからユーザーのアクセストークン取得
            const authPersistPath = path.join(process.cwd(), 'Data', 'Auth', 'sessions.json');
            let userOauth: any = null;
            try {
                if (fs.existsSync(authPersistPath)) {
                    const raw = fs.readFileSync(authPersistPath, 'utf8') || '{}';
                    const obj = JSON.parse(raw) as Record<string, any>;
                    userOauth = obj[user.userId];
                }
            } catch (e) {
                console.warn('[UserGuilds] Failed to read OAuth sessions from disk:', e);
            }

            let userGuilds: any[] = [];
            if (userOauth && userOauth.accessToken) {
                try {
                    const resp = await fetch('https://discord.com/api/users/@me/guilds', {
                        headers: {
                            Authorization: `Bearer ${userOauth.accessToken}`
                        }
                    });
                    if (resp.ok) {
                        const guilds = await resp.json() as Array<any>;
                        // 管理者権限(0x8)または管理権限(0x20)を持つサーバーのみ抽出
                        userGuilds = guilds.filter(g => (g.permissions & 0x8) || (g.owner === true));
                    }
                } catch (e) {
                    console.warn('[UserGuilds] Error fetching user guilds:', e);
                }
            }

            // Botが参加しているサーバーのみ返す
            const botGuildIds = new Set(botGuilds.map(g => g.id));
            const filtered = userGuilds.filter(g => botGuildIds.has(g.id));

            res.json({ guilds: filtered });
        } catch (error) {
            console.error('Failed to get user guilds:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    return router;
}