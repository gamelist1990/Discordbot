import { PermissionsBitField, type ChatInputCommandInteraction, type Message } from 'discord.js';
import type { OpenAITool, ToolHandler } from '../../../../types/openai.js';

const SNOWFLAKE = /^\d{17,20}$/;
const MAX_SCANNED = 1000;
const MAX_CONTEXT_PER_SIDE = 20;
const DEFAULT_CONTEXT_PER_SIDE = 10;
const MAX_SEARCH_RESPONSE_CHARS = 40_000;

function id(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return SNOWFLAKE.test(text) ? text : null;
}

function positive(value: unknown, fallback: number, max: number): number {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
}

function contextSize(value: unknown): number {
    if (value === undefined || value === null) return DEFAULT_CONTEXT_PER_SIDE;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_CONTEXT_PER_SIDE) : DEFAULT_CONTEXT_PER_SIDE;
}

function compareSnowflakes(a: string, b: string): number {
    return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}

export async function staffReadableChannel(context: unknown, requestedChannel: unknown) {
    const interaction = context as ChatInputCommandInteraction | null;
    if (!interaction?.guildId || !interaction.user?.id || !interaction.guild || !interaction.client) {
        return { error: 'DISCORD_ERROR: Discordサーバー内の/staff aiから実行してください。' };
    }
    const channelId = requestedChannel == null ? interaction.channelId : id(requestedChannel);
    if (!channelId) return { error: 'DISCORD_ERROR: チャンネルIDが不正です。' };
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.guildId !== interaction.guildId || !channel.isTextBased()
        || !('messages' in channel) || !channel.messages?.fetch
        || !('permissionsFor' in channel) || !channel.permissionsFor) {
        return { error: 'DISCORD_ERROR: 指定されたチャンネルの履歴を参照できません。' };
    }
    const requester = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const bot = interaction.client.user;
    const required = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory];
    const canRead = (subject: any) => subject && channel.permissionsFor(subject)?.has(required);
    if (!canRead(requester) || !canRead(bot)) {
        return { error: 'DISCORD_DENIED: 依頼者またはBotに閲覧・履歴権限がありません。' };
    }
    return { channel, guildId: interaction.guildId };
}

export const searchChannelMessagesDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'search_channel_messages',
        description: 'Discordの古い会話をキーワードで検索。ヒットした投稿だけでなく前後各10件（調整可、各最大20件）をDiscord APIで自動fetchし、時系列の会話文脈とともに返す。最大1000件まで遡れる。文脈のない断片から話題・発言者を推測しない。',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '検索語句（本文の部分一致、大文字小文字を区別しない）。' },
                channel_id: { type: 'string', description: '省略時は現在のチャンネル。別チャンネルは同一サーバーで閲覧権限必須。' },
                limit: { type: 'integer', minimum: 1, maximum: 15, description: '返すヒット数（初期値8）。' },
                scan_limit: { type: 'integer', minimum: 1, maximum: 1000, description: '過去に調べるメッセージ数（初期値500、最大1000）。' },
                before: { type: 'string', description: 'さらに古く検索するときのnext_before。' },
                context_before: { type: 'integer', minimum: 0, maximum: 20, description: '各ヒットより前（古い）のメッセージ取得数。初期値10。' },
                context_after: { type: 'integer', minimum: 0, maximum: 20, description: '各ヒットより後（新しい）のメッセージ取得数。初期値10。' },
                include_context: { type: 'boolean', description: '前後文脈を取得するか。初期値true。falseでヒット一覧のみ。' },
            },
            required: ['query'],
        },
    },
};

export const fetchDiscordMessageDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'fetch_discord_message',
        description: '特定のDiscord発言をIDまたはURLで直接fetchし本文・添付・投稿日時・元リンクを取得。検索結果を詳しく確認するときにも使用可能。',
        parameters: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: 'DiscordメッセージID（message_urlといずれか一方）。' },
                message_url: { type: 'string', description: 'DiscordのメッセージURL（https://discord.com/channels/...）。' },
                channel_id: { type: 'string', description: 'message_idと併用するチャンネルID。省略時は現在のチャンネル。' },
            },
        },
    },
};

function data(message: Message, guild: string, channel: string, maxChars: number) {
    return {
        message_id: message.id,
        author_id: message.author?.id,
        author: message.member?.displayName || message.author?.username || 'unknown',
        created_at: message.createdAt?.toISOString?.() ?? null,
        content: (message.content || '').slice(0, maxChars),
        truncated: (message.content?.length || 0) > maxChars,
        attachments: [...(message.attachments?.values?.() || [])].slice(0, 5)
            .map(file => ({ name: file.name, url: file.url, content_type: file.contentType })),
        url: 'https://discord.com/channels/' + guild + '/' + channel + '/' + message.id,
    };
}

/** Compact context keeps long conversations within Qwopus' context budget. */
function contextMessage(message: Message) {
    return {
        message_id: message.id,
        author: message.member?.displayName || message.author?.username || 'unknown',
        created_at: message.createdAt?.toISOString?.() ?? null,
        content: (message.content || '').slice(0, 180),
        truncated: (message.content?.length || 0) > 180,
        attachments: [...(message.attachments?.values?.() || [])].slice(0, 2)
            .map(file => file.name),
    };
}

type ContextMessage = ReturnType<typeof contextMessage>;
interface NearbyContext {
    before: ContextMessage[];
    after: ContextMessage[];
    requested_before: number;
    requested_after: number;
    status: 'ok' | 'unavailable' | 'partial';
    error?: string;
    truncated_for_budget?: boolean;
}

function trimSearchResponse(payload: { results: Array<{ context?: NearbyContext }> }): void {
    // The model needs actual chronological conversation, not a 100KB tool response.
    // Prefer keeping nearest messages and at least the hit itself.
    let size = JSON.stringify(payload).length;
    while (size > MAX_SEARCH_RESPONSE_CHARS) {
        const candidate = payload.results
            .map(hit => hit.context)
            .filter((context): context is NearbyContext => !!context && (context.before.length > 0 || context.after.length > 0))
            .sort((a, b) => (b.before.length + b.after.length) - (a.before.length + a.after.length))[0];
        if (!candidate) break;
        if (candidate.before.length > candidate.after.length) candidate.before.shift();
        else if (candidate.after.length) candidate.after.pop();
        else candidate.before.shift();
        candidate.truncated_for_budget = true;
        candidate.status = 'partial';
        size = JSON.stringify(payload).length;
    }
}

export const searchChannelMessagesHandler: ToolHandler = async (args, context) => {
    const query = String(args?.query ?? '').trim();
    if (!query || query.length > 180) return 'SEARCH_ERROR: queryは1〜180文字で指定してください。';
    const startBefore = args?.before == null ? null : id(args.before);
    if (args?.before != null && !startBefore) return 'SEARCH_ERROR: beforeにはメッセージIDを指定してください。';
    const access = await staffReadableChannel(context, args?.channel_id);
    if ('error' in access) return access.error;
    const channel = access.channel;
    const scanLimit = positive(args?.scan_limit, 500, MAX_SCANNED);
    const resultLimit = positive(args?.limit, 8, 15);
    const includeContext = args?.include_context !== false;
    const beforeCount = includeContext ? contextSize(args?.context_before) : 0;
    const afterCount = includeContext ? contextSize(args?.context_after) : 0;
    const matches: Message[] = [];
    let scanned = 0;
    let before = startBefore ?? undefined;
    let exhausted = false;

    while (scanned < scanLimit && matches.length < resultLimit) {
        const size = Math.min(100, scanLimit - scanned);
        let page: Awaited<ReturnType<typeof channel.messages.fetch>>;
        try { page = await channel.messages.fetch({ limit: size, ...(before ? { before } : {}) }); }
        catch { return 'SEARCH_ERROR: Discord APIの履歴取得に失敗しました。'; }
        const messages = Array.from(page.values()).sort((a, b) => compareSnowflakes(b.id, a.id));
        if (!messages.length) { exhausted = true; break; }

        let processed = 0;
        for (const message of messages) {
            processed += 1;
            if ((message.content ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
                matches.push(message);
                if (matches.length >= resultLimit) break;
            }
        }
        scanned += processed;
        // When limit hits mid-page, start the next search after the last inspected
        // message rather than skipping uninspected matches on the same Discord page.
        const next = messages[processed - 1].id;
        if (before === next) break;
        before = next;
        if (processed === messages.length && messages.length < size) { exhausted = true; break; }
    }

    const results: Array<ReturnType<typeof data> & { context?: NearbyContext }> = [];
    for (const hit of matches) {
        const result: ReturnType<typeof data> & { context?: NearbyContext } =
            data(hit, access.guildId!, channel.id, 850);
        if (includeContext) {
            const nearby: NearbyContext = {
                before: [], after: [],
                requested_before: beforeCount, requested_after: afterCount, status: 'ok',
            };
            if (beforeCount || afterCount) {
                // One bounded Discord request per match. Unlike search-page snippets,
                // around also fetches messages just outside the scanned window.
                try {
                    const collection = await channel.messages.fetch({
                        around: hit.id,
                        limit: Math.min(100, beforeCount + afterCount + 1),
                    });
                    const timeline = Array.from(collection.values());
                    const older = timeline
                        .filter(item => compareSnowflakes(item.id, hit.id) < 0)
                        .sort((a, b) => compareSnowflakes(b.id, a.id))
                        .slice(0, beforeCount)
                        .reverse();
                    const newer = timeline
                        .filter(item => compareSnowflakes(item.id, hit.id) > 0)
                        .sort((a, b) => compareSnowflakes(a.id, b.id))
                        .slice(0, afterCount);
                    nearby.before = older.map(contextMessage);
                    nearby.after = newer.map(contextMessage);
                    // Nearby may be shorter near the start/end of a channel.
                    // Do not claim those messages exist if Discord did not return them.
                    nearby.status = 'ok';
                } catch {
                    nearby.status = 'unavailable';
                    nearby.error = 'Discordの周辺メッセージ取得に失敗。検索ヒット自体は取得済み。';
                }
            }
            result.context = nearby;
        }
        results.push(result);
    }

    const payload = {
        query, channel_id: channel.id, scanned, results,
        next_before: exhausted ? null : before ?? null,
        note: 'ヒットと周辺発言はいずれもDiscordから取得した実データ。各結果のcontext.beforeは古い順、context.afterは新しい順。contextがunavailableの場合は会話の流れを推測しない。返信関係は自動確定しない。',
    };
    trimSearchResponse(payload);
    return JSON.stringify(payload);
};

export const fetchDiscordMessageHandler: ToolHandler = async (args, context) => {
    let messageId = id(args?.message_id);
    let channelId = args?.channel_id;
    if (args?.message_url) {
        let url: URL;
        try { url = new URL(String(args.message_url)); }
        catch { return 'FETCH_ERROR: Discord URLとして解析できません。'; }
        const match = /^\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/.exec(url.pathname);
        if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com'].includes(url.hostname)
            || !match || match[1] !== (context as ChatInputCommandInteraction)?.guildId) {
            return 'FETCH_DENIED: このサーバー内の正規DiscordメッセージURLだけ参照できます。';
        }
        [, , channelId, messageId] = match;
    }
    if (!messageId) return 'FETCH_ERROR: 有効なmessage_idまたはmessage_urlが必要です。';
    const access = await staffReadableChannel(context, channelId);
    if ('error' in access) return access.error;
    const message = await access.channel.messages.fetch(messageId).catch(() => null) as Message | null;
    if (!message || message.id !== messageId) return 'FETCH_ERROR: 対象のメッセージが見つかりません。';
    return JSON.stringify(data(message, access.guildId!, access.channel.id, 4000));
};
