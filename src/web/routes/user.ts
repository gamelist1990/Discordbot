import { Router, Request, Response } from 'express';
import { BotClient } from '../../core/platform/BotClient.js';
import { verifyAuth, getCurrentUser } from '../middleware/auth.js';
import { userHasAdminOrManageFlag } from './permissionsUtils.js';
import { PermissionFlagsBits } from 'discord.js';
import { SettingsSession } from '../types';
import { PermissionLevel } from '../types/permission.js';
import { ProfileService } from '../services/ProfileService.js';
import { database } from '../../core/persistence/Database.js';
import { publicProfileFields } from '../shared/profileSafety.js';
import fs from 'fs';
import path from 'path';
/**
 * ユーザー関連ルート
 */
export function createUserRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient,
    profileService: ProfileService
): Router {
    const router = Router();
    const profileSearchRequests = new Map<string, number>();

    const getSessionGuildLevel = (session: SettingsSession, guildId: string): number => {
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find((permission) => permission.guildId === guildId);
            if (found) {
                return found.level;
            }
        }

        if (session.guildId === guildId && typeof session.permission === 'number') {
            return session.permission;
        }

        return 0;
    };

    const sessionHasGuildAccess = (session: SettingsSession, guildId: string): boolean => {
        if (session.guildId === guildId) {
            return true;
        }

        if (Array.isArray(session.guildIds) && session.guildIds.includes(guildId)) {
            return true;
        }

        return getSessionGuildLevel(session, guildId) > PermissionLevel.ANY;
    };

    const sessionCanManageGuildUserData = async (session: SettingsSession, guildId: string): Promise<boolean> => {
        if (getSessionGuildLevel(session, guildId) >= PermissionLevel.ADMIN) {
            return true;
        }

        const guild = botClient.client.guilds.cache.get(guildId);
        if (!guild) {
            return false;
        }

        const member = await guild.members.fetch(session.userId).catch(() => null);
        if (!member) {
            return false;
        }

        return (
            member.permissions.has(PermissionFlagsBits.Administrator) ||
            member.permissions.has(PermissionFlagsBits.ManageGuild)
        );
    };

    const sessionCanReadGuildUserData = async (session: SettingsSession, guildId: string): Promise<boolean> => {
        if (sessionHasGuildAccess(session, guildId)) {
            return true;
        }

        const guild = botClient.client.guilds.cache.get(guildId);
        if (!guild) {
            return false;
        }

        const member = await guild.members.fetch(session.userId).catch(() => null);
        return !!member;
    };

    const pickTargetUserId = (req: Request, currentUserId: string): string => {
        const queryUserId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
        if (queryUserId) {
            return queryUserId;
        }

        const bodyUserId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
        return bodyUserId || currentUserId;
    };

    const pickDataKey = (req: Request): string => {
        const queryKey = typeof req.query.key === 'string' ? req.query.key.trim() : '';
        if (queryKey) {
            return queryKey;
        }

        return typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    };

    /**
     * ユーザープロフィールを取得
     * ?userId=<userId> で他のユーザーのプロフィールも取得可能
     */
    router.get('/profile/search', verifyAuth(sessions), async (req: Request, res: Response) => {
        const viewer = getCurrentUser(req);
        const query = typeof req.query.q === 'string' ? req.query.q.trim().replace(/^@/, '') : '';
        if (query.length < 2) { res.json({ users: [] }); return; }
        if (query.length > 80) { res.status(400).json({ error: '検索語は80文字以内で入力してください。' }); return; }
        const now = Date.now();
        if (now - (profileSearchRequests.get(viewer.userId) || 0) < 1000) { res.status(429).json({ error: '検索の間隔を少し空けてください。' }); return; }
        profileSearchRequests.set(viewer.userId, now);
        if (profileSearchRequests.size > 1000) profileSearchRequests.delete(profileSearchRequests.keys().next().value!);
        res.setHeader('Cache-Control', 'private, no-store');
        try {
            const candidates = new Map<string, any>();
            const mutual = new Map<string, any>();
            let searched = 0;
            for (const guild of botClient.client.guilds.cache.values()) {
                const membership = guild.members.cache.get(viewer.userId) || await guild.members.fetch(viewer.userId).catch(() => null);
                if (!membership) continue;
                const matches = (member: any) => [member.user.username, member.displayName, member.id].some(value => String(value).toLowerCase().includes(query.toLowerCase()));
                for (const member of guild.members.cache.values()) if (!member.user.bot) {
                    if (mutual.size < 200) mutual.set(member.id, member.user);
                    if (matches(member)) candidates.set(member.id, member.user);
                }
                if (candidates.size < 20 && searched++ < 5) {
                    const results = /^[1-9]\d{0,19}$/.test(query)
                        ? [await guild.members.fetch(query).catch(() => null)]
                        : [...(await guild.members.fetch({ query, limit: 20 }).catch(() => new Map())).values()];
                    for (const member of results) if (member && !member.user.bot && matches(member)) candidates.set(member.id, member.user);
                }
                if (candidates.size >= 50) break;
            }
            if (candidates.size < 20) {
                const names = await Promise.all([...mutual.values()].filter(user => !candidates.has(user.id)).map(async user => ({ user, profile: await profileService.getCustomProfile(user.id) })));
                for (const item of names) if (item.profile?.privacy?.allowPublicView && item.profile.displayName?.toLowerCase().includes(query.toLowerCase())) candidates.set(item.user.id, item.user);
            }
            const users = (await Promise.all([...candidates.values()].slice(0, 50).map(async user => {
                const custom = await profileService.getCustomProfile(user.id);
                if (user.id !== viewer.userId && !custom?.privacy?.allowPublicView) return null;
                return { id: user.id, username: user.username, displayName: custom?.displayName || user.globalName || user.username,
                    avatar: typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL({ size: 128 }) : null };
            }))).filter(Boolean).slice(0, 20);
            res.json({ users });
        } catch (error) {
            console.error('Profile search failed:', error);
            res.status(503).json({ error: 'ユーザーを検索できませんでした。もう一度お試しください。' });
        }
    });

    router.get('/profile', verifyAuth(sessions), async (req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'private, no-store');
        try {
            const viewer = getCurrentUser(req);
            if (req.query.userId !== undefined && (typeof req.query.userId !== 'string' || req.query.userId.length > 100)) {
                res.status(400).json({ error: 'ユーザーの指定が不正です。' }); return;
            }
            let targetId = typeof req.query.userId === 'string' && req.query.userId ? req.query.userId : viewer.userId;
            if (!/^[1-9]\d{0,19}$/.test(targetId)) {
                const slug = targetId.replace(/^@/, '').split('#')[0].toLowerCase();
                const exact = botClient.client.users.cache.find(user => user.username.toLowerCase() === slug);
                const session = [...sessions.values()].find(item => item.username?.replace(/^@/, '').split('#')[0].toLowerCase() === slug);
                targetId = exact?.id || session?.userId || '';
            }
            if (!/^[1-9]\d{0,19}$/.test(targetId)) { res.status(404).json({ error: 'ユーザーが見つかりません。' }); return; }
            const own = targetId === viewer.userId;
            const customProfile = await profileService.getCustomProfile(targetId);
            if (!own && !customProfile?.privacy?.allowPublicView) { res.status(403).json({ error: 'このプロフィールは非公開です。' }); return; }
            const discordUser = await botClient.client.users.fetch(targetId).catch(() => null);
            if (!discordUser && !own) { res.status(404).json({ error: 'ユーザーが見つかりません。' }); return; }
            const showStats = own || customProfile?.privacy?.showStats === true;
            const showServers = own || customProfile?.privacy?.showServers === true;
            const showActivity = own || customProfile?.privacy?.showActivity === true;
            const guilds: any[] = [];
            const totalStats = { totalMessages: 0, totalLinks: 0, totalMedia: 0, totalServers: 0 };
            if (showStats || showServers) {
                for (const guild of botClient.client.guilds.cache.values()) {
                    if (!own && !await guild.members.fetch(viewer.userId).catch(() => null)) continue;
                    const member = await guild.members.fetch(targetId).catch(() => null);
                    if (!member) continue;
                    const stats = showStats ? await database.getUserGuildData<any>(targetId, guild.id, 'stats', null).catch(() => null) : null;
                    const numbers = { totalMessages: stats?.totalMessages || 0, linkMessages: stats?.linkMessages || 0, mediaMessages: stats?.mediaMessages || 0 };
                    totalStats.totalMessages += numbers.totalMessages;
                    totalStats.totalLinks += numbers.linkMessages;
                    totalStats.totalMedia += numbers.mediaMessages;
                    if (showServers) {
                        totalStats.totalServers++;
                        guilds.push({ id: guild.id, name: guild.name, iconURL: guild.iconURL(), ...numbers, viewerIsMember: true,
                            role: member.roles.highest.name, joinedAt: member.joinedAt?.toISOString() });
                    }
                }
            }
            res.json({
                id: targetId, username: discordUser?.username || viewer.username?.split('#')[0] || targetId,
                discriminator: discordUser?.discriminator || '0',
                avatar: discordUser?.displayAvatarURL({ size: 256 }) || null,
                isOwnProfile: own, visibility: { stats: showStats, servers: showServers, activity: showActivity },
                guilds, totalStats, customProfile: own ? customProfile || undefined : publicProfileFields(customProfile),
            });
        } catch (error) {
            console.error('Failed to get user profile:', error);
            res.status(500).json({ error: 'プロフィールを読み込めませんでした。' });
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
            const statsMgr = (await import('../../core/stats/StatsManager.js')).statsManagerSingleton.instance;

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
     * ユーザーごとのギルドデータを取得
     * ?userId=<userId>&key=<key>
     */
    router.get('/guilds/:guildId/data', verifyAuth(sessions), async (req: Request, res: Response) => {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { guildId } = req.params;
            const targetUserId = pickTargetUserId(req, currentUser.userId);
            const key = pickDataKey(req);
            const canRead = await sessionCanReadGuildUserData(currentUser, guildId);
            const canManage = await sessionCanManageGuildUserData(currentUser, guildId);

            if (!canRead && !canManage) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            if (targetUserId !== currentUser.userId && !canManage) {
                res.status(403).json({ error: 'Manage Guild permission required' });
                return;
            }

            if (key) {
                if (!(await database.hasUserGuildData(targetUserId, guildId, key))) {
                    res.status(404).json({ error: 'User guild data not found' });
                    return;
                }

                const value = await database.getUserGuildData(targetUserId, guildId, key, null);
                res.json({
                    guildId,
                    userId: targetUserId,
                    key,
                    value
                });
                return;
            }

            const data = await database.getAllUserGuildData(targetUserId, guildId);
            res.json({
                guildId,
                userId: targetUserId,
                data
            });
        } catch (error) {
            console.error('Failed to get guild user data:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * 管理権限ユーザー向け: ギルド内ユーザーデータの一覧取得
     * ?key=stats
     */
    router.get('/guilds/:guildId/data-map', verifyAuth(sessions), async (req: Request, res: Response) => {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { guildId } = req.params;
            const key = pickDataKey(req) || 'stats';

            if (!(await sessionCanManageGuildUserData(currentUser, guildId))) {
                res.status(403).json({ error: 'Manage Guild permission required' });
                return;
            }

            const users = await database.getGuildUserDataMap(guildId, key);
            res.json({
                guildId,
                key,
                users
            });
        } catch (error) {
            console.error('Failed to get guild user data map:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * 管理権限ユーザー向け: ユーザーごとのギルドデータを更新
     */
    router.put('/guilds/:guildId/data', verifyAuth(sessions), async (req: Request, res: Response) => {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { guildId } = req.params;
            const targetUserId = pickTargetUserId(req, currentUser.userId);
            const key = pickDataKey(req);

            if (!key) {
                res.status(400).json({ error: 'key is required' });
                return;
            }

            if (req.body?.value === undefined) {
                res.status(400).json({ error: 'value is required' });
                return;
            }

            if (!(await sessionCanManageGuildUserData(currentUser, guildId))) {
                res.status(403).json({ error: 'Manage Guild permission required' });
                return;
            }

            await database.setUserGuildData(targetUserId, guildId, key, req.body.value);
            res.json({
                success: true,
                guildId,
                userId: targetUserId,
                key
            });
        } catch (error) {
            console.error('Failed to update guild user data:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * 管理権限ユーザー向け: ユーザーごとのギルドデータを削除
     */
    router.delete('/guilds/:guildId/data', verifyAuth(sessions), async (req: Request, res: Response) => {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { guildId } = req.params;
            const targetUserId = pickTargetUserId(req, currentUser.userId);
            const key = pickDataKey(req);

            if (!key) {
                res.status(400).json({ error: 'key is required' });
                return;
            }

            if (!(await sessionCanManageGuildUserData(currentUser, guildId))) {
                res.status(403).json({ error: 'Manage Guild permission required' });
                return;
            }

            const deleted = await database.deleteUserGuildData(targetUserId, guildId, key);
            res.json({
                success: deleted,
                guildId,
                userId: targetUserId,
                key
            });
        } catch (error) {
            console.error('Failed to delete guild user data:', error);
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
            const authPersistPath = path.join(database.getDataDir(), 'system', 'auth', 'sessions.json');
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
                        userGuilds = guilds.filter(g => userHasAdminOrManageFlag(g));
                    }
                } catch (e) {
                    console.warn('[UserGuilds] Error fetching user guilds:', e);
                }
            }

            // Botが参加しているサーバーのみ返す
            const botGuildIds = new Set(botGuilds.map(g => g.id));

            // If OAuth fetch result is empty, fallback to session's guild list
            if ((!userGuilds || userGuilds.length === 0) && user) {
                console.warn('[UserGuilds] OAuth guilds empty; falling back to session.guildIds/permissions');
                const sessionGuildIds: string[] = [];
                if (Array.isArray((user as any).guildIds) && (user as any).guildIds.length > 0) {
                    (sessionGuildIds as string[]).push(...(user as any).guildIds);
                } else if ((user as any).guildId) {
                    sessionGuildIds.push((user as any).guildId);
                }

                const sessionPermMap = new Map<string, number>();
                ((user as any).permissions || []).forEach((p: any) => {
                    if (p && p.guildId) sessionPermMap.set(p.guildId, p.level);
                });

                userGuilds = sessionGuildIds
                    .filter(gid => botGuildIds.has(gid))
                    // require ADMIN level (>=2) for management view
                    .filter(gid => {
                        const lvl = sessionPermMap.get(gid) ?? (user as any).permission ?? 0;
                        return typeof lvl === 'number' ? lvl >= 2 : Number(lvl) >= 2;
                    })
                    .map(gid => {
                        const bg = botGuilds.find(bg => bg.id === gid);
                        const lvl = (user as any).permissions?.find((p: any) => p.guildId === gid)?.level ?? (user as any).permission ?? 0;
                        const isOwner = Array.isArray((user as any).owners) ? (user as any).owners.includes((user as any).userId) : (lvl >= 3);
                        const permsNum = lvl >= 3 ? Number(PermissionFlagsBits.Administrator) : (lvl >= 2 ? Number(((PermissionFlagsBits as any).ManageGuild || 0)) : 0);
                        if (bg) return { id: bg.id, name: bg.name, icon: bg.icon, memberCount: bg.memberCount, owner: isOwner, permissions: permsNum };
                        return { id: gid, name: gid, icon: undefined, memberCount: 0, owner: isOwner, permissions: permsNum };
                    });
            }

            const filtered = userGuilds.filter(g => botGuildIds.has(g.id));

            // Sanitize guild objects to avoid BigInt values (e.g., PermissionFlagsBits)
            const safeGuilds = filtered.map(g => ({
                id: g.id,
                name: g.name,
                icon: (g as any).icon ?? null,
                memberCount: Number((g as any).memberCount || 0),
                owner: Boolean((g as any).owner || false),
                permissions: Number(((g as any).permissions !== undefined) ? (g as any).permissions : 0)
            }));

            res.json({ guilds: safeGuilds });
        } catch (error) {
            console.error('Failed to get user guilds:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * Get available emojis/stickers from mutual guilds the bot and user share
     * GET /api/user/emojis
     */
    router.get('/emojis', verifyAuth(sessions), async (req: Request, res: Response) => {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) return res.status(401).json({ error: 'Unauthorized' });

            const botGuilds = botClient.getGuildList();

            const result: Array<{ guildId: string; guildName: string; emojis: Array<{ id?: string; name?: string; url?: string; animated?: boolean; char?: string }> }> = [];

            for (const g of botGuilds) {
                try {
                    const guildObj = botClient.client.guilds.cache.get(g.id as string);
                    if (!guildObj) continue;
                    // try to find if user is in this guild (best-effort)
                    let memberPresent = false;
                    try {
                        const member = await guildObj.members.fetch(currentUser.userId).catch(() => null);
                        if (member) memberPresent = true;
                    } catch {
                        // ignore
                    }
                    if (!memberPresent) continue;

                    const emojisArr: any[] = [];
                    try {
                        // use cached emojis
                        for (const e of guildObj.emojis.cache.values()) {
                            const url = e.url || `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}`;
                            emojisArr.push({ id: e.id, name: e.name, url, animated: e.animated });
                        }
                    } catch (e) {
                        // ignore per-guild emoji errors
                    }

                    if (emojisArr.length > 0) {
                        result.push({ guildId: g.id, guildName: g.name, emojis: emojisArr });
                    }
                } catch (e) {
                    // ignore
                }
            }

            res.json({ guilds: result });
        } catch (error) {
            console.error('Failed to list guild emojis:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    return router;
}
