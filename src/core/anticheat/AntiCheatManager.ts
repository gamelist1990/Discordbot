import { Client, Guild, Message, TextChannel } from 'discord.js';
import { database } from '../Database.js';
import { Logger } from '../../utils/Logger.js';
import {
    Detector,
    DetectionContext,
    DetectionResult,
    GuildAntiCheatSettings,
    DEFAULT_ANTICHEAT_SETTINGS,
    PunishmentThreshold,
    UserTrustData,
    TrustHistoryEntry,
    DetectionLog
} from './types.js';
import { TextSpamDetector } from './detectors/TextSpamDetector.js';
import { PunishmentExecutor } from './PunishmentExecutor.js';

/**
 * Main AntiCheat Manager
 * Handles detector registration, message processing, trust scoring, and punishment execution
 */
export class AntiCheatManager {
    private client: Client | null = null;
    private detectors: Map<string, Detector> = new Map();
    private readonly MAX_LOGS = 100;

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

            try {
                const result: DetectionResult = await detector.detect(message, context);
                
                if (result.scoreDelta > 0) {
                    totalScoreDelta += result.scoreDelta;
                    allReasons.push(...result.reasons);

                    // Log detection
                    await this.logDetection(guildId, {
                        userId,
                        messageId: message.id,
                        detector: name,
                        scoreDelta: result.scoreDelta,
                        reason: result.reasons.join('; '),
                        timestamp: new Date().toISOString(),
                        metadata: result.metadata
                    });
                }
            } catch (error) {
                Logger.error(`Detector ${name} failed:`, error);
            }
        }

        // Adjust trust score if violations detected
        if (totalScoreDelta > 0) {
            const newScore = await this.adjustTrust(
                guildId,
                userId,
                totalScoreDelta,
                allReasons.join('; ')
            );

            // Check thresholds and execute punishments
            await this.checkThresholds(message.guild!, userId, newScore, settings);
        }
    }

    /**
     * Check if trust score crosses any punishment thresholds
     */
    private async checkThresholds(
        guild: Guild,
        userId: string,
        trustScore: number,
        settings: GuildAntiCheatSettings
    ): Promise<void> {
        // Sort thresholds by value (ascending)
        const sortedThresholds = [...settings.punishments].sort((a, b) => a.threshold - b.threshold);

        // Find the highest threshold crossed
        let thresholdToApply: PunishmentThreshold | null = null;
        for (const threshold of sortedThresholds) {
            if (trustScore >= threshold.threshold) {
                thresholdToApply = threshold;
            }
        }

        if (!thresholdToApply) return;

        // Get member and log channel
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;

        const logChannel = settings.logChannelId
            ? (await guild.channels.fetch(settings.logChannelId).catch(() => null)) as TextChannel | null
            : null;

        // Execute all actions for this threshold
        for (const action of thresholdToApply.actions) {
            await PunishmentExecutor.execute(member, action, logChannel);
        }
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
            settings.userTrust[userId] = {
                score: 0,
                lastUpdated: new Date().toISOString(),
                history: []
            };
            await database.set(guildId, `Guild/${guildId}/anticheat`, settings);
            Logger.info(`Reset trust for user ${userId} in guild ${guildId}`);
        }
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
     * Get recent detection logs for a guild
     */
    async getLogs(
        guildId: string,
        limit: number = 50,
        before?: string
    ): Promise<DetectionLog[]> {
        const settings = await this.getSettings(guildId);
        let logs = settings.recentLogs;

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
}

// Singleton instance
export const antiCheatManager = new AntiCheatManager();
