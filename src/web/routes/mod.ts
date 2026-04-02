import { Router, Request, Response } from 'express';
import { BotClient } from '../../core/BotClient.js';
import { verifyAuth, getCurrentUser, getSessionGuildPermissionLevel, isGuildAccessible } from '../middleware/auth.js';
import { SettingsSession } from '../types';
import { database } from '../../core/Database.js';
import { PermissionLevel } from '../types/permission.js';

export function createModRoutes(sessions: Map<string, SettingsSession>, botClient: BotClient) {
    const router = Router();

    // Return moderation overview for a guild
    router.get('/:guildId/modinfo', verifyAuth(sessions), async (req: Request, res: Response) => {
        try {
            const session = getCurrentUser(req);
            const guildId = req.params.guildId;

            const guild = botClient.client.guilds.cache.get(guildId as string);
            if (!guild) return res.status(404).json({ error: 'Guild not found' });

            if (!session) return res.status(401).json({ error: 'Unauthorized' });

            if (!isGuildAccessible(session, guildId)) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            let allowed = getSessionGuildPermissionLevel(session, guildId) >= PermissionLevel.STAFF;
            if (!allowed) {
                try {
                    const member = await guild.members.fetch(session.userId).catch(() => null);
                    if (member) {
                        const settings = await database.get<any>(guildId, `Guild/${guildId}/settings`);
                        if (settings) {
                            if (settings.adminRoleId && member.roles.cache.has(settings.adminRoleId)) {
                                allowed = true;
                            } else if (settings.staffRoleId && member.roles.cache.has(settings.staffRoleId)) {
                                allowed = true;
                            }
                        }
                    }
                } catch (e) {
                    // keep denied
                }
            }

            if (!allowed) return res.status(403).json({ error: 'Forbidden' });

            // Roles
            const roles = Array.from(guild.roles.cache.values()).map(r => ({
                id: r.id,
                name: r.name,
                color: r.hexColor,
                position: r.position,
                // permissions.bitfield may be a BigInt; convert to string for JSON safety
                permissions: typeof r.permissions.bitfield === 'bigint' ? r.permissions.bitfield.toString() : r.permissions.bitfield
            }));

            // Member count
            const memberCount = guild.memberCount;

            // Audit logs (limited)
            let auditLogs: any[] = [];
            try {
                const logs = await guild.fetchAuditLogs({ limit: 50 });
                auditLogs = Array.from(logs.entries.values()).slice(0, 50).map((e: any) => ({
                    id: e.id,
                    action: e.action,
                    targetId: e.targetId,
                    executorId: e.executor?.id,
                    reason: e.reason,
                    createdAt: e.createdAt
                }));
            } catch (e) {
                // may lack permission to view audit logs
            }

            // Bans (limited)
            let bans: any[] = [];
            try {
                const b = await guild.bans.fetch();
                bans = Array.from(b.values()).map(bi => ({ userId: bi.user.id, reason: bi.reason }));
            } catch (e) {
                // may lack ban read permission
            }

            // Read persisted per-user stats and compute guild aggregates (if present)
            let guildAggregates = { totalMessages: 0, totalLinks: 0, totalMedia: 0 };
            let topUsers: Array<{ userId: string; totalMessages: number; linkMessages: number; mediaMessages: number }> = [];
            try {
                const userStatsMap = await database.getGuildUserDataMap<{
                    totalMessages?: number;
                    linkMessages?: number;
                    mediaMessages?: number;
                }>(guildId, 'stats');

                for (const [uid, stats] of Object.entries(userStatsMap)) {
                    const tm = stats.totalMessages || 0;
                    const tl = stats.linkMessages || 0;
                    const im = stats.mediaMessages || 0;
                    guildAggregates.totalMessages += tm;
                    guildAggregates.totalLinks += tl;
                    guildAggregates.totalMedia += im;
                    topUsers.push({ userId: uid, totalMessages: tm, linkMessages: tl, mediaMessages: im });
                }
                // sort by totalMessages desc and keep top 20
                topUsers.sort((a, b) => b.totalMessages - a.totalMessages);
                topUsers = topUsers.slice(0, 20);
            } catch (e) {
                // ignore if no persisted stats
            }

            res.json({ roles, memberCount, auditLogs, bans, guildAggregates, topUsers });
        } catch (error) {
            console.error('modinfo error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Return member info (roles, joinedAt)
    router.get('/:guildId/members/:userId', verifyAuth(sessions), async (req: Request, res: Response) => {
        try {
            const session = getCurrentUser(req);
            const guildId = req.params.guildId;
            const userId = req.params.userId;

            const guild = botClient.client.guilds.cache.get(guildId as string);
            if (!guild) return res.status(404).json({ error: 'Guild not found' });

            if (!session) return res.status(401).json({ error: 'Unauthorized' });

            if (!isGuildAccessible(session, guildId)) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            let allowedMember = getSessionGuildPermissionLevel(session, guildId) >= PermissionLevel.STAFF;
            if (!allowedMember) {
                try {
                    const m = await guild.members.fetch(session.userId).catch(() => null);
                    if (m) {
                        const settings = await database.get<any>(guildId, `Guild/${guildId}/settings`);
                        if (settings) {
                            if (settings.adminRoleId && m.roles.cache.has(settings.adminRoleId)) {
                                allowedMember = true;
                            } else if (settings.staffRoleId && m.roles.cache.has(settings.staffRoleId)) {
                                allowedMember = true;
                            }
                        }
                    }
                } catch (e) {
                    // keep denied
                }
            }

            if (!allowedMember) return res.status(403).json({ error: 'Forbidden' });

            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) return res.status(404).json({ error: 'Member not found' });

            const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name);
            const joinedAt = member.joinedAt ? member.joinedAt.toISOString() : null;

            res.json({ userId: member.id, displayName: member.displayName, roles, joinedAt });
        } catch (error) {
            console.error('member info error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}
