import type { Message } from 'discord.js';
import type { DetectionResult } from './types.js';

export async function deleteMatchedContent(message: Message, expected: NonNullable<DetectionResult['contentDeletion']>): Promise<void> {
    const fresh = await message.fetch();
    if (fresh.content !== expected.content || fresh.editedTimestamp !== expected.editedTimestamp
        || [...fresh.attachments.keys()].join() !== expected.attachmentIds) throw new Error('Message changed during analysis');
    await fresh.delete();
}
