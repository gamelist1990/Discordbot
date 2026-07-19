import fs from 'fs/promises';
import path from 'path';
import type { OpenAITool, ToolHandler } from '../../../types/openai.js';
import type { ChatAIMemoryFile, ChatAIUserMemory } from '../types.js';
import type { ChatAIToolRegistrar } from './types.js';

const MAX_ALIASES = 10;
const MAX_LIKES = 20;
const MAX_NOTES = 30;

export const userMemoryEditDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'user_memory_edit',
        description: '常駐AIのuser-memory.jsonを安全に参照・更新します。ユーザー一覧の取得、1ユーザーの取得、既存ユーザーの部分更新、ユーザー削除ができます。会話で明確に確認できた非センシティブな情報だけを保存してください。',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['list', 'get', 'update', 'delete'],
                    description: '実行する操作',
                },
                userId: {
                    type: 'string',
                    description: 'get/update/delete対象のDiscordユーザーID',
                },
                displayName: { type: 'string', description: '更新する表示名' },
                aliases: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '置換する別名一覧。省略時は変更しません。',
                },
                profile: { type: 'string', description: '更新する短いプロフィール' },
                likes: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '置換する好み一覧。省略時は変更しません。',
                },
                notes: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '置換する安全なメモ一覧。省略時は変更しません。',
                },
                appendNotes: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '既存メモを消さず、重要な会話履歴を追記します。重複は除外されます。',
                },
                trustScore: {
                    type: 'number',
                    minimum: 0,
                    maximum: 100,
                    description: '観測済みの対話に基づく会話上の信頼スコア。通常は50、協力的な対話で徐々に上げ、嫌がらせで下げます。',
                },
                conversationTone: {
                    type: 'string',
                    description: 'このユーザーへ話す際の望ましい会話トーン。例: 簡潔でフレンドリー。空文字で削除します。',
                },
                cautions: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '会話時の非センシティブで具体的な注意事項。人物評価ではなく応答方法として記述します。空配列で削除できます。',
                },
                relationshipTone: {
                    type: ['string', 'null'],
                    enum: ['friendly', 'neutral', 'firm', null],
                    description: '現在の関係性に応じた応答姿勢。friendly=親しみ、neutral=通常、firm=境界を明確にした簡潔な対応。nullで削除します。',
                },
                relationshipContext: {
                    type: ['string', 'null'],
                    description: '応答姿勢の根拠となる、直近の会話で観測できた簡潔な文脈。人格評価ではなく会話上の事実だけを記録します。nullまたは空文字で削除します。',
                },
                boundaryState: {
                    type: ['string', 'null'],
                    enum: ['clear', 'awaiting-apology', null],
                    description: '会話上の境界状態。clear=通常、awaiting-apology=明確な謝罪と行動改善が確認できるまで毅然と対応。nullで削除します。',
                },
                suspectedAltOf: {
                    type: ['string', 'null'],
                    description: '関連アカウント候補。nullで削除します。',
                },
            },
            required: ['action'],
        },
    },
};

function cleanString(value: unknown, maxLength: number): string {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cleanList(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return Array.from(new Set(
        value
            .map(entry => cleanString(entry, maxLength))
            .filter(Boolean),
    )).slice(0, maxItems);
}

async function readMemory(memoryFile: string): Promise<ChatAIMemoryFile> {
    try {
        const raw = await fs.readFile(memoryFile, 'utf8');
        const parsed = JSON.parse(raw) as Partial<ChatAIMemoryFile>;
        return {
            users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {},
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
        return { users: {}, updatedAt: new Date().toISOString() };
    }
}

async function writeMemoryAtomic(memoryFile: string, memory: ChatAIMemoryFile): Promise<void> {
    memory.updatedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(memoryFile), { recursive: true });
    const temporaryFile = `${memoryFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(memory, null, 2), 'utf8');
    await fs.rename(temporaryFile, memoryFile);
}

export function createUserMemoryEditHandler(memoryFile: string): ToolHandler {
    return async (args) => {
        const action = cleanString(args?.action, 20);
        const memory = await readMemory(memoryFile);

        if (action === 'list') {
            return JSON.stringify({
                users: Object.values(memory.users).map(user => ({
                    userId: user.userId,
                    displayName: user.displayName,
                    aliases: user.aliases,
                    profile: user.profile,
                    likes: user.likes,
                    notes: user.notes,
                    trustScore: user.trustScore,
                    conversationTone: user.conversationTone,
                    cautions: user.cautions,
                    relationshipTone: user.relationshipTone,
                    relationshipContext: user.relationshipContext,
                    boundaryState: user.boundaryState,
                    suspectedAltOf: user.suspectedAltOf,
                    updatedAt: user.updatedAt,
                })),
                updatedAt: memory.updatedAt,
            });
        }

        const userId = cleanString(args?.userId, 32);
        if (!/^\d{5,32}$/.test(userId)) {
            return 'USER_MEMORY_ERROR: get/update/deleteには有効なDiscordユーザーIDが必要です。';
        }

        if (action === 'get') {
            const user = memory.users[userId];
            return user
                ? JSON.stringify(user)
                : `USER_MEMORY_NOT_FOUND: ${userId}`;
        }

        if (action === 'delete') {
            if (!memory.users[userId]) return `USER_MEMORY_NOT_FOUND: ${userId}`;
            delete memory.users[userId];
            await writeMemoryAtomic(memoryFile, memory);
            return `USER_MEMORY_DELETED: ${userId}`;
        }

        if (action !== 'update') {
            return `USER_MEMORY_ERROR: 未対応のactionです: ${action || '(empty)'}`;
        }

        const existing = memory.users[userId];
        if (!existing) {
            return `USER_MEMORY_NOT_FOUND: ${userId}。新規ユーザーはDiscord発言の観測後にのみ作成されます。`;
        }

        const next: ChatAIUserMemory = { ...existing };
        if (typeof args?.displayName === 'string') {
            const displayName = cleanString(args.displayName, 100);
            if (displayName) next.displayName = displayName;
        }
        const aliases = cleanList(args?.aliases, MAX_ALIASES, 100);
        if (aliases) next.aliases = aliases;
        if (typeof args?.profile === 'string') next.profile = cleanString(args.profile, 500);
        const likes = cleanList(args?.likes, MAX_LIKES, 100);
        if (likes) next.likes = likes;
        const notes = cleanList(args?.notes, MAX_NOTES, 200);
        if (notes) next.notes = notes;
        const appendNotes = cleanList(args?.appendNotes, MAX_NOTES, 200);
        if (appendNotes?.length) {
            next.notes = Array.from(new Set([...(next.notes || []), ...appendNotes])).slice(-MAX_NOTES);
        }
        if (Number.isFinite(Number(args?.trustScore))) {
            next.trustScore = Math.max(0, Math.min(100, Math.round(Number(args.trustScore))));
        }
        if (typeof args?.conversationTone === 'string') {
            const conversationTone = cleanString(args.conversationTone, 300);
            if (conversationTone) next.conversationTone = conversationTone;
            else delete next.conversationTone;
        }
        const cautions = cleanList(args?.cautions, 15, 200);
        if (cautions) next.cautions = cautions;
        if (args?.relationshipTone === null) {
            delete next.relationshipTone;
        } else if (['friendly', 'neutral', 'firm'].includes(String(args?.relationshipTone))) {
            next.relationshipTone = args.relationshipTone as ChatAIUserMemory['relationshipTone'];
        }
        if (args?.relationshipContext === null) {
            delete next.relationshipContext;
        } else if (typeof args?.relationshipContext === 'string') {
            const relationshipContext = cleanString(args.relationshipContext, 300);
            if (relationshipContext) next.relationshipContext = relationshipContext;
            else delete next.relationshipContext;
        }
        if (args?.boundaryState === null) {
            delete next.boundaryState;
        } else if (['clear', 'awaiting-apology'].includes(String(args?.boundaryState))) {
            next.boundaryState = args.boundaryState as ChatAIUserMemory['boundaryState'];
        }
        if (args?.suspectedAltOf === null) {
            delete next.suspectedAltOf;
        } else if (typeof args?.suspectedAltOf === 'string') {
            const suspectedAltOf = cleanString(args.suspectedAltOf, 80);
            if (suspectedAltOf) next.suspectedAltOf = suspectedAltOf;
            else delete next.suspectedAltOf;
        }
        next.updatedAt = new Date().toISOString();
        memory.users[userId] = next;
        await writeMemoryAtomic(memoryFile, memory);
        return JSON.stringify({ status: 'USER_MEMORY_UPDATED', user: next });
    };
}

export const registerUserMemoryEditTool: ChatAIToolRegistrar = (manager, context) => {
    manager.registerTool(userMemoryEditDefinition, createUserMemoryEditHandler(context.memoryFile));
};
