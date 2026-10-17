import { AsyncLocalStorage } from 'node:async_hooks';
import { selectAIExperienceMemories, staffMemoryList } from '../../../../core/ai/StaffAIMemory.js';
import { serverMemoAction } from './memo.js';

// Explicit guild+requesting-user context, never supplied by model-controlled arguments.
export const staffMemoryToolScope = new AsyncLocalStorage<{ guildId: string; userId: string }>();

export const staffMemoryDefinition = {
    type: 'function' as const,
    function: {
        name: 'manage_memory',
        description: [
            'Staff AIの唯一のメモリーツール。用途に応じてstoreを選ぶ。',
            'dailyはサーバーの日次要約、my_profileは発言者本人の非公開プロフィール、public_interestsは公開可能な趣味だけを読む。これらはaction=recall。',
            'ai_selfはAI自身がこのサーバーで経験した出来事・約束・学びの記憶を読む。関連する思い出を確認したいときaction=recallで使う。',
            'server_memosはサーバー共有メモのlist/search/get/create/update/deleteに使う。',
            '更新・作成・削除はユーザーが明確に依頼した場合だけ行う。日常会話の好みやプロフィールは自動要約されるため、共有メモへ重複保存しない。',
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['recall', 'list', 'search', 'get', 'create', 'update', 'delete'] },
                store: { type: 'string', enum: ['daily', 'my_profile', 'public_interests', 'ai_self', 'server_memos'] },
                day: { type: 'string', description: 'daily指定時の日付（YYYY-MM-DD）。省略すると直近5件。' },
                userId: { type: 'string', description: 'public_interests指定時のDiscordユーザーID。公開可能な趣味だけを返す。' },
                query: { type: 'string', description: 'server_memos検索語、またはai_selfで思い出したい話題' },
                id: { type: 'string', description: 'server_memosの対象ID' },
                title: { type: 'string', description: 'server_memosのタイトル' },
                content: { type: 'string', description: 'server_memosの本文' },
                limit: { type: 'number', description: 'list/searchの取得件数（最大100）' },
            },
            required: ['action', 'store'],
            additionalProperties: false,
        },
    },
};

async function recallStaffMemory(type: 'daily' | 'my_profile' | 'public_interests' | 'ai_self', args: Record<string, unknown>): Promise<string> {
    const scope = staffMemoryToolScope.getStore();
    if (!scope) return 'このリクエストではメモリーの読み取り権限がありません';

    const entries = await staffMemoryList(scope.guildId);
    if (type === 'public_interests') {
        const requestedId = typeof args.userId === 'string' && /^\d{17,20}$/.test(args.userId)
            ? args.userId : scope.userId;
        const profile = entries.find(item => item.kind === 'user' && item.userId === requestedId);
        return profile?.publicInterests?.trim() || 'このユーザーの一般公開可能な趣味・得意分野は記録されていません';
    }

    if (type === 'ai_self') {
        const query = typeof args.query === 'string' ? args.query : '';
        const memories = await selectAIExperienceMemories(scope.guildId, query, 10);
        return memories.length
            ? memories.map(item => `${item.title} (${item.updatedAt}): ${item.content.slice(0, 1_200)}`).join('\n')
            : 'AI自身の経験メモリーはまだありません';
    }

    const filtered = type === 'my_profile'
        ? entries.filter(item => item.kind === 'user' && item.userId === scope.userId)
        : entries.filter(item => item.kind === 'daily' && (typeof args.day !== 'string' || item.day === args.day)).slice(-5);
    return filtered.length
        ? filtered.map(item => `${item.title} (${item.updatedAt}): ${item.content.slice(0, 2500)}`).join('\n')
        : '記録されたメモリーはありません';
}

export async function staffMemoryHandler(args: Record<string, unknown>, context?: unknown): Promise<string | object> {
    const action = typeof args.action === 'string' ? args.action : '';
    const store = typeof args.store === 'string' ? args.store : '';

    if (store === 'server_memos') return serverMemoAction(action, args, context);
    if (store === 'daily' || store === 'my_profile' || store === 'public_interests' || store === 'ai_self') {
        if (action !== 'recall') return '日次要約とプロフィールは参照専用です。action=recallを指定してください';
        return recallStaffMemory(store, args);
    }

    // Keep the previous handler argument format working for existing in-flight requests.
    if (!store && (args.type === 'daily' || args.type === 'my_profile' || args.type === 'public_interests')) {
        return recallStaffMemory(args.type, args);
    }
    return 'メモリーのstoreを指定してください';
}
