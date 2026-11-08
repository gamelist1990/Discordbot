import { PermissionFlagsBits, type Client, type Message } from 'discord.js';
import { OpenAIChatManager } from './OpenAIChatManager.js';
import type { OpenAIChatCompletionMessage } from '../../types/openai.js';
import { GEMMA_MODEL, config } from '../../config.js';
import { Logger } from '../../utils/Logger.js';
import { getEffectiveContent } from '../anticheat/ForwardedContent.js';
import {
    dotMediaStore,
    extractDotMedia,
    formatMediaNotes,
    type DotMediaItem,
    type DotMediaMessageLike,
} from './DotAmbientMedia.js';
import {
    extractGuildEpisodes,
    formatEpisodeForMemory,
    loadGuildEpisodeStore,
    matchEpisodesForConversation,
    type GuildEpisode,
} from './GuildEpisodeMemory.js';
import {
    formatMemberMemoLine,
    loadGuildMemberMemoStore,
    selectMemberMemosForContext,
    updateGuildMemberMemos,
    type GuildMemberMemo,
} from './GuildMemberMemory.js';
import { getStaffAIDotMode } from '../../commands/staff/subcommands/StaffAIDotMode.js';
import {
    applyGuildAIPersonalityLearning,
    ATMOSPHERE_LEARNING_SYSTEM_PROMPT,
    buildAtmosphereLearningUserPrompt,
    buildGuildAIPersonalityPrompt,
    ensureGuildAIPersona,
    getGuildAIPersonality,
} from './GuildAIPersonality.js';

/**
 * Staff AI dotモード（常駐型）: dotモードがONの間、ギルドの会話を見守り、
 * 盛り上がっている会話の流れの中に「しれっと」短く混ざる。混ざるかどうかは
 * ヒューリスティクスで機会を作り、最終判断はモデル自身が行う。
 * メンション・Botへの返信はその場で応え、それ以外の「呼びかけっぽい」発言は
 * 緩く拾って、モデルが文脈で「話しかけられたか」を判定してから応える。
 * 毎回応答するAIChatとは別物で、専用AIチャンネルには入らない。
 * あわせて観測した会話からサーバーの空気（GuildAIPersonality）を少しずつ学習する。
 */

export const DOT_AMBIENT = {
    sweepIntervalMs: 30_000,
    flagCacheMs: 20_000,
    channelCooldownMs: 30 * 60_000,
    selfBotRecentMs: 12 * 60_000,
    guildHourlyCap: 3,
    questionMinAgeMs: 60_000,
    questionMaxAgeMs: 15 * 60_000,
    activeWindowMs: 5 * 60_000,
    activeMinMessages: 3,
    activeMinHumans: 2,
    activeMaxAgeMs: 3 * 60_000,
    evaluationIntervalMs: 90_000,
    evaluationMinNewMessages: 2,
    judgeMinConfidence: 0.7,
    reactMinConfidence: 0.6,
    continueMinConfidence: 0.55,
    engagedWindowMs: 5 * 60_000,
    recentReactionKeep: 5,
    contextBufferSize: 25,
    addressedCooldownMs: 45_000,
    addressedJudgeMinConfidence: 0.65,
    addressedContextOnlyMinConfidence: 0.85,
    addressedContextWindowMs: 10 * 60_000,
    contextMessages: 12,
    learningBatchSize: 20,
    learningIntervalMs: 20 * 60_000,
    learningUseMessages: 40,
    episodeMinPending: 15,
    episodeIntervalMs: 10 * 60_000,
    episodeUseMessages: 40,
    episodeMaxTokens: 1600,
    episodePendingCap: 300,
    // 過去の記憶（出来事・メンバーメモ）の文脈注入。件数は判定・生成の末尾に差し込む上限。
    episodeInjectLimit: 3,
    memberMemoInjectLimit: 4,
    memoryStoreCacheMs: 60_000,
    memberMemoMinPending: 15,
    memberMemoIntervalMs: 20 * 60_000,
    memberMemoUseMessages: 40,
    memberMemoMaxTokens: 1600,
    memberMemoPendingCap: 300,
    judgeMaxTokens: 1024,
    judgeSessionMaxChars: 24_000,
    judgeSessionMaxTurns: 40,
    judgeSessionMaxLoggedMessages: 150,
    // 生成は思考ONのままなので、1024だと推論で予算を使い切って本文が空になることがある
    // （2026-11-08 A/B検証で敵対的な呼びかけ文脈で3回中2回が空応答）。空応答は無言になるだけ
    // なので、予算を広げて本文が返る側に倒す（ユーザーの「予算は十分に大きく」方針にも沿う）。
    generationMaxTokens: 2048,
    learningMaxTokens: 1600,
    mediaDescribeMaxPerMessage: 2,
    mediaEnsureMaxPerCall: 3,
    typingRefreshMs: 8_000,
} as const;

const QUESTION_TAIL = /(かな|かしら|だっけ|っけ|どう|なぜ|なんで|いつ|どこ|だれ|誰|なに|何|教えて|知ってる|知らない|わかる|分かる|ありますか|いますか|ませんか|でしょうか|ですか|ますか)$/;

/** 返事が宙に浮きそうな「質問っぽい」発言か。 */
export function isHangingQuestion(content: string): boolean {
    const text = content.trim();
    if (text.length < 6) return false;
    if (text.startsWith('/') || text.startsWith('!') || text.startsWith('！')) return false;
    if (/^(https?:\/\/\S+)$/.test(text)) return false;
    if (text.endsWith('？') || text.endsWith('?')) return true;
    return QUESTION_TAIL.test(text);
}

const DOT_WORD = /(^|[\s、。，・])dot(?![a-zA-Z0-9])/i;

/** 名前や「dot」で呼びかけられているか（メンション・返信判定は呼び出し側）。 */
export function isNameCalled(content: string, names: string[]): boolean {
    for (const name of names) {
        if (name && name.length >= 2 && content.includes(name)) return true;
    }
    return DOT_WORD.test(content);
}

const AI_CUE = /(^|[\s、。，・「『（(])AI(?![a-zA-Z0-9])|ＡＩ|エーアイ/;
const BOT_CUE = /\bbot\b|ボット/i;
const VOCATIVE_HEAD = /^(ねえ|ねぇ|ねー|ちょっと|聞いて|おい|あのさ|あのね|すみません|あの)/;

export interface AddressedCandidateOptions {
    names: string[];
    isQuestion: boolean;
    botRecentlyActive: boolean;
}

/**
 * 呼びかけ候補のノミネート根拠。
 * - 'message-signal': 発言自体の中に呼びかけ信号（名前呼び・AI/botへの言及）がある。
 * - 'recent-bot-only': 発言内に信号はなく、「Botが直近に発言していた＋質問形／呼びかけ口調」だけが根拠。
 *   場への質問（その場の全員に向けた問い）を「自分宛て」と取り違える事故が起きた経路なので、
 *   判定プロンプトへの明示としきい値の引き上げで特に厳しく扱う。
 */
export type AddressedNominationBasis = 'message-signal' | 'recent-bot-only';

/**
 * 「Botに話しかけているかも」しれない発言の緩いノミネート（純粋関数）。
 * ここは最終判断ではなく候補拾い。応答するかどうかはモデルの文脈判定が決める。
 * 候補でない場合は null、候補の場合はノミネート根拠を返す。
 */
export function addressedNominationBasis(content: string, options: AddressedCandidateOptions): AddressedNominationBasis | null {
    const text = content.trim();
    if (text.length < 2) return null;
    if (text.startsWith('/') || text.startsWith('!') || text.startsWith('！')) return null;
    if (isNameCalled(text, options.names)) return 'message-signal';
    if (AI_CUE.test(text) || BOT_CUE.test(text)) return 'message-signal';
    // Botが直近でそのチャンネルで話した流れの中での、宛先が書かれていない呼びかけ・質問。
    // 発言内に宛ての信号は無いので、根拠としては最も弱い。
    if (options.botRecentlyActive && (options.isQuestion || VOCATIVE_HEAD.test(text))) return 'recent-bot-only';
    return null;
}

/** 「Botに話しかけているかも」しれない発言かどうか（ノミネートの有無のみ）。 */
export function isAddressedCandidate(content: string, options: AddressedCandidateOptions): boolean {
    return addressedNominationBasis(content, options) !== null;
}

/**
 * 呼びかけ判定（統合スキーマ）で応答してよいか。reply かつ、しきい値以上で応答する。
 * 基準値は ambient参加より少し低めだが、ノミネート根拠が 'recent-bot-only'
 * （Botが直近に話した＋質問形だけ）の場合は場への質問の取り違えを防ぐため高いしきい値を要求する。
 */
export function shouldRespondToAddressed(decision: ParticipationDecision | null, basis: AddressedNominationBasis = 'message-signal'): boolean {
    if (decision === null || decision.action !== 'reply') return false;
    const minConfidence = basis === 'recent-bot-only'
        ? DOT_AMBIENT.addressedContextOnlyMinConfidence
        : DOT_AMBIENT.addressedJudgeMinConfidence;
    return decision.confidence >= minConfidence;
}

/** 本文中の生メンション文字列（<@id> / <@!id>）で Bot がメンションされているか。mentions.users に載らないケースの補強。 */
export function hasRawBotMention(content: string, botId: string | undefined): boolean {
    if (!botId) return false;
    return content.includes(`<@${botId}>`) || content.includes(`<@!${botId}>`);
}

/** 表示名・ペルソナ名での明確な名前呼び（@表示名 のテキスト表記を含む）か。 */
export function hasExplicitNameCall(content: string, names: string[]): boolean {
    if (isNameCalled(content, names)) return true;
    for (const name of names) {
        if (name && name.length >= 2 && content.includes(`@${name}`)) return true;
    }
    return false;
}

/**
 * 判定が解釈不能（null）のまま終わった場合の最終フォールバック。
 * 名前で明確に呼ばれている時だけ応答し、名前呼びでない候補は無言のままにする。
 * 判定が正常に none 等を返した場合はモデルの判断を尊重してフォールバックしない。
 */
export function shouldFallbackToAddressed(decision: ParticipationDecision | null, content: string, names: string[]): boolean {
    return decision === null && hasExplicitNameCall(content, names);
}

const LONE_SURROGATE_PATTERN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const UNSAFE_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * AIへ送るテキストのサニタイズ（純粋関数）。
 * 単独サロゲート（絵文字のサロゲートペアを slice で切り離した時などに生じる）は
 * JSON.stringify で \uXXXX エスケープとして送出され、EndPoint 側（axum + serde_json）の
 * 厳密なリクエストパースで「unexpected end of hex escape」となり 400 になるため U+FFFD に置換する。
 * あわせて不要な制御文字（改行・タブ・CR以外）を取り除く。
 * 送信直前の組み立て済み文字列に最後の仕上げとして適用する想定（slice 後の適用が重要）。
 */
export function sanitizeAiText(text: string): string {
    return text
        .replace(LONE_SURROGATE_PATTERN, '\uFFFD')
        .replace(UNSAFE_CONTROL_PATTERN, '');
}

export type ParticipationAction = 'none' | 'reply' | 'comment' | 'react' | 'continue';

export interface ParticipationDecision {
    action: ParticipationAction;
    targetMessageId: string | null;
    emoji: string | null;
    confidence: number;
    reason: string;
    /** reply/comment/continue の場合に実際に投稿する文の下書き（参加判定が分離して返す。具体性の機械チェック対象）。 */
    draft?: string;
}

/**
 * 参加判断モデルのJSON出力を解釈する。解釈できない場合は参加しない。
 * 前後に説明文や別の波括弧が混ざっていても、対応の取れた {...} 断片を順に試して本命のJSONを探す。
 * emoji は通常のUnicode絵文字だけを採用する（カスタム絵文字・英数字は落とす）。
 */
export function parseParticipationDecision(text: string): ParticipationDecision | null {
    for (const candidate of extractJsonObjectCandidates(text)) {
        const decision = parseDecisionCandidate(candidate);
        if (decision) return decision;
    }
    return null;
}

/** テキスト中の波括弧の対応が取れた {...} 断片を出現順に取り出す（文字列リテラル内の波括弧は数えない）。 */
function* extractJsonObjectCandidates(text: string): Generator<string> {
    for (let start = 0; start < text.length; start++) {
        if (text[start] !== '{') continue;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') inString = true;
            else if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    yield text.slice(start, i + 1);
                    break;
                }
            }
        }
    }
}

function parseDecisionCandidate(candidate: string): ParticipationDecision | null {
    try {
        const value = JSON.parse(candidate) as Record<string, unknown>;
        const action = value.action;
        if (action !== 'none' && action !== 'reply' && action !== 'comment' && action !== 'react' && action !== 'continue') return null;
        const confidence = typeof value.confidence === 'number'
            ? Math.min(1, Math.max(0, value.confidence))
            : 0;
        const targetMessageId = typeof value.targetMessageId === 'string' && /^\d{5,25}$/.test(value.targetMessageId)
            ? value.targetMessageId
            : null;
        const emoji = typeof value.emoji === 'string'
            && value.emoji.length >= 1 && value.emoji.length <= 8
            && !/[\x00-\x7F]/.test(value.emoji)
            ? value.emoji
            : null;
        const reason = typeof value.reason === 'string' ? value.reason.slice(0, 120) : '';
        const decision: ParticipationDecision = { action, targetMessageId, emoji, confidence, reason };
        // draft は下書きがある場合だけ載せる（旧形式の出力・addressed判定の出力には無い）。
        if (typeof value.draft === 'string' && value.draft.trim()) decision.draft = value.draft.slice(0, 200);
        return decision;
    } catch {
        return null;
    }
}

/**
 * 判定モデルの出力を解釈し、解釈できない場合は1回だけ再試行する。
 * parse に失敗した生出力は onParseFailure 経由でログに残す（恒常的な原因追跡用）。
 */
export async function parseDecisionWithRetry(
    generate: () => Promise<string>,
    onParseFailure?: (raw: string, attempt: number) => void,
): Promise<ParticipationDecision | null> {
    for (let attempt = 1; attempt <= 2; attempt++) {
        const text = await generate();
        const decision = parseParticipationDecision(text);
        if (decision) return decision;
        onParseFailure?.(text, attempt);
    }
    return null;
}

/**
 * 生成リクエスト自体がエラーで落ちた場合に、最小文脈で組み立て直した再試行へ切り替える。
 * 文脈側の文字列が原因で中継（EndPoint）が 400 を返すケースでも、履歴を落とせば大抵は通る。
 * 再試行も落ちた場合はそのエラーをそのまま投げる（失敗としての記録は呼び出し側に委ねる）。
 */
export async function generateWithContextFallback<T>(
    primary: () => Promise<T>,
    minimalRetry: () => Promise<T>,
    onRetry?: (error: unknown) => void,
): Promise<T> {
    try {
        return await primary();
    } catch (error) {
        onRetry?.(error);
        return await minimalRetry();
    }
}

/** アクションごとの実行しきい値。冷たい新規参加（reply/comment）は高く、軽い参加（react）と参加中の追随（continue）は低め。 */
export function participationThreshold(action: ParticipationAction): number {
    switch (action) {
        case 'reply':
        case 'comment':
            return DOT_AMBIENT.judgeMinConfidence;
        case 'react':
            return DOT_AMBIENT.reactMinConfidence;
        case 'continue':
            return DOT_AMBIENT.continueMinConfidence;
        default:
            return Number.POSITIVE_INFINITY;
    }
}

/** モデルの構造化判断を実行してよいか。continue は engaged の時だけ意味を持つ。 */
export function shouldExecuteParticipation(decision: ParticipationDecision | null, presence: DotPresence): boolean {
    if (!decision || decision.action === 'none') return false;
    if (decision.action === 'continue' && presence !== 'engaged') return false;
    return decision.confidence >= participationThreshold(decision.action);
}

/**
 * 下書きの具体性チェックで「具体」とみなさない一般語。
 * 会話と下書きの重なりがこれらだけなら、内容が空（濁した下書き）とみなす。
 */
export const DRAFT_ANCHOR_STOPWORDS: ReadonlySet<string> = new Set([
    '仕組み', '技術', '情報', '複雑', '雰囲気', '空気', '魅力', '空間', '感じ', '一般', '話題', '会話',
    '発言', '反応', '自分', '相手', '対象', '内容', '具体', '今回', '場合', '必要', '以上', '以下',
    'もの', 'こと', 'ため', 'ところ', 'サーバー', 'カオス', 'そういう', 'みたいな', 'みたい',
    'かもしれ', 'じゃない', 'について', 'として', 'なんだか', 'なんか',
]);

/** 一般語のグラム（2〜3文字の断片）も具体とみなさないための除外集合。 */
const DRAFT_ANCHOR_STOPGRAMS: ReadonlySet<string> = (() => {
    const grams = new Set<string>();
    for (const word of DRAFT_ANCHOR_STOPWORDS) {
        grams.add(word);
        for (let n = 2; n <= 4; n++) {
            for (let i = 0; i + n <= word.length; i++) grams.add(word.slice(i, i + n));
        }
    }
    return grams;
})();

/**
 * テキストから「具体」の候補トークンを抜き出す（純粋関数）。
 * 日本語は単語境界が無いため、漢字・カタカナの連続（例: 「二次試験終わった」の「二次試験終」）から
 * 2〜4文字の断片（グラム）と短い連続そのものを候補にする。英字は3文字以上の単語、数字は2桁以上。
 * 一般語とその断片（DRAFT_ANCHOR_STOPWORDS 由来）は具体とみなさない。
 */
export function extractContentTokens(text: string): string[] {
    const tokens = new Set<string>();
    for (const run of text.match(/[一-龥々ァ-ヶー]{2,}/g) ?? []) {
        if (run.length <= 5 && !DRAFT_ANCHOR_STOPGRAMS.has(run)) tokens.add(run);
        for (let n = 2; n <= 4; n++) {
            for (let i = 0; i + n <= run.length; i++) {
                const gram = run.slice(i, i + n);
                if (!DRAFT_ANCHOR_STOPGRAMS.has(gram)) tokens.add(gram);
            }
        }
    }
    for (const word of text.match(/[A-Za-z]{3,}/g) ?? []) tokens.add(word);
    for (const num of text.match(/[0-9]{2,}/g) ?? []) tokens.add(num);
    return [...tokens];
}

/** 判定の下書き本文を取り出す。draft フィールド優先、無ければ reason 内の「」引用、最後は reason 全体。 */
export function draftAnchorText(decision: ParticipationDecision): string {
    if (decision.draft && decision.draft.trim()) return decision.draft;
    const quoted = [...decision.reason.matchAll(/「([^」]{2,})」/g)].map(m => m[1]).join(' ');
    return quoted || decision.reason;
}

/**
 * 下書きが直近の会話の具体（固有名詞・物・出来事・数字）に触れているかの機械チェック（純粋関数）。
 * 判定プロンプトの規律だけでは、はぐらかし下書き（相槌のみ・「具体的な言葉は不要」等）が
 * 高い confidence で通ってしまう実績が続いたため（2026-11-07〜08）、実行直前にコード側でも担保する。
 * react には適用しない（呼び出し側で分岐）。
 */
export function draftHasConcreteAnchor(decision: ParticipationDecision, contextText: string): boolean {
    const anchor = draftAnchorText(decision);
    if (!anchor.trim()) return false;
    return extractContentTokens(contextText).some(token => anchor.includes(token));
}

/** Bot自身が付けたリアクションの記録。リアクションは通常のメッセージ履歴に残らないため、判定材料として明示的に保持する。 */
export interface RecentReaction {
    at: number;
    authorName: string;
    excerpt: string;
    emoji: string;
}

/**
 * リアクション履歴へ新しい順で記録する（保持件数を超えたら古いものから落とす）。
 * 間隔の判断はモデルに委ねるため、ここでは時間による間引き・ブロックは一切しない。
 */
export function recordRecentReaction(history: RecentReaction[], entry: RecentReaction): RecentReaction[] {
    return [entry, ...history].slice(0, DOT_AMBIENT.recentReactionKeep);
}

/** 判定入力用に、Bot自身の直近のリアクション履歴を整形する（新しい順）。 */
export function formatRecentReactions(history: RecentReaction[], now: number): string {
    if (history.length === 0) return '（このチャンネルではまだリアクションしていません）';
    return history.map(entry => {
        const mins = Math.floor((now - entry.at) / 60_000);
        const when = mins < 1 ? 'たった今' : mins < 60 ? `${mins}分前` : `${Math.floor(mins / 60)}時間前`;
        const name = sanitizeAiText(entry.authorName) || '(不明)';
        const body = sanitizeAiText(entry.excerpt.replace(/\s+/g, ' ').slice(0, 80)) || '(本文なし)';
        return `- ${when}: ${name}の「${body}」に ${entry.emoji}`;
    }).join('\n');
}

export interface DotChannelSnapshot {
    lastHumanMessageAt: number;
    lastHumanMessageIsQuestion: boolean;
    lastHumanMessageId: string;
    lastJudgedQuestionId: string;
    lastAmbientJoinAt: number;
    lastOtherBotMessageAt: number;
    lastBotParticipationAt: number;
    engagedUntil: number;
    humanMessagesInWindow: number;
    distinctHumansInWindow: number;
    humanMessagesTotal: number;
    humanCountAtLastEvaluation: number;
    lastEvaluationAt: number;
}

/** チャンネルに対するBotのプレゼンス。engaged=会話に参加中、cooldown=参加後の静止期間、lurking=様子見。 */
export type DotPresence = 'lurking' | 'engaged' | 'cooldown';

export function presenceOf(s: DotChannelSnapshot, now: number): DotPresence {
    if (s.engagedUntil > now) return 'engaged';
    if (s.lastAmbientJoinAt > 0 && now - s.lastAmbientJoinAt < DOT_AMBIENT.channelCooldownMs) return 'cooldown';
    return 'lurking';
}

export type DotEvaluationTrigger = 'engaged' | 'question' | 'open';

/**
 * 「モデルに判断させる機会」があるかを決める純粋関数（候補化のみ）。
 * 実際に何をするかはモデルの構造化判断（parseParticipationDecision）が決める。
 * 件数カウンタはここでの候補化と上限ガードにだけ使い、参加可否の主役ではない。
 */
export function evaluateEvaluationTrigger(s: DotChannelSnapshot, now: number): DotEvaluationTrigger | null {
    if (s.lastHumanMessageAt === 0) return null;
    // Bot本体（他の機能）が最近そのチャンネルで話していたら譲る。
    if (s.lastOtherBotMessageAt > 0 && now - s.lastOtherBotMessageAt < DOT_AMBIENT.selfBotRecentMs) return null;

    const age = now - s.lastHumanMessageAt;
    const presence = presenceOf(s, now);
    if (presence === 'engaged') {
        // 参加中: 自分の最後の参加より後に来た人間の発言で、まだ流れが生きている間だけ追随判定する。
        if (s.lastHumanMessageAt > s.lastBotParticipationAt
            && s.lastHumanMessageAt > s.lastEvaluationAt
            && age <= DOT_AMBIENT.activeMaxAgeMs) {
            return 'engaged';
        }
        return null;
    }
    if (presence === 'cooldown') return null;

    // lurking: 最後に混ざって以降、人間の新しい発言がないなら何もしない。
    if (s.lastHumanMessageAt <= s.lastAmbientJoinAt) return null;
    // 静かなチャンネルで質問が宙に浮いている場合は、単発でも判定機会を作る。
    if (s.lastHumanMessageIsQuestion
        && s.lastHumanMessageId !== s.lastJudgedQuestionId
        && age >= DOT_AMBIENT.questionMinAgeMs
        && age <= DOT_AMBIENT.questionMaxAgeMs
        && s.humanMessagesInWindow < DOT_AMBIENT.activeMinMessages) {
        return 'question';
    }
    // 盛り上がっている最中: 一定間隔＋新規発言があるときだけ判定機会を作る。
    if (s.humanMessagesInWindow >= DOT_AMBIENT.activeMinMessages
        && s.distinctHumansInWindow >= DOT_AMBIENT.activeMinHumans
        && age <= DOT_AMBIENT.activeMaxAgeMs
        && now - s.lastEvaluationAt >= DOT_AMBIENT.evaluationIntervalMs
        && s.humanMessagesTotal - s.humanCountAtLastEvaluation >= DOT_AMBIENT.evaluationMinNewMessages) {
        return 'open';
    }
    return null;
}

interface ChannelState {
    guildId: string;
    lastHumanMessageAt: number;
    lastHumanMessageId: string;
    lastHumanMessageIsQuestion: boolean;
    lastJudgedQuestionId: string;
    lastAmbientJoinAt: number;
    lastOtherBotMessageAt: number;
    lastAddressedResponseAt: number;
    lastBotMessageAt: number;
    lastBotParticipationAt: number;
    engagedUntil: number;
    recentReactions: RecentReaction[];
    recentMessages: BufferedMessage[];
    participationSession: AppendOnlySession;
    addressedSession: AppendOnlySession;
    dotPostIds: Set<string>;
    recentBotMessageIds: string[];
    recentHuman: Array<{ authorId: string; at: number }>;
    humanMessagesTotal: number;
    humanCountAtLastEvaluation: number;
    lastEvaluationAt: number;
}

interface ObservedMessage {
    id: string;
    content: string;
    channelId: string;
    channelName: string;
    authorId: string;
    authorName: string;
    at: number;
}

export interface DotAmbientOptions {
    /** 専用AIチャンネルなど、常駐dotが入らないチャンネル。 */
    excludedChannelIds?: string[];
}

const chatManager = new OpenAIChatManager();
const channelStates = new Map<string, ChannelState>();
const guildReplyTimes = new Map<string, number[]>();
const guildObservations = new Map<string, ObservedMessage[]>();
const guildLastLearnAt = new Map<string, number>();
const guildEpisodePending = new Map<string, ObservedMessage[]>();
const guildLastEpisodeAt = new Map<string, number>();
const guildMemberMemoPending = new Map<string, ObservedMessage[]>();
const guildLastMemberMemoAt = new Map<string, number>();
const guildNamesCache = new Map<string, { names: string[]; at: number }>();
const excludedChannels = new Set<string>();

let dotEnabledCache = false;
let dotEnabledCheckedAt = 0;
let sweeping = false;
let initialized = false;

async function refreshDotEnabled(): Promise<boolean> {
    const now = Date.now();
    if (now - dotEnabledCheckedAt < DOT_AMBIENT.flagCacheMs) return dotEnabledCache;
    dotEnabledCheckedAt = now;
    dotEnabledCache = await getStaffAIDotMode();
    return dotEnabledCache;
}

function stateFor(message: Message): ChannelState {
    let state = channelStates.get(message.channelId);
    if (!state) {
        state = {
            guildId: message.guildId ?? '',
            lastHumanMessageAt: 0,
            lastHumanMessageId: '',
            lastHumanMessageIsQuestion: false,
            lastJudgedQuestionId: '',
            lastAmbientJoinAt: 0,
            lastOtherBotMessageAt: 0,
            lastAddressedResponseAt: 0,
            lastBotMessageAt: 0,
            lastBotParticipationAt: 0,
            engagedUntil: 0,
            recentReactions: [],
            recentMessages: [],
            participationSession: createAppendOnlySession(),
            addressedSession: createAppendOnlySession(),
            dotPostIds: new Set(),
            recentBotMessageIds: [],
            recentHuman: [],
            humanMessagesTotal: 0,
            humanCountAtLastEvaluation: 0,
            lastEvaluationAt: 0,
        };
        channelStates.set(message.channelId, state);
    }
    return state;
}

async function guildCallNames(client: Client, guildId: string): Promise<string[]> {
    const cached = guildNamesCache.get(guildId);
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.names;
    const names = new Set<string>();
    if (client.user?.username) names.add(client.user.username);
    try {
        const personality = await getGuildAIPersonality(guildId);
        if (personality.persona?.name) names.add(personality.persona.name);
    } catch { /* ペルソナが無くても呼びかけ判定は続行できる */ }
    const list = [...names];
    guildNamesCache.set(guildId, { names: list, at: Date.now() });
    return list;
}

export interface BufferedMessage {
    id: string;
    authorId: string;
    authorName: string;
    content: string;
    at: number;
    isBot: boolean;
    /** 添付メディア（説明は DotAmbientMedia 側で非同期に付く。無ければ空配列） */
    media: DotMediaItem[];
}

function formatContext(messages: Message[], selfId: string | undefined): string {
    return messages
        .map(message => {
            const name = message.author.id === selfId ? '(自分=このBot)' : sanitizeAiText(message.author.username);
            const textBody = (message.content ?? '').replace(/\s+/g, ' ').slice(0, 300);
            // 添付メディアは説明文（未確認なら存在プレースホルダ）を併記し、本文だけでの誤読を防ぐ。
            // サニタイズは連結後の全体に適用する（単独サロゲート対策）。
            const body = sanitizeAiText([textBody, formatMediaNotes(mediaItemsOf(message))].filter(Boolean).join(' ')) || '(本文なし)';
            return `[${message.id}] ${name}: ${body}`;
        })
        .join('\n');
}

/** チャンネルごとに保持している直近の会話（誰が・いつ・何を）を判定入力の「会話の絵」に整形する。 */
function formatBuffered(messages: BufferedMessage[], selfId: string | undefined, now: number): string {
    return messages
        .map(entry => {
            const name = entry.authorId === selfId ? '(自分=このBot)' : sanitizeAiText(entry.authorName);
            const textBody = entry.content.replace(/\s+/g, ' ').slice(0, 300);
            const body = sanitizeAiText([textBody, formatMediaNotes(entry.media)].filter(Boolean).join(' ')) || '(本文なし)';
            const mins = Math.floor((now - entry.at) / 60_000);
            const when = mins >= 1 ? ` (${mins}分前)` : '';
            return `[${entry.id}] ${name}${when}: ${body}`;
        })
        .join('\n');
}

function pushBuffered(state: ChannelState, entry: BufferedMessage): void {
    state.recentMessages.push(entry);
    if (state.recentMessages.length > DOT_AMBIENT.contextBufferSize) state.recentMessages.shift();
}

/**
 * dsh（deepseek-harness）方式の追記専用ジャッジセッション。
 *
 * 設計:
 * - システムプロンプトはセッション中バイト同一（呼び出し側が固定文字列を渡す）。
 * - 会話ログは「一度送った行は二度と書き換えない」追記専用。各ターンは
 *   [新規発言の行] + [メディア説明の補足] + [更新された場合のみ雰囲気] + [今回の判定材料（末尾）]
 *   という1つの user メッセージとして末尾へ追加されるだけなので、前回までの
 *   リクエスト全体が今回のリクエストの接頭辞になり、ゲートウェイの接頭辞キャッシュが効く。
 * - 相対時刻（「3分前」）のような可変表現はログ行に使わない（行は作った瞬間に凍結される）。
 *   メディア説明が後から揃った場合は行を書き換えず、補足ブロックとして末尾に追記する。
 * - 満杯（文字数/ターン数/ログ件数の上限）になったら途中編集はせずリベースする:
 *   セッションを閉じ、現在の候補行全体から新しいセッションを開始する（コールド1回を受け入れる）。
 */
export interface AppendOnlySession {
    turns: string[];
    loggedMessageIds: Set<string>;
    mediaNotesByMessage: Map<string, string>;
    personalitySent: string;
    /** 過去の記憶ブロック（出来事・メンバーメモ）の送信済み内容。変わった時だけ末尾へ追記する。 */
    memorySent: string;
    lastLoggedAt: number;
    chars: number;
}

export function createAppendOnlySession(): AppendOnlySession {
    return {
        turns: [],
        loggedMessageIds: new Set(),
        mediaNotesByMessage: new Map(),
        personalitySent: '',
        memorySent: '',
        lastLoggedAt: 0,
        chars: 0,
    };
}

export function appendOnlySessionNeedsRebase(session: AppendOnlySession, additionalChars: number): boolean {
    if (session.turns.length === 0) return false;
    return session.chars + additionalChars > DOT_AMBIENT.judgeSessionMaxChars
        || session.turns.length >= DOT_AMBIENT.judgeSessionMaxTurns
        || session.loggedMessageIds.size >= DOT_AMBIENT.judgeSessionMaxLoggedMessages;
}

/** 判定ログ用の安定行整形。相対時刻を含めないため、同じ発言からは常に同じバイト列が得られる。 */
export function formatJudgeLogLine(entry: BufferedMessage, selfId: string | undefined): string {
    const name = entry.authorId === selfId ? '(自分=このBot)' : sanitizeAiText(entry.authorName);
    const textBody = entry.content.replace(/\s+/g, ' ').slice(0, 300);
    const body = sanitizeAiText([textBody, formatMediaNotes(entry.media)].filter(Boolean).join(' ')) || '(本文なし)';
    return `[${entry.id}] ${name}: ${body}`;
}

export interface JudgeLogEntry {
    id: string;
    at: number;
    /** 凍結済みの行テキスト（formatJudgeLogLine の出力） */
    text: string;
    /** 現時点のメディア注記（説明が揃うと変わる。変わったら補足として追記される） */
    mediaNotes: string;
}

export interface AppendOnlyTurnInput {
    entries: JudgeLogEntry[];
    /** 学習サマリ等の「更新される安定情報」。前回送信分と変わった時だけ末尾側に載る */
    personalityPrompt?: string;
    /** 過去の記憶ブロック（出来事・メンバーメモ）。雰囲気と同じく、前回送信分と変わった時だけ末尾側に載る */
    memoryPrompt?: string;
    /** プレゼンス・きっかけ・リアクション履歴・対象メッセージ等の今回限りの材料（必ず末尾） */
    tailLines: string[];
    /** 初回ターン先頭の説明 */
    firstTurnHeader: string;
}

export interface PreparedAppendOnlyTurn {
    /** 実際に送信するメッセージ列（system + 凍結済みターン群 + 今回ターン） */
    messages: OpenAIChatCompletionMessage[];
    /** 送信（トランスポート）が成功したら呼ぶ。セッションへ今回ターンを確定する */
    commit: () => void;
    /** このターンでリベース（新セッション開始）が起きたか */
    rebased: boolean;
    /** 今回ターンに新規発言が何件含まれたか */
    newEntryCount: number;
}

/**
 * 追記専用ターンを組み立てる（セッションはまだ変更しない）。
 * リベース時は候補 entries 全体を新しい初回ターンとして組み直す。
 */
export function prepareAppendOnlyTurn(
    session: AppendOnlySession,
    systemPrompt: string,
    input: AppendOnlyTurnInput,
): PreparedAppendOnlyTurn {
    const sorted = [...input.entries].sort((a, b) => a.at - b.at);
    // リベース判定: 現在のセッションへ「本当に増える分（未送信の新規行＋末尾材料）」を足して上限を超えるか
    const provisionalNew = sorted.filter(e => !session.loggedMessageIds.has(e.id) && e.at >= session.lastLoggedAt);
    const estimate = provisionalNew.reduce((sum, e) => sum + e.text.length, 0) + input.tailLines.join('\n').length + 64;
    const rebased = appendOnlySessionNeedsRebase(session, estimate);
    const baseLogged = rebased ? new Set<string>() : session.loggedMessageIds;
    const baseMedia = rebased ? new Map<string, string>() : session.mediaNotesByMessage;
    const baseLastAt = rebased ? 0 : session.lastLoggedAt;
    const basePersonality = rebased ? '' : session.personalitySent;
    const baseMemory = rebased ? '' : session.memorySent;

    const newEntries = sorted.filter(e => !baseLogged.has(e.id) && e.at >= baseLastAt);
    const supplements = sorted.filter(e => baseLogged.has(e.id) && e.mediaNotes && e.mediaNotes !== baseMedia.get(e.id));

    const parts: string[] = [];
    if (rebased || session.turns.length === 0) parts.push(input.firstTurnHeader);
    if (newEntries.length > 0) {
        parts.push('【会話ログ追記】\n' + newEntries.map(e => e.text).join('\n'));
    }
    if (supplements.length > 0) {
        parts.push('【メディア説明の補足（既出発言の添付について、説明が揃いました）】\n'
            + supplements.map(e => `[${e.id}] ${e.mediaNotes}`).join('\n'));
    }
    const personality = (input.personalityPrompt ?? '').slice(0, 700);
    const personalityChanged = personality.length > 0 && personality !== basePersonality;
    if (personalityChanged) {
        parts.push('【サーバーの雰囲気・話し方（最新の学習結果）】\n' + personality);
    }
    const memory = (input.memoryPrompt ?? '').slice(0, 1200);
    const memoryChanged = memory.length > 0 && memory !== baseMemory;
    if (memoryChanged) {
        parts.push(memory);
    }
    parts.push('【今回の判定材料】\n' + input.tailLines.join('\n'));
    const turnText = sanitizeAiText(parts.join('\n\n'));

    const priorTurns = rebased ? [] : session.turns;
    const messages: OpenAIChatCompletionMessage[] = [
        { role: 'system', content: systemPrompt },
        ...priorTurns.map(content => ({ role: 'user' as const, content })),
        { role: 'user', content: turnText },
    ];

    const commit = () => {
        if (rebased) {
            session.turns = [];
            session.loggedMessageIds = new Set();
            session.mediaNotesByMessage = new Map();
            session.personalitySent = '';
            session.memorySent = '';
            session.lastLoggedAt = 0;
            session.chars = 0;
        }
        session.turns.push(turnText);
        session.chars += turnText.length;
        for (const e of newEntries) {
            session.loggedMessageIds.add(e.id);
            session.mediaNotesByMessage.set(e.id, e.mediaNotes);
            if (e.at > session.lastLoggedAt) session.lastLoggedAt = e.at;
        }
        for (const e of supplements) session.mediaNotesByMessage.set(e.id, e.mediaNotes);
        if (personalityChanged) session.personalitySent = personality;
        if (memoryChanged) session.memorySent = memory;
    };

    return { messages, commit, rebased, newEntryCount: newEntries.length };
}

/** メッセージの添付メディアを抽出し、説明キャッシュの正規オブジェクトへ寄せて返す。 */
function mediaItemsOf(message: Message): DotMediaItem[] {
    const like: DotMediaMessageLike = {
        id: message.id,
        attachments: message.attachments.values(),
        messageSnapshots: [...message.messageSnapshots.values()].map(snapshot => ({ attachments: snapshot.attachments.values() })),
        embeds: message.embeds,
    };
    return dotMediaStore.register(extractDotMedia(like));
}

/** 履歴内のメディアを新しい順に最大 mediaEnsureMaxPerCall 件まで説明しておく（判定・応答生成の前に呼ぶ）。 */
async function ensureHistoryMedia(history: Message[]): Promise<void> {
    const items: DotMediaItem[] = [];
    for (const message of [...history].reverse()) items.push(...mediaItemsOf(message));
    if (items.length === 0) return;
    await dotMediaStore.ensure(items, DOT_AMBIENT.mediaEnsureMaxPerCall).catch(() => undefined);
}

/** 観測メッセージの本文に、説明済みメディアの注記を付け足す（雰囲気学習・出来事抽出用）。 */
function withMediaNotes(content: string, messageId: string): string {
    const notes = dotMediaStore.notesForMessage(messageId);
    return notes ? `${content} ${notes}` : content;
}

// ---------------------------------------------------------------------------
// 過去の記憶（出来事・メンバーメモ）の文脈注入
//
// 判定・生成はツールなし設計のため、検索はAIに任せずコード側で決定的に行う。
// 照合結果は dsh 規律どおり文脈の末尾にだけ差し込み、セットが変わったときだけ更新する。
// ストア読みは短時間キャッシュし、判定のたびのファイル読みを避ける（学習で更新されたら破棄）。
// ---------------------------------------------------------------------------

const episodeStoreCache = new Map<string, { at: number; episodes: GuildEpisode[] }>();
const memberMemoStoreCache = new Map<string, { at: number; memos: GuildMemberMemo[] }>();

async function cachedGuildEpisodes(guildId: string): Promise<GuildEpisode[]> {
    const cached = episodeStoreCache.get(guildId);
    if (cached && Date.now() - cached.at < DOT_AMBIENT.memoryStoreCacheMs) return cached.episodes;
    const store = await loadGuildEpisodeStore(guildId);
    episodeStoreCache.set(guildId, { at: Date.now(), episodes: store.episodes });
    return store.episodes;
}

async function cachedGuildMemberMemos(guildId: string): Promise<GuildMemberMemo[]> {
    const cached = memberMemoStoreCache.get(guildId);
    if (cached && Date.now() - cached.at < DOT_AMBIENT.memoryStoreCacheMs) return cached.memos;
    const store = await loadGuildMemberMemoStore(guildId);
    memberMemoStoreCache.set(guildId, { at: Date.now(), memos: store.memos });
    return store.memos;
}

export interface DotMemoryMessageSource {
    authorId?: string;
    authorName?: string;
    content: string;
}

/** 注入ブロックの組み立て（純粋関数）。出来事・メモのどちらも無ければ空文字。 */
export function formatDotMemoryBlock(episodes: GuildEpisode[], memos: GuildMemberMemo[]): string {
    const sections: string[] = [];
    if (episodes.length > 0) {
        sections.push(['【過去の出来事（サーバーの記録）】', ...episodes.map(formatEpisodeForMemory)].join('\n'));
    }
    if (memos.length > 0) {
        sections.push(['【今の会話に出ている人について（記録メモ）】', ...memos.map(formatMemberMemoLine)].join('\n'));
    }
    return sections.join('\n\n');
}

/**
 * 今の会話に合う過去の出来事とメンバーメモを照合し、判定・生成の末尾へ差し込むブロックを作る。
 * 出来事は話者・話題での決定的照合（最大 episodeInjectLimit 件）、メモは今の会話に出ている人だけ。
 */
export async function buildDotMemoryBlock(guildId: string, messages: DotMemoryMessageSource[]): Promise<string> {
    if (!guildId || messages.length === 0) return '';
    const [episodes, memos] = await Promise.all([cachedGuildEpisodes(guildId), cachedGuildMemberMemos(guildId)]);
    const matched = matchEpisodesForConversation(episodes, messages, DOT_AMBIENT.episodeInjectLimit);
    const speakerIds = new Set(messages.map(message => message.authorId).filter((id): id is string => !!id));
    const conversationText = messages.map(message => `${message.authorName ?? ''} ${message.content}`).join('\n');
    const selected = selectMemberMemosForContext(memos, speakerIds, conversationText, DOT_AMBIENT.memberMemoInjectLimit);
    return formatDotMemoryBlock(matched, selected);
}

const sleepMs = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** typing 表示の維持に必要な最小のチャンネル形（テストしやすいよう構造で受ける）。 */
export interface TypingChannelLike {
    sendTyping: () => Promise<unknown>;
}

/**
 * 「入力中…」表示を維持する。Discord の typing は約10秒で切れるため、開始直後に1回送り、
 * 以後は intervalMs 間隔で再送する。戻り値の stop は送信完了・失敗のどちらでも必ず呼ぶこと
 * （try/finally で囲う）。stop の二重呼び出しは安全で、stop 後にタイマーが残ることはない。
 */
export function startTypingKeepAlive(channel: TypingChannelLike, intervalMs: number = DOT_AMBIENT.typingRefreshMs): () => void {
    let stopped = false;
    const send = () => {
        if (!stopped) void channel.sendTyping().catch(() => undefined);
    };
    send();
    const timer = setInterval(send, intervalMs);
    timer.unref?.();
    return () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
    };
}

/** 投稿前の人間らしい間（ミリ秒）。rand は 0..1。呼びかけ応答は速め、通常参加は少し置く、リアクションは軽く。 */
export function ambientSendDelayMs(kind: 'addressed' | 'join' | 'react', rand: number): number {
    const r = Math.min(1, Math.max(0, rand));
    switch (kind) {
        case 'addressed': return 400 + Math.floor(r * 800);
        case 'join': return 1500 + Math.floor(r * 2500);
        case 'react': return 300 + Math.floor(r * 600);
    }
}

export const PARTICIPATION_JUDGE_SYSTEM_PROMPT = [
    'あなたはDiscordサーバーに常駐するAIの「参加判断器」です。JSONだけを返してください。',
    '形式: {"action":"none"|"reply"|"comment"|"react"|"continue","targetMessageId":"対象のメッセージIDまたはnull","emoji":"絵文字またはnull","draft":"reply/comment/continue の場合に、実際に投稿する文の下書き（そのまま投稿できる完成文）","confidence":0.0から1.0,"reason":"短い理由"}',
    '会話ログの各行頭は [メッセージID] です。あなた自身は「(自分=このBot)」と表示されています。',
    '会話ログには添付メディアの内容が [画像: …]、[動画: …]、[音声: …] の形で併記されることがあります。これは実際にメディアを見た説明なので、話題の判断に使ってください。「（内容未確認）」とあるメディアは、存在だけが分かっているものです。',
    '「AIかと思った」のような発言は、投稿された写真そのものがAI生成画像に見えたという意味であることがあります。自分（Bot）のことだと決めつけず、メディアの内容と文脈から判断してください。',
    'action の意味:',
    '- none: 何もしない（既定）。開かれていない会話、二人だけのやり取り、他人宛の話、内輪で完結している流れ、深刻な相談や言い争いの最中、直近で自分が話したばかりの場では必ず none。',
    '- reply: 特定のメッセージへの返信が自然な場合。宙に浮いた質問への回答、あなたに向けられた発言への応答。targetMessageId を指定する。',
    '- comment: 会話全体に短く口を挟む余地が本当にある場合だけ（ネタへの乗っかり、困っている人へのさりげない助け）。ハードルは高い。',
    '- react: 言葉ではなく絵文字リアクションが一番自然な軽い反応（笑い・驚き・共感）。targetMessageId と emoji を必ず指定する。',
    'react の間隔は固定ルールでは決めない。ユーザー文には「あなたの直近のリアクション」（いつ・誰の・どんな発言に・どの絵文字を付けたか）が渡されるので、それと会話の進み具合を見て、人間らしい間隔を自分で判断すること。秒数の決まりは無い。',
    '直前に自分がリアクションしたばかりで、会話があまり進んでいない・話題も変わっていないなら、react は none に寄せる。うるさく感じられる連打はしない。',
    '全部の発言に付けるのは不自然で、付けすぎは空気を壊す。付けるのは笑いどころ・強い同意・祝福など、反応が自然な一点だけにする。',
    '逆に、前回から話題が変わった、新しい盛り上がりや別の人の光る発言があるなら、間隔が短くても react してよい。時間が経っていても付ける価値のない発言には付けない。間隔は時計ではなく文脈で判断する。',
    '- continue: あなたが既に参加している会話の流れへの追随（あなたの状態が engaged の時だけ選べる）。',
    'しれっと混ざるのが理想で、出しゃばるのは失敗です。迷ったら none。confidence は「その参加が成功する確信度」。',
    'comment / reply を選ぶ場合、reason には「具体的に何を言うのか」（直近の会話の具体的な単語・固有名詞を拾った、自分の発言内容の下書き）が必須です。下書きが書けない参加は価値がありません。',
    '「会話の流れに軽く乗っかる」「意見に同意しつつ反応する」「雰囲気に合わせて一言」のような、言う内容が空の理由しか書けない場合は必ず none にしてください。',
    '言う内容は reason ではなく draft フィールドに、完成文のまま分離して書くこと。draft は、直近の会話に実際に出てきた固有名詞・物・出来事・数字のどれか1つ以上を、そのままの表記で含まなければならない。含まない draft はシステム側で機械的に却下され、参加自体が取り消される。',
    '「具体的な言葉を考える必要はない」「軽く相槌を打つだけ」のような、下書きを放棄した判断は却下対象です。労い・同意・ツッコミの参加でも、対象の具体を拾った完成文（draft）が書ける場合だけ選んでください。',
    '良い下書きの例: 対象「二次試験終わったぜ」への draft「二次試験おつかれ〜！終わったんか、今日はもう休むだけやな」。対象「すき家のマグロユッケ」への draft「すき家のマグロユッケか、飯テロは反則やわ」。どちらも会話の具体をそのまま含み、自分の反応を言い切っている。',
    '悪い参加の例（このような発言しかできないなら none）: 会話の固有名詞や中身に一切触れず「なんか技術的な話は、結構複雑な仕組みで動いてるんだよねぇ。」「特定の技術的な実装については、なかなか情報掴みにくいんだよね。」のような一般論ではぐらかす参加。',
    '「サーバーの雰囲気・空気・カオスさ・この鯖の魅力」のような、雰囲気そのものへの感想は参加内容として認めない。学習した雰囲気の要約の言い換えは中身ではない。悪い参加の実例: 対象が「鯖」という断片（誰かのサーバーの話）しかない場面で「いろんな話が飛び交う、まじでカオスな空間だよね。」のようなサーバーの雰囲気感想を返すこと。対象の話題（誰の・何のサーバーか）に何も言えていないので、この場合は none が正解。',
    '下書きは対象発言の話題そのもの（人名・物・出来事などの具体）について言える内容でなければならない。対象が断片的で、文脈から話題が分かっても、その話題について具体的に言えることがなければ none。',
    '対象の発言にメディアの説明（[動画: …] [画像: …] [音声: …]）が付いている場合、下書きはそのメディアの中身の具体（映っている物・画面の文字や数値・起きている出来事）について書くこと。投稿者の文言をなぞっただけの下書きや、メディアの中身に一切触れていない下書きは、内容が空なので none にする。',
    '会話ログの末尾には【過去の出来事（サーバーの記録）】と【今の会話に出ている人について（記録メモ）】が付くことがあります。これは実際に記録された出来事と、観測から分かったその人のメモです。話題の判断と下書きの材料に使ってください。',
    '下書きが、渡された過去の出来事の具体（出来事・固有名詞・数字）に触れている場合も、「具体に触れている」下書きとして有効です（システム側の機械チェックでも、その記録の文面が照合対象に含まれます）。',
    '過去の出来事への言及（掘り返し）は自然な参加の一形態です。ただし、渡された記録にない出来事を作って言及してはならない。掘り返しは会話の流れに自然に合うときだけで十分で、毎回する必要はありません。',
    '渡された記録の中に、同じ人が同じ話題や文句を以前も言っていた形跡がある場合、「また〜って言ってる」「前も同じこと言ってた」式の軽い掘り返しは、このサーバーでは自然な参加の形です。具体例: 記録に「2026-11-05 AIはゴミだと述べた」とあり、本人が今日もAIへの文句を言っているなら、下書きは「またAIゴミって言ってるw 5日も同じこと言ってたやん」のように、記録の具体（日付・内容）に触れて書くのが良い参加になります。',
    '知らない固有名詞・知らない話題については、知ったかぶりの一般論で参加しない。知らないことは参加の理由にならないので none。',
].join('\n');

export const ADDRESSED_JUDGE_SYSTEM_PROMPT = [
    'あなたはDiscordサーバーに常駐するAIの「呼びかけ判定器」です。JSONだけを返してください。',
    '形式: {"action":"reply"または"none","targetMessageId":null,"emoji":null,"confidence":0.0から1.0,"reason":"短い理由"}',
    '判定するのは「対象メッセージ」が、常駐AIであるあなた自身に話しかけているかどうかです。会話ログの中であなたは「(自分=このBot)」と表示されています。直近の会話は文脈としてだけ使い、判定は対象メッセージについて行ってください。',
    '会話ログには添付メディアの内容が [画像: …]、[動画: …]、[音声: …] の形で併記されることがあります。「AIかと思った」などは、その写真がAI生成に見えたという話題であることがあるので、メディアの内容と文脈から、あなた宛てかどうかを判断してください。',
    '会話ログの末尾に【過去の出来事（サーバーの記録）】や【今の会話に出ている人について（記録メモ）】が付くことがあります。実際に記録された過去の出来事と、その人についてのメモです。あなた宛てかどうかの判定の文脈としてだけ使ってください。',
    'action=reply: 名前や「AI」などでの呼びかけ、あなたへの質問・依頼・相談、あなたの直前の発言への返答・ツッコミ・続きの質問、二人称であなたに向けられた発言。',
    'action=none: あなたを話題にしているだけの発言（感想・報告・他人への説明）、他の特定の人への発言・質問、独り言、あなたが入ると割り込みになる発言。他のユーザーをメンションしている発言は原則その人宛です。',
    '例外として、話題にしているだけでも、発言の形が明らかにあなたへの呼びかけ・ツッコミで、あなた本人が短く返すのが会話の流れとして自然な場合に限り、高い確信度で reply にしてよい。',
    '場への質問（「〜ないかな」「〜知らない？」「〜ある？」など、その場にいる全員に広く向けた問いかけ）は、それだけではあなたへの呼びかけではありません。あなたが直前に発言していたという事情だけを理由に reply にしないこと。',
    'reply にできるのは、発言自体の中にあなた宛ての信号がある場合だけです: 名前や「AI」などでの呼びかけ、あなたへの二人称、あなたの発言への返信・続き・ツッコミ、あなた自身（あなたの発言・機能・判断）に関する話題。',
    '候補化の経緯として「直近であなたが発言していたことと質問形であることだけが根拠」と伝えられた発言は、場への質問である可能性が高い。発言内にあなた宛ての信号が見つからなければ none にすること。',
    '迷ったら action=none。confidence は「話しかけられた」確信度。',
].join('\n');

export const AMBIENT_SYSTEM_RULES = [
    'あなたはこのDiscordサーバーに常駐するAIです。会話の空気を読んで、混ざる価値がある場面で短く自然に発言しています。',
    '応答の芯: 相手の発言の具体（名詞・出来事・数字・主張）のどれか1つに必ず触れて、それに対する自分の反応・意見・ツッコミを言い切ること。「〜かもね」「〜みたいな感じ」「仕様によるよね」「なかなか分からないよね」のような、当たりも外れもしない言い方で逃げない。知らない話題は、知らないと認めて終わるか、そもそも参加しない（一般論で埋めない）。',
    '発言は短く（基本1〜2文）。混ざるときは相槌や短いリアクション（「まじ〜」「それな」程度）も普通に使い、盛り上がっている場では熱量に合わせた軽い一言でしれっと混ざる。詩的な飾りや相談の勧誘はしない。見出し・箇条書きのレポート形式にもしない。質問が宙に浮いていたら簡潔に助ける。',
    '相手を呼ぶときは、その人の表示名を使うか、そもそも名前で呼ばない。「夜更かしさん」のような、相手の属性や様子から作ったラベル・あだ名では呼ばない（「夜更かしさん、いらっしゃい！」は禁止の典型例）。',
    '話題や相談を勧誘する文句で締めない（「何か話したいことある？」「夜空の話でもする？」「何か相談ある？」のような誘いで終わらない）。返事は、答えが終わったらそこで終わる。',
    '星や夜空の話題・比喩は、相手が振ったときだけ使う。それ以外では自分から持ち出さない。',
    'ペルソナの決め台詞や緩ませ文句（「お茶でも飲んで落ち着きや」のような、場を和ませるための言い回し）は、返事の代わりに使わない。質問・ツッコミ・文句には、まずその中身で応えること。決め台詞を添えるのは中身のある返事の後に限る。直近の自分の発言で使っていたら、今回は使わない。',
    '知らない固有名詞・知らない話題について、抽象語（技術的・仕組み・情報・複雑など）を使った一般論ではぐらかさない（NG例: 「なんか技術的な話は、結構複雑な仕組みで動いてるんだよねぇ。」「特定の技術的な実装については、なかなか情報掴みにくいんだよね。」）。知らない話題には無理に参加しない。',
    'サーバーの雰囲気そのものへの感想（「カオスな空間だよね」「この鯖の魅力だよね」のような一般論）に落とさない。それは中身のない発言になる。参加するときは、判定の下書きにあった具体（人名・物・出来事）をそのまま短く言う。',
    '返すときは、直近の会話に実際に出てきた具体的な単語（固有名詞や話題の語）を拾って使う。直近の自分の発言と同じ文型・言い回しを繰り返さない。',
    '禁止の実例（実際に送られた、濁した応答）: 質問「俺ってなんでこれでコミュ力無いって言われてるの？」に「なんか特定のやり取りが引っかかっとるんちゃう？まあ、そんなん、あんま考えんと、お茶でも飲んで落ち着きや。🍵」と返すこと（質問に答えず、推測と決め台詞で逃げている）。呼びかけへの応答が「お、キナコ呼んだん？どうしたん？🍵」だけで、相手の発言の中身に一切触れていないこと。「まじか、そんなん気合入ってんな🤣 お茶でも飲んで落ち着きや〜🍵」（何にでも当てはまる文＋決め台詞の組み合わせ）。',
    '良い応答の実例: 「二次試験終わったぜ」には「二次試験おつかれ〜！終わったんか、今日はもう休むだけやな」。「俺ってなんでこれでコミュ力無いって言われてるの？」には「コミュ力無いってより、勢いで連投しすぎなんちゃう？w 中身じゃなくて圧やと思う」。どちらも相手の言葉の具体を拾い、自分の見方を言い切っている。',
    '馴れ馴れしすぎない、連投しない、場を独占しない。AIであることを聞かれたら隠さない。知らないことは知らないと言う。',
    '添付メディアは [画像: …] [動画: …] [音声: …] の形で内容が併記されます。併記がある話題では、その内容に即して話してください。メディアを見ていない前提の返しや、写真への感想を自分（Bot）への話だと決めつける返しはしないこと。',
    'メディアの説明がある話題で返すときは、必ずその中身の具体（映っている物・画面の文字や数値・起きている出来事）に触れる。投稿者の言葉をなぞるだけのオウム返しや、中身に触れない汎用相槌で済ませるのは禁止。',
    '禁止の実例: 動画付きの「最終的にこんな動作になった」という投稿への返しで「うわ、最終的にそんな動作になるんか。これ、相当な仕組みで組まれたんやな〜」と返すこと。投稿者の文言の言い換えと「相当な仕組み」という空の相槌だけで、動画の中身（サーバーの設定画面でロールが次々に作られていく様子）に一切触れていない。メディアの中身について具体的に言えることがなければ、無理に参加しない。',
    '文脈に【過去の出来事（サーバーの記録）】が含まれる場合、過去への言及はその記録にある内容だけを使うこと。記録にない出来事を「前に〜だったよね」の形で思い出したように語るのは捏造なので禁止。',
    '掘り返しは、会話の流れに自然にハマるときだけ、軽く一度だけにする。同じ出来事を繰り返し蒸し返したり、相手が蒸し返されたくない過去に触れたりしない。',
    '文脈に【今の会話に出ている人について（記録メモ）】が含まれる場合、その人の話題の好みなどの参考にしてよい。ただしメモを決めつけやラベル貼りに使わず、メモに書かれていない性質を推測で付け足さない。',
    'ツールは使わない。サーバーの話し方設定と学習した雰囲気に合わせる。',
].join('\n');

async function generateAmbientReply(guildId: string, context: string, situation: string, memoryBlock = ''): Promise<string> {
    const personality = await ensureGuildAIPersona(guildId, false);
    const personalityPrompt = buildGuildAIPersonalityPrompt(personality);
    const personaBlock = personality.persona
        ? `あなたの名前は「${personality.persona.name}」。${personality.persona.firstPerson ? `一人称は「${personality.persona.firstPerson}」。` : ''}性格: ${personality.persona.character} 話し方: ${personality.persona.speakingStyle} 振る舞い: ${personality.persona.behavior}`
        : '';
    // dsh原則: システムは固定ルールのみ（全ギルド共通でバイト同一）。ペルソナや学習サマリ等の
    // 可変情報は user 側の末尾に置き、先頭の接頭辞を安定させる。過去の記憶ブロックも末尾に置く。
    const text = await chatManager.generateText([
        { role: 'system', content: AMBIENT_SYSTEM_RULES },
        { role: 'user', content: sanitizeAiText(`直近の会話:\n${context}\n\n${situation}${personaBlock || personalityPrompt ? `\n\n${[personaBlock, personalityPrompt].filter(Boolean).join('\n')}` : ''}${memoryBlock ? `\n\n${memoryBlock}` : ''}`) },
    ], { model: GEMMA_MODEL, strictModel: true, maxTokens: DOT_AMBIENT.generationMaxTokens, priority: 'background',
        usageContext: { guildId, purpose: 'dot-generate' } });
    return text.trim();
}

function rememberDotPost(state: ChannelState, message: Message): void {
    state.lastBotMessageAt = message.createdTimestamp;
    state.dotPostIds.add(message.id);
    if (state.dotPostIds.size > 40) {
        const oldest = state.dotPostIds.values().next().value;
        if (oldest) state.dotPostIds.delete(oldest);
    }
    state.recentBotMessageIds.push(message.id);
    if (state.recentBotMessageIds.length > 60) state.recentBotMessageIds.shift();
}

/** Discord Message を判定ログ候補へ変換する（行は安定整形で凍結される）。 */
function judgeEntriesOf(history: Message[], selfId: string | undefined): JudgeLogEntry[] {
    return history.map(message => {
        const media = mediaItemsOf(message);
        const entry: BufferedMessage = {
            id: message.id,
            authorId: message.author.id,
            authorName: message.author.username,
            content: (getEffectiveContent(message) || message.content || '').slice(0, 300),
            at: message.createdTimestamp,
            isBot: message.author.bot,
            media,
        };
        return { id: entry.id, at: entry.at, text: formatJudgeLogLine(entry, selfId), mediaNotes: formatMediaNotes(media) };
    });
}

function judgeEntriesOfBuffered(buffered: BufferedMessage[], selfId: string | undefined): JudgeLogEntry[] {
    return buffered.map(entry => ({
        id: entry.id,
        at: entry.at,
        text: formatJudgeLogLine(entry, selfId),
        mediaNotes: formatMediaNotes(entry.media),
    }));
}

/** ノミネートされた候補が「Botに話しかけている」かをモデルに文脈で判定させる。basis はノミネート根拠で、判定への伝え方に使う。 */
async function judgeAddressed(message: Message, state: ChannelState, basis: AddressedNominationBasis = 'message-signal'): Promise<ParticipationDecision | null> {
    const channel = message.channel;
    if (!channel.isTextBased() || !('messages' in channel)) return null;
    const fetched = await channel.messages.fetch({ limit: DOT_AMBIENT.contextMessages }).catch(() => null);
    const history = fetched ? [...fetched.values()].reverse() : [message];
    await ensureHistoryMedia(history);
    const selfId = message.client.user?.id;
    const mentionsOthers = message.mentions.users.some(user => user.id !== selfId);
    const candidate = sanitizeAiText((message.content ?? '').replace(/\s+/g, ' ').slice(0, 300));
    const authorName = sanitizeAiText(message.author.username);
    // 過去の記憶（出来事・メンバーメモ）も判定の文脈として末尾に差し込む（参加判定と同じ規律）。
    const memoryBlock = await buildDotMemoryBlock(message.guildId ?? '', history.map(item => ({
        authorId: item.author.id,
        authorName: item.author.username,
        content: (getEffectiveContent(item) || item.content || ''),
    }))).catch(() => '');
    // 参加判定と同じ追記専用セッション規律（呼びかけ専用セッション。システムプロンプトが違うため分ける）。
    const prepared = prepareAppendOnlyTurn(state.addressedSession, ADDRESSED_JUDGE_SYSTEM_PROMPT, {
        entries: judgeEntriesOf(history, selfId),
        memoryPrompt: memoryBlock || undefined,
        tailLines: [
            `対象メッセージ: ${authorName}: ${candidate}`,
            ...(mentionsOthers ? ['（このメッセージは他のユーザーをメンションしています）'] : []),
            ...(basis === 'recent-bot-only' ? ['（候補化の経緯: この発言には名前・メンションなどの呼びかけ信号がありません。あなたが直近に発言していたことと、質問形であることだけが根拠です）'] : []),
            '上記の追記ログ全体が直近の会話です。判定は末尾の対象メッセージについて行ってください。',
        ],
        firstTurnHeader: '以下はこのチャンネルの会話ログです（新しい発言は追記として末尾に足されます）。',
    });
    if (prepared.rebased) Logger.info(`[DotAmbient] addressed judge session rebased guild=${message.guildId} channel=${message.channelId}`);
    // 欲しいのは短いJSONだけなので思考を切り、トークン予算も確保する。解釈不能なら1回だけ再試行する。
    const runJudge = (messages: OpenAIChatCompletionMessage[]) => parseDecisionWithRetry(
        () => chatManager.generateText(messages,
            { model: GEMMA_MODEL, strictModel: true, maxTokens: DOT_AMBIENT.judgeMaxTokens, priority: 'background', chatTemplateKwargs: { enable_thinking: false },
                usageContext: { guildId: message.guildId ?? undefined, purpose: 'dot-judge' } }),
        (raw, attempt) => Logger.warn(`[DotAmbient] addressed judge parse failed guild=${message.guildId} channel=${message.channelId} attempt=${attempt}/2 raw=${JSON.stringify(raw.slice(0, 200))}`),
    );
    // 生成リクエスト自体が落ちた場合は、履歴なし（対象メッセージのみの文脈）で組み立て直して再試行する。
    // それでも落ちたら null を返す（呼び出し側の名前呼びフォールバック判定に委ねる）。
    return generateWithContextFallback(
        async () => { const decision = await runJudge(prepared.messages); prepared.commit(); return decision; },
        () => runJudge([
            { role: 'system', content: ADDRESSED_JUDGE_SYSTEM_PROMPT },
            { role: 'user', content: sanitizeAiText(`直近の会話:\n${formatContext([message], selfId)}\n\n対象メッセージ: ${authorName}: ${candidate}`) },
        ]),
        error => Logger.warn(`[DotAmbient] addressed judge request failed guild=${message.guildId} channel=${message.channelId}; retrying with minimal context:`, error),
    ).catch(() => null);
}

/** 呼びかけへの応答。direct=メンション/返信の確定信号、judged=モデルが文脈で話しかけられたと判定。 */
async function respondToAddressed(message: Message, state: ChannelState, via: 'direct' | 'judged' = 'direct', confidence?: number): Promise<void> {
    const channel = message.channel;
    if (!channel.isTextBased() || !('messages' in channel)) return;
    const fetched = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    const history = fetched ? [...fetched.values()].reverse() : [message];
    await ensureHistoryMedia(history);
    const context = formatContext(history, message.client.user?.id);
    // 過去の記憶（出来事・メンバーメモ）を生成の文脈にも差し込む（掘り返しはこの記録の範囲でのみ許可される）。
    const memoryBlock = await buildDotMemoryBlock(message.guildId ?? '', history.map(item => ({
        authorId: item.author.id,
        authorName: item.author.username,
        content: (getEffectiveContent(item) || item.content || ''),
    }))).catch(() => '');
    const situation = via === 'judged'
        ? 'あなたは今、文脈の流れから自分に話しかけられたと判断しました。その発言の中身（質問・ツッコミ・文句・ネタ）に、短く自然に応えてください。「どうしたん？」のような、話しかけられたことの確認だけで終わらせるのは禁止です。相手の発言に出てきた具体的な言葉を拾って返すこと。質問や相談であれば簡潔に答えること。'
        : 'あなたは今、名前を呼ばれました。呼びかけの文そのもの（質問・ツッコミ・文句・ネタ）に、その中身で短く自然に応えてください。「どうしたん？」のような、呼ばれたことの確認だけで終わらせるのは禁止です。相手の発言に出てきた具体的な言葉を拾って返すこと。質問や相談であれば簡潔に答えること。';
    // 生成中ずっと「入力中…」が見えるよう、生成開始から送信完了（または失敗）まで typing を維持する。
    const stopTyping = 'sendTyping' in channel ? startTypingKeepAlive(channel) : () => undefined;
    try {
        // 生成が文脈側の事情で落ちたら、履歴なし（対象メッセージ＋状況文だけの最小文脈）で1回だけ組み立て直す。
        // 再試行も落ちた場合に初めて、呼び出し側が「addressed response failed」として記録する。
        const replyText = await generateWithContextFallback(
            () => generateAmbientReply(message.guildId ?? '', context, situation, memoryBlock),
            () => generateAmbientReply(message.guildId ?? '', formatContext([message], message.client.user?.id), situation, memoryBlock),
            error => Logger.warn(`[DotAmbient] addressed reply generation failed guild=${message.guildId} channel=${message.channelId}; retrying with minimal context:`, error),
        );
        if (!replyText) return;
        await sleepMs(ambientSendDelayMs('addressed', Math.random()));
        const sent = await message.reply({ content: replyText.slice(0, 1900) }).catch(() => null);
        if (sent) {
            rememberDotPost(state, sent);
            state.lastBotParticipationAt = sent.createdTimestamp;
            state.engagedUntil = Date.now() + DOT_AMBIENT.engagedWindowMs;
            Logger.info(`[DotAmbient] addressed guild=${message.guildId} channel=${message.channelId} via=${via}${via === 'judged' ? ` conf=${confidence ?? '?'}` : ''}`);
        }
    } finally {
        stopTyping();
    }
}

function onMessageCreate(client: Client) {
    return (message: Message) => {
        void (async () => {
            try {
                if (!message.guildId) return;
                const state = stateFor(message);
                if (message.author.id === client.user?.id) {
                    state.lastBotMessageAt = message.createdTimestamp;
                    pushBuffered(state, { id: message.id, authorId: message.author.id, authorName: message.author.username, content: (message.content ?? '').replace(/\s+/g, ' ').slice(0, 300), at: message.createdTimestamp, isBot: true, media: [] });
                    if (!state.dotPostIds.has(message.id)) {
                        state.lastOtherBotMessageAt = message.createdTimestamp;
                    }
                    state.recentBotMessageIds.push(message.id);
                    if (state.recentBotMessageIds.length > 60) state.recentBotMessageIds.shift();
                    return;
                }
                if (message.author.bot || message.system) return;
                if (!(await refreshDotEnabled())) return;
                if (excludedChannels.has(message.channelId)) return;

                const content = getEffectiveContent(message).trim();
                const now = message.createdTimestamp;
                state.recentHuman = state.recentHuman.filter(item => now - item.at <= DOT_AMBIENT.activeWindowMs);
                state.recentHuman.push({ authorId: message.author.id, at: now });
                state.humanMessagesTotal += 1;
                state.lastHumanMessageAt = now;
                state.lastHumanMessageId = message.id;
                state.lastHumanMessageIsQuestion = isHangingQuestion(content);
                const media = mediaItemsOf(message);
                pushBuffered(state, { id: message.id, authorId: message.author.id, authorName: message.author.username, content: content.slice(0, 300), at: now, isBot: false, media });
                if (media.length > 0) {
                    // 添付メディアは非同期で説明しておく（参加判定・応答が回る頃には説明が揃っている）。
                    void dotMediaStore.ensure(media, DOT_AMBIENT.mediaDescribeMaxPerMessage).catch(() => undefined);
                }

                if (content.length >= 4) {
                    const observed: ObservedMessage = {
                        id: message.id,
                        content: content.slice(0, 300),
                        channelId: message.channelId,
                        channelName: (message.channel as { name?: string }).name ?? '',
                        authorId: message.author.id,
                        authorName: message.member?.displayName || message.author.globalName || message.author.username,
                        at: now,
                    };
                    const buffer = guildObservations.get(message.guildId) ?? [];
                    buffer.push(observed);
                    while (buffer.length > 60) buffer.shift();
                    guildObservations.set(message.guildId, buffer);
                    // 出来事の長期記憶用にも同じ観測を貯める（抽出は sweep 側でまとめて行う）。
                    const pending = guildEpisodePending.get(message.guildId) ?? [];
                    pending.push(observed);
                    while (pending.length > DOT_AMBIENT.episodePendingCap) pending.shift();
                    guildEpisodePending.set(message.guildId, pending);
                    // メンバーメモ用にも同じ観測を貯める（更新は sweep 側で学習サイクルに合わせて行う）。
                    const memoPending = guildMemberMemoPending.get(message.guildId) ?? [];
                    memoPending.push(observed);
                    while (memoPending.length > DOT_AMBIENT.memberMemoPendingCap) memoPending.shift();
                    guildMemberMemoPending.set(message.guildId, memoPending);
                }

                // 呼びかけ判定: Discordメンション / Botの発言への直接返信は「呼ばれた」確定信号として即応答。
                // それ以外は緩くノミネートし、最終判断はモデル（文脈）に任せる。
                const selfId = client.user?.id;
                const mentionUserIds = [...message.mentions.users.keys()];
                // mentions.users に載らないメンション（生文字列 <@id> のみ残るケース等）を取りこぼさない。
                const rawMention = hasRawBotMention(content, selfId);
                const mentioned = (selfId ? message.mentions.users.has(selfId) : false) || rawMention;
                let repliedToBot = false;
                if (message.reference?.messageId) {
                    if (state.recentBotMessageIds.includes(message.reference.messageId)) {
                        repliedToBot = true;
                    } else {
                        const referenced = await message.fetchReference().catch(() => null);
                        repliedToBot = referenced?.author.id === client.user?.id;
                    }
                }
                const addressedReady = now - state.lastAddressedResponseAt >= DOT_AMBIENT.addressedCooldownMs;
                if ((mentioned || repliedToBot) && addressedReady) {
                    Logger.debug(`[DotAmbient] addressed direct guild=${message.guildId} channel=${message.channelId} self=${selfId ?? '?'} mentionUsers=[${mentionUserIds.join(',')}] rawMention=${rawMention} repliedToBot=${repliedToBot}`);
                    state.lastAddressedResponseAt = now;
                    await respondToAddressed(message, state, 'direct').catch(error => {
                        Logger.warn('[DotAmbient] addressed response failed:', error);
                    });
                } else if (!mentioned && !repliedToBot && addressedReady && content.length >= 2) {
                    const names = await guildCallNames(client, message.guildId);
                    const displayName = message.guild?.members.me?.displayName;
                    const botRecentlyActive = state.lastBotMessageAt > 0
                        && now - state.lastBotMessageAt <= DOT_AMBIENT.addressedContextWindowMs;
                    const basis = addressedNominationBasis(content, {
                        names: displayName ? [...names, displayName] : names,
                        isQuestion: state.lastHumanMessageIsQuestion,
                        botRecentlyActive,
                    });
                    if (basis) {
                        Logger.debug(`[DotAmbient] addressed judge guild=${message.guildId} channel=${message.channelId} self=${selfId ?? '?'} mentionUsers=[${mentionUserIds.join(',')}] rawMention=${rawMention} basis=${basis}`);
                        const decision = await judgeAddressed(message, state, basis).catch(error => {
                            Logger.debug('[DotAmbient] addressed judge failed:', error);
                            return null;
                        });
                        const callNames = displayName ? [...names, displayName] : names;
                        if (shouldRespondToAddressed(decision, basis)) {
                            state.lastAddressedResponseAt = Date.now();
                            await respondToAddressed(message, state, 'judged', decision?.confidence).catch(error => {
                                Logger.warn('[DotAmbient] addressed response failed:', error);
                            });
                        } else if (shouldFallbackToAddressed(decision, content, callNames)) {
                            // 判定基盤の不調で解釈不能（null）でも、名前で明確に呼ばれているなら無言にしない。
                            Logger.info(`[DotAmbient] addressed fallback (judge null, explicit name call) guild=${message.guildId} channel=${message.channelId}`);
                            state.lastAddressedResponseAt = Date.now();
                            await respondToAddressed(message, state, 'judged').catch(error => {
                                Logger.warn('[DotAmbient] addressed response failed:', error);
                            });
                        } else {
                            Logger.debug(`[DotAmbient] addressed pass guild=${message.guildId} channel=${message.channelId} self=${selfId ?? '?'} mentionUsers=[${mentionUserIds.join(',')}] basis=${basis} decision=${decision ? `action=${decision.action} conf=${decision.confidence}` : 'null'}`);
                        }
                    }
                }
            } catch (error) {
                Logger.debug('[DotAmbient] intake failed:', error);
            }
        })();
    };
}

function snapshotOf(state: ChannelState, now: number): DotChannelSnapshot {
    const recent = state.recentHuman.filter(item => now - item.at <= DOT_AMBIENT.activeWindowMs);
    return {
        lastHumanMessageAt: state.lastHumanMessageAt,
        lastHumanMessageIsQuestion: state.lastHumanMessageIsQuestion,
        lastHumanMessageId: state.lastHumanMessageId,
        lastJudgedQuestionId: state.lastJudgedQuestionId,
        lastAmbientJoinAt: state.lastAmbientJoinAt,
        lastOtherBotMessageAt: state.lastOtherBotMessageAt,
        lastBotParticipationAt: state.lastBotParticipationAt,
        engagedUntil: state.engagedUntil,
        humanMessagesInWindow: recent.length,
        distinctHumansInWindow: new Set(recent.map(item => item.authorId)).size,
        humanMessagesTotal: state.humanMessagesTotal,
        humanCountAtLastEvaluation: state.humanCountAtLastEvaluation,
        lastEvaluationAt: state.lastEvaluationAt,
    };
}

function guildCapReached(guildId: string, now: number): boolean {
    const times = (guildReplyTimes.get(guildId) ?? []).filter(at => now - at < 60 * 60_000);
    guildReplyTimes.set(guildId, times);
    return times.length >= DOT_AMBIENT.guildHourlyCap;
}

async function judgeAndParticipate(client: Client, channelId: string, state: ChannelState, trigger: NonNullable<DotEvaluationTrigger>): Promise<void> {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) return;
    const guild = client.guilds.cache.get(state.guildId);
    const me = guild?.members.me;
    if (!me || !('permissionsFor' in channel)) return;
    const permissions = channel.permissionsFor(me);
    if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) return;

    const fetched = await channel.messages.fetch({ limit: DOT_AMBIENT.contextMessages }).catch(() => null);
    if (!fetched) return;
    const history = [...fetched.values()].reverse();
    if (history.length === 0) return;
    await ensureHistoryMedia(history);

    if (trigger === 'question') {
        const targetIndex = history.findIndex(item => item.id === state.lastHumanMessageId);
        if (targetIndex === -1) return;
        // 質問の後に人間の発言があれば、もう宙には浮いていない。
        if (history.slice(targetIndex + 1).some(item => !item.author.bot)) return;
    } else {
        const humans = history.filter(item => !item.author.bot);
        const latestHuman = humans[humans.length - 1];
        if (!latestHuman || Date.now() - latestHuman.createdTimestamp > DOT_AMBIENT.activeWindowMs) return;
    }

    const personality = await ensureGuildAIPersona(state.guildId, false);
    const personalityPrompt = buildGuildAIPersonalityPrompt(personality);
    const presence = presenceOf(snapshotOf(state, Date.now()), Date.now());
    // 会話の絵: バッファの方が厚ければそちらを、そうでなければ取得した履歴を使う。
    // ただし判定へ渡す形は dsh 方式の追記専用セッション（過去ターン不変・新規分だけ末尾追記）。
    const context = state.recentMessages.length > history.length
        ? formatBuffered(state.recentMessages, client.user?.id, Date.now())
        : formatContext(history, client.user?.id);
    // バッファ側メディアの説明も判定前にできるだけ揃える（揃った分は補足として追記される）。
    if (state.recentMessages.length > 0) {
        const bufferedItems = state.recentMessages.flatMap(entry => entry.media);
        if (bufferedItems.length > 0) await dotMediaStore.ensure(bufferedItems, DOT_AMBIENT.mediaEnsureMaxPerCall).catch(() => undefined);
    }
    const judgeEntries = state.recentMessages.length > history.length
        ? judgeEntriesOfBuffered(state.recentMessages, client.user?.id)
        : judgeEntriesOf(history, client.user?.id);
    // 過去の記憶（出来事・メンバーメモ）: 判定に使った会話と同じ材料で決定的に照合し、末尾へ差し込む。
    const memoryBlock = await buildDotMemoryBlock(state.guildId,
        state.recentMessages.length > history.length
            ? state.recentMessages.map(entry => ({ authorId: entry.authorId, authorName: entry.authorName, content: entry.content }))
            : history.map(item => ({ authorId: item.author.id, authorName: item.author.username, content: (getEffectiveContent(item) || item.content || '') })),
    ).catch(() => '');
    const prepared = prepareAppendOnlyTurn(state.participationSession, PARTICIPATION_JUDGE_SYSTEM_PROMPT, {
        entries: judgeEntries,
        personalityPrompt,
        memoryPrompt: memoryBlock || undefined,
        tailLines: [
            `あなたの状態: ${presence === 'engaged' ? 'このチャンネルでは会話に参加中（engaged）' : 'このチャンネルでは様子見中（lurking）'}`,
            `きっかけ: ${trigger}`,
            `あなたの直近のリアクション（このチャンネル）:\n${formatRecentReactions(state.recentReactions, Date.now())}`,
            '上記の追記ログ全体が現在の会話です。最後の追記が最新の発言です。判定は最新の状態で行ってください。',
        ],
        firstTurnHeader: '以下はこのチャンネルの会話ログです（新しい発言は追記として末尾に足されます。過去の内容は変わりません）。',
    });
    if (prepared.rebased) Logger.info(`[DotAmbient] participation judge session rebased guild=${state.guildId} channel=${channelId} trigger=${trigger}`);

    const runJudge = (messages: OpenAIChatCompletionMessage[]) => parseDecisionWithRetry(
        () => chatManager.generateText(messages,
            { model: GEMMA_MODEL, strictModel: true, maxTokens: DOT_AMBIENT.judgeMaxTokens, priority: 'background', chatTemplateKwargs: { enable_thinking: false },
                usageContext: { guildId: state.guildId, purpose: 'dot-judge' } }),
        (raw, attempt) => Logger.warn(`[DotAmbient] participation judge parse failed guild=${state.guildId} channel=${channelId} trigger=${trigger} attempt=${attempt}/2 raw=${JSON.stringify(raw.slice(0, 200))}`),
    );
    const latestHumanMessage = [...history].reverse().find(item => !item.author.bot) ?? history[history.length - 1];
    // 生成リクエスト自体が落ちた場合は、最新の人間の発言だけの最小文脈で再試行する。それでも落ちたら参加しない。
    // フォールバック時はセッションへ確定しない（見ていない追記は次回もう一度送る）。
    const decision = await generateWithContextFallback(
        async () => { const d = await runJudge(prepared.messages); prepared.commit(); return d; },
        () => runJudge([
            { role: 'system', content: PARTICIPATION_JUDGE_SYSTEM_PROMPT },
            { role: 'user', content: sanitizeAiText(`あなたの状態: ${presence === 'engaged' ? 'このチャンネルでは会話に参加中（engaged）' : 'このチャンネルでは様子見中（lurking）'}\nきっかけ: ${trigger}\n直近の会話:\n${formatContext([latestHumanMessage], client.user?.id)}`) },
        ]),
        error => Logger.warn(`[DotAmbient] participation judge request failed guild=${state.guildId} channel=${channelId} trigger=${trigger}; retrying with minimal context:`, error),
    ).catch(() => null);
    if (!shouldExecuteParticipation(decision, presence)) {
        Logger.debug(`[DotAmbient] pass guild=${state.guildId} channel=${channelId} trigger=${trigger} decision=${decision ? `action=${decision.action} conf=${decision.confidence}` : 'null'}`);
        return;
    }
    if (!decision) return;
    // 具体性ゲート: reply/comment/continue は、下書きが会話の具体に触れている場合だけ実行する。
    // 判定プロンプトの規律だけでは濁した下書きが通ってしまうため、機械的にも止める（react は対象外）。
    // 照合元には注入した過去の記憶（出来事・メンバーメモ）の文面も含める。含めないと、
    // 記録に基づく良い掘り返しの下書きが「会話に出てこない具体」として全部弾かれてしまう。
    const gateContext = memoryBlock ? `${context}\n${memoryBlock}` : context;
    if (decision.action !== 'react' && !draftHasConcreteAnchor(decision, gateContext)) {
        Logger.info(`[DotAmbient] participation blocked (draft has no concrete anchor) guild=${state.guildId} channel=${channelId} trigger=${trigger} action=${decision.action} conf=${decision.confidence} draft=${draftAnchorText(decision).slice(0, 120)} reason=${decision.reason}`);
        return;
    }

    const resolveTarget = async (): Promise<Message | null> => {
        if (!decision.targetMessageId) return null;
        const inHistory = history.find(item => item.id === decision.targetMessageId);
        if (inHistory) return inHistory;
        return await channel.messages.fetch(decision.targetMessageId).catch(() => null);
    };
    const lastHumanMessage = [...history].reverse().find(item => !item.author.bot) ?? null;

    if (decision.action === 'react') {
        // 間隔の固定クールダウンは無い。付けるかどうか・どの間隔が自然かは、直近のリアクション履歴を
        // 材料にモデル自身が判定している（PARTICIPATION_JUDGE 参照）。ここでは実行だけを行う。
        if (!permissions.has(PermissionFlagsBits.AddReactions)) return;
        const target = (await resolveTarget()) ?? lastHumanMessage;
        if (!target) return;
        await sleepMs(ambientSendDelayMs('react', Math.random()));
        const reacted = await target.react(decision.emoji ?? '👍').then(() => true).catch(() => false);
        if (!reacted) return;
        state.recentReactions = recordRecentReaction(state.recentReactions, {
            at: Date.now(),
            authorName: target.author.username,
            excerpt: getEffectiveContent(target).replace(/\s+/g, ' ').slice(0, 120),
            emoji: decision.emoji ?? '👍',
        });
        Logger.info(`[DotAmbient] reacted guild=${state.guildId} channel=${channelId} emoji=${decision.emoji ?? '👍'} conf=${decision.confidence} reason=${decision.reason}`);
        return;
    }

    const baseSituation = decision.action === 'continue'
        ? 'あなたは今、このチャンネルの会話に参加中です。流れへの追随として、短く自然に続けてください。'
        : trigger === 'question'
            ? '上記の会話で答えられていない質問に、常駐AIとして短く自然に答えてください。'
            : decision.action === 'reply'
                ? '上記の会話の中の対象メッセージに、常駐AIとして短く自然に返信してください。'
                : '上記の会話の流れに、常駐AIとして短く自然に混ざってください。';
    // 判定の下書き（具体性ゲート通過済み）を生成へ引き継ぎ、生成側で汎用文に薄まらないようにする。
    const situation = decision.draft?.trim()
        ? `${baseSituation}\n（参加判定の下書き: 「${decision.draft.trim()}」この下書きの具体と温度感を保ったまま、自然な文にして返してください。下書きを汎用文に薄めないこと。）`
        : baseSituation;
    // 生成中ずっと「入力中…」が見えるよう、生成開始から送信完了（または失敗）まで typing を維持する。
    const stopTyping = 'sendTyping' in channel ? startTypingKeepAlive(channel) : () => undefined;
    try {
        const replyText = await generateAmbientReply(state.guildId, context, situation, memoryBlock);
        if (!replyText) return;

        await sleepMs(ambientSendDelayMs('join', Math.random()));

        let sent: Message | null = null;
        const target = await resolveTarget();
        if (decision.action === 'reply' || decision.action === 'continue') {
            const replyTarget = target
                ?? (trigger === 'question' ? history.find(item => item.id === state.lastHumanMessageId) ?? null : lastHumanMessage);
            if (replyTarget) sent = await replyTarget.reply({ content: replyText.slice(0, 1900) }).catch(() => null);
        } else if (target) {
            sent = await target.reply({ content: replyText.slice(0, 1900) }).catch(() => null);
        }
        if (!sent) sent = await channel.send({ content: replyText.slice(0, 1900) }).catch(() => null);
        if (!sent) return;

        rememberDotPost(state, sent);
        const now = Date.now();
        state.lastAmbientJoinAt = now;
        state.lastBotParticipationAt = now;
        state.engagedUntil = now + DOT_AMBIENT.engagedWindowMs;
        const times = guildReplyTimes.get(state.guildId) ?? [];
        times.push(now);
        guildReplyTimes.set(state.guildId, times);
        Logger.info(`[DotAmbient] joined(${decision.action}) guild=${state.guildId} channel=${channelId} trigger=${trigger} conf=${decision.confidence} reason=${decision.reason}`);
    } finally {
        stopTyping();
    }
}

/** 観測した会話からサーバーの空気を学習し、既存の GuildAIPersonality へ反映する。 */
async function learnGuildAtmosphere(guildId: string): Promise<void> {
    const buffer = guildObservations.get(guildId) ?? [];
    if (buffer.length < DOT_AMBIENT.learningBatchSize) return;
    const now = Date.now();
    if (now - (guildLastLearnAt.get(guildId) ?? 0) < DOT_AMBIENT.learningIntervalMs) return;

    const personality = await getGuildAIPersonality(guildId);
    if (!personality.learningEnabled) return;
    const used = buffer.slice(0, DOT_AMBIENT.learningUseMessages);
    const summary = (await chatManager.generateText([
        { role: 'system', content: ATMOSPHERE_LEARNING_SYSTEM_PROMPT },
        { role: 'user', content: sanitizeAiText(buildAtmosphereLearningUserPrompt(personality.learnedSummary, used.map(item => withMediaNotes(item.content, item.id)))) },
    ], { model: config.pexAi.channelModel || config.pexAi.model, strictModel: true, maxTokens: DOT_AMBIENT.learningMaxTokens, priority: 'background',
        usageContext: { guildId, purpose: 'dot-learn' } })).trim();

    guildObservations.set(guildId, buffer.slice(used.length));
    guildLastLearnAt.set(guildId, now);
    if (!summary) return;
    const applied = await applyGuildAIPersonalityLearning(guildId, personality.learningRevision, summary, used.length, used[used.length - 1].id);
    if (applied) Logger.info(`[DotAmbient] learned atmosphere guild=${guildId} messages=${used.length} total=${applied.learnedMessageCount}`);
}

/** 観測した会話から「出来事」だけを抽出し、長期記憶（GuildEpisodeMemory）へ追記する。雰囲気学習とは別枠。 */
async function extractObservedEpisodes(guildId: string): Promise<void> {
    const buffer = guildEpisodePending.get(guildId) ?? [];
    if (buffer.length < DOT_AMBIENT.episodeMinPending) return;
    const now = Date.now();
    if (now - (guildLastEpisodeAt.get(guildId) ?? 0) < DOT_AMBIENT.episodeIntervalMs) return;
    const used = buffer.slice(0, DOT_AMBIENT.episodeUseMessages);
    const result = await extractGuildEpisodes(guildId, used.map(item => ({
        id: item.id,
        at: item.at,
        channelId: item.channelId,
        channelName: item.channelName,
        authorId: item.authorId,
        authorName: item.authorName,
        content: withMediaNotes(item.content, item.id),
    })), 'observed', async messages => chatManager.generateText(
        messages.map(message => ({ role: message.role, content: sanitizeAiText(message.content) })),
        { model: config.pexAi.channelModel || config.pexAi.model, strictModel: true, maxTokens: DOT_AMBIENT.episodeMaxTokens, priority: 'background',
            usageContext: { guildId, purpose: 'episode' } },
    ));
    // 抽出に成功した分だけ消費する（失敗時は次回 sweep で再挑戦）。
    guildEpisodePending.set(guildId, buffer.slice(used.length));
    guildLastEpisodeAt.set(guildId, now);
    if (result.added > 0) {
        episodeStoreCache.delete(guildId);
        Logger.info(`[DotAmbient] recorded episodes guild=${guildId} added=${result.added} parsed=${result.parsed}`);
    }
}

/** 観測した会話から、活発なメンバーについての軽いメモ（GuildMemberMemory）を更新する。雰囲気学習と同じ観測の別枠。 */
async function learnGuildMemberMemos(guildId: string): Promise<void> {
    const buffer = guildMemberMemoPending.get(guildId) ?? [];
    if (buffer.length < DOT_AMBIENT.memberMemoMinPending) return;
    const now = Date.now();
    if (now - (guildLastMemberMemoAt.get(guildId) ?? 0) < DOT_AMBIENT.memberMemoIntervalMs) return;
    const personality = await getGuildAIPersonality(guildId);
    if (!personality.learningEnabled) return;
    const used = buffer.slice(0, DOT_AMBIENT.memberMemoUseMessages);
    const result = await updateGuildMemberMemos(guildId, used, async messages => chatManager.generateText(
        messages.map(message => ({ role: message.role, content: sanitizeAiText(message.content) })),
        { model: config.pexAi.channelModel || config.pexAi.model, strictModel: true, maxTokens: DOT_AMBIENT.memberMemoMaxTokens, priority: 'background',
            usageContext: { guildId, purpose: 'member-memo' } },
    ));
    // 生成に成功した分だけ消費する（失敗時は例外で抜け、次回 sweep で再挑戦）。
    guildMemberMemoPending.set(guildId, buffer.slice(used.length));
    guildLastMemberMemoAt.set(guildId, now);
    if (result.updated > 0) {
        memberMemoStoreCache.delete(guildId);
        Logger.info(`[DotAmbient] updated member memos guild=${guildId} authors=${result.authors} updated=${result.updated}`);
    }
}

async function sweep(client: Client): Promise<void> {
    if (sweeping) return;
    sweeping = true;
    try {
        if (!(await refreshDotEnabled())) return;
        const now = Date.now();
        let evaluations = 0;
        const evaluatedGuilds = new Set<string>();
        for (const [channelId, state] of channelStates) {
            if (excludedChannels.has(channelId)) continue;
            if (state.lastHumanMessageAt > 0 && now - state.lastHumanMessageAt > 60 * 60_000) {
                channelStates.delete(channelId);
                continue;
            }
            if (evaluations >= 2) break;
            const trigger = evaluateEvaluationTrigger(snapshotOf(state, now), now);
            if (!trigger) continue;
            if (evaluatedGuilds.has(state.guildId)) continue;
            if (guildCapReached(state.guildId, now)) continue;
            evaluations += 1;
            evaluatedGuilds.add(state.guildId);
            await judgeAndParticipate(client, channelId, state, trigger).catch(error => {
                Logger.warn('[DotAmbient] judge/participate failed:', error);
            });
            if (trigger === 'question') {
                state.lastJudgedQuestionId = state.lastHumanMessageId;
            } else {
                state.lastEvaluationAt = Date.now();
                state.humanCountAtLastEvaluation = state.humanMessagesTotal;
            }
        }
        for (const guildId of guildObservations.keys()) {
            await learnGuildAtmosphere(guildId).catch(error => {
                Logger.warn('[DotAmbient] learning failed:', error);
            });
        }
        for (const guildId of guildEpisodePending.keys()) {
            await extractObservedEpisodes(guildId).catch(error => {
                Logger.warn('[DotAmbient] episode extraction failed:', error);
            });
        }
        for (const guildId of guildMemberMemoPending.keys()) {
            await learnGuildMemberMemos(guildId).catch(error => {
                Logger.warn('[DotAmbient] member memo learning failed:', error);
            });
        }
    } finally {
        sweeping = false;
    }
}

/** Bot起動時に一度だけ呼ぶ。dotモードがOFFの間は実質何もしない。 */
export function initializeStaffAIDotAmbient(client: Client, options: DotAmbientOptions = {}): void {
    if (initialized) return;
    initialized = true;
    for (const id of options.excludedChannelIds ?? []) excludedChannels.add(id);
    client.on('messageCreate', onMessageCreate(client));
    const timer = setInterval(() => {
        void sweep(client).catch(error => Logger.warn('[DotAmbient] sweep failed:', error));
    }, DOT_AMBIENT.sweepIntervalMs);
    timer.unref();
    Logger.info(`[DotAmbient] 常駐dotを初期化しました（dotモードON時にだけ発言します, excluded=${excludedChannels.size})`);
}
