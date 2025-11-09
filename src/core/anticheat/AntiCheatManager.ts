import { Client, Guild, Message, TextChannel, EmbedBuilder, Colors, PermissionFlagsBits, MessageResolvable } from 'discord.js';
import { database } from '../Database.js';
import { Logger } from '../../utils/Logger.js';
import {
    Detector,
    DetectionContext,
    DetectionResult,
    GuildAntiCheatSettings,
    DEFAULT_ANTICHEAT_SETTINGS,
    UserTrustData,
    TrustHistoryEntry,
    DetectionLog,
    PunishmentAction
} from './types';
import { TextSpamDetector } from './detectors/TextSpamDetector.js';
import { PunishmentExecutor } from './PunishmentExecutor.js';

/**
 * Main AntiCheat Manager
 * Handles detector registration, message processing, trust scoring, and punishment execution
 */
export class AntiCheatManager {
    private detectors: Map<string, Detector> = new Map();
    private client: Client | null = null;
    private readonly MAX_LOGS = 100;
    // debounce window (ms) to avoid immediate duplicate detections for same guild:user:detector
    private readonly detectionCooldownMs = 50;
    private lastDetectionTimestamps: Map<string, number> = new Map();

    constructor() {
        // Register default detectors
        this.registerDetector(new TextSpamDetector());
    }

    /**
     * Set the Discord client
     */
    setClient(client: Client): void {
        this.client = client;
    }

    /**
     * Register a detector
     */
    registerDetector(detector: Detector): void {
        this.detectors.set(detector.name, detector);
        Logger.debug(`Registered AntiCheat detector: ${detector.name}`);
    }

    /**
     * Handle a message for AntiCheat detection
     */
    async onMessage(message: Message): Promise<void> {
        // Ignore bots
        if (message.author.bot) return;
        
        // Require guild context
        if (!message.guild) return;

        const guildId = message.guild.id;
        const settings = await this.getSettings(guildId);

        // Check if AntiCheat is enabled
        if (!settings.enabled) return;

        // Check if channel is excluded
        if (settings.excludedChannels.includes(message.channel.id)) return;

        // Check if user has excluded role
        if (message.member) {
            const hasExcludedRole = settings.excludedRoles.some(roleId =>
                message.member!.roles.cache.has(roleId)
            );
            if (hasExcludedRole) return;
        }

        try {
            await this.processMessage(message, settings);
        } catch (error) {
            Logger.error(`AntiCheat error processing message ${message.id}:`, error);
        }
    }

    /**
     * Process a message through all enabled detectors
     */
    private async processMessage(message: Message, settings: GuildAntiCheatSettings): Promise<void> {
        const guildId = message.guild!.id;
        const userId = message.author.id;
        
        // Get current trust score
        const currentTrust = await this.getUserTrust(guildId, userId);
        
        // Build detection context
        const context: DetectionContext = {
            guildId,
            userId,
            channelId: message.channel.id,
            userTrustScore: currentTrust.score
        };

        let totalScoreDelta = 0;
        const allReasons: string[] = [];

        // Run all enabled detectors
        for (const [name, detector] of this.detectors) {
            const detectorConfig = settings.detectors[name];
            if (!detectorConfig || !detectorConfig.enabled) continue;

            // debounce: skip detection if same detector detected for this user very recently
            try {
                const key = `${guildId}:${userId}:${name}`;
                const now = Date.now();
                const last = this.lastDetectionTimestamps.get(key) || 0;
                if (now - last < this.detectionCooldownMs) continue;
            } catch (e) {
                // ignore errors and continue
            }

            try {
                const result: DetectionResult = await detector.detect(message, context);
                
                if (result.scoreDelta > 0) {
                    // record detection time to suppress rapid duplicates for this detector
                    try { this.lastDetectionTimestamps.set(`${guildId}:${userId}:${name}`, Date.now()); } catch {}
                    // Increment trust by 1 per detection (fixed increment)
                    totalScoreDelta += 1;
                    allReasons.push(...result.reasons);

                    // Log detection for UI display (record a +1 increase per detection)
                    await this.logDetection(guildId, {
                        userId,
                        messageId: message.id,
                        detector: name,
                        scoreDelta: 1,
                        reason: result.reasons.join('; '),
                        timestamp: new Date().toISOString(),
                        status: 'active',
                        metadata: result.metadata
                    });

                    // If auto-timeout is enabled, try to apply it immediately and stop further detections
                    if (settings.autoTimeout?.enabled) {
                        try {
                            const applied = await this.executeAutoTimeout(message.guild!, userId, settings, message.id);
                            if (applied) {
                                // suppress further immediate detections for this user across all detectors
                                const now = Date.now();
                                for (const detName of this.detectors.keys()) {
                                    try { this.lastDetectionTimestamps.set(`${guildId}:${userId}:${detName}`, now); } catch {}
                                }
                                // break out of detector loop
                                break;
                            }
                        } catch (e) {
                            // If timeout application failed, continue processing other detectors
                            Logger.debug('Auto-timeout attempt failed during detection loop:', e);
                        }
                    }
                }
            } catch (error) {
                Logger.error(`Detector ${name} failed:`, error);
            }
        }

        // Adjust trust score if violations detected
        if (totalScoreDelta > 0) {
            await this.adjustTrust(
                guildId,
                userId,
                totalScoreDelta,
                allReasons.join('; ')
            );

            // Auto-delete recent messages if enabled
            if (settings.autoDelete?.enabled) {
                try {
                    const guild = message.guild!;
                    const deleted = await this.deleteRecentMessages(guild, userId, settings.autoDelete.windowSeconds);
                    Logger.info(`Auto-deleted ${deleted} messages for user ${userId} in guild ${guildId}`);
                } catch (err) {
                    Logger.error('Failed to auto-delete messages:', err);
                }
            }

            // Execute auto timeout if enabled
            if (settings.autoTimeout.enabled) {
                await this.executeAutoTimeout(message.guild!, userId, settings, message.id);
            }

            // Send a detection notification to the configured log channel (if any)
            if (settings.logChannelId) {
                try {
                    const guild = await this.client?.guilds.fetch(guildId).catch(() => null);
                    if (guild) {
                        const logChannel = await guild.channels.fetch(settings.logChannelId).catch(() => null) as TextChannel | null;
                        if (logChannel) {
                            const embed = new EmbedBuilder()
                                .setTitle('🚨 AntiCheat 検知')
                                .setColor(Colors.Red)
                                .setTimestamp()
                                .setFooter({ text: 'AntiCheat System', iconURL: guild.iconURL() || undefined })
                                .addFields(
                                    { name: '👤 ユーザー', value: `${message.author.tag}\n${message.author.toString()}`, inline: true },
                                    { name: '🆔 ユーザーID', value: `\`${userId}\``, inline: true },
                                    { name: '💬 チャンネル', value: `<#${message.channel.id}>`, inline: true },
                                    { name: '📈 スコア増加', value: `+${totalScoreDelta}`, inline: true },
                                    { name: '📝 理由', value: allReasons.join('; ') || 'N/A', inline: false }
                                );

                            await logChannel.send({ embeds: [embed] });
                        }
                    }
                } catch (error) {
                    Logger.error('Failed to send detection notification:', error);
                }
            }
        }
    }

    /**
     * Execute auto timeout for a user
     */
    private async executeAutoTimeout(guild: Guild, userId: string, settings: GuildAntiCheatSettings, messageId?: string): Promise<boolean> {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return false;

        const logChannel = settings.logChannelId
            ? (await guild.channels.fetch(settings.logChannelId).catch(() => null)) as TextChannel | null
            : null;

        const action: PunishmentAction = {
            type: 'timeout',
            durationSeconds: settings.autoTimeout.durationSeconds,
            reasonTemplate: 'Auto timeout: AntiCheat violation detected',
            notify: false
        };

        const applied = await PunishmentExecutor.execute(member, action, logChannel);

        // If timeout applied, mark recent log entry (by messageId) as timed out and include username/displayName
        if (applied && messageId) {
            try {
                const s = await this.getSettings(guild.id);
                s.recentLogs = s.recentLogs.map(l => {
                    if (l.messageId === messageId) {
                        const meta = l.metadata || {};
                        return {
                            ...l,
                            metadata: {
                                ...meta,
                                isTimedOut: true,
                                username: member.user.username,
                                displayName: member.displayName || member.user.username
                            }
                        };
                    }
                    return l;
                });
                await database.set(guild.id, `Guild/${guild.id}/anticheat`, s);
            } catch (err) {
                Logger.debug('Failed to mark log as timed out:', err);
            }
        }

        return !!applied;
    }

    /**
     * Get settings for a guild
     */
    async getSettings(guildId: string): Promise<GuildAntiCheatSettings> {
        const key = `Guild/${guildId}/anticheat`;
        const settings = await database.get<GuildAntiCheatSettings>(guildId, key);
        
        if (!settings) {
            // Initialize with defaults
            await database.set(guildId, key, DEFAULT_ANTICHEAT_SETTINGS);
            return { ...DEFAULT_ANTICHEAT_SETTINGS };
        }

        return settings;
    }

    /**
     * Update settings for a guild
     */
    async setSettings(guildId: string, settings: GuildAntiCheatSettings): Promise<void> {
        const key = `Guild/${guildId}/anticheat`;
        await database.set(guildId, key, settings);
        Logger.info(`Updated AntiCheat settings for guild ${guildId}`);
    }

    /**
     * Get trust data for a user
     */
    async getUserTrust(guildId: string, userId: string): Promise<UserTrustData> {
        const settings = await this.getSettings(guildId);
        
        if (!settings.userTrust[userId]) {
            return {
                score: 0,
                lastUpdated: new Date().toISOString(),
                history: []
            };
        }

        return settings.userTrust[userId];
    }

    /**
     * Adjust trust score for a user
     */
    async adjustTrust(
        guildId: string,
        userId: string,
        delta: number,
        reason: string
    ): Promise<number> {
        const settings = await this.getSettings(guildId);
        
        const currentTrust = settings.userTrust[userId] || {
            score: 0,
            lastUpdated: new Date().toISOString(),
            history: []
        };

        const newScore = Math.max(0, currentTrust.score + delta);
        
        const historyEntry: TrustHistoryEntry = {
            delta,
            reason,
            timestamp: new Date().toISOString()
        };

        // Keep only last 50 history entries
        const history = [...currentTrust.history, historyEntry].slice(-50);

        settings.userTrust[userId] = {
            score: newScore,
            lastUpdated: new Date().toISOString(),
            history
        };

        await database.set(guildId, `Guild/${guildId}/anticheat`, settings);
        
        Logger.debug(`User ${userId} trust: ${currentTrust.score} → ${newScore} (${reason})`);
        
        return newScore;
    }

    /**
     * Reset trust score for a user
     */
    async resetTrust(guildId: string, userId: string): Promise<void> {
        const settings = await this.getSettings(guildId);
        
        if (settings.userTrust[userId]) {
            const oldScore = settings.userTrust[userId].score;
            settings.userTrust[userId] = {
                score: 0,
                lastUpdated: new Date().toISOString(),
                history: []
            };
            await database.set(guildId, `Guild/${guildId}/anticheat`, settings);
            Logger.info(`Reset trust for user ${userId} in guild ${guildId}`);

            // Send reset notification to log channel
            if (settings.logChannelId) {
                try {
                    const guild = await this.client?.guilds.fetch(guildId).catch(() => null);
                    if (guild) {
                        const logChannel = await guild.channels.fetch(settings.logChannelId).catch(() => null) as TextChannel | null;
                        const member = await guild.members.fetch(userId).catch(() => null);
                        
                        if (logChannel && member) {
                            const embed = new EmbedBuilder()
                                .setTitle('🔄 信頼スコアリセット')
                                .setColor(Colors.Blue)
                                .setTimestamp()
                                .setFooter({
                                    text: 'AntiCheat System',
                                    iconURL: guild.iconURL() || undefined
                                })
                                .addFields(
                                    {
                                        name: '👤 ユーザー',
                                        value: `${member.user.tag}\n${member.user.toString()}`,
                                        inline: true
                                    },
                                    {
                                        name: '🆔 ユーザーID',
                                        value: `\`${userId}\``,
                                        inline: true
                                    },
                                    {
                                        name: '📊 以前のスコア',
                                        value: oldScore.toString(),
                                        inline: true
                                    },
                                    {
                                        name: '📝 理由',
                                        value: 'スタッフによる手動リセット',
                                        inline: false
                                    }
                                );
                            
                            await logChannel.send({ embeds: [embed] });
                        }
                    }
                } catch (error) {
                    Logger.error('Failed to send trust reset notification:', error);
                }
            }
        }
    }

    /**
     * Get recent detection logs for a guild
     */
    async getLogs(
        guildId: string,
        limit: number = 50,
        before?: string
    ): Promise<DetectionLog[]> {
        const settings = await this.getSettings(guildId);
        let logs = settings.recentLogs.filter(log => log.status !== 'revoked');

        // If we have a Discord client, verify timed-out status for logs marked as timed out.
        // If the user is no longer timed out, mark the log as revoked so it won't be returned.
        let updated = false;
        try {
            const guild = await this.client?.guilds.fetch(guildId).catch(() => null);
            if (guild) {
                const idsToRemove: string[] = [];
                for (const l of settings.recentLogs) {
                    if (l.status === 'revoked') continue;
                    const isMarkedTimedOut = !!(l.metadata && l.metadata.isTimedOut);
                    if (isMarkedTimedOut) {
                        try {
                            const member = await guild.members.fetch(l.userId).catch(() => null);
                            const isCurrentlyTimedOut = member ? (member.communicationDisabledUntil !== null) : false;
                            if (!isCurrentlyTimedOut) {
                                // schedule removal to hide from UI
                                idsToRemove.push(l.messageId);
                                updated = true;
                            }
                        } catch (e) {
                            // ignore fetch errors
                        }
                    }
                }
                if (updated && idsToRemove.length > 0) {
                    // remove the revoked/stale entries and persist
                    settings.recentLogs = settings.recentLogs.filter(l => !idsToRemove.includes(l.messageId));
                    await database.set(guildId, `Guild/${guildId}/anticheat`, settings);
                }
            }
        } catch (e) {
            // ignore errors while verifying member timeouts
        }

        // Recompute logs after possible revocations so we don't return stale entries
        logs = settings.recentLogs.filter(log => log.status !== 'revoked');

        if (before) {
            const beforeDate = new Date(before).getTime();
            logs = logs.filter(log => new Date(log.timestamp).getTime() < beforeDate);
        }

        return logs.slice(-limit).reverse();
    }

    /**
     * Get all user trust data for a guild
     */
    async getAllUserTrust(guildId: string): Promise<Record<string, UserTrustData>> {
        const settings = await this.getSettings(guildId);
        return settings.userTrust;
    }

    /**
     * Log a detection event
     */
    private async logDetection(guildId: string, log: DetectionLog): Promise<void> {
        const settings = await this.getSettings(guildId);
        
        settings.recentLogs = [...settings.recentLogs, log].slice(-this.MAX_LOGS);
        
        await database.set(guildId, `Guild/${guildId}/anticheat`, settings);
    }

    /**
     * Revoke a detection log (mark as revoked)
     */
    async revokeLog(guildId: string, messageId: string): Promise<void> {
        const settings = await this.getSettings(guildId);

        const exists = settings.recentLogs.some(log => log.messageId === messageId);
        if (exists) {
            settings.recentLogs = settings.recentLogs.filter(log => log.messageId !== messageId);
            await database.set(guildId, `Guild/${guildId}/anticheat`, settings);
            Logger.debug(`Removed log for message ${messageId} in guild ${guildId}`);
        }
    }

    /**
     * Delete recent messages from a user across accessible text channels within a time window
     */
    private async deleteRecentMessages(guild: Guild, userId: string, windowSeconds: number): Promise<number> {
        const now = Date.now();
        let deletedCount = 0;

        // Iterate cached channels; fetching all channels may not be reliable in every environment
        for (const ch of guild.channels.cache.values()) {
            // Only handle text-based channels (TextChannel, NewsChannel, Threads omitted)
            if (!('isTextBased' in ch) || !(ch as any).isTextBased()) continue;

            const textCh = ch as TextChannel;

            // Check permissions
            const me = guild.members.me;
            if (!me) continue;
            const perms = textCh.permissionsFor(me);
            if (!perms || !perms.has(PermissionFlagsBits.ManageMessages)) continue;

            try {
                let before: string | undefined = undefined;
                let keepFetching = true;

                while (keepFetching) {
                    const fetched = await textCh.messages.fetch({ limit: 100, before });
                    if (!fetched || fetched.size === 0) break;

                    // Filter messages by author and time window
                    const toDelete = fetched.filter(m => m.author.id === userId && (now - m.createdTimestamp) <= (windowSeconds * 1000));

                    if (toDelete.size > 0) {
                        // bulkDelete accepts up to 100 messages
                        const ids = Array.from(toDelete.keys()) as string[];
                        for (let i = 0; i < ids.length; i += 100) {
                            const chunk = ids.slice(i, i + 100) as readonly MessageResolvable[];
                            try {
                                const res = await textCh.bulkDelete(chunk, true).catch(() => null) as any;
                                // bulkDelete may return a collection of deleted messages
                                if (res && typeof res.size === 'number') deletedCount += res.size;
                                else deletedCount += chunk.length;
                            } catch (e) {
                                // ignore individual channel errors
                            }
                        }
                    }

                    // If the oldest fetched message is older than windowSeconds, stop fetching this channel
                    const oldest = fetched.last();
                    if (!oldest) break;
                    if ((now - oldest.createdTimestamp) > (windowSeconds * 1000)) break;

                    // Prepare for next page
                    before = oldest.id;
                    if (fetched.size < 100) break;
                }
            } catch (error) {
                // ignore per-channel errors
                Logger.debug(`Failed scanning channel ${textCh.id} for deletions: ${error}`);
            }
        }

        return deletedCount;
    }
}

// Singleton instance (guard with global to avoid multiple instantiations
// if the module is accidentally loaded more than once under different
// module IDs). We also attach a small creation log including PID to help
// diagnose duplicate startups.
const GLOBAL_KEY = '__antiCheatManager_v1';
if (!(global as any)[GLOBAL_KEY]) {
    (global as any)[GLOBAL_KEY] = new AntiCheatManager();
    Logger.debug(`AntiCheatManager created (pid=${process.pid})`);
} else {
    Logger.debug(`AntiCheatManager reused existing instance (pid=${process.pid})`);
}

export const antiCheatManager: AntiCheatManager = (global as any)[GLOBAL_KEY];
