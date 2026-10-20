import { toolResultError } from './ToolResultStatus.js';

/** Result metadata for Discord progress; never copy arbitrary returned text or private records. */
export function toolResultSummary(name: string, args: unknown, result: unknown): string {
    if (name === 'fetch_url' && typeof result === 'string' && toolResultError(result)) {
        if (/FETCH_ERROR: DNS_NOT_FOUND:/.test(result)) return 'DNS解決失敗：ホスト名を確認してください';
        if (/FETCH_ERROR: JS_REQUIRED:/.test(result)) return 'HTMLに本文がありません：JavaScript描画が必要な可能性';
        if (/FETCH_ERROR: BODY_EMPTY:/.test(result)) return '本文なし：記事本文を取得できませんでした';
        if (/FETCH_ERROR: NEWS_AGGREGATOR:/.test(result)) return 'Google Newsから元記事を解決できませんでした';
        if (/FETCH_ERROR: NETWORK_ERROR:/.test(result)) return 'HTTP通信に失敗しました';
        if (/FETCH_ERROR: TIMEOUT:/.test(result)) return 'ページ取得がタイムアウトしました';
        if (/FETCH_ERROR: BROWSER_UNAVAILABLE:/.test(result)) return 'Chrome取得サービスを利用できません';
        if (/FETCH_ERROR: ACCESS_CHALLENGE:/.test(result)) return 'サイトの認証・CAPTCHAで取得できません';
        const status = result.match(/FETCH_ERROR: HTTP_(\d{3}):/)?.[1];
        if (status) return `HTTP ${status}：ページ本文を取得できませんでした`;
    }
    if (toolResultError(result)) return '取得・実行に失敗しました';
    let data: any = result;
    if (typeof result === 'string' && /^[\[{]/.test(result.trim())) {
        try { data = JSON.parse(result); } catch { /* Plain text is a normal tool result. */ }
    }
    if (data !== result && toolResultError(data)) return '取得・実行に失敗しました';
    const text = typeof result === 'string' ? result : '';
    const action = args && typeof args === 'object' && 'action' in args ? args.action : undefined;
    const count = (value: unknown) => Array.isArray(value) ? value.length : undefined;
    if (name === 'web_search') {
        if (/^SEARCH_EMPTY:/.test(text)) return '検索結果 0件';
        const hits = [...text.matchAll(/^(?:## )?\d+\. \[([^\]\n]+)\]\(/gm)];
        const number = count(data?.results) ?? (hits.length || undefined);
        const titles = Array.isArray(data?.results) ? data.results.slice(0, 2).map((item: any) =>
            typeof item?.title === 'string' ? item.title : '').filter(Boolean) : hits.slice(0, 2).map(hit => hit[1]);
        return number !== undefined ? `検索結果 ${number}件${titles.length ? '：' + titles.join(' / ').slice(0, 100) : ''}` : '検索結果を取得しました';
    }
    if (name === 'fetch_url') {
        const body = text.includes('\n\n') ? text.slice(text.indexOf('\n\n') + 2) : text;
        return `ページ本文 ${body.trim().length}文字を取得`;
    }
    if (name === 'search_channel_messages') return `一致する発言 ${count(data?.results) ?? 0}件を取得`;
    if (name === 'collect_channel_history') return `メッセージ ${count(data?.messages) ?? 0}件を取得`;
    if (name === 'fetch_discord_message') return '指定メッセージを取得しました';
    if (name === 'fetch_message_link_context') return `前後のメッセージ ${count(data?.context) ?? 0}件を取得`;
    if (name === 'manage_memory') {
        const number = count(data?.memos) ?? count(data?.results);
        if (number !== undefined) return `メモリー ${number}件を取得`;
        if (/記録されていません|記録されたメモリーはありません/.test(text)) return '該当するメモリーはありません';
        if (action === 'delete') return '共有メモを削除しました';
        if (action === 'create' || action === 'update') return '共有メモを保存しました';
        return 'メモリーを取得しました';
    }
    if (name === 'manage_schedule') {
        if (Array.isArray(data?.schedules)) return `通知予約 ${data.schedules.length}件`;
        return action === 'cancel' ? '通知予約を取り消しました' : data?.alreadyExists ? '既存の同一予約を確認しました' : '通知予約を保存しました';
    }
    if (name === 'calculate_bash') {
        const number = typeof data?.stdout === 'string' ? data.stdout.trim() : '';
        return /^[\d+\-.eE\s]+$/.test(number) && number.length <= 80 ? `計算結果：${number}` : '計算結果を取得しました';
    }
    if (name === 'output_file') return /^FILE_UPLOADED:/.test(text) ? 'Discordへのファイル添付完了' : 'ファイル処理が完了しました';
    if (name === 'get_weather') return '天気予報を取得しました';
    if (name === 'get_time') return '現在日時を取得しました';
    if (name === 'get_server_status') return 'サーバー情報を取得しました';
    if (name === 'get_user_details' || name === 'get_anticheat_user_profile') return 'ユーザー情報を取得しました';
    const number = count(data?.results) ?? count(data?.items) ?? count(data);
    return number !== undefined ? `結果 ${number}件を取得` : '実行結果を受信しました';
}
