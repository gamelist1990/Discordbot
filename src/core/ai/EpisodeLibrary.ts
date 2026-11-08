import { normalizeSearchText } from './SearchText.js';
import type { GuildEpisode } from './GuildEpisodeMemory.js';

/**
 * 出来事ライブラリ（辞書式の閲覧用グルーピング）。
 *
 * 蓄積されたエピソードを「年月 → 週 → 出来事」の階層に整える純粋関数群。
 * 週は日本時間のカレンダーで月曜始まりとし、週は「その週の月曜日が属する月」に
 * 帰属させる（月をまたぐ週を分割しないため、月初の日曜などは前月の最終週に入る）。
 * 並びはすべて新しい順。日付はエピソードに保存済みの JST 日付（YYYY-MM-DD）を正とする。
 */

export interface EpisodeLibraryItem {
    id: string;
    /** epoch ms */
    at: number;
    /** YYYY-MM-DD（日本時間） */
    date: string;
    /** 11月8日 */
    dateLabel: string;
    /** 19:24（日本時間） */
    timeLabel: string;
    actor: string;
    summary: string;
    channelName: string;
    /** 元の発言への Discord ジャンプリンク（材料がある場合のみ）。 */
    jumpUrl?: string;
}

export interface EpisodeLibraryWeek {
    /** 週の月曜日 YYYY-MM-DD */
    key: string;
    /** 11月2日〜8日 / 10月26日〜11月1日 / 2026年12月28日〜2027年1月3日 */
    label: string;
    startDate: string;
    endDate: string;
    count: number;
    episodes: EpisodeLibraryItem[];
}

export interface EpisodeLibraryMonth {
    /** YYYY-MM（週の月曜日の属する月） */
    key: string;
    /** 2026年11月 */
    label: string;
    count: number;
    weeks: EpisodeLibraryWeek[];
}

export interface EpisodeLibraryData {
    /** ストア全体の件数（検索前）。 */
    total: number;
    /** 検索で一致した件数（検索なしの場合は total と同じ）。 */
    matched: number;
    query: string;
    months: EpisodeLibraryMonth[];
}

const jstTimeFormat = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false,
});

interface DateParts { y: number; m: number; d: number }

function parseDateParts(date: string): DateParts | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) return null;
    return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function formatDateParts(parts: DateParts): string {
    const mm = String(parts.m).padStart(2, '0');
    const dd = String(parts.d).padStart(2, '0');
    return `${parts.y}-${mm}-${dd}`;
}

function shiftDate(parts: DateParts, days: number): DateParts {
    const utc = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + days));
    return { y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() };
}

/** YYYY-MM-DD（日本時間のカレンダー日付）の属する週の月曜日を YYYY-MM-DD で返す。 */
export function mondayOfWeek(date: string): string {
    const parts = parseDateParts(date);
    if (!parts) return date;
    const utc = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
    // getUTCDay: 日曜=0 … 土曜=6。月曜始まりまでの戻り量は (day + 6) % 7。
    const back = (utc.getUTCDay() + 6) % 7;
    return formatDateParts(shiftDate(parts, -back));
}

function weekLabel(start: DateParts, end: DateParts): string {
    if (start.y !== end.y) {
        return `${start.y}年${start.m}月${start.d}日〜${end.y}年${end.m}月${end.d}日`;
    }
    if (start.m !== end.m) {
        return `${start.m}月${start.d}日〜${end.m}月${end.d}日`;
    }
    return `${start.m}月${start.d}日〜${end.d}日`;
}

function toLibraryItem(episode: GuildEpisode, guildId: string): EpisodeLibraryItem {
    const parts = parseDateParts(episode.date);
    const firstMessageId = episode.messageIds.find(id => /^\d{17,20}$/.test(id));
    return {
        id: episode.id,
        at: episode.at,
        date: episode.date,
        dateLabel: parts ? `${parts.m}月${parts.d}日` : episode.date,
        timeLabel: jstTimeFormat.format(new Date(episode.at)),
        actor: episode.actor,
        summary: episode.summary,
        channelName: episode.channelName,
        ...(firstMessageId && /^\d{17,20}$/.test(episode.channelId)
            ? { jumpUrl: `https://discord.com/channels/${guildId}/${episode.channelId}/${firstMessageId}` }
            : {}),
    };
}

/** 検索語を空白で割って正規化した語のリストにする（すべて部分一致で AND 検索）。 */
export function episodeQueryTerms(query: string): string[] {
    return normalizeSearchText(query).split(/\s+/).map(term => term.trim()).filter(Boolean);
}

function matchesQuery(episode: GuildEpisode, terms: string[]): boolean {
    if (!terms.length) return true;
    const haystack = normalizeSearchText(`${episode.summary} ${episode.actor} ${episode.channelName}`);
    return terms.every(term => haystack.includes(term));
}

/**
 * エピソード一覧を年月→週の階層に組み立てる。
 * query が空でない場合は要約・話者・チャンネル名への部分一致（単語AND）で絞り込んでから組み立てる。
 */
export function buildEpisodeLibrary(
    episodes: GuildEpisode[],
    options: { guildId: string; query?: string },
): EpisodeLibraryData {
    const query = (options.query ?? '').trim();
    const terms = episodeQueryTerms(query);
    const filtered = episodes.filter(episode => matchesQuery(episode, terms));
    const sorted = [...filtered].sort((a, b) => b.at - a.at);

    // monthKey -> monday -> items
    const monthMap = new Map<string, Map<string, EpisodeLibraryItem[]>>();
    for (const episode of sorted) {
        const monday = mondayOfWeek(episode.date);
        const monthKey = monday.slice(0, 7);
        let weeks = monthMap.get(monthKey);
        if (!weeks) {
            weeks = new Map();
            monthMap.set(monthKey, weeks);
        }
        const items = weeks.get(monday) ?? [];
        items.push(toLibraryItem(episode, options.guildId));
        weeks.set(monday, items);
    }

    const months: EpisodeLibraryMonth[] = [...monthMap.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([monthKey, weeks]) => {
            const [y, m] = monthKey.split('-').map(Number);
            const weekList: EpisodeLibraryWeek[] = [...weeks.entries()]
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([monday, items]) => {
                    const start = parseDateParts(monday) ?? { y, m, d: 1 };
                    const end = shiftDate(start, 6);
                    return {
                        key: monday,
                        label: weekLabel(start, end),
                        startDate: monday,
                        endDate: formatDateParts(end),
                        count: items.length,
                        episodes: items,
                    };
                });
            return {
                key: monthKey,
                label: `${y}年${m}月`,
                count: weekList.reduce((sum, week) => sum + week.count, 0),
                weeks: weekList,
            };
        });

    return { total: episodes.length, matched: filtered.length, query, months };
}
