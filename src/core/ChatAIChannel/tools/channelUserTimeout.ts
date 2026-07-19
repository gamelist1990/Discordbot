import fs from 'fs/promises';
import path from 'path';
import type { OpenAITool, ToolHandler } from '../../../types/openai.js';
import type { ChatAIChannelTimeoutFile } from '../types.js';
import type { ChatAIToolRegistrar } from './types.js';

const MIN_DURATION_SECONDS = 1;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;

type TimeoutToolContext = {
    client?: { user?: { id?: string } };
    guildId?: string;
    channelId?: string;
    allowedUserIds?: string[];
};

const definition: OpenAITool = {
    type: 'function',
    function: {
        name: 'channel_user_timeout',
        description: '現在のAI会話に参加しているユーザーが、注意後も嫌がらせ・脅し・執拗な妨害を続けた場合だけ、そのAIチャンネルへの投稿を1秒〜7日停止します。Discord標準タイムアウトではありません。',
        parameters: {
            type: 'object',
            properties: {
                userId: { type: 'string', description: '対象DiscordユーザーID。現在の会話参加者に限ります。' },
                durationSeconds: { type: 'number', minimum: MIN_DURATION_SECONDS, maximum: MAX_DURATION_SECONDS, description: '停止期間（秒）。必要最小限にします。' },
                reason: { type: 'string', description: '観測できた具体的な問題行動と、停止が必要な理由。' },
            },
            required: ['userId', 'durationSeconds', 'reason'],
        },
    },
};

async function readTimeouts(timeoutFile: string): Promise<ChatAIChannelTimeoutFile> {
    try {
        const parsed = JSON.parse(await fs.readFile(timeoutFile, 'utf8')) as Partial<ChatAIChannelTimeoutFile>;
        return {
            entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {},
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return { entries: {}, updatedAt: new Date().toISOString() };
    }
}

async function writeTimeouts(timeoutFile: string, data: ChatAIChannelTimeoutFile): Promise<void> {
    data.updatedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(timeoutFile), { recursive: true });
    const temporaryFile = `${timeoutFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(temporaryFile, timeoutFile);
}

export function createChannelUserTimeoutHandler(timeoutFile: string): ToolHandler {
    return async (args, context?: TimeoutToolContext) => {
        const userId = String(args?.userId || '').trim();
        const durationSeconds = Math.round(Number(args?.durationSeconds));
        const reason = String(args?.reason || '').trim().slice(0, 300);
        const guildId = String(context?.guildId || '');
        const channelId = String(context?.channelId || '');

        if (!/^\d{5,32}$/.test(userId)) return 'CHANNEL_TIMEOUT_ERROR: 有効なユーザーIDが必要です。';
        if (!guildId || !channelId) return 'CHANNEL_TIMEOUT_ERROR: 現在のチャンネルを特定できません。';
        if (!context?.allowedUserIds?.includes(userId)) return 'CHANNEL_TIMEOUT_ERROR: 対象は現在の会話参加者に限られます。';
        if (userId === context.client?.user?.id) return 'CHANNEL_TIMEOUT_ERROR: Bot自身は対象にできません。';
        if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_DURATION_SECONDS || durationSeconds > MAX_DURATION_SECONDS) {
            return `CHANNEL_TIMEOUT_ERROR: 期間は${MIN_DURATION_SECONDS}〜${MAX_DURATION_SECONDS}秒で指定してください。`;
        }
        if (reason.length < 5) return 'CHANNEL_TIMEOUT_ERROR: 具体的な理由が必要です。';

        const data = await readTimeouts(timeoutFile);
        const now = Date.now();
        const entry = {
            userId,
            guildId,
            channelId,
            reason,
            createdAt: new Date(now).toISOString(),
            expiresAt: new Date(now + durationSeconds * 1000).toISOString(),
        };
        data.entries[`${channelId}:${userId}`] = entry;
        await writeTimeouts(timeoutFile, data);
        return JSON.stringify({ status: 'CHANNEL_TIMEOUT_SET', durationSeconds, ...entry });
    };
}

export const registerChannelUserTimeoutTool: ChatAIToolRegistrar = (manager, context) => {
    manager.registerTool(definition, createChannelUserTimeoutHandler(context.timeoutFile));
};
