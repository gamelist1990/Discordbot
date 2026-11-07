import type { ChatInputCommandInteraction } from 'discord.js';
import type { OpenAITool, ToolHandler } from '../../../../types/openai.js';
import {
    jstDateString,
    loadGuildEpisodeStore,
    searchEpisodeRecords,
} from '../../../../core/ai/GuildEpisodeMemory.js';


/**
 * 出来事検索ツール。dot常駐の観測と過去履歴のバックフィルで貯まった
 * 「出来事の長期記憶」を、キーワードの部分一致・主体・日付範囲で引く。
 * 生の発言そのものの確認は search_channel_messages（発言検索）で行う。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dateArg(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return DATE_PATTERN.test(trimmed) ? trimmed : undefined;
}

export const searchServerEpisodesDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'search_server_episodes',
        description: 'サーバーで起きた出来事の長期記録（出来事メモリ）を検索する。キーワードは要約・人物名・チャンネル名への部分一致で、単語に分けて全単語一致も探す。「前に〜という出来事はあった？」「誰が〜と言ったことがある？」のような過去の出来事の確認に使う。出来事は観測と過去履歴の取り込みで自動的に貯まるため、記録が無いことは「起きなかった」証拠にはならない。生の発言そのものは発言検索（search_channel_messages）で確認すること。0件でも言い換えてもう一度探すこと。',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '出来事の内容のキーワード（部分一致、単語に分割して探す）。' },
                actor: { type: 'string', description: '主体の表示名（部分一致）。' },
                from: { type: 'string', description: '開始日 YYYY-MM-DD（日本時間）。' },
                to: { type: 'string', description: '終了日 YYYY-MM-DD（日本時間）。' },
                limit: { type: 'integer', minimum: 1, maximum: 25, description: '返す件数（初期値10）。' },
            },
        },
    },
};

export const searchServerEpisodesHandler: ToolHandler = async (args, context) => {
    const interaction = context as ChatInputCommandInteraction | undefined;
    const guildId = interaction?.guildId;
    if (!guildId) return 'EPISODE_ERROR: サーバー内でのみ使えます。';
    const query = typeof args?.query === 'string' ? args.query.trim() : '';
    const actor = typeof args?.actor === 'string' ? args.actor.trim() : '';
    const from = dateArg(args?.from);
    const to = dateArg(args?.to);
    const limit = Number.isFinite(args?.limit) ? Math.min(25, Math.max(1, Math.floor(args.limit))) : 10;
    const store = await loadGuildEpisodeStore(guildId);
    const hits = searchEpisodeRecords(store.episodes, {
        ...(query ? { query } : {}),
        ...(actor ? { actor } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        limit,
    });
    const episodes = hits.map(hit => ({
        date: hit.date,
        at: new Date(hit.at).toISOString(),
        channel_id: hit.channelId,
        channel: hit.channelName,
        actor: hit.actor,
        summary: hit.summary,
        display: `${hit.date} #${hit.channelName}: ${hit.actor}が、${hit.summary.replace(/。$/, '')}`,
        message_url: hit.channelId ? `https://discord.com/channels/${guildId}/${hit.channelId}/${hit.id}` : undefined,
        match_level: hit.matchLevel,
    }));
    return JSON.stringify({
        episodes,
        total_stored: store.episodes.length,
        backfill: {
            completed: Boolean(store.backfill.completedAt),
            ...(store.backfill.completedAt ? { completed_at: store.backfill.completedAt } : {}),
        },
        today_jst: jstDateString(Date.now()),
        note: '出来事メモリは観測と過去履歴の取り込みで自動的に貯まる記録であり、全発言の網羅ではない。0件は「記録に無い」だけで、起きなかった証拠にはならない。内容を断定する前に、必要なら発言検索で生の発言も確認すること。',
        ...(episodes.length === 0 ? {
            tried: { query, actor, from: from ?? null, to: to ?? null },
            retry_hint: '0件だった。キーワードを短くする・言い換える・日付範囲や主体を外すなど条件を変えて、もう一度探すこと。発言検索（search_channel_messages）で生の発言側も当たること。',
        } : {}),
    });
};
