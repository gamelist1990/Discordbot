import { createHash } from 'node:crypto';
import type { Message } from 'discord.js';

// discord.js updates cached Message instances in place. Pin the input before
// awaiting settings, REST, media downloads or inference.
export function snapshotMessage(message: Message): Message {
    return Object.create(message, {
        content: { value: message.content || '' },
        editedTimestamp: { value: message.editedTimestamp ?? null },
        attachments: { value: message.attachments?.clone?.() ?? message.attachments },
        embeds: { value: [...(message.embeds || [])] }
    });
}

export function messageRevision(message: Message): string {
    return createHash('sha256').update(JSON.stringify([
        message.content, message.editedTimestamp,
        Array.from(message.attachments?.values() || [], item => [item.id, item.name, item.size]),
        message.embeds
    ])).digest('hex');
}
