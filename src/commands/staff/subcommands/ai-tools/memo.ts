import { OpenAITool, ToolHandler } from '../../../../types/openai';
import { ChatInputCommandInteraction } from 'discord.js';
import { database } from '../../../../core/Database.js';

/**
 * ギルド内メモ（memo）ツール
 * - 複数メモを保持
 * - AI がメモを作成・更新・取得・削除・検索できる
 */

type MemoEntry = {
    id: string;
    title?: string;
    content: string;
    createdAt: string; // ISO
    updatedAt?: string; // ISO
    authorId?: string;
    authorName?: string;
};

const KEY_PREFIX = 'Guild';

function getKey(guildId: string) {
    return `${KEY_PREFIX}/${guildId}/memos`;
}

async function loadMemos(guildId: string): Promise<MemoEntry[]> {
    try {
        const key = getKey(guildId);
        const data = (await database.get(guildId, key, [])) || [];
        return data as MemoEntry[];
    } catch (err) {
        console.error('loadMemos error:', err);
        return [];
    }
}

async function persistMemos(guildId: string, memos: MemoEntry[]): Promise<void> {
    const key = getKey(guildId);
    await database.set(guildId, key, memos);
}

// list_memos
export const memoListDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'list_memos',
        description: 'このサーバーに保存されているメモの一覧を取得します（タイトル・id・作成日時など）',
        parameters: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: '取得する件数の上限（最新から）', default: 20 }
            },
            required: []
        }
    }
};

export const memoListHandler: ToolHandler = async (args: { limit?: number }, context?: any) => {
    try {
        if (!context || !context.guild) return { error: 'このツールはギルド内でのみ利用できます' };
        const interaction = context as ChatInputCommandInteraction;
        const guildId = interaction.guild!.id;
        const limit = Math.max(0, Math.min(100, args.limit ?? 20));
        const memos = await loadMemos(guildId);
        const slice = memos.slice(-limit).map(m => ({ id: m.id, title: m.title, createdAt: m.createdAt, updatedAt: m.updatedAt }));
        return { memos: slice };
    } catch (err) {
        console.error('memoListHandler error:', err);
        return { error: 'メモ一覧の取得に失敗しました' };
    }
};

// get_memo
export const memoGetDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'get_memo',
        description: '指定した ID のメモを取得します',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '取得対象のメモID' }
            },
            required: ['id']
        }
    }
};

export const memoGetHandler: ToolHandler = async (args: { id: string }, context?: any) => {
    try {
        if (!context || !context.guild) return { error: 'このツールはギルド内でのみ利用できます' };
        const interaction = context as ChatInputCommandInteraction;
        const guildId = interaction.guild!.id;
        const memos = await loadMemos(guildId);
        const found = memos.find(m => m.id === args.id);
        if (!found) return { error: `メモ ${args.id} が見つかりません` };
        return found;
    } catch (err) {
        console.error('memoGetHandler error:', err);
        return { error: 'メモの取得に失敗しました' };
    }
};

// create_memo
export const memoCreateDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'create_memo',
        description: '新しいメモを作成します（titleは任意、content は必須）',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'メモのタイトル（省略可）' },
                content: { type: 'string', description: 'メモの本文' }
            },
            required: ['content']
        }
    }
};

export const memoCreateHandler: ToolHandler = async (args: { title?: string, content: string }, context?: any) => {
    try {
        if (!context || !context.guild) return { error: 'このツールはギルド内でのみ利用できます' };
        if (!args || typeof args.content !== 'string' || args.content.trim() === '') return { error: 'content は必須です' };

        const interaction = context as ChatInputCommandInteraction;
        const guildId = interaction.guild!.id;

        const memos = await loadMemos(guildId);
        const id = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const now = new Date().toISOString();
        const entry: MemoEntry = {
            id,
            title: args.title?.trim() || undefined,
            content: args.content.trim(),
            createdAt: now,
            updatedAt: now,
            authorId: interaction.user.id,
            authorName: interaction.user.username
        };

        memos.push(entry);
        // keep latest 200 memos max to avoid unbounded growth
        const trimmed = memos.slice(-200);
        await persistMemos(guildId, trimmed);

        return { success: true, memo: entry };
    } catch (err) {
        console.error('memoCreateHandler error:', err);
        return { error: 'メモの作成に失敗しました' };
    }
};

// update_memo
export const memoUpdateDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'update_memo',
        description: '既存のメモを更新します（id 必須）',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '更新対象のメモID' },
                title: { type: 'string' },
                content: { type: 'string' }
            },
            required: ['id']
        }
    }
};

export const memoUpdateHandler: ToolHandler = async (args: { id: string, title?: string, content?: string }, context?: any) => {
    try {
        if (!context || !context.guild) return { error: 'このツールはギルド内でのみ利用できます' };
        const interaction = context as ChatInputCommandInteraction;
        const guildId = interaction.guild!.id;
        const memos = await loadMemos(guildId);
        const idx = memos.findIndex(m => m.id === args.id);
        if (idx === -1) return { error: `メモ ${args.id} が見つかりません` };

        if (typeof args.title === 'string') memos[idx].title = args.title.trim() || undefined;
        if (typeof args.content === 'string') memos[idx].content = args.content.trim();
        memos[idx].updatedAt = new Date().toISOString();
        await persistMemos(guildId, memos);

        return { success: true, memo: memos[idx] };
    } catch (err) {
        console.error('memoUpdateHandler error:', err);
        return { error: 'メモの更新に失敗しました' };
    }
};

// delete_memo
export const memoDeleteDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'delete_memo',
        description: '指定したメモを削除します（復元不可）',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '削除対象のメモID' }
            },
            required: ['id']
        }
    }
};

export const memoDeleteHandler: ToolHandler = async (args: { id: string }, context?: any) => {
    try {
        if (!context || !context.guild) return { error: 'このツールはギルド内でのみ利用できます' };
        const interaction = context as ChatInputCommandInteraction;
        const guildId = interaction.guild!.id;
        let memos = await loadMemos(guildId);
        const before = memos.length;
        memos = memos.filter(m => m.id !== args.id);
        if (memos.length === before) return { error: `メモ ${args.id} が見つかりません` };
        await persistMemos(guildId, memos);
        return { success: true };
    } catch (err) {
        console.error('memoDeleteHandler error:', err);
        return { error: 'メモの削除に失敗しました' };
    }
};

// search_memos
export const memoSearchDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'search_memos',
        description: 'メモを検索します（タイトル・内容を部分一致で検索）',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '検索クエリ（部分一致）' },
                limit: { type: 'number', description: '最大取得件数', default: 20 }
            },
            required: ['query']
        }
    }
};

export const memoSearchHandler: ToolHandler = async (args: { query: string, limit?: number }, context?: any) => {
    try {
        if (!context || !context.guild) return { error: 'このツールはギルド内でのみ利用できます' };
        const interaction = context as ChatInputCommandInteraction;
        const guildId = interaction.guild!.id;
        const memos = await loadMemos(guildId);
        const q = args.query.trim().toLowerCase();
        const matches = memos.filter(m => (m.title || '').toLowerCase().includes(q) || m.content.toLowerCase().includes(q));
        const limit = Math.max(0, Math.min(100, args.limit ?? 20));
        return { results: matches.slice(0, limit) };
    } catch (err) {
        console.error('memoSearchHandler error:', err);
        return { error: 'メモ検索に失敗しました' };
    }
};