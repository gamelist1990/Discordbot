import { ChatInputCommandInteraction } from 'discord.js';
import { database } from '../../../../core/persistence/Database.js';

/** Backing operations for the single Staff AI memory tool. */
export type MemoEntry = {
    id: string;
    title?: string;
    content: string;
    createdAt: string;
    updatedAt?: string;
    authorId?: string;
    authorName?: string;
};

const getKey = (guildId: string) => `Guild/${guildId}/memos`;

export async function loadMemos(guildId: string): Promise<MemoEntry[]> {
    try {
        return await database.get<MemoEntry[]>(guildId, getKey(guildId), []) || [];
    } catch (error) {
        console.error('[StaffAI memory] memo load failed:', error);
        return [];
    }
}

async function persistMemos(guildId: string, memos: MemoEntry[]): Promise<void> {
    await database.set(guildId, getKey(guildId), memos);
}

async function serverMemoActionUnlocked(
    action: string,
    args: Record<string, unknown>,
    context?: unknown,
): Promise<object> {
    const interaction = context as ChatInputCommandInteraction | undefined;
    if (!interaction?.guild) return { error: 'サーバーメモはギルド内でのみ利用できます' };
    const guildId = interaction.guild.id;

    try {
        const memos = await loadMemos(guildId);
        if (action === 'list') {
            const requested = Number(args.limit ?? 20);
            const limit = Number.isFinite(requested) ? Math.max(0, Math.min(100, requested)) : 20;
            return { memos: (limit ? memos.slice(-limit) : []).map(memo => ({
                id: memo.id, title: memo.title, createdAt: memo.createdAt, updatedAt: memo.updatedAt,
            })) };
        }

        if (action === 'search') {
            const query = typeof args.query === 'string' ? args.query.trim().toLocaleLowerCase() : '';
            if (!query) return { error: '検索語を指定してください' };
            const requested = Number(args.limit ?? 20);
            const limit = Number.isFinite(requested) ? Math.max(0, Math.min(100, requested)) : 20;
            const results = memos.filter(memo => (memo.title || '').toLocaleLowerCase().includes(query)
                || memo.content.toLocaleLowerCase().includes(query));
            return { results: results.slice(0, limit) };
        }

        if (action === 'get') {
            const id = typeof args.id === 'string' ? args.id : '';
            const memo = memos.find(entry => entry.id === id);
            return memo || { error: `メモ ${id || '(IDなし)'} が見つかりません` };
        }

        if (action === 'create') {
            const content = typeof args.content === 'string' ? args.content.trim() : '';
            if (!content || content.length > 6000 || (typeof args.title === 'string' && args.title.length > 200)) return { error: '作成するメモの本文を指定してください' };
            const now = new Date().toISOString();
            const memo: MemoEntry = {
                id: `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
                title: typeof args.title === 'string' ? args.title.trim() || undefined : undefined,
                content,
                createdAt: now,
                updatedAt: now,
                authorId: interaction.user.id,
                authorName: interaction.user.username,
            };
            memos.push(memo);
            await persistMemos(guildId, memos.slice(-200));
            return { success: true, memo };
        }

        if (action === 'update') {
            const id = typeof args.id === 'string' ? args.id : '';
            const index = memos.findIndex(entry => entry.id === id);
            if (index < 0) return { error: `メモ ${id || '(IDなし)'} が見つかりません` };
            if (typeof args.title === 'string') memos[index].title = args.title.trim() || undefined;
            if (typeof args.content === 'string') {
                if (!args.content.trim() || args.content.length > 6000) return { error: '本文は1〜6000文字です' };
                memos[index].content = args.content.trim();
            }
            memos[index].updatedAt = new Date().toISOString();
            await persistMemos(guildId, memos);
            return { success: true, memo: memos[index] };
        }

        if (action === 'delete') {
            const id = typeof args.id === 'string' ? args.id : '';
            const remaining = memos.filter(entry => entry.id !== id);
            if (remaining.length === memos.length) return { error: `メモ ${id || '(IDなし)'} が見つかりません` };
            await persistMemos(guildId, remaining);
            return { success: true };
        }

        return { error: `未対応のメモ操作です: ${action || '(empty)'}` };
    } catch (error) {
        console.error(`[StaffAI memory] memo ${action} failed:`, error);
        return { error: 'サーバーメモの処理に失敗しました' };
    }
}

const memoTails = new Map<string, Promise<void>>();
export async function serverMemoAction(action: string, args: Record<string, unknown>, context?: unknown): Promise<object> {
    const guildId = (context as ChatInputCommandInteraction | undefined)?.guild?.id;
    if (!guildId) return { error: 'サーバーメモはギルド内でのみ利用できます' };
    const previous = memoTails.get(guildId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    memoTails.set(guildId, tail);
    await previous.catch(() => undefined);
    try { return await serverMemoActionUnlocked(action, args, context); }
    finally { release(); if (memoTails.get(guildId) === tail) memoTails.delete(guildId); }
}
