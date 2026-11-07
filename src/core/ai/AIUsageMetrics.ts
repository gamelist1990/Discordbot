// src/core/ai/AIUsageMetrics.ts
import { database } from '../persistence/Database.js';

/**
 * Bot 全体の AI 利用統計（トラックE: 利用統計の全面正確化）。
 *
 * 旧方式の問題:
 * - 計数は /staff ai の成功時に呼び出し側が recordStaffUsage を呼ぶ経路だけだった。
 *   dot常駐の判定・生成・学習、メディア説明、出来事抽出、ChatAI、性格生成、
 *   ContentSafety、ServerBuilder など他の全経路は数えられていなかった。
 * - KVヒット率は /staff ai 分だけの cached_tokens ベースで、A8 ゲートウェイの
 *   /v1/cache/stats（全トラフィック・ゲートウェイ再起動以降の累計）とは母集団も
 *   期間も違うため一致しなかった（定義の比較は docs ではなく本ファイル末尾コメント参照）。
 *
 * 新方式:
 * - 全 AI 呼び出しが通る共通層（ChatGPTClient の sendMessage / streamMessage /
 *   streamResponse と、直接 fetch 経路の DotAmbientMedia / visionDescribe /
 *   LfmContentClassifier）で、HTTP レスポンス単位に usage を記録する。
 *   ツールラウンドや再試行はそれぞれ実リクエストなので個別に数える。
 * - KVヒット率の定義は全経路で統一: cached prompt tokens ÷ total prompt tokens。
 *   cached の取得元は実測で確定済み（2026-11-07、EndPoint 経由 gemma-4-E4B-it）:
 *   Chat Completions は usage.prompt_tokens_details.cached_tokens、
 *   Responses は usage.input_tokens_details.cached_tokens が Bot 側まで届き、
 *   どちらも timings.cache_n と一致し、prompt_tokens = cache_n + prompt_n が成立する。
 *   cached がレスポンスに無い経路（Gemini 等）は「不明」として分母にも入れない
 *   （0% と偽らない。旧 recordStaffUsage と同じ原則）。
 * - 生成速度の定義: 生成時間の分かるリクエストについて
 *   timedOutputTokens ÷ generatedSeconds。generatedSeconds は timings.predicted_ms
 *   （prefill を含まない生成のみの時間）由来。時間の無い経路の出力トークンは
 *   timedOutputTokens に入れない（全体の出力で割ると過小評価になるため）。
 * - 永続化は新キー（ai-usage-metrics-v2）に分離し、旧 staff-ai-metrics とは混ぜない。
 *   つまり新方式の開始時点でカウンタは 0 から始まり、startedAt がその開始日時になる。
 *   startedAt は最初の記録（または ensure）で一度だけ設定し、以後は上書きしない。
 */

export type AIUsagePurpose =
    | 'staff-ai' | 'staff-ai-scheduled' | 'chat-ai' | 'dot-judge' | 'dot-generate'
    | 'dot-learn' | 'media' | 'vision' | 'episode' | 'persona' | 'content-safety'
    | 'server-builder' | 'memory' | 'corepanel' | 'embedding' | 'other';

export interface AIUsageTotals {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    /** 生成時間（秒、timings.predicted_ms 由来。prefill を含まない）。 */
    generatedSeconds: number;
    /** generatedSeconds と対になる出力トークン（速度計算の分子）。 */
    timedOutputTokens: number;
    cacheHitTokens: number;
    /** cached が取得できたリクエストの入力トークン合計（ヒット率の分母）。 */
    cacheInputTokens: number;
}

export interface AIUsageMetrics extends AIUsageTotals {
    version: 2;
    /** 集計開始日時（ISO）。新方式の開始時点。以後は上書きしない。 */
    startedAt: string | null;
    byPurpose: Record<string, AIUsageTotals>;
    byModel: Record<string, AIUsageTotals>;
}

export interface AIUsageRecord {
    guildId?: string | null;
    purpose?: string;
    model?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    /** undefined/null = この経路では cached を取得できない（不明として扱う）。 */
    cachedTokens?: number | null;
    generatedSeconds?: number;
}

export const AI_USAGE_METRICS_VERSION = 2;
const GUILD_KEY = (guildId: string) => `Guild/${guildId}/ai-usage-metrics-v2`;
const GLOBAL_GUILD_ID = '';
const GLOBAL_KEY = 'Global/ai-usage-metrics-v2';

export function zeroAIUsageTotals(): AIUsageTotals {
    return {
        requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0,
        generatedSeconds: 0, timedOutputTokens: 0, cacheHitTokens: 0, cacheInputTokens: 0,
    };
}

export function zeroAIUsageMetrics(): AIUsageMetrics {
    return { ...zeroAIUsageTotals(), version: AI_USAGE_METRICS_VERSION, startedAt: null, byPurpose: {}, byModel: {} };
}

/** KVヒット率 = cached prompt tokens ÷ total prompt tokens（cached 取得済み分のみ）。不明なら null。 */
export function aiCacheHitRate(totals: Pick<AIUsageTotals, 'cacheHitTokens' | 'cacheInputTokens'>): number | null {
    return totals.cacheInputTokens > 0 ? totals.cacheHitTokens / totals.cacheInputTokens : null;
}

/** 生成速度 = 生成時間の分かる出力トークン ÷ 生成時間（prefill を含まない）。不明なら null。 */
export function aiGenerationSpeed(totals: Pick<AIUsageTotals, 'timedOutputTokens' | 'generatedSeconds'>): number | null {
    return totals.generatedSeconds > 0 && totals.timedOutputTokens > 0
        ? totals.timedOutputTokens / totals.generatedSeconds
        : null;
}

const finiteCount = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

function applyRecord(totals: AIUsageTotals, record: AIUsageRecord): void {
    const input = finiteCount(record.inputTokens);
    const output = finiteCount(record.outputTokens);
    totals.requests += 1;
    totals.inputTokens += input;
    totals.outputTokens += output;
    totals.totalTokens += input + output;
    const seconds = typeof record.generatedSeconds === 'number' && Number.isFinite(record.generatedSeconds) && record.generatedSeconds > 0
        ? record.generatedSeconds : 0;
    if (seconds > 0) {
        totals.generatedSeconds += seconds;
        totals.timedOutputTokens += output;
    }
    if (typeof record.cachedTokens === 'number' && Number.isFinite(record.cachedTokens)) {
        totals.cacheHitTokens += Math.min(Math.max(0, Math.floor(record.cachedTokens)), input);
        totals.cacheInputTokens += input;
    }
}

const tails = new Map<string, Promise<void>>();
async function withScopeLock<T>(scope: string, action: () => Promise<T>): Promise<T> {
    const previous = tails.get(scope) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    tails.set(scope, tail);
    await previous.catch(() => undefined);
    try {
        return await action();
    } finally {
        release();
        if (tails.get(scope) === tail) tails.delete(scope);
    }
}

async function readScope(guildId: string, key: string): Promise<AIUsageMetrics> {
    const stored = await database.get<AIUsageMetrics>(guildId, key, null);
    if (!stored || (stored as { version?: number }).version !== AI_USAGE_METRICS_VERSION) {
        // 旧方式の数字は新キーには存在しない。万一旧形式が入っていても混ぜずに開始し直す。
        return zeroAIUsageMetrics();
    }
    return {
        ...zeroAIUsageMetrics(),
        ...stored,
        byPurpose: stored.byPurpose ?? {},
        byModel: stored.byModel ?? {},
    };
}

async function updateScope(guildId: string, key: string, mutate: (metrics: AIUsageMetrics) => void): Promise<AIUsageMetrics> {
    return withScopeLock(`${guildId}::${key}`, async () => {
        const metrics = await readScope(guildId, key);
        if (!metrics.startedAt) metrics.startedAt = new Date().toISOString();
        mutate(metrics);
        await database.set(guildId, key, metrics);
        return metrics;
    });
}

let recordingEnabled = true;
/** テスト等で実 DB への記録を止めるためのスイッチ。 */
export function setAIUsageRecordingEnabled(enabled: boolean): void {
    recordingEnabled = enabled;
}

/**
 * 1 回の AI リクエスト（HTTP レスポンス単位）の usage を全体＋ギルド別に記録する。
 * 記録の失敗で本体の応答を壊さないため、この関数は例外を投げない。
 */
export async function recordAIUsage(record: AIUsageRecord): Promise<void> {
    if (!recordingEnabled) return;
    try {
        const purpose = typeof record.purpose === 'string' && record.purpose.trim() ? record.purpose.trim() : 'other';
        const normalized: AIUsageRecord = { ...record, purpose };
        const apply = (metrics: AIUsageMetrics) => {
            applyRecord(metrics, normalized);
            const byPurpose = metrics.byPurpose[purpose] ??= zeroAIUsageTotals();
            applyRecord(byPurpose, normalized);
            if (record.model) {
                const byModel = metrics.byModel[record.model] ??= zeroAIUsageTotals();
                applyRecord(byModel, normalized);
            }
        };
        await updateScope(GLOBAL_GUILD_ID, GLOBAL_KEY, apply);
        const guildId = typeof record.guildId === 'string' ? record.guildId.trim() : '';
        if (guildId && guildId !== 'global') {
            await updateScope(guildId, GUILD_KEY(guildId), apply);
        }
    } catch (error) {
        console.warn('[AIUsageMetrics] record failed:', error);
    }
}

export async function getAIUsageMetrics(guildId: string): Promise<AIUsageMetrics> {
    return readScope(guildId, GUILD_KEY(guildId));
}

export async function getGlobalAIUsageMetrics(): Promise<AIUsageMetrics> {
    return readScope(GLOBAL_GUILD_ID, GLOBAL_KEY);
}

/** レコードが無ければ startedAt=now のゼロレコードを作り、開始日時を表示可能にする。既存の startedAt は保持する。 */
export async function ensureAIUsageMetrics(guildId?: string | null): Promise<AIUsageMetrics> {
    if (guildId && guildId !== 'global') {
        return updateScope(guildId, GUILD_KEY(guildId), () => undefined);
    }
    return updateScope(GLOBAL_GUILD_ID, GLOBAL_KEY, () => undefined);
}

/** 明示リセット（総履歴リセット用）。startedAt はリセット時刻に更新される。 */
export async function resetAIUsageMetrics(guildId: string): Promise<void> {
    await withScopeLock(`${guildId}::${GUILD_KEY(guildId)}`, async () => {
        await database.set(guildId, GUILD_KEY(guildId), { ...zeroAIUsageMetrics(), startedAt: new Date().toISOString() });
    });
}
