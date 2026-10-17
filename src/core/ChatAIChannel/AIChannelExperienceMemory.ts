import { database } from '../persistence/Database.js';

// Retained only to remove memories created by the retired AIChannel self-memory feature.
const MEMORY_KEY = 'chat-ai-channel-self-memories';
const REVISION_KEY = 'chat-ai-channel-self-memory-revision';
const locks = new Map<string, Promise<void>>();

async function withLock<T>(guildId: string, operation: () => Promise<T>): Promise<T> {
    const previous = locks.get(guildId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    locks.set(guildId, tail);
    await previous.catch(() => undefined);
    try {
        return await operation();
    } finally {
        release();
        if (locks.get(guildId) === tail) locks.delete(guildId);
    }
}

/** Remove AIChannel self-memories left behind by the retired feature. */
export async function clearAIChannelExperienceMemory(guildId: string): Promise<number> {
    return withLock(guildId, async () => {
        const memories = await database.get<Array<{ id: string }>>(guildId, MEMORY_KEY, []) || [];
        await Promise.all([
            database.set(guildId, MEMORY_KEY, []),
            database.set(guildId, REVISION_KEY, (await database.get<number>(guildId, REVISION_KEY, 0) || 0) + 1),
        ]);
        return memories.length;
    });
}
