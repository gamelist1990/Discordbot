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

            // デバッグログ: セッション情報とユーザー情報を出力
       

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
                } else {
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
                    const persisted = (await import('../../core/Database.js')).database;

                    // 1) Try runtime StatsManager
                    if (statsMgr) {
                        const s = await statsMgr.getUserStats(g.id, user.userId);
                        if (s) {
                            totalMessages = s.totalMessages || 0;
                            linkMessages = s.linkMessages || 0;
                            mediaMessages = s.mediaMessages || 0;
                        }
                    }

                    // 2) If still zeros, try persisted per-guild per-user file
                    if (totalMessages === 0 && linkMessages === 0 && mediaMessages === 0) {
                        try {
                            // 1) Try per-guild per-user file at namespace=g.id, path=Guild/<guildId>/User/<userId>
                            const perUser = await persisted.get(g.id, `Guild/${g.id}/User/${user.userId}`, null) as any;
                            if (perUser) {
                                totalMessages = perUser.totalMessages || 0;
                                linkMessages = perUser.linkMessages || 0;
                                mediaMessages = perUser.mediaMessages || 0;
                            } else {
                                // 2) Try global per-user file at root namespace (""), path=User/<userId>
                                // This file contains per-user global aggregates and optional per-guild breakdowns.
                                const userFile = await persisted.get('', `User/${user.userId}`, null) as any;
                                if (userFile) {
                                    // Prefer per-guild breakdown inside global user file if present
                                    if (userFile.guilds && userFile.guilds[g.id]) {
                                        const gd = userFile.guilds[g.id];
                                        totalMessages = gd.totalMessages || 0;
                                        linkMessages = gd.linkMessages || 0;
                                        mediaMessages = gd.mediaMessages || 0;
                                    } else {
                                        // Otherwise, do not assign the global totals as this guild's totals.
                                        // Keep zeros (or other fallbacks) rather than copying globalUser.totalMessages
                                        // which would cause the same counts to appear across multiple guilds.
                                        // Continue to legacy fallback below.
                                    }
                                }

                                // 3) Legacy fallback: aggregated mapping stored under namespace=g.id with key 'user_stats'
                                if (totalMessages === 0 && linkMessages === 0 && mediaMessages === 0) {
                                    const rec = await persisted.get(g.id, 'user_stats', {} as any) as Record<string, any> || {};
                                    const u = rec[user.userId] || { totalMessages: 0, linkMessages: 0, mediaMessages: 0 };
                                    totalMessages = u.totalMessages || 0;
                                    linkMessages = u.linkMessages || 0;
                                    mediaMessages = u.mediaMessages || 0;
                                }
                            }
                        } catch (e) {
                            // ignore and keep zeros
                        }
                    }
                } catch (e) {
                    // ignore and keep zeros
                }

                userGuilds.push({
                    id: g.id,
                    name: g.name,
                    // BotClient.getGuildList() now includes `icon` (hash) when available
                    icon: (g as any).icon || undefined,
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
            // 総統計を計算 - StatsManagerのグローバル集計を使用
            let totalMessagesAll = 0;
            let totalLinksAll = 0;
            let totalMediaAll = 0;

            // 各guildからの集計を試す（互換性のため）
            try {
                const persisted = (await import('../../core/Database.js')).database;
                const globalUser = await persisted.get('', `User/${user.userId}`, null) as any;

                if (globalUser && globalUser.guilds && typeof globalUser.guilds === 'object') {
                    // Use guild-specific data from global structure
                    for (const g of botGuilds) {
                        if (globalUser.guilds[g.id] && userGuildIds && userGuildIds.includes(g.id)) {
                            const guildData = globalUser.guilds[g.id];
                            totalMessagesAll += guildData.totalMessages || 0;
                            totalLinksAll += guildData.linkMessages || 0;
                            totalMediaAll += guildData.mediaMessages || 0;
                        }
                    }
                } else if (globalUser) {
                    // Fallback to old flat structure
                    totalMessagesAll = globalUser.totalMessages || 0;
                    totalLinksAll = globalUser.linkMessages || 0;
                    totalMediaAll = globalUser.mediaMessages || 0;
                }
            } catch (e) {
                console.warn('Failed to load global user stats:', e);
                // Fallback to API-based per-guild calculations
                // ... existing fallback logic ...
            }

            // Ensure totalStats is defined in this scope for the response
            const totalStats = {
                totalMessages: totalMessagesAll,
                totalLinks: totalLinksAll,
                totalMedia: totalMediaAll,
                totalServers: userGuilds.length,
            };

            // Discordユーザー情報（実際の実装ではOAuthトークンを使って取得）
            const userProfile: UserProfile = {
                id: user.userId,
                username: (user.username && user.username.split('#')[0]) || user.userId,
                discriminator: (user.username && user.username.split('#')[1]) || '0000',
                avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.userId}/${user.avatar}.png` : undefined,
                banner: undefined, // モックデータ
                // Add iconURL convenience property for frontend
                guilds: userGuilds.map(g => ({
                    ...g,
                    // if an icon hash exists, expose full CDN URL; otherwise null
                    // @ts-ignore
                    iconURL: (g as any).icon ? `https://cdn.discordapp.com/icons/${g.id}/${(g as any).icon}.png` : null
                })),
                totalStats: totalStats,
            };

         

            res.json(userProfile);
        } catch (error) {
            console.error('Failed to get user profile:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * Get user activity data with timestamps
     */
    router.get('/activity', verifyAuth(sessions), async (req: Request, res: Response) => {
        try {
            const user = getCurrentUser(req);
            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            // Get bot guilds
            const botGuilds = botClient.getGuildList();
            const guildIds = botGuilds.map(g => g.id as string);

            // Get stats manager
            const statsMgr = (await import('../../core/StatsManager.js')).statsManagerSingleton.instance;
            
            if (!statsMgr) {
                res.status(503).json({ error: 'Stats manager not available' });
                return;
            }

            // Get aggregated activity data
            const activityData = await statsMgr.getUserAggregatedActivity(user.userId, guildIds);

            // Calculate averages and frequency
            const weeklyAverage = activityData.weeklyMessages / 7;
            const monthlyAverage = activityData.monthlyMessages / 30;

            let chatFrequency: 'very_high' | 'high' | 'moderate' | 'low' | 'very_low' = 'low';
            if (weeklyAverage >= 50) chatFrequency = 'very_high';
            else if (weeklyAverage >= 20) chatFrequency = 'high';
            else if (weeklyAverage >= 10) chatFrequency = 'moderate';
            else if (weeklyAverage >= 3) chatFrequency = 'low';
            else chatFrequency = 'very_low';

            // Calculate link and media counts from timestamps
            const now = Date.now();
            const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

            const weeklyLinks = activityData.allTimestamps.filter(t => t.timestamp >= oneWeekAgo && t.isLink).length;
            const weeklyMedia = activityData.allTimestamps.filter(t => t.timestamp >= oneWeekAgo && t.isMedia).length;

            res.json({
                weeklyMessages: activityData.weeklyMessages,
                monthlyMessages: activityData.monthlyMessages,
                yearlyMessages: activityData.yearlyMessages,
                weeklyLinks,
                weeklyMedia,
                weeklyAverage,
                monthlyAverage,
                chatFrequency,
                recentActivity: activityData.recentActivity,
                hasTimestampData: activityData.allTimestamps.length > 0
            });
        } catch (error) {
            console.error('Failed to get user activity:', error);
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