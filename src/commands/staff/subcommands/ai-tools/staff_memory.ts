import { AsyncLocalStorage } from 'node:async_hooks';
import { staffMemoryList } from '../../../../core/ai/StaffAIMemory.js';
import { serverMemoAction } from './memo.js';

export const staffMemoryToolScope = new AsyncLocalStorage<{ guildId: string; userId: string }>();
export const staffMemoryDefinition = {
    type: 'function' as const,
    function: {
        name: 'manage_memory',
        description: 'dailyは日次要約の参照(action=recall)。server_memosはカスタム共有メモのlist/search/get/create/update/delete。作成・変更・削除はユーザーの明示依頼時だけ。個人プロフィールは保存しない。',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['recall','list','search','get','create','update','delete'] },
                store: { type: 'string', enum: ['daily','server_memos'] },
                day: { type: 'string' }, query: { type: 'string' }, id: { type: 'string' },
                title: { type: 'string' }, content: { type: 'string' }, limit: { type: 'number' },
            },
            required: ['action','store'], additionalProperties: false,
        },
    },
};
export async function staffMemoryHandler(args: Record<string, unknown>, context?: unknown): Promise<string | object> {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { error: 'storeとactionを指定してください' };
    if (args.store === 'server_memos') return serverMemoAction(String(args.action), args, context);
    if (args.store === 'daily' && args.action === 'recall') {
        const scope = staffMemoryToolScope.getStore();
        if (!scope) return { error: 'このリクエストではメモリーの読み取り権限がありません' };
        const entries = (await staffMemoryList(scope.guildId))
            .filter(item => item.kind === 'daily' && (typeof args.day !== 'string' || item.day === args.day)).slice(-5);
        return entries.length ? entries.map(item => `${item.title}: ${item.content.slice(0,2500)}`).join('\n') : '記録されたメモリーはありません';
    }
    return { error: 'storeとactionを指定してください。dailyはrecall、server_memosはlist/search/get/create/update/delete。ユーザー別記憶は廃止されました。' };
}
