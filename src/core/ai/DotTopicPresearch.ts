/**
 * The model must not improvise game mechanics from ambiguous Discord banter.
 * This planner is intentionally conservative: it searches only when the
 * conversation supplies an actual game's name, not the assistant's guess.
 */
export interface DotTopicLine {
    content: string;
    authorId: string;
    isBot: boolean;
    timestamp?: number;
}

export type DotResearchPlan =
    | { kind: 'none' }
    | { kind: 'ambiguous'; reason: string }
    | { kind: 'search'; query: string; game: string; focus: string; anchor: string | null };

const GAMES: ReadonlyArray<{ label: string; pattern: RegExp }> = [
    { label: '崩壊スターレイル', pattern: /崩壊[:：\s]*スターレイル|スタレ|崩スタ|star\s*rail|hsr/iu },
    { label: '原神', pattern: /原神|genshin/iu },
    { label: 'ゼンレスゾーンゼロ', pattern: /ゼンゼロ|ゼンレス|zzz\b|zenless/iu },
    { label: '鳴潮', pattern: /鳴潮|wuthering\s*waves/iu },
    { label: 'ブルーアーカイブ', pattern: /ブルアカ|ブルーアーカイブ|blue\s*archive/iu },
    { label: 'Fate Grand Order', pattern: /FGO\b|fate\/grand order/iu },
    { label: '学園アイドルマスター', pattern: /学マス|学園アイドルマスター/iu },
    { label: 'ウマ娘', pattern: /ウマ娘|umamusume/iu },
    { label: 'モンスターストライク', pattern: /モンスト|モンスターストライク/iu },
    { label: 'パズル＆ドラゴンズ', pattern: /パズドラ|パズル[&＆]ドラゴンズ/iu },
    { label: 'グランブルーファンタジー', pattern: /グラブル|グランブルーファンタジー/iu },
    { label: 'アークナイツ', pattern: /アークナイツ|arknights/iu },
];

const GAME_MECHANICS = /(?:星[０-９0-9５５四五一二三四五]|[★☆][1-6１-６]|レア(?:度|リティ)|ガチャ|インフレ|デフレ|完凸|無凸|[0-6０-６]凸|限界突破|凸(?:った|できる|れる)|ダメージ|火力|DPS|スコア|バフ|デバフ|餅武器|武器(?:性能|効果)|必殺技|スキル(?:倍率|性能)?|キャラ(?:性能|評価)|編成|耐久|Tier|ティア|ボス|高難度|難易度|ナーフ|上方修正|下方修正|メタ(?:環境)?|天井|配布(?:キャラ|武器)?|育成|ビルド|最強|弱体化|倍率|クリティカル|会心|厳選|ステータス)/iu;

const UNCERTAIN_REFERENCE = /(?:そこ|それ|あれ|こいつ|これ|あの(?:キャラ|武器|敵)|その(?:キャラ|武器|敵)|そんな(?:性能|数値))/u;
const GENERIC_ANCHORS = new Set(['スタレ','インフレ','ガチャ','レアリティ','キャラクター','キャラ','ダメージ','バフ','デバフ','スコア','ボス','ステージ','アイテム','スキル','ガチャ結果','ゼンゼロ','モンスト','ブルアカ','アークナイツ','パズドラ','ウマ娘','グラブル','ホヨバ','マイクラ','Minecraft']);
const NAMED_GAME_REFERENT = /(?:[ァ-ヶー]{3,}|[A-Za-z][A-Za-z0-9-]{3,}|黄泉|景元|丹恒|忘却の庭|虚構叙事|末日の幻影)/gu;
const EXPLICIT_FACT = /(?:何(?:の|を|が)|ど(?:の|こ|れ)|誰|何%|いくら|何点|どっち|強い|弱い|インフレ|倍率|確率|ダメージ|火力|DPS|勝てる|倒せる|打てる|撃てる|できる|性能|最強|仕様)/u;

function clean(text: string): string {
    return text.replace(/<@!?\d+>|https?:\/\/\S+/g, ' ')
        .replace(/\[[^\]]{0,120}\]/g, ' ')
        .replace(/\s+/g, ' ').trim().slice(0, 240);
}

/**
 * Uses only human messages at or before the target message. Does not steal
 * context from messages posted after the response was requested.
 */
export function planDotTopicPresearch(
    focusText: string,
    priorMessages: readonly DotTopicLine[],
    currentTime?: number,
): DotResearchPlan {
    const focus = clean(focusText);
    if (!focus || !GAME_MECHANICS.test(focus)) return { kind: 'none' };

    const human = priorMessages.filter(line => !line.isBot && !!clean(line.content))
        .filter(line => currentTime === undefined || line.timestamp === undefined
            || (line.timestamp <= currentTime && currentTime - line.timestamp <= 12 * 60_000))
        .slice(-15);
    // A game title must appear in actual human conversation; never infer it
    // solely from "星1", "インフレ", etc.
    const nearby = [...human].reverse();
    let found: { label: string; age: number } | null = null;
    for (let i = 0; i < nearby.length; i++) {
        const line = clean(nearby[i].content);
        const hit = GAMES.find(game => game.pattern.test(line));
        if (hit) { found = { label: hit.label, age: i }; break; }
    }
    if (!found) return { kind: 'ambiguous', reason: 'no-game-title' };

    // The newest title is potentially from a previous topic. Avoid a stale
    // association after more than 10 other human messages.
    if (found.age > 10) return { kind: 'ambiguous', reason: 'stale-game-title' };

    // For vague references, require at least one actual mechanism/character
    // clue in nearby posts besides the generic "インフレ" etc.
    const candidates = nearby.slice(0, 6).map(line => clean(line.content))
        .filter(line => !/(?:エアプ|うざい|死ね|消えろ|クソAI)/u.test(line));
    const keywords: string[] = [];
    for (const msg of [focus, ...candidates]) {
        for (const match of msg.matchAll(/(?:星[0-6１-６]|[0-6０-６]凸|完凸|無凸|インフレ|ガチャ|ダメージ|火力|DPS|倍率|ボス|武器|餅武器|キャラ|スコア|配布|高難度|必殺技|バフ|スキル|会心|天井|ナーフ|耐久|弱体化|上方修正)/giu)) {
            const word = match[0];
            if (!keywords.includes(word)) keywords.push(word);
        }
        if (keywords.length >= 8) break;
    }
    if (!EXPLICIT_FACT.test(focus)) return { kind: 'none' };
    // Ambiguous references need at least two concrete signals; agreeing with
    // "そこ打てる" without knowing what "そこ" refers to is exactly the bug.
    const anchors: string[] = [];
    for (const line of candidates) {
        for (const match of line.matchAll(NAMED_GAME_REFERENT)) {
            const candidate = match[0];
            if (GENERIC_ANCHORS.has(candidate) || /(?:ガチャ|ヤバ|スタレ|インフレ|キャラ|ダメージ|スコア|スターレイル|ゼンゼロ)/u.test(candidate) || GAMES.some(game => game.pattern.test(candidate))) continue;
            if (!anchors.includes(candidate)) anchors.push(candidate);
        }
    }
    const anchor = anchors[0] ?? null;
    if (UNCERTAIN_REFERENCE.test(focus) && !anchor) {
        return { kind: 'ambiguous', reason: 'missing-referent' };
    }
    const query = [found.label, ...(anchor ? [anchor] : []), ...keywords.slice(0, 6)].join(' ').slice(0, 200);
    return { kind: 'search', query, game: found.label, focus, anchor };
}

export function dotTopicSearchSupportsReferent(searchText: string, anchor: string | null): boolean {
    if (!dotSearchHasUsableResults(searchText)) return false;
    if (!anchor) return true;
    // The search-query heading echoes the anchor even when all results are unrelated.
    // Only accept a source title/snippet/body mentioning the specific subject.
    const results = searchText.includes('## 1.') ? searchText.split('## 1.').slice(1).join('## 1.') : searchText;
    return results.toLocaleLowerCase().includes(anchor.toLocaleLowerCase());
}

export function dotSearchHasUsableResults(value: string): boolean {
    const text = value.trim();
    if (!text || /^SEARCH_(?:ERROR|EMPTY|UNAVAILABLE)\b/iu.test(text)) return false;
    return /https?:\/\/[^\s)]+/iu.test(text);
}
