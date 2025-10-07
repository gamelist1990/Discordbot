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
