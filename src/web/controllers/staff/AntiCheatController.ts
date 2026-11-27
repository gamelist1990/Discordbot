import { getLiveGuildManagementLevel } from '../../middleware/liveGuildAccess.js';
import { Request, Response } from 'express';
import { BotClient } from '../../../core/platform/BotClient.js';
import { antiCheatManager } from '../../../core/anticheat/AntiCheatManager.js';
import { PunishmentExecutor } from '../../../core/anticheat/PunishmentExecutor.js';
import { GuildAntiCheatSettings, PunishmentAction } from '../../../core/anticheat/types.js';
import { Logger } from '../../../utils/Logger.js';
import { TextChannel, PermissionFlagsBits } from 'discord.js';
import { validateExclusions } from '../../../core/anticheat/ExclusionPolicy.js';
import { snapshotManager } from '../../../core/anticheat/SnapshotManager.js';

/** Runtime state is exposed by dedicated endpoints and must not be echoed into
 * the editable settings document. Apart from leaking history to the browser,
 * echoing it made subsequent saves grow past Express' request-body limit. */
function editableSettings(
    settings: GuildAntiCheatSettings
): Omit<GuildAntiCheatSettings, 'userTrust' | 'recentLogs' | 'watchUsers'> {
    const { userTrust: _userTrust, recentLogs: _recentLogs, watchUsers: _watchUsers, ...editable } = settings;
    return editable;
}

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
        if (!session || !(await hasGuildMutationAccess(this.botClient, session, guildId))) { res.status(403).json({ error: 'Access denied to this guild' }); return; }
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
                settings: editableSettings(settings),
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
            if (!session || !(await hasGuildMutationAccess(this.botClient, session, guildId))) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            if (updates.aiLogChannelId !== undefined && updates.aiLogChannelId !== null) {
                if (typeof updates.aiLogChannelId !== 'string' || !/^[1-9]\d{0,19}$/.test(updates.aiLogChannelId)) {
                    res.status(400).json({ error: 'AI判定ログチャンネルIDが不正です。' }); return;
                }
                const guild = await this.botClient.client.guilds.fetch(guildId);
                const channel = await guild.channels.fetch(updates.aiLogChannelId).catch(() => null);
                const me = guild.members.me || await guild.members.fetchMe();
                const permissions = channel?.permissionsFor(me);
                if (!channel?.isTextBased() || !('send' in channel) || !permissions?.has([
                    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles,
                ])) {
                    res.status(400).json({ error: 'AI判定ログには、Botが閲覧・送信・埋め込み・ファイル添付できるテキストチャンネルを指定してください。' }); return;
                }
            }
            const contentConfig = updates.detectors?.contentSafety?.config;
            if (contentConfig) {
                for (const key of ['customRulesChannelId', 'customRulesMessageId']) {
                    const value = contentConfig[key];
                    if (value !== undefined && value !== '' && (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value))) {
                        res.status(400).json({ error: `${key === 'customRulesChannelId' ? '独自ルールのチャンネル' : '独自ルールのメッセージ'}IDが不正です。` }); return;
                    }
                }
                if (contentConfig.customRulesChannelId && contentConfig.customRulesMessageId) {
                    const guild = await this.botClient.client.guilds.fetch(guildId);
                    const channel = await guild.channels.fetch(contentConfig.customRulesChannelId).catch(() => null);
                    const ruleMessage = channel?.isTextBased() && 'messages' in channel
                        ? await channel.messages.fetch(contentConfig.customRulesMessageId).catch(() => null) : null;
                    if (!ruleMessage?.content.trim()) {
                        res.status(400).json({ error: '独自ルールのメッセージを取得できないか、本文が空です。Botの閲覧権限とIDを確認してください。' }); return;
                    }
                }
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
                watchUsers: currentSettings.watchUsers,
                recentLogs: currentSettings.recentLogs
            });

            await antiCheatManager.setSettings(guildId, newSettings);

            res.json({ 
                success: true,
                settings: editableSettings(newSettings)
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
            if (!session || !(await hasGuildMutationAccess(this.botClient, session, guildId))) {
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
            if (!session || !(await hasGuildMutationAccess(this.botClient, session, guildId))) {
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
            if (!session || !(await hasGuildMutationAccess(this.botClient, session, guildId))) {
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

    /**
     * GET /api/staff/anticheat/:guildId/watch-users
     * 警戒ユーザー (watch tier) entries with the resolving member names.
     */
    getWatchUsers = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const session = (req as any).session;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const entries = await antiCheatManager.getWatchUsers(guildId);
            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            const watchUsers: Array<Record<string, unknown>> = [];
            for (const entry of entries) {
                const member = guild?.members.cache?.get(entry.userId)
                    || (guild ? await guild.members.fetch(entry.userId).catch(() => null) : null);
                watchUsers.push({
                    ...entry,
                    username: member?.user.username || '不明',
                    displayName: member?.displayName || entry.nameSnapshot || '不明',
                    avatar: member?.user.avatarURL() || null
                });
            }

            res.json({ watchUsers });
        } catch (error) {
            Logger.error('Error getting watch users:', error);
            res.status(500).json({ error: 'Failed to get watch users' });
        }
    };

    /**
     * POST /api/staff/anticheat/:guildId/watch-users/:userId/dismiss
     * Staff dismissal: the current name snapshot is not re-flagged.
     */
    dismissWatchUser = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, userId } = req.params;
            const session = (req as any).session;
            if (!session || !(await hasGuildMutationAccess(this.botClient, session, guildId))) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }
            if (!/^[1-9]\d{0,19}$/.test(String(userId))) {
                res.status(400).json({ error: 'IDが不正です。' });
                return;
            }

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
            const dismissed = await antiCheatManager.dismissWatchUser(guildId, userId, member?.displayName);
            if (!dismissed) {
                res.status(404).json({ error: '警戒ユーザーが見つかりません。' });
                return;
            }

            res.json({ success: true });
        } catch (error) {
            Logger.error('Error dismissing watch user:', error);
            res.status(500).json({ error: 'Failed to dismiss watch user' });
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

    // ------------------------------------------------------------------
    // AntiNuke snapshots / restore (brief AN2)
    // ------------------------------------------------------------------

    /**
     * GET /api/staff/anticheat/:guildId/antinuke/snapshots
     * Snapshot list + recent restore jobs.
     */
    listSnapshots = async (req: Request, res: Response): Promise<void> => {
        const guildId = String(req.params.guildId);
        const session = (req as any).session;
        if (!session || !hasAccessToGuild(session, guildId)) {
            res.status(403).json({ error: 'Access denied to this guild' });
            return;
        }
        try {
            const [index, jobs] = await Promise.all([
                snapshotManager.listSnapshots(guildId),
                snapshotManager.listJobs(guildId)
            ]);
            res.json({
                snapshots: index.snapshots,
                latestSnapshotId: index.latestSnapshotId,
                restores: jobs,
                restoring: snapshotManager.isRestoring(guildId)
            });
        } catch (error) {
            Logger.error('Error listing AntiNuke snapshots:', error);
            res.status(500).json({ error: 'スナップショット一覧を取得できませんでした。' });
        }
    };

    /**
     * POST /api/staff/anticheat/:guildId/antinuke/snapshots
     * On-demand capture (staff action).
     */
    captureSnapshot = async (req: Request, res: Response): Promise<void> => {
        const guildId = String(req.params.guildId);
        const session = (req as any).session;
        if (!session || !(await hasGuildMutationAccess(this.botClient, session, guildId))) {
            res.status(403).json({ error: 'Access denied to this guild' });
            return;
        }
        try {
            const guild = await this.botClient.client.guilds.fetch(guildId);
            const requestedBy = typeof session.userId === 'string' ? session.userId : null;
            const snapshot = await snapshotManager.captureAndStore(guild, 'manual', requestedBy);
            res.json({
                success: true,
                snapshot: {
                    id: snapshot.id,
                    createdAt: snapshot.createdAt,
                    trigger: snapshot.trigger,
                    counts: snapshot.counts,
                    warnings: snapshot.warnings
                }
            });
        } catch (error) {
            Logger.error('Error capturing AntiNuke snapshot:', error);
            res.status(500).json({ error: 'スナップショットを取得できませんでした。' });
        }
    };

    /**
     * GET /api/staff/anticheat/:guildId/antinuke/restore/preview?snapshotId=…
     * Pre-restore summary: age, recreate counts, unban diff, limitations.
     */
    previewRestore = async (req: Request, res: Response): Promise<void> => {
        const guildId = String(req.params.guildId);
        const session = (req as any).session;
        if (!session || !hasAccessToGuild(session, guildId)) {
            res.status(403).json({ error: 'Access denied to this guild' });
            return;
        }
        const snapshotId = String(req.query.snapshotId || '');
        if (!snapshotId) {
            res.status(400).json({ error: 'snapshotId が必要です。' });
            return;
        }
        try {
            const guild = await this.botClient.client.guilds.fetch(guildId);
            const preview = await snapshotManager.previewRestore(guild, snapshotId, readIncidentIds(req.query.incidentId));
            res.json({ preview });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'プレビューを取得できませんでした。';
            Logger.error('Error previewing AntiNuke restore:', error);
            res.status(400).json({ error: message });
        }
    };

    /**
     * POST /api/staff/anticheat/:guildId/antinuke/restore
     * Starts a tracked background restore; poll the job for progress.
     */
    startRestore = async (req: Request, res: Response): Promise<void> => {
        const guildId = String(req.params.guildId);
        const session = (req as any).session;
        if (!session || !(await hasGuildMutationAccess(this.botClient, session, guildId))) {
            res.status(403).json({ error: 'Access denied to this guild' });
            return;
        }
        const body = (req.body || {}) as {
            snapshotId?: string;
            unbanAdded?: boolean;
            rebanSnapshotBans?: boolean;
            incidentIds?: string[];
            confirm?: string;
        };
        if (!body.snapshotId) {
            res.status(400).json({ error: 'snapshotId が必要です。' });
            return;
        }
        if (body.confirm !== 'RESTORE') {
            res.status(400).json({ error: 'confirm=RESTORE が指定されていません。プレビューを確認してから実行してください。' });
            return;
        }
        try {
            const guild = await this.botClient.client.guilds.fetch(guildId);
            const requestedBy = typeof session.userId === 'string' ? session.userId : null;
            const job = await snapshotManager.startRestore(guild, String(body.snapshotId), {
                unbanAdded: body.unbanAdded !== false,
                rebanSnapshotBans: body.rebanSnapshotBans === true,
                incidentIds: Array.isArray(body.incidentIds) ? body.incidentIds.filter((id) => typeof id === 'string') : []
            }, requestedBy);
            res.json({ success: true, job });
        } catch (error) {
            const message = error instanceof Error ? error.message : '復元を開始できませんでした。';
            Logger.error('Error starting AntiNuke restore:', error);
            res.status(400).json({ error: message });
        }
    };

    /**
     * GET /api/staff/anticheat/:guildId/antinuke/restore/:jobId
     * Progress + persisted report for one restore job.
     */
    getRestoreJob = async (req: Request, res: Response): Promise<void> => {
        const guildId = String(req.params.guildId);
        const session = (req as any).session;
        if (!session || !hasAccessToGuild(session, guildId)) {
            res.status(403).json({ error: 'Access denied to this guild' });
            return;
        }
        try {
            const job = await snapshotManager.getJob(guildId, String(req.params.jobId));
            if (!job) {
                res.status(404).json({ error: '復元ジョブが見つかりません。' });
                return;
            }
            res.json({ job });
        } catch (error) {
            Logger.error('Error getting AntiNuke restore job:', error);
            res.status(500).json({ error: '復元ジョブを取得できませんでした。' });
        }
    };

}

/** Incident ids for the unban window: `?incidentId=a,b` or repeated params. */
function readIncidentIds(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : [value];
    const ids: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        for (const part of entry.split(',')) {
            const id = part.trim();
            if (id && /^[\w:-]{4,80}$/.test(id) && !ids.includes(id)) ids.push(id);
        }
    }
    return ids;
}

/** Mutation guard for state-changing AntiCheat endpoints (settings update,
 * punishment actions, timeout revoke, trust reset, cache clear).
 * hasAccessToGuild alone only proves guild membership: OAuth sessions carry a
 * permissions entry (level 0) for every shared guild, so any ordinary member
 * could otherwise mutate. OAuth sessions must hold guild permission level >= 1,
 * with a live Discord fallback (owner / Administrator / ManageGuild) for
 * sessions whose stored level undercounts. Legacy token sessions without a
 * permissions array stay bound to their single guild, as before. */
export async function hasGuildMutationAccess(botClient: BotClient, session: any, guildId: string): Promise<boolean> {    if (!session || !hasAccessToGuild(session, guildId)) return false;
    return (await getLiveGuildManagementLevel(botClient, session, guildId)) >= 1;
}

/**
 * Backwards-compatible guild access check.
 * Accepts older debug sessions (session.guildId), array of IDs (session.guildIds),
 * or the richer session.guilds array (objects with `id` property) produced by OAuth.
 */
export function hasAccessToGuild(session: any, guildId: string): boolean {
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
