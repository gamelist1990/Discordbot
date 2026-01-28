import { OpenAITool, ToolHandler } from '../../../../types/openai';
import { ChatInputCommandInteraction } from 'discord.js';

// チャンネル履歴収集ツール
export const collectHistoryDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'collect_channel_history',
        description: '指定チャンネルの直近の会話履歴を取得します（デフォルトはコマンド実行チャンネル）',
        parameters: {
            type: 'object',
            properties: {
                channel_id: { type: 'string', description: 'チャンネルID（省略時は現在のチャンネル）' },
                limit: { type: 'number', description: '取得するメッセージ数の上限（最大100）', default: 20 },
                since_minutes: { type: 'number', description: '何分以内のメッセージを取得するか（省略時は60）', default: 60 },
                include_bots: { type: 'boolean', description: 'Botのメッセージを含めるか（デフォルト false）', default: false }
            },
            required: []
        }
    }
};

export const collectHistoryHandler: ToolHandler = async (args: { channel_id?: string, limit?: number, since_minutes?: number, include_bots?: boolean }, context?: any) => {
    try {
        if (!context || !context.guild) return { error: 'このツールはギルド内でのみ利用できます' };
        const interaction = context as ChatInputCommandInteraction;
        const client = interaction.client;
        const channelId = args.channel_id || (interaction.channel?.id);
        if (!channelId) return { error: 'チャンネルIDが指定されておらず、現在のチャンネルも特定できませんでした' };

        // チャンネルを取得
        let channel: any;
        try {
            channel = await client.channels.fetch(channelId);
        } catch (e) {
            return { error: `チャンネル ${channelId} を取得できませんでした` };
        }

        if (!channel || !('messages' in channel)) {
            return { error: '指定されたチャンネルはメッセージを保持できません' };
        }

        const limit = Math.max(1, Math.min(100, args.limit ?? 20));
        const sinceMinutes = Math.max(0, args.since_minutes ?? 60);
        const includeBots = args.include_bots ?? false;
        const sinceTs = Date.now() - sinceMinutes * 60 * 1000;

        const fetched = await (channel as any).messages.fetch({ limit });
        const msgs = Array.from((fetched as any).values()) as any[];
        const filtered = msgs
            .filter(m => m.createdTimestamp >= sinceTs)
            .filter(m => includeBots ? true : !m.author.bot)
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
            .map(m => ({ id: m.id, authorId: m.author.id, authorName: (m as any).member?.displayName || m.author.username, isBot: m.author.bot, timestamp: m.createdTimestamp, content: m.content, attachments: (m.attachments?.map ? m.attachments.map((a:any) => ({ id: a.id, url: a.url, contentType: a.contentType })) : []) }));



        return { channel_id: channelId, fetched: filtered.length, messages: filtered };

    } catch (err) {
        console.error('collectHistoryHandler error:', err);
        return { error: 'チャンネル履歴の取得に失敗しました' };
    }
};

// メッセージリンクのコンテキスト取得ツール
export const fetchMessageLinkDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'fetch_message_link_context',
        description: 'Discord のメッセージリンク（https://discord.com/channels/...）の対象メッセージと周辺の文脈を取得します',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'メッセージリンク（必須）' },
                context_limit: { type: 'number', description: '周辺メッセージの取得上限（周辺含め最大100）', default: 5 }
            },
            required: ['url']
        }
    }
};

export const fetchMessageLinkHandler: ToolHandler = async (args: { url: string, context_limit?: number }, context?: any) => {
    try {
        if (!context) return { error: 'このツールは対話コンテキストでのみ利用できます' };
        const interaction = context as ChatInputCommandInteraction;
        const client = interaction.client;

        const url = (args.url || '').trim();
        if (!url) return { error: 'url を指定してください' };

        // パース: /channels/<guildId>/<channelId>/<messageId>
        const re = /discord(?:app)?\.com\/channels\/(\d+|@me)\/(\d+)\/(\d+)/i;
        const m = url.match(re);
        if (!m) return { error: '無効なメッセージリンクです' };

        const guildId = m[1];
        const channelId = m[2];
        const messageId = m[3];

        // チャンネルを取得
        let channel: any;
        try {
            channel = await client.channels.fetch(channelId);
        } catch (e) {
            return { error: `チャンネル ${channelId} を取得できませんでした` };
        }

        if (!channel || !('messages' in channel)) {
            return { error: '指定されたリンク先はメッセージを取得できないチャンネルです' };
        }

        // メッセージと周辺文脈を取得
        const contextLimit = Math.max(1, Math.min(100, args.context_limit ?? 5));
        let message;
        try {
            message = await channel.messages.fetch(messageId);
        } catch (e) {
            return { error: `メッセージ ${messageId} を取得できませんでした` };
        }

        // 周辺メッセージ（around）を取得
        let aroundMsgs = [] as any[];
        try {
            const fetched = await (channel as any).messages.fetch({ around: messageId, limit: contextLimit });
            aroundMsgs = (Array.from((fetched as any).values()) as any[])
                .sort((a: any, b: any) => a.createdTimestamp - b.createdTimestamp)
                .map((m: any) => ({ id: m.id, authorId: m.author.id, authorName: m.member?.displayName || m.author.username, isBot: m.author.bot, timestamp: m.createdTimestamp, content: m.content, attachments: (m.attachments?.map ? m.attachments.map((a:any) => ({ id: a.id, url: a.url })) : []) }));
        } catch (e) {
            // around が失敗した場合はメッセージ単体で返す
            aroundMsgs = [{ id: message.id, authorId: message.author.id, authorName: (message as any).member?.displayName || message.author.username, isBot: message.author.bot, timestamp: message.createdTimestamp, content: message.content, attachments: message.attachments.map(a => ({ id: a.id, url: a.url })) }];
        }

        return { link: url, guild_id: guildId, channel_id: channelId, message_id: messageId, context: aroundMsgs };

    } catch (err) {
        console.error('fetchMessageLinkHandler error:', err);
        return { error: 'メッセージリンクの取得に失敗しました' };
    }
};