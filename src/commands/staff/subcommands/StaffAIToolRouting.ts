/** Avoid sending every Discord utility JSON schema on every conversational turn. */
export function selectStaffToolNames(prompt: string, recentMessages: string[] = []): Set<string> {
    const current = prompt.trim().slice(0, 3000);
    // Short follow-ups often refer to the last question: preserve relevant tool access.
    const followUp = /^(それ|じゃあ|なら|続け|さっき|その|あと|もう一度|お願い|やって)/.test(current);
    const preceding = followUp ? recentMessages.slice(-2).join(' ').slice(-800) : '';
    const text = (current + ' ' + preceding).toLowerCase();
    const chosen = new Set<string>();
    // A question mark in casual chat (e.g. '元気？') should not load Web tools.
    if (current.length <= 32
        && /^(やほ|やっほ|こんにちは|おはよ|おやすみ|暇|ひま|元気|ありがとう|ありがと|どうも|ww|草)/i.test(current)
        && !/(検索|調べ|教え|おすすめ|ニュース|天気|何時|歌詞|曲|いつ|いくら)/.test(current)) {
        return chosen;
    }

    if (/天気|気温|降水|雨|晴れ|雪|台風|気象|forecast|weather/i.test(text)) {
        chosen.add('get_weather');
    }
    if (/今何時|現在時刻|時刻|日付|何曜日|今日何日|time zone|timezone/i.test(text)) {
        chosen.add('get_time');
    }
    if (/サーバー.*(人数|状況|状態|オンライン|人いる)|オンライン.*(人数|何人)|メンバー数|server status/i.test(text)) {
        chosen.add('get_server_status');
    }
    if (/ユーザー情報|ユーザー詳細|メンバー情報|プロフィール|ユーザープロフィール|ロール|役職|アイコン|その人の情報/i.test(text)) {
        chosen.add('get_user_details');
    }
    if (/アンチチート|anticheat|anti.?cheat|チート判定|違反履歴|処罰|面接室|ban履歴/i.test(text)) {
        chosen.add('get_anticheat_user_profile');
    }
    if (/フレーズ|単語.*(回数|数)|カウント|何回言っ|発言数|何件言っ/i.test(text)) {
        chosen.add('count_phrase_in_channel');
    }
    if (/メッセージリンク|discord\.com\/channels\/|discordapp\.com\/channels\//i.test(text)) {
        chosen.add('fetch_message_link_context');
    }
    if (/チャンネル.*(履歴|発言|ログ)|発言履歴|過去の会話|以前の発言|チャット履歴|ログを調べ/i.test(text)) {
        chosen.add('collect_channel_history');
    }
    if (/メモ|memo|覚えて|記録して|保存して|忘れて|思い出し|メモリー|備忘録|昨日|一昨日|先週|過去の出来事|以前の会話|好きなもの|好きな物|趣味|得意|どんな人/i.test(text)) {
        chosen.add('manage_memory');
    }
    // For research questions keep the actual Endpoint-backed web search available.
    // Casual greetings and chat have no tool schema overhead.
    if (/検索|調べ|探し|最新|ニュース|誰が|何者|由来|意味|特徴|評判|おすすめ|比較|価格|発売|現在の|歌詞|楽曲|曲|アーティスト|ジャンル|music|lyrics|^https?:\/\/|[?？]/i.test(text)) {
        chosen.add('web_search');
    }
    return chosen;
}
