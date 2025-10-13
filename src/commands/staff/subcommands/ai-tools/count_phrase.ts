import { OpenAITool, ToolHandler } from '../../../../types/openai';
import { ChatInputCommandInteraction, Message, GuildTextBasedChannel } from 'discord.js';

/**
 * 指定したチャンネル（省略時は現在のチャンネル）で、指定ユーザーが指定フレーズを発言した回数を数えるツール
 * args: { phrase: string, channel_id?: string, max_messages?: number }
 * - max_messages は検索上限。デフォルトは 500 件（内部上限は 100000）。
 */
export const countPhraseToolDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'count_phrase_in_channel',
        description: '指定ユーザーが指定チャンネルで特定のフレーズを発言した回数をカウントします。',
        parameters: {
            type: 'object',
            properties: {
                phrase: { type: 'string', description: '検索するフレーズ（部分一致・大文字小文字を区別しない）。' },
                channel_id: { type: 'string', description: '検索対象のチャンネルID。省略した場合は現在のチャンネルを使用。' },
                max_messages: { type: 'number', description: '検索する最大メッセージ数の上限（負荷軽減のため）。省略で上限なし（内部最大100000）。' }
            },
            required: ['phrase']
        }
    }
};

export const countPhraseToolHandler: ToolHandler = async (args: { phrase: string; channel_id?: string; max_messages?: number }, context?: any) => {
    try {
        if (!context || !context.guild) {
            return { error: 'このツールはサーバー内でのみ使用できます' };
        }

        const interaction = context as ChatInputCommandInteraction;
        const guild = interaction.guild!;

        const phrase = args.phrase;
        const channelId = args.channel_id || (interaction.channel ? (interaction.channel as any).id : undefined);
        const maxMessagesArg = args.max_messages ?? null;

        if (!channelId) {
            return { error: 'チャンネルが指定されていません（コマンド発行チャンネルまたは channel_id を指定してください）' };
        }

        const channel = guild.channels.cache.get(channelId) as GuildTextBasedChannel | undefined;
        if (!channel) {
            return { error: `チャンネル ${channelId} を見つけられませんでした` };
        }

        // 権限チェック: Botがチャンネルを閲覧・履歴を読む権限を持っているか
        const botMember = guild.members.cache.get(interaction.client.user!.id) || await guild.members.fetch(interaction.client.user!.id);
        const mePerms = channel.permissionsFor(botMember as any);
        if (mePerms && !mePerms.has('ViewChannel')) {
            return { error: 'Bot にチャンネル閲覧権限がありません' };
        }
        if (mePerms && !mePerms.has('ReadMessageHistory')) {
            return { error: 'Bot にメッセージ履歴閲覧権限がありません' };
        }

        // メッセージをチャンクでフェッチして検索
        const limitPerFetch = 100; // Discord API の最大
        let fetched = 0;
        const DEFAULT_INTERNAL_MAX = 500;
        const internalMax = Math.min(Math.max(0, maxMessagesArg || DEFAULT_INTERNAL_MAX) || DEFAULT_INTERNAL_MAX, 100000); // 内部上限
        let before: string | undefined = undefined;
        const matches: { id: string; content: string; createdAt: string; author: { id: string; username: string; discriminator?: string; displayName?: string } }[] = [];
        const userCounts: Record<string, number> = {};

        const lowerPhrase = phrase.toLowerCase();

        while (true) {
            if (internalMax && fetched >= internalMax) break;
            const toFetch = Math.min(limitPerFetch, internalMax ? (internalMax - fetched) : limitPerFetch);

            const msgs = await channel.messages.fetch({ limit: toFetch, before });
            if (!msgs || msgs.size === 0) break;

            // iterate
            for (const m of msgs.values() as Iterable<Message>) {
                fetched++;
                const content = (m.content || '').toLowerCase();
                if (content.includes(lowerPhrase)) {
                    matches.push({
                        id: m.id,
                        content: m.content,
                        createdAt: m.createdAt.toISOString(),
                        author: {
                            id: m.author.id,
                            username: m.author.username,
                            discriminator: (m.author as any).discriminator,
                            displayName: (m as any).member?.displayName || undefined
                        }
                    });

                    userCounts[m.author.id] = (userCounts[m.author.id] || 0) + 1;
                }
            }

            // 次のバッチの before を設定（最古のメッセージの id）
            const last = msgs.last();
            if (!last) break;
            before = last.id;

            // 取得件数が limit より少なければ終了
            if (msgs.size < toFetch) break;

            // safety: ループが長くならないように短い休止を入れる（API負荷軽減）
            await new Promise(r => setTimeout(r, 50));
        }

        return {
            channel_id: channelId,
            phrase: phrase,
            total_matches: matches.length,
            checked_messages: fetched,
            sample_matches: matches.slice(0, 10),
            user_counts: userCounts,
            note: internalMax >= 100000 ? undefined : `検索上限: ${internalMax} 件`
        };
    } catch (error) {
        console.error('Error in countPhraseToolHandler:', error);
        return { error: `検索中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}` };
    }
};
