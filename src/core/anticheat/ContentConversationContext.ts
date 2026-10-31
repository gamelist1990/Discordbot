import type { Message } from 'discord.js';

/** Bounded, same-channel conversation context. Never score neighboring posts. */
const WINDOW_MS = 12 * 60_000;
const PER_SIDE = 4;
const PREVIEW_LENGTH = 240;
const AFTER_MESSAGE_GRACE_MS = 1800;

export async function loadContentConversationContext(message: Message, replyContext = '', graceMs = AFTER_MESSAGE_GRACE_MS): Promise<string> {
    const channel = message.channel as typeof message.channel & {
        messages?: { fetch: (options: { around: string; limit: number }) => Promise<{ values: () => IterableIterator<any> }> }
    };
    const reply = replyContext.trim().slice(0, 500);
    if (!channel?.messages || typeof channel.messages.fetch !== 'function' || !message.id) {
        return reply ? JSON.stringify({ repliedTo: reply }) : '';
    }
    // Give immediately-following comments a brief opportunity to arrive.
    // Future posts not yet sent are necessarily unavailable.
    if (graceMs > 0 && message.content?.length <= 240) {
        await new Promise<void>(resolve => setTimeout(resolve, graceMs));
    }
    try {
        const fetched = await channel.messages.fetch({ around: message.id, limit: 13 });
        const created = Number(message.createdTimestamp) || Date.now();
        const nearby = Array.from(fetched.values()).filter((item: any) => {
            if (!item || item.id === message.id || item.author?.bot || item.webhookId || !item.content?.trim()) return false;
            if (item.channelId && message.channelId && item.channelId !== message.channelId) return false;
            const timestamp = Number(item.createdTimestamp);
            return Number.isFinite(timestamp) && Math.abs(timestamp - created) <= WINDOW_MS;
        }).map((item: any) => ({
            id: String(item.id),
            author: String(item.author?.id || 'unknown').slice(0, 22),
            timestamp: Number(item.createdTimestamp),
            text: String(item.content).replace(/\s+/g, ' ').slice(0, PREVIEW_LENGTH),
        })).sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
        const before = nearby.filter(item => item.timestamp <= created).slice(-PER_SIDE);
        const after = nearby.filter(item => item.timestamp > created).slice(0, PER_SIDE);
        if (!before.length && !after.length && !reply) return '';
        return JSON.stringify({
            ...(before.length ? { before } : {}),
            ...(reply ? { repliedTo: reply } : {}),
            ...(after.length ? { after } : {}),
        });
    } catch {
        // Missing history permission or transient Discord errors must not block scanning.
        return reply ? JSON.stringify({ repliedTo: reply }) : '';
    }
}
