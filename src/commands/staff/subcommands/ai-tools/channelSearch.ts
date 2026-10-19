import { PermissionsBitField, type ChatInputCommandInteraction, type Message } from 'discord.js';
import type { OpenAITool, ToolHandler } from '../../../../types/openai.js';

const SNOWFLAKE = /^\d{17,20}$/;
const MAX_SCANNED = 1000;

function id(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return SNOWFLAKE.test(text) ? text : null;
}

function positive(value: unknown, fallback: number, max: number): number {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
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
        description: 'Discord内で古い発言を探す。実際のチャンネル履歴をキーワードで最大1000件まで100件ずつ遡って検索。特定メッセージはfetch_discord_messageで取得。過去の会話、以前に誰かが言った話題、検索の依頼で使う。',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '検索語句（部分一致、大文字小文字を区別しない）。' },
                channel_id: { type: 'string', description: '省略時は現在のチャンネル。指定時は同じサーバー内の権限があるチャンネルID。' },
                limit: { type: 'integer', minimum: 1, maximum: 15, description: '返す最大件数（初期値8）。' },
                scan_limit: { type: 'integer', minimum: 1, maximum: 1000, description: '確認する過去の発言数。初期500、最大1000。' },
                before: { type: 'string', description: 'さらに古く遡る場合、前回のnext_beforeで返されたメッセージID。' },
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
    const results: ReturnType<typeof data>[] = [];
    let scanned = 0;
    let before = startBefore ?? undefined;
    let exhausted = false;
    while (scanned < scanLimit && results.length < resultLimit) {
        const size = Math.min(100, scanLimit - scanned);
        let page: Awaited<ReturnType<typeof channel.messages.fetch>>;
        try { page = await channel.messages.fetch({ limit: size, ...(before ? { before } : {}) }); }
        catch { return 'SEARCH_ERROR: Discord APIの履歴取得に失敗しました。'; }
        const messages = Array.from(page.values()).sort((a, b) =>
            BigInt(a.id) > BigInt(b.id) ? -1 : BigInt(a.id) < BigInt(b.id) ? 1 : 0);
        if (!messages.length) { exhausted = true; break; }
        scanned += messages.length;
        for (const message of messages) {
            if ((message.content ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
                results.push(data(message, access.guildId!, channel.id, 850));
                if (results.length >= resultLimit) break;
            }
        }
        const next = messages.at(-1)!.id;
        if (before === next) break;
        before = next;
        if (messages.length < size) { exhausted = true; break; }
    }
    return JSON.stringify({
        query, channel_id: channel.id, scanned, results,
        next_before: exhausted ? null : before ?? null,
        note: '検索できた範囲のみを返しています。古い会話が存在しないと断言するものではありません。',
    });
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
