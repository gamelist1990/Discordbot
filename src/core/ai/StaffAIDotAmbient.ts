import { PermissionFlagsBits, type Client, type Message } from 'discord.js';
import { OpenAIChatManager } from './OpenAIChatManager.js';
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
import { extractGuildEpisodes } from './GuildEpisodeMemory.js';
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
    judgeMaxTokens: 1024,
    generationMaxTokens: 1024,
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
        return { action, targetMessageId, emoji, confidence, reason };
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

interface BufferedMessage {
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
    '形式: {"action":"none"|"reply"|"comment"|"react"|"continue","targetMessageId":"対象のメッセージIDまたはnull","emoji":"絵文字またはnull","confidence":0.0から1.0,"reason":"短い理由"}',
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
    '悪い参加の例（このような発言しかできないなら none）: 会話の固有名詞や中身に一切触れず「なんか技術的な話は、結構複雑な仕組みで動いてるんだよねぇ。」「特定の技術的な実装については、なかなか情報掴みにくいんだよね。」のような一般論ではぐらかす参加。',
    '「サーバーの雰囲気・空気・カオスさ・この鯖の魅力」のような、雰囲気そのものへの感想は参加内容として認めない。学習した雰囲気の要約の言い換えは中身ではない。悪い参加の実例: 対象が「鯖」という断片（誰かのサーバーの話）しかない場面で「いろんな話が飛び交う、まじでカオスな空間だよね。」のようなサーバーの雰囲気感想を返すこと。対象の話題（誰の・何のサーバーか）に何も言えていないので、この場合は none が正解。',
    '下書きは対象発言の話題そのもの（人名・物・出来事などの具体）について言える内容でなければならない。対象が断片的で、文脈から話題が分かっても、その話題について具体的に言えることがなければ none。',
    '知らない固有名詞・知らない話題については、知ったかぶりの一般論で参加しない。知らないことは参加の理由にならないので none。',
].join('\n');

export const ADDRESSED_JUDGE_SYSTEM_PROMPT = [
    'あなたはDiscordサーバーに常駐するAIの「呼びかけ判定器」です。JSONだけを返してください。',
    '形式: {"action":"reply"または"none","targetMessageId":null,"emoji":null,"confidence":0.0から1.0,"reason":"短い理由"}',
    '判定するのは「対象メッセージ」が、常駐AIであるあなた自身に話しかけているかどうかです。会話ログの中であなたは「(自分=このBot)」と表示されています。直近の会話は文脈としてだけ使い、判定は対象メッセージについて行ってください。',
    '会話ログには添付メディアの内容が [画像: …] の形で併記されることがあります。「AIかと思った」などは、その写真がAI生成に見えたという話題であることがあるので、メディアの内容と文脈から、あなた宛てかどうかを判断してください。',
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
    '発言は短く（基本1〜2文）。混ざるときは相槌や短いリアクション（「まじ〜」「それな」程度）も普通に使い、盛り上がっている場では熱量に合わせた軽い一言でしれっと混ざる。詩的な飾りや相談の勧誘はしない。見出し・箇条書きのレポート形式にもしない。質問が宙に浮いていたら簡潔に助ける。',
    '相手を呼ぶときは、その人の表示名を使うか、そもそも名前で呼ばない。「夜更かしさん」のような、相手の属性や様子から作ったラベル・あだ名では呼ばない（「夜更かしさん、いらっしゃい！」は禁止の典型例）。',
    '話題や相談を勧誘する文句で締めない（「何か話したいことある？」「夜空の話でもする？」「何か相談ある？」のような誘いで終わらない）。返事は、答えが終わったらそこで終わる。',
    '星や夜空の話題・比喩は、相手が振ったときだけ使う。それ以外では自分から持ち出さない。',
    '知らない固有名詞・知らない話題について、抽象語（技術的・仕組み・情報・複雑など）を使った一般論ではぐらかさない（NG例: 「なんか技術的な話は、結構複雑な仕組みで動いてるんだよねぇ。」「特定の技術的な実装については、なかなか情報掴みにくいんだよね。」）。知らない話題には無理に参加しない。',
    'サーバーの雰囲気そのものへの感想（「カオスな空間だよね」「この鯖の魅力だよね」のような一般論）に落とさない。それは中身のない発言になる。参加するときは、判定の下書きにあった具体（人名・物・出来事）をそのまま短く言う。',
    '返すときは、直近の会話に実際に出てきた具体的な単語（固有名詞や話題の語）を拾って使う。直近の自分の発言と同じ文型・言い回しを繰り返さない。',
    '馴れ馴れしすぎない、連投しない、場を独占しない。AIであることを聞かれたら隠さない。知らないことは知らないと言う。',
    '添付メディアは [画像: …] [動画: …] [音声: …] の形で内容が併記されます。併記がある話題では、その内容に即して話してください。メディアを見ていない前提の返しや、写真への感想を自分（Bot）への話だと決めつける返しはしないこと。',
    'ツールは使わない。サーバーの話し方設定と学習した雰囲気に合わせる。',
].join('\n');

async function generateAmbientReply(guildId: string, context: string, situation: string): Promise<string> {
    const personality = await ensureGuildAIPersona(guildId, false);
    const personalityPrompt = buildGuildAIPersonalityPrompt(personality);
    const personaBlock = personality.persona
        ? `あなたの名前は「${personality.persona.name}」。${personality.persona.firstPerson ? `一人称は「${personality.persona.firstPerson}」。` : ''}性格: ${personality.persona.character} 話し方: ${personality.persona.speakingStyle} 振る舞い: ${personality.persona.behavior}`
        : '';
    const text = await chatManager.generateText([
        { role: 'system', content: sanitizeAiText([AMBIENT_SYSTEM_RULES, personaBlock, personalityPrompt].filter(Boolean).join('\n')) },
        { role: 'user', content: sanitizeAiText(`直近の会話:\n${context}\n\n${situation}`) },
    ], { model: GEMMA_MODEL, strictModel: true, maxTokens: DOT_AMBIENT.generationMaxTokens, priority: 'background' });
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

/** ノミネートされた候補が「Botに話しかけている」かをモデルに文脈で判定させる。basis はノミネート根拠で、判定への伝え方に使う。 */
async function judgeAddressed(message: Message, basis: AddressedNominationBasis = 'message-signal'): Promise<ParticipationDecision | null> {
    const channel = message.channel;
    if (!channel.isTextBased() || !('messages' in channel)) return null;
    const fetched = await channel.messages.fetch({ limit: DOT_AMBIENT.contextMessages }).catch(() => null);
    const history = fetched ? [...fetched.values()].reverse() : [message];
    await ensureHistoryMedia(history);
    const context = formatContext(history, message.client.user?.id);
    const selfId = message.client.user?.id;
    const mentionsOthers = message.mentions.users.some(user => user.id !== selfId);
    const candidate = sanitizeAiText((message.content ?? '').replace(/\s+/g, ' ').slice(0, 300));
    const authorName = sanitizeAiText(message.author.username);
    // 欲しいのは短いJSONだけなので思考を切り、トークン予算も確保する。解釈不能なら1回だけ再試行する。
    const runJudge = (contextText: string) => parseDecisionWithRetry(
        () => chatManager.generateText([
            { role: 'system', content: ADDRESSED_JUDGE_SYSTEM_PROMPT },
            { role: 'user', content: sanitizeAiText(`直近の会話:\n${contextText}\n\n対象メッセージ: ${authorName}: ${candidate}${mentionsOthers ? '\n（このメッセージは他のユーザーをメンションしています）' : ''}${basis === 'recent-bot-only' ? '\n（候補化の経緯: この発言には名前・メンションなどの呼びかけ信号がありません。あなたが直近に発言していたことと、質問形であることだけが根拠です）' : ''}`) },
        ], { model: GEMMA_MODEL, strictModel: true, maxTokens: DOT_AMBIENT.judgeMaxTokens, priority: 'background', chatTemplateKwargs: { enable_thinking: false } }),
        (raw, attempt) => Logger.warn(`[DotAmbient] addressed judge parse failed guild=${message.guildId} channel=${message.channelId} attempt=${attempt}/2 raw=${JSON.stringify(raw.slice(0, 200))}`),
    );
    // 生成リクエスト自体が落ちた場合は、履歴なし（対象メッセージのみの文脈）で組み立て直して再試行する。
    // それでも落ちたら null を返す（呼び出し側の名前呼びフォールバック判定に委ねる）。
    return generateWithContextFallback(
        () => runJudge(context),
        () => runJudge(formatContext([message], selfId)),
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
    const situation = via === 'judged'
        ? 'あなたは今、文脈の流れから自分に話しかけられたと判断しました。その発言に短く自然に応えてください。質問や相談であれば簡潔に答えること。'
        : 'あなたは今、名前を呼ばれました。その呼びかけに短く自然に応えてください。質問や相談であれば簡潔に答えること。';
    // 生成中ずっと「入力中…」が見えるよう、生成開始から送信完了（または失敗）まで typing を維持する。
    const stopTyping = 'sendTyping' in channel ? startTypingKeepAlive(channel) : () => undefined;
    try {
        // 生成が文脈側の事情で落ちたら、履歴なし（対象メッセージ＋状況文だけの最小文脈）で1回だけ組み立て直す。
        // 再試行も落ちた場合に初めて、呼び出し側が「addressed response failed」として記録する。
        const replyText = await generateWithContextFallback(
            () => generateAmbientReply(message.guildId ?? '', context, situation),
            () => generateAmbientReply(message.guildId ?? '', formatContext([message], message.client.user?.id), situation),
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
                        const decision = await judgeAddressed(message, basis).catch(error => {
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
    const context = state.recentMessages.length > history.length
        ? formatBuffered(state.recentMessages, client.user?.id, Date.now())
        : formatContext(history, client.user?.id);

    const judgeUserContent = (contextText: string) => sanitizeAiText(`${personalityPrompt ? personalityPrompt.slice(0, 700) + '\n' : ''}あなたの状態: ${presence === 'engaged' ? 'このチャンネルでは会話に参加中（engaged）' : 'このチャンネルでは様子見中（lurking）'}\nきっかけ: ${trigger}\nあなたの直近のリアクション（このチャンネル）:\n${formatRecentReactions(state.recentReactions, Date.now())}\n直近の会話:\n${contextText}`);
    const runJudge = (contextText: string) => parseDecisionWithRetry(
        () => chatManager.generateText([
            { role: 'system', content: PARTICIPATION_JUDGE_SYSTEM_PROMPT },
            { role: 'user', content: judgeUserContent(contextText) },
        ], { model: GEMMA_MODEL, strictModel: true, maxTokens: DOT_AMBIENT.judgeMaxTokens, priority: 'background', chatTemplateKwargs: { enable_thinking: false } }),
        (raw, attempt) => Logger.warn(`[DotAmbient] participation judge parse failed guild=${state.guildId} channel=${channelId} trigger=${trigger} attempt=${attempt}/2 raw=${JSON.stringify(raw.slice(0, 200))}`),
    );
    const latestHumanMessage = [...history].reverse().find(item => !item.author.bot) ?? history[history.length - 1];
    // 生成リクエスト自体が落ちた場合は、最新の人間の発言だけの最小文脈で再試行する。それでも落ちたら参加しない。
    const decision = await generateWithContextFallback(
        () => runJudge(context),
        () => runJudge(formatContext([latestHumanMessage], client.user?.id)),
        error => Logger.warn(`[DotAmbient] participation judge request failed guild=${state.guildId} channel=${channelId} trigger=${trigger}; retrying with minimal context:`, error),
    ).catch(() => null);
    if (!shouldExecuteParticipation(decision, presence)) {
        Logger.debug(`[DotAmbient] pass guild=${state.guildId} channel=${channelId} trigger=${trigger} decision=${decision ? `action=${decision.action} conf=${decision.confidence}` : 'null'}`);
        return;
    }
    if (!decision) return;

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

    const situation = decision.action === 'continue'
        ? 'あなたは今、このチャンネルの会話に参加中です。流れへの追随として、短く自然に続けてください。'
        : trigger === 'question'
            ? '上記の会話で答えられていない質問に、常駐AIとして短く自然に答えてください。'
            : decision.action === 'reply'
                ? '上記の会話の中の対象メッセージに、常駐AIとして短く自然に返信してください。'
                : '上記の会話の流れに、常駐AIとして短く自然に混ざってください。';
    // 生成中ずっと「入力中…」が見えるよう、生成開始から送信完了（または失敗）まで typing を維持する。
    const stopTyping = 'sendTyping' in channel ? startTypingKeepAlive(channel) : () => undefined;
    try {
        const replyText = await generateAmbientReply(state.guildId, context, situation);
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
    ], { model: config.pexAi.channelModel || config.pexAi.model, strictModel: true, maxTokens: DOT_AMBIENT.learningMaxTokens, priority: 'background' })).trim();

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
        { model: config.pexAi.channelModel || config.pexAi.model, strictModel: true, maxTokens: DOT_AMBIENT.episodeMaxTokens, priority: 'background' },
    ));
    // 抽出に成功した分だけ消費する（失敗時は次回 sweep で再挑戦）。
    guildEpisodePending.set(guildId, buffer.slice(used.length));
    guildLastEpisodeAt.set(guildId, now);
    if (result.added > 0) Logger.info(`[DotAmbient] recorded episodes guild=${guildId} added=${result.added} parsed=${result.parsed}`);
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
        void sweep(client);
    }, DOT_AMBIENT.sweepIntervalMs);
    timer.unref();
    Logger.info(`[DotAmbient] 常駐dotを初期化しました（dotモードON時にだけ発言します, excluded=${excludedChannels.size})`);
}
