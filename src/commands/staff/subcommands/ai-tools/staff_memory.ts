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
                type: { type: 'string', enum: ['daily', 'my_profile', 'public_interests'] },
                day: { type: 'string', description: 'daily指定の場合に任意の日付（YYYY-MM-DD）' },
                userId: { type: 'string', description: 'public_interests指定時の対象DiscordユーザーID' },
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
    if (args.type === 'public_interests') {
        const target = typeof args.userId === 'string' && /^\d{17,20}$/.test(args.userId)
            ? args.userId : scope.userId;
        const profile = entries.find(item => item.kind === 'user' && item.userId === target);
        return profile?.publicInterests?.trim() || 'このユーザーの一般公開可能な趣味・得意分野は記録されていません';
    }
    const filtered = args.type === 'my_profile'
        ? entries.filter(item => item.kind === 'user' && item.userId === scope.userId)
        : entries.filter(item => item.kind === 'daily' && (!args.day || item.day === args.day)).slice(-5);
    return filtered.length
        ? filtered.map(item => `${item.title} (${item.updatedAt}): ${item.content.slice(0, 2500)}`).join('\n')
        : '記録されたメモリーはありません';
}
