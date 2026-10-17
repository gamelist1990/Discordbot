import { EmbedBuilder, escapeMarkdown } from 'discord.js';

export type StaffToolView = {
    name: string;
    arguments: string;
    phase: '準備中' | '実行中' | '完了' | '失敗';
};

const LABELS: Record<string, string> = {
    web_search: 'Web検索',
    get_server_status: 'サーバー状況',
    get_weather: '天気',
    get_time: '時刻',
    get_user_details: 'ユーザー情報',
    get_anticheat_user_profile: 'AntiCheat情報',
    count_phrase_in_channel: 'フレーズ調査',
    collect_channel_history: '会話履歴',
    fetch_message_link_context: 'メッセージ取得',
    list_memos: 'メモ一覧',
    get_memo: 'メモ取得',
    create_memo: 'メモ作成',
    update_memo: 'メモ更新',
    delete_memo: 'メモ削除',
    search_memos: 'メモ検索',
};

function safePreview(value: unknown): string {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim().replace(/[\r\n\t]/g, ' ');
    return escapeMarkdown(trimmed.slice(0, 120))
        .replace(/@/g, '@\u200b')
        .replace(/</g, '‹');
}

export function describeStaffTool(tool: StaffToolView): { name: string; value: string } {
    let args: Record<string, unknown> = {};
    try {
        const parsed: unknown = JSON.parse(tool.arguments);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            args = parsed as Record<string, unknown>;
        }
    } catch { /* incomplete SSE arguments; never dump raw JSON or secrets */ }
    const label = LABELS[tool.name] ?? 'ツール処理';
    const subject = (() => {
        switch (tool.name) {
            case 'web_search': return safePreview(args.query) ? `「${safePreview(args.query)}」を検索` : '検索語句を準備中';
            case 'get_weather': return safePreview(args.prefecture) ? `${safePreview(args.prefecture)}の天気` : '地域の天気を確認';
            case 'count_phrase_in_channel': return safePreview(args.phrase) ? `「${safePreview(args.phrase)}」を確認` : 'チャンネルの発言を調査';
            case 'get_time': return '現在時刻を確認';
            case 'get_server_status': return 'サーバーの情報を取得';
            case 'collect_channel_history': return '最近の投稿を確認';
            case 'fetch_message_link_context': return '指定メッセージを確認';
            case 'search_memos': return safePreview(args.query) ? `「${safePreview(args.query)}」のメモを検索` : 'メモを検索';
            default: return label + 'を処理';
        }
    })();
    const symbol = tool.phase === '完了' ? '✅'
        : tool.phase === '失敗' ? '❌'
        : tool.phase === '実行中' ? '⏳' : '🔄';
    return {
        name: `${symbol} ${label}`,
        value: `${subject} · ${tool.phase}`,
    };
}

export function buildStaffToolEmbed(tools: StaffToolView[]): EmbedBuilder | null {
    if (!tools.length) return null;
    const latest = tools.slice(-3);
    const failed = latest.some(tool => tool.phase === '失敗');
    const active = latest.some(tool => tool.phase === '実行中' || tool.phase === '準備中');
    return new EmbedBuilder()
        .setColor(failed ? 0xef4444 : active ? 0xf59e0b : 0x22c55e)
        .setTitle(active ? '🛠️ ツール実行中' : '🛠️ ツール実行履歴')
        .addFields(latest.map(describeStaffTool));
}

export function buildStaffThinkingEmbed(
    thinking: string,
    isComplete: boolean,
    isWaiting: boolean,
): EmbedBuilder | null {
    if (!thinking && (!isWaiting || isComplete)) return null;
    const text = thinking
        ? thinking.slice(-700)
        : '応答を準備中…';
    return new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle(isComplete ? '🧠 Thinking' : '🧠 Thinking · 進行中')
        .setDescription(text);
}
