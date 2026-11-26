import {
    DEFAULT_RAID_JOIN_ENTROPY,
    type RaidJoinEntropyConfig
} from './types.js';

/**
 * Join-interval entropy (anti-raid).
 *
 * Automated raid joins arrive on a regular cadence (all bots in a script
 * join one after another, often with the same delay), while human joins are
 * irregular. The coefficient of variation (population standard deviation
 * divided by the mean) of the inter-arrival gaps captures that difference.
 *
 * Everything here is pure and Discord-object free so the metric can be
 * tested directly; the manager only feeds it the 1 h join cache.
 */

export { DEFAULT_RAID_JOIN_ENTROPY };

export interface JoinEntropyResult {
    /** Number of timestamps considered (after sorting). */
    joins: number;
    /** Number of inter-arrival gaps (joins - 1). */
    gaps: number;
    /** Mean gap in milliseconds; 0 when there is no gap. */
    meanGapMs: number;
    /** Population standard deviation of the gaps in milliseconds. */
    stdDevMs: number;
    /** std/mean; null when it cannot be computed. */
    cv: number | null;
    /** True when at least one gap exists (mean/CV are meaningful). */
    computable: boolean;
    /** True when every activation condition is met. */
    automated: boolean;
    /** Human readable activation reason including CV and mean gap. */
    reason: string | null;
}

const clampPositiveInt = (value: unknown, fallback: number, min: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.floor(parsed));
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

const positiveNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

/** Reads the automation block with the same tolerance as the raid config. */
export function readJoinEntropyConfig(value: Partial<RaidJoinEntropyConfig> | null | undefined): RaidJoinEntropyConfig {
    const source = value || {};
    return {
        minJoins: clampPositiveInt(source.minJoins, DEFAULT_RAID_JOIN_ENTROPY.minJoins, 2),
        meanGapSeconds: positiveNumber(source.meanGapSeconds, DEFAULT_RAID_JOIN_ENTROPY.meanGapSeconds, 0.1, 24 * 60 * 60),
        cvThreshold: clampNumber(source.cvThreshold, DEFAULT_RAID_JOIN_ENTROPY.cvThreshold, 0, 100)
    };
}

const formatSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)}秒`;

/**
 * Computes gaps and their coefficient of variation for the supplied join
 * timestamps (the caller passes the 1 h join cache). Invalid timestamps are
 * ignored; the list is sorted so cache order cannot change the result.
 */
export function computeJoinEntropy(
    timestamps: Array<number | null | undefined>,
    config: Partial<RaidJoinEntropyConfig> = {}
): JoinEntropyResult {
    const options = { ...readJoinEntropyConfig(config) };
    const times = (Array.isArray(timestamps) ? timestamps : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .sort((left, right) => left - right);

    const joins = times.length;
    const gaps: number[] = [];
    for (let index = 1; index < times.length; index++) {
        gaps.push(Math.max(0, times[index] - times[index - 1]));
    }

    if (!gaps.length) {
        return {
            joins,
            gaps: 0,
            meanGapMs: 0,
            stdDevMs: 0,
            cv: null,
            computable: false,
            automated: false,
            reason: null
        };
    }

    const meanGapMs = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const variance = gaps.reduce((sum, gap) => sum + (gap - meanGapMs) ** 2, 0) / gaps.length;
    const stdDevMs = Math.sqrt(variance);
    // A zero mean means every join had the same timestamp; CV is defined as 0.
    const cv = meanGapMs > 0 ? stdDevMs / meanGapMs : 0;

    const automated = joins >= options.minJoins
        && meanGapMs < options.meanGapSeconds * 1000
        && cv < options.cvThreshold;

    return {
        joins,
        gaps: gaps.length,
        meanGapMs,
        stdDevMs,
        cv,
        computable: true,
        automated,
        reason: automated
            ? `参加間隔が機械的（CV=${cv.toFixed(2)}・平均間隔=${formatSeconds(meanGapMs)}・${joins}件）`
            : null
    };
}

/** One-line metric for the activation embed; null when not computable. */
export function formatJoinEntropyMetric(result: JoinEntropyResult): string | null {
    if (!result.computable || result.cv === null) return null;
    return `平均 ${formatSeconds(result.meanGapMs)} / CV ${result.cv.toFixed(2)}（${result.joins}件）`;
}
