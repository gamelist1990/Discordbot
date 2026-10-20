import { escapeMarkdown } from 'discord.js';

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
    manage_memory: 'メモリー',
    manage_schedule: 'スケジュール',
    output_file: 'ファイル出力',
    calculate_bash: '計算',
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
            case 'output_file': return safePreview(args.filename) ? `「${safePreview(args.filename)}」を添付` : 'ファイルを添付';
            case 'web_search': return safePreview(args.query) ? `「${safePreview(args.query)}」を検索` : '検索語句を準備中';
            case 'get_weather': return safePreview(args.prefecture) ? `${safePreview(args.prefecture)}の天気` : '地域の天気を確認';
            case 'count_phrase_in_channel': return safePreview(args.phrase) ? `「${safePreview(args.phrase)}」を確認` : 'チャンネルの発言を調査';
            case 'get_time': return '現在時刻を確認';
            case 'calculate_bash': return 'Bashで数値計算';
            case 'manage_schedule': return args.action === 'list' ? '本人の予約一覧を確認'
                : args.action === 'cancel' ? '予約を取り消し'
                : args.mode === 'task' || args.task ? '指定時刻のAI処理を予約' : 'メンション通知を予約';
            case 'get_server_status': return 'サーバーの情報を取得';
            case 'collect_channel_history': return '最近の投稿を確認';
            case 'fetch_message_link_context': return '指定メッセージを確認';
            case 'manage_memory': {
                const memoryStore = args.store ?? args.type;
                const store = memoryStore === 'server_memos' ? '共有メモ'
                    : memoryStore === 'daily' ? '日次要約'
                    : memoryStore === 'my_profile' ? '本人プロフィール'
                    : memoryStore === 'public_interests' ? '公開プロフィール' : 'メモリー';
                const action = args.action === 'search' ? 'を検索'
                    : args.action === 'list' ? '一覧を取得'
                    : args.action === 'create' ? 'を作成'
                    : args.action === 'update' ? 'を更新'
                    : args.action === 'delete' ? 'を削除'
                    : args.action === 'get' || args.action === 'recall' ? 'を取得' : 'を処理';
                return `${store}${action}`;
            }
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
