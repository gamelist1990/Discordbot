/** Only pre-search named music references; other up-to-date questions may call web_search normally. */
export function musicResearchQuery(prompt: string): string | null {
    if (!/(歌詞|曲|楽曲|音楽|アーティスト|ミュージック|music|lyrics)/i.test(prompt)) {
        return null;
    }

    const quoted = prompt.match(/[「『"“]([^」』"”]{2,65})[」』"”]/)?.[1]?.trim();
    const latinName = prompt.match(/\b[A-Za-z][A-Za-z0-9_-]{1,24}(?:\s+[A-Za-z][A-Za-z0-9_-]{1,24}){1,3}\b/)?.[0];
    const title = quoted || latinName;
    if (!title) return null;
    if (/^(make|write|create|please|song|lyrics|music|some|good|the)\s/i.test(title)) return null;
    return `${title.slice(0, 65)} 曲 歌手 ジャンル テーマ 雰囲気`;
}
