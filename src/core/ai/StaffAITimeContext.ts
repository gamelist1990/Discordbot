/** Variable clock context stays separate from the stable system prefix. */
export function buildStaffAITimeContext(now = Date.now()): string {
    const date = new Date(now);
    const local = new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo', dateStyle: 'full', timeStyle: 'long',
    }).format(date);
    return [
        '[現在の日時（サーバーの時計）]',
        `日本時間: ${local}`,
        `タイムゾーン: Asia/Tokyo (JST / UTC+09:00)`,
        `UTC: ${date.toISOString()}`,
        '今日・明日・何分後などの相対日時は、この日時を基準に解釈する。ユーザーが別のタイムゾーンを指定した場合はそれに従う。',
        '予約時刻はタイムゾーン付きの日時に変換する。過去の会話にある日時を現在時刻として扱わない。処理に時間がかかった場合や再確認が必要な場合はget_timeで現在時刻を取得する。',
    ].join('\n');
}
