import { Client, Message } from 'discord.js';
import { database } from './Database.js';

interface UserCounts {
    totalMessages: number;
    linkMessages: number;
    mediaMessages: number;
}

export class StatsManager {
    private client: Client;
    private buffer: Map<string, Map<string, UserCounts>>; // guildId -> userId -> counts
    private flushIntervalMs = 60 * 1000; // flush every minute
    private flushTimer: NodeJS.Timeout | null = null;

    constructor(client: Client) {
        this.client = client;
        this.buffer = new Map();

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

            if (!this.buffer.has(guildId)) this.buffer.set(guildId, new Map());
            const guildMap = this.buffer.get(guildId)!;

            if (!guildMap.has(userId)) {
                guildMap.set(userId, { totalMessages: 0, linkMessages: 0, mediaMessages: 0 });
            }

            const counts = guildMap.get(userId)!;
            counts.totalMessages++;

            // detect link (simple regex)
            const urlRegex = /(https?:\/\/[^\s]+)/i;
            if (urlRegex.test(message.content || '')) counts.linkMessages++;

            // detect media attachments or embeds
            if ((message.attachments && message.attachments.size > 0) || (message.embeds && message.embeds.some(e => !!e.image || !!e.thumbnail))) {
                counts.mediaMessages++;
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
            // clear buffer for this guild
            this.buffer.set(guildId, new Map());
        }
    }

    async getUserStats(guildId: string, userId: string) {
        const persisted = (await database.get<UserCounts>(guildId, `Guild/${guildId}/User/${userId}`, { totalMessages: 0, linkMessages: 0, mediaMessages: 0 })) || { totalMessages: 0, linkMessages: 0, mediaMessages: 0 };
        return persisted;
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
