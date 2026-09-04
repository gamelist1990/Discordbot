import { Request, Response } from 'express';
import { BotClient } from '../../../core/platform/BotClient.js';
import { antiCheatManager } from '../../../core/anticheat/AntiCheatManager.js';
import { PunishmentExecutor } from '../../../core/anticheat/PunishmentExecutor.js';
import { GuildAntiCheatSettings, PunishmentAction } from '../../../core/anticheat/types.js';
import { Logger } from '../../../utils/Logger.js';
import { TextChannel, PermissionFlagsBits } from 'discord.js';
import { validateExclusions } from '../../../core/anticheat/ExclusionPolicy.js';

/**
 * AntiCheat Controller
 * Handles AntiCheat-related web API endpoints
 */
export class AntiCheatController {
    constructor(private botClient: BotClient) {}
    getExclusionTargets = async (req: Request, res: Response): Promise<void> => {
        const guildId = String(req.params.guildId);
        if (!hasAccessToGuild((req as any).session || {}, guildId)) { res.status(403).json({ error: 'Access denied to this guild' }); return; }
        const targetId = req.query.targetId;
        if (targetId !== undefined && (typeof targetId !== 'string' || !/^[1-9]\d{0,19}$/.test(targetId))) { res.status(400).json({ error: 'IDが不正です。' }); return; }
        try {
            const guild = await this.botClient.client.guilds.fetch(guildId);
            const [roles, channels] = await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
            // Include cached threads and allow an explicitly entered archived/private thread ID to be resolved.
            const available = new Map([...guild.channels.cache, ...channels]);
            if (typeof targetId === 'string' && !available.has(targetId) && !roles.has(targetId)) {
                const channel = await guild.channels.fetch(targetId).catch(() => null);
                if (channel?.guildId === guildId) available.set(channel.id, channel);
            }
            res.json({
                roles: roles.map(role => ({ id: role.id, name: role.name, kind: 'role', type: 'ロール' })),
                channels: [...available.values()].filter(channel => channel && channel.guildId === guildId).map(channel => ({
                    id: channel!.id, name: channel!.name, kind: 'channel',
                    type: ({ 0: 'テキスト', 2: 'ボイス', 4: 'カテゴリ', 5: 'アナウンス', 10: 'スレッド', 11: 'スレッド', 12: '非公開スレッド', 13: 'ステージ', 15: 'フォーラム', 16: 'メディア' } as Record<number, string>)[channel!.type] || 'チャンネル'
                }))
            });
        } catch (error) {
            Logger.error('Failed to load AntiCheat exclusion targets:', error);
            res.status(503).json({ error: 'ロール・チャンネル一覧を取得できませんでした。' });
        }
    };
    clearContentCache = async (req: Request, res: Response): Promise<void> => {
        const guildId = String(req.params.guildId);
        const session = (req as any).session;
        if (!session || !hasAccessToGuild(session, guildId)) { res.status(403).json({ error: 'Access denied to this guild' }); return; }
        res.json({ success: true, removed: antiCheatManager.clearContentCache(guildId) });
    };

    /**
     * GET /api/staff/anticheat/:guildId/settings
     * Get guild AntiCheat settings
     */
    getSettings = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;

            // Verify user has access to this guild
            const session = (req as any).session;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const settings = await antiCheatManager.getSettings(guildId);
            const userTrust = await antiCheatManager.getAllUserTrust(guildId);

            res.json({
                settings,
                userTrustCount: Object.keys(userTrust).length
            });
        } catch (error) {
            Logger.error('Error getting AntiCheat settings:', error);
            res.status(500).json({ error: 'Failed to get settings' });
        }
    };

    /**
     * POST /api/staff/anticheat/:guildId/settings
     * Update guild AntiCheat settings
     */
    updateSettings = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const updates: Partial<GuildAntiCheatSettings> = req.body;

            // Verify user has access to this guild
            const session = (req as any).session;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            // Get current settings
            const currentSettings = await antiCheatManager.getSettings(guildId);
            if (updates.excludedRoles !== undefined || updates.excludedChannels !== undefined || updates.channelDetectorExclusions !== undefined) {
                const guild = await this.botClient.client.guilds.fetch(guildId);
                const error = await validateExclusions(updates, currentSettings, guild);
                if (error) { res.status(400).json({ error }); return; }
            }
            const newSettings: GuildAntiCheatSettings = antiCheatManager.mergeSettings(currentSettings, {
                ...updates,
                userTrust: currentSettings.userTrust,
                recentLogs: currentSettings.recentLogs
            });

            await antiCheatManager.setSettings(guildId, newSettings);

            res.json({ 
                success: true,
                settings: newSettings
            });
        } catch (error) {
            Logger.error('Error updating AntiCheat settings:', error);
            res.status(500).json({ error: 'Failed to update settings' });
        }
    };

    /**
     * GET /api/staff/anticheat/:guildId/logs
     * Get detection logs for a guild
     */
    getLogs = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const limit = parseInt(req.query.limit as string) || 50;
            const before = req.query.before as string | undefined;

            // Verify user has access to this guild
            const session = (req as any).session;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const logs = await antiCheatManager.getLogs(guildId, limit, before);

            res.json({ logs });
        } catch (error) {
            Logger.error('Error getting AntiCheat logs:', error);
            res.status(500).json({ error: 'Failed to get logs' });
        }
    };

    /**
     * POST /api/staff/anticheat/:guildId/action
     * Execute a manual punishment action
     */
    executeAction = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const { userId, action } = req.body as { userId: string; action: PunishmentAction };

            // Verify user has access to this guild
            const session = (req as any).session;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            // Get guild and member
            const guild = await this.botClient.client.guilds.fetch(guildId);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                res.status(404).json({ error: 'Member not found' });
                return;
            }

            // Get log channel
            const settings = await antiCheatManager.getSettings(guildId);
            const logChannel = settings.logChannelId
                ? (await guild.channels.fetch(settings.logChannelId).catch(() => null)) as TextChannel | null
                : null;

            // Check bot permissions based on action type
            let requiredPermission: bigint | null = null;
            switch (action.type) {
                case 'timeout':
                    requiredPermission = PermissionFlagsBits.ModerateMembers;
                    break;
                case 'kick':
                    requiredPermission = PermissionFlagsBits.KickMembers;
                    break;
                case 'ban':
                    requiredPermission = PermissionFlagsBits.BanMembers;
                    break;
            }
            if (requiredPermission && !guild.members.me?.permissions.has(requiredPermission)) {
                const permName = requiredPermission === PermissionFlagsBits.ModerateMembers ? 'Moderate Members' :
                                requiredPermission === PermissionFlagsBits.KickMembers ? 'Kick Members' : 'Ban Members';
                res.status(403).json({ error: `Bot lacks ${permName} permission to execute this action` });
                return;
            }

            // Execute action
            const success = await PunishmentExecutor.execute(member, action, logChannel);

            if (success) {
                res.json({ success: true, message: 'Action executed successfully' });
            } else {
                res.status(500).json({ error: 'Failed to execute action' });
            }
        } catch (error) {
            Logger.error('Error executing AntiCheat action:', error);
            res.status(500).json({ error: 'Failed to execute action' });
        }
    };

    /**
     * POST /api/staff/anticheat/:guildId/revoke
     * Revoke a timeout and optionally reset trust score
     */
    revokeTimeout = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const { userId, resetTrust, messageId } = req.body as { userId: string; resetTrust?: boolean; messageId?: string };

            // Verify user has access to this guild
            const session = (req as any).session;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            // Get guild and member
            const guild = await this.botClient.client.guilds.fetch(guildId);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                res.status(404).json({ error: 'Member not found' });
                return;
            }

            // Get log channel
            const settings = await antiCheatManager.getSettings(guildId);
            const logChannel = settings.logChannelId
                ? (await guild.channels.fetch(settings.logChannelId).catch(() => null)) as TextChannel | null
                : null;

            // Check bot permissions
            if (!guild.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                res.status(403).json({ error: 'Bot lacks Moderate Members permission to revoke timeouts' });
                return;
            }

            // Revoke related log if messageId provided
            if (messageId) {
                await antiCheatManager.revokeLog(guildId, messageId);
            }

            // Revoke timeout
            const success = await PunishmentExecutor.revokeTimeout(member, logChannel);

            // Reset trust if requested
            if (success && resetTrust) {
                await antiCheatManager.resetTrust(guildId, userId);
            }

            if (success) {
                res.json({ 
                    success: true, 
                    message: 'Timeout revoked successfully',
                    trustReset: resetTrust || false,
                    logRevoked: !!messageId
                });
            } else {
                res.status(500).json({ error: 'Failed to revoke timeout' });
            }
        } catch (error) {
            Logger.error('Error revoking timeout:', error);
            res.status(500).json({ error: 'Failed to revoke timeout' });
        }
    };

    /**
     * POST /api/staff/anticheat/:guildId/reset-trust
     * Reset trust score for a user
     */
    resetTrust = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const { userId } = req.body as { userId: string };

            // Verify user has access to this guild
            const session = (req as any).session;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            await antiCheatManager.resetTrust(guildId, userId);

            res.json({ 
                success: true, 
                message: 'Trust score reset successfully'
            });
        } catch (error) {
            Logger.error('Error resetting trust:', error);
            res.status(500).json({ error: 'Failed to reset trust' });
        }
    };

    /**
     * GET /api/staff/anticheat/:guildId/user-timeout/:userId
     * Get timeout status for a user
     */
    getUserTimeoutStatus = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, userId } = req.params;

            // Verify user has access to this guild
            const session = (req as any).session;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            // Get guild and member
            const guild = await this.botClient.client.guilds.fetch(guildId);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                res.status(404).json({ error: 'Member not found' });
                return;
            }

            // Check if user is currently timed out
            const isTimedOut = member.communicationDisabledUntil !== null;
            const timeoutUntil = member.communicationDisabledUntil ? member.communicationDisabledUntil.toISOString() : null;

            res.json({
                userId,
                isTimedOut,
                timeoutUntil
            });
        } catch (error) {
            Logger.error('Error getting user timeout status:', error);
            res.status(500).json({ error: 'Failed to get timeout status' });
        }
    };

    /**
     * GET /api/staff/anticheat/:guildId/active-timeouts
     * Get users who are currently timed out
     */
    getActiveTimeouts = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;

            const session = (req as any).session;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const members = await guild.members.fetch().catch(() => null);
            if (!members) {
                res.status(500).json({ error: 'Failed to fetch guild members' });
                return;
            }

            const settings = await antiCheatManager.getSettings(guildId);
            const trustMap = settings.userTrust || {};
            const logs = settings.recentLogs || [];
            const now = Date.now();

            const activeTimeouts = Array.from(members.values())
                .filter((member) => {
                    const until = member.communicationDisabledUntil?.getTime?.() || 0;
                    return until > now;
                })
                .map((member) => {
                    const timeoutUntil = member.communicationDisabledUntil?.toISOString() || null;
                    const userLogs = logs
                        .filter((entry) => entry.userId === member.id && entry.metadata?.isTimedOut)
                        .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
                    const latestTimeoutLog = userLogs[0] || null;
                    const trust = trustMap[member.id];

                    return {
                        userId: member.id,
                        username: member.user.username,
                        displayName: member.displayName || member.user.username,
                        avatar: member.user.avatarURL(),
                        timeoutUntil,
                        remainingMs: timeoutUntil ? Math.max(0, new Date(timeoutUntil).getTime() - now) : 0,
                        trustScore: trust?.score || 0,
                        lastUpdated: trust?.lastUpdated || null,
                        sourceMessageId: latestTimeoutLog?.messageId || null,
                        sourceDetector: latestTimeoutLog?.detector || null,
                        sourceReason: latestTimeoutLog?.reason || null
                    };
                })
                .sort((left, right) => new Date(left.timeoutUntil || 0).getTime() - new Date(right.timeoutUntil || 0).getTime());

            res.json({ activeTimeouts });
        } catch (error) {
            Logger.error('Error getting active timeouts:', error);
            res.status(500).json({ error: 'Failed to get active timeouts' });
        }
    };
    getUserTrust = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const { userId } = req.query;

            // Verify user has access to this guild
            const session = (req as any).session;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            if (userId) {
                // Get specific user trust
                const trust = await antiCheatManager.getUserTrust(guildId, userId as string);
                res.json({ userId, trust });
            } else {
                // Get all user trust with usernames
                const allTrust = await antiCheatManager.getAllUserTrust(guildId);
                
                // Get guild to fetch user information
                const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
                if (!guild) {
                    res.json({ userTrust: allTrust });
                    return;
                }

                // Add usernames to trust data
                const userTrustWithNames: Record<string, any> = {};
                for (const [userId, trustData] of Object.entries(allTrust)) {
                    try {
                        const member = await guild.members.fetch(userId).catch(() => null);
                        userTrustWithNames[userId] = {
                            ...trustData,
                            username: member ? member.user.username : '不明',
                            displayName: member ? member.displayName : '不明',
                            avatar: member ? member.user.avatarURL() : null
                        };
                    } catch (error) {
                        // User not found or other error
                        userTrustWithNames[userId] = {
                            ...trustData,
                            username: '不明',
                            displayName: '不明',
                            avatar: null
                        };
                    }
                }

                res.json({ userTrust: userTrustWithNames });
            }
        } catch (error) {
            Logger.error('Error getting user trust:', error);
            res.status(500).json({ error: 'Failed to get user trust' });
        }
    };

}

/**
 * Backwards-compatible guild access check.
 * Accepts older debug sessions (session.guildId), array of IDs (session.guildIds),
 * or the richer session.guilds array (objects with `id` property) produced by OAuth.
 */
function hasAccessToGuild(session: any, guildId: string): boolean {
    try {
        if (!guildId) return false;
        if (session.guildId && session.guildId === guildId) return true;
        if (Array.isArray(session.guildIds) && session.guildIds.includes(guildId)) return true;
        if (Array.isArray(session.guilds) && session.guilds.some((g: any) => g && (g.id === guildId || g.guildId === guildId))) return true;
        // Also support permissions array entries
        if (Array.isArray(session.permissions) && session.permissions.some((p: any) => p && p.guildId === guildId)) return true;
    } catch (e) {
        // ignore and deny
    }
    return false;
}
