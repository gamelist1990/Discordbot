/**
* 検索用のテキスト正規化・単語分割・一致度スコアリング（純粋関数）。
*
* Staff AI の発言検索（search_channel_messages）と出来事検索（search_server_episodes）で共有する。
* 日本語は分かち書きされないため、クエリを「実用的な単語」に割って部分一致＋AND で探せるようにする。
* 完全一致だけに頼ると「AIゴミ」で検索しても「AI は ゴミ だ」「AIはゴミ」のような
* 実際の言い回しを取りこぼす（2026-11-05 の出来事を 0 件で終了した事故の教訓）。
*/

/** NFKC 正規化＋小文字化。全角英数や大文字小文字の表記ゆれを吸収する。 */
export function normalizeSearchText(text: string): string {
return text.normalize('NFKC').toLowerCase();
}

/** 空白類を除いた連結形（フレーズの連結一致に使う）。 */
export function despacedSearchText(text: string): string {
return normalizeSearchText(text).replace(/\s+/g, '');
}

const SEPARATOR = /[\s、。.,・:：;；!！?？「」『』（）()[\]{}<>〈〉《》/\\|~〜…]+/;
/** 文字種（英数／ひらがな／カタカナ／漢字）の runs。日本語文を単語っぽく割るための境界にする。 */
const SCRIPT_RUN = /[a-z0-9_]+|[ぁ-ん]+|[ァ-ヶー]+|[一-龯々]+/g;
/** 単独で現れたら検索語として意味を持たない助詞（分割で生じたものだけ落とす）。 */
const PARTICLE_STOPWORDS = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'の', 'も', 'や', 'か']);

const MAX_TERMS = 8;

export interface BuiltSearchQuery {
/** 空白を1つに畳んだ正規化クエリ（そのままの語順のフレーズ一致に使う）。 */
phrase: string;
/** 空白を除いた連結形（"AI ゴミ" と "AIゴミ" を相互に一致させる）。 */
concatenated: string;
/** 分割した検索単語（重複なし）。 */
terms: string[];
}

/** クエリを検索用に組み立てる: フレーズ形・連結形・単語リスト。 */
export function buildSearchQuery(query: string): BuiltSearchQuery {
const phrase = normalizeSearchText(query).replace(/\s+/g, ' ').trim();
const concatenated = phrase.replace(/\s+/g, '');
const terms: string[] = [];
const seen = new Set<string>();
for (const chunk of phrase.split(SEPARATOR)) {
if (!chunk) continue;
const runs = chunk.match(SCRIPT_RUN);
const pieces = runs && runs.join('') === chunk? runs: [chunk];
for (const piece of pieces) {
if (!piece) continue;
if (pieces.length > 1 && PARTICLE_STOPWORDS.has(piece)) continue;
if (seen.has(piece)) continue;
seen.add(piece);
terms.push(piece);
if (terms.length >= MAX_TERMS) break;
}
if (terms.length >= MAX_TERMS) break;
}
// 助詞だけのクエリ等で単語が空になったら、フレーズ自体を1単語として扱う（検索不能にしない）。
if (!terms.length && phrase) terms.push(phrase);
return { phrase, concatenated, terms};
}

/** クエリを検索単語に分割する（buildSearchQuery の terms だけが要る場合）。 */
export function tokenizeSearchQuery(query: string): string[] {
return buildSearchQuery(query).terms;
}

export interface SearchMatch {
/** 3=フレーズ一致（連結形含む）, 2=全単語一致, 1=一部単語一致, 0=不一致。 */
level: 0 | 1 | 2 | 3;
/** 実際に一致した単語。 */
matchedTerms: string[];
}

/** 本文がクエリにどれだけ一致するかを返す。スペース違い・助詞入りの言い回しも拾う。 */
export function scoreSearchMatch(content: string, built: BuiltSearchQuery): SearchMatch {
const normalized = normalizeSearchText(content?? '');
if (!normalized ||!built.phrase) return { level: 0, matchedTerms: []};
if (normalized.includes(built.phrase) || despacedSearchText(content?? '').includes(built.concatenated)) {
return { level: 3, matchedTerms: [...built.terms]};
}
const matchedTerms = built.terms.filter(term => normalized.includes(term));
if (built.terms.length > 0 && matchedTerms.length === built.terms.length) {
return { level: 2, matchedTerms};
}
if (matchedTerms.length > 0) return { level: 1, matchedTerms};
return { level: 0, matchedTerms: []};
}
