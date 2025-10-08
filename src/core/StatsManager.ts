import { Client, Message } from 'discord.js';
import { database } from './Database.js';

interface UserCounts {
    totalMessages: number;
    linkMessages: number;
    mediaMessages: number;
}

interface MessageTimestamp {
    timestamp: number;
    isLink: boolean;
    isMedia: boolean;
}

export class StatsManager {
    private client: Client;
    private buffer: Map<string, Map<string, UserCounts>>; // guildId -> userId -> counts
    private timestampBuffer: Map<string, Map<string, MessageTimestamp[]>>; // guildId -> userId -> timestamps
    private flushIntervalMs = 60 * 1000; // flush every minute
    private flushTimer: NodeJS.Timeout | null = null;
    private maxTimestampsPerUser = 1000; // Keep last 1000 messages per user

    constructor(client: Client) {
        this.client = client;
        this.buffer = new Map();
        this.timestampBuffer = new Map();

        // register handler
        this.client.on('messageCreate', (message) => this.onMessage(message));

        // periodic flush
        this.flushTimer = setInterval(() => this.flushAll().catch(() => {}), this.flushIntervalMs);
    }

    private async onMessage(message: Message) {
        try {
            if (!message.guild || !message.author) return;
            if (message.author.bot) return;

            const guildId = message.guild.id;
            const userId = message.author.id;
            const timestamp = message.createdTimestamp;

            // Update counts buffer
            if (!this.buffer.has(guildId)) this.buffer.set(guildId, new Map());
            const guildMap = this.buffer.get(guildId)!;

            if (!guildMap.has(userId)) {
                guildMap.set(userId, { totalMessages: 0, linkMessages: 0, mediaMessages: 0 });
            }

            const counts = guildMap.get(userId)!;
            counts.totalMessages++;

            // detect link (simple regex)
            const urlRegex = /(https?:\/\/[^\s]+)/i;
            const isLink = urlRegex.test(message.content || '');
            if (isLink) counts.linkMessages++;

            // detect media attachments or embeds
            const isMedia = (message.attachments && message.attachments.size > 0) || (message.embeds && message.embeds.some(e => !!e.image || !!e.thumbnail));
            if (isMedia) {
                counts.mediaMessages++;
            }

            // Store timestamp
            if (!this.timestampBuffer.has(guildId)) this.timestampBuffer.set(guildId, new Map());
            const timestampGuildMap = this.timestampBuffer.get(guildId)!;
            
            if (!timestampGuildMap.has(userId)) {
                timestampGuildMap.set(userId, []);
            }
            
            const timestamps = timestampGuildMap.get(userId)!;
            timestamps.push({ timestamp, isLink, isMedia });
            
            // Keep only last N timestamps to prevent memory issues
            if (timestamps.length > this.maxTimestampsPerUser) {
                timestamps.shift();
            }

            // do not flush here; periodic flush will persist
        } catch (e) {
            // swallow
            // console.warn('StatsManager onMessage error', e);
        }
    }

    private async flushAll() {
        for (const [guildId, guildMap] of this.buffer.entries()) {
            try {
                // persist each user's stats into Guild/<guildId>/User/<userId>.json
                let persistedCount = 0;
                for (const [userId, counts] of guildMap.entries()) {
                    const existing = (await database.get<UserCounts>(guildId, `Guild/${guildId}/User/${userId}`, { totalMessages: 0, linkMessages: 0, mediaMessages: 0 })) || { totalMessages: 0, linkMessages: 0, mediaMessages: 0 };
                    const merged = {
                        totalMessages: existing.totalMessages + counts.totalMessages,
                        linkMessages: existing.linkMessages + counts.linkMessages,
                        mediaMessages: existing.mediaMessages + counts.mediaMessages,
                    };
                    await database.set(guildId, `Guild/${guildId}/User/${userId}`, merged);
                    
                    // Save timestamps to separate file
                    const timestampGuildMap = this.timestampBuffer.get(guildId);
                    if (timestampGuildMap && timestampGuildMap.has(userId)) {
                        const timestamps = timestampGuildMap.get(userId)!;
                        if (timestamps.length > 0) {
                            try {
                                // Load existing timestamps
                                const existingTimestamps = await database.get<MessageTimestamp[]>(
                                    guildId, 
                                    `Guild/${guildId}/User/${userId}_timestamps`, 
                                    []
                                ) || [];
                                
                                // Merge and keep only recent ones (last 1000)
                                const allTimestamps = [...existingTimestamps, ...timestamps]
                                    .sort((a, b) => b.timestamp - a.timestamp)
                                    .slice(0, this.maxTimestampsPerUser);
                                
                                await database.set(guildId, `Guild/${guildId}/User/${userId}_timestamps`, allTimestamps);
                            } catch (e) {
                                console.warn(`Failed to save timestamps for user ${userId} in guild ${guildId}:`, e);
                            }
                        }
                    }
                    
                        // Also update a global per-user file that contains per-guild breakdowns
                        // This makes Data/User/<userId>.json contain a `guilds` mapping for easier profile aggregation.
                        try {
                            // read existing global user file (supports both old flat and new structure)
                            const globalUserAny = await database.get(guildId, `User/${userId}`, null) as any;
                            const newGlobal = globalUserAny && typeof globalUserAny === 'object' ? { ...globalUserAny } : {};
                            if (!newGlobal.guilds || typeof newGlobal.guilds !== 'object') newGlobal.guilds = {};
                            newGlobal.guilds[guildId] = merged;
                            // Optionally keep backward-compatible top-level totals (sum across guilds)
                            try {
                                // recompute totals across guilds
                                const totals: { totalMessages: number; linkMessages: number; mediaMessages: number } = Object.values(newGlobal.guilds).reduce((acc: { totalMessages: number; linkMessages: number; mediaMessages: number }, g: any) => {
                                    acc.totalMessages += (g.totalMessages || 0);
                                    acc.linkMessages += (g.linkMessages || 0);
                                    acc.mediaMessages += (g.mediaMessages || 0);
                                    return acc;
                                }, { totalMessages: 0, linkMessages: 0, mediaMessages: 0 });
                                (newGlobal as any).totalMessages = totals.totalMessages;
                                (newGlobal as any).linkMessages = totals.linkMessages;
                                (newGlobal as any).mediaMessages = totals.mediaMessages;
                            } catch (_) {
                                // ignore
                            }
                            await database.set(guildId, `User/${userId}`, newGlobal);
                        } catch (e) {
                            // ignore errors updating global user file
                        }

                    persistedCount++;
                }
                if (persistedCount > 0) console.log(`StatsManager: persisted ${persistedCount} user(s) for guild ${guildId}`);
            } catch (e) {
                // ignore flush errors
            }
            // clear buffers for this guild
            this.buffer.set(guildId, new Map());
            if (this.timestampBuffer.has(guildId)) {
                this.timestampBuffer.set(guildId, new Map());
            }
        }
    }

    async getUserStats(guildId: string, userId: string) {
        const persisted = (await database.get<UserCounts>(guildId, `Guild/${guildId}/User/${userId}`, { totalMessages: 0, linkMessages: 0, mediaMessages: 0 })) || { totalMessages: 0, linkMessages: 0, mediaMessages: 0 };
        return persisted;
    }

    /**
     * Get user activity data with timestamps for a specific period
     */
    async getUserActivityWithTimestamps(guildId: string, userId: string): Promise<MessageTimestamp[]> {
        try {
            const timestamps = await database.get<MessageTimestamp[]>(
                guildId, 
                `Guild/${guildId}/User/${userId}_timestamps`, 
                []
            ) || [];
            return timestamps;
        } catch (e) {
            console.warn(`Failed to get timestamps for user ${userId} in guild ${guildId}:`, e);
            return [];
        }
    }

    /**
     * Get aggregated activity data for a user across all guilds
     */
    async getUserAggregatedActivity(userId: string, guildIds: string[]): Promise<{
        allTimestamps: MessageTimestamp[];
        weeklyMessages: number;
        monthlyMessages: number;
        yearlyMessages: number;
        recentActivity: Array<{ date: string; messages: number }>;
    }> {
        const now = Date.now();
        const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
        const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;
        const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;

        // Collect all timestamps from all guilds
        const allTimestamps: MessageTimestamp[] = [];
        for (const guildId of guildIds) {
            const guildTimestamps = await this.getUserActivityWithTimestamps(guildId, userId);
            allTimestamps.push(...guildTimestamps);
        }

        // Sort by timestamp descending
        allTimestamps.sort((a, b) => b.timestamp - a.timestamp);

        // Calculate period counts
        const weeklyMessages = allTimestamps.filter(t => t.timestamp >= oneWeekAgo).length;
        const monthlyMessages = allTimestamps.filter(t => t.timestamp >= oneMonthAgo).length;
        const yearlyMessages = allTimestamps.filter(t => t.timestamp >= oneYearAgo).length;

        // Calculate recent 7 days activity
        const recentActivity: Array<{ date: string; messages: number }> = [];
        for (let i = 0; i < 7; i++) {
            const dayStart = now - (6 - i) * 24 * 60 * 60 * 1000;
            const dayEnd = dayStart + 24 * 60 * 60 * 1000;
            const date = new Date(dayStart);
            const dayMessages = allTimestamps.filter(t => t.timestamp >= dayStart && t.timestamp < dayEnd).length;
            
            recentActivity.push({
                date: date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }),
                messages: dayMessages
            });
        }

        return {
            allTimestamps,
            weeklyMessages,
            monthlyMessages,
            yearlyMessages,
            recentActivity
        };
    }

    stop() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
    }
}

export const statsManagerSingleton = {
    instance: null as StatsManager | null,
    init(client: Client) {
        if (!this.instance) this.instance = new StatsManager(client);
        return this.instance;
    }
};
