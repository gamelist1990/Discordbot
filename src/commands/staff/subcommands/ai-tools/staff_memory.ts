import { staffMemoryList } from '../../../../core/ai/StaffAIMemory.js';
import { AsyncLocalStorage } from 'node:async_hooks';

// Explicit guild+requesting-user context, never supplied by model-controlled arguments.
export const staffMemoryToolScope = new AsyncLocalStorage<{ guildId: string; userId: string }>();

export const staffMemoryDefinition = {
    type: 'function' as const,
    function: {
        name: 'recall_staff_memory',
        description: '参照権限のあるStaff AIメモリーから、本人のプロフィールや日次出来事を取得する',
        parameters: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['daily', 'my_profile'] },
                day: { type: 'string', description: 'daily指定の場合に任意の日付（YYYY-MM-DD）' },
            },
            required: ['type'],
            additionalProperties: false,
        },
    },
};

export async function staffMemoryHandler(args: Record<string, unknown>): Promise<string> {
    const scope = staffMemoryToolScope.getStore();
    if (!scope) return 'このリクエストではメモリーの読み取り権限がありません';
    const entries = await staffMemoryList(scope.guildId);
    const filtered = args.type === 'my_profile'
        ? entries.filter(item => item.kind === 'user' && item.userId === scope.userId)
        : entries.filter(item => item.kind === 'daily' && (!args.day || item.day === args.day)).slice(-5);
    return filtered.length
        ? filtered.map(item => `${item.title} (${item.updatedAt}): ${item.content.slice(0, 2500)}`).join('\n')
        : '記録されたメモリーはありません';
}
