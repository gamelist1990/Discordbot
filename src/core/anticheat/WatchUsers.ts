import { readToggle } from './RaidEnforcement.js';
import type { WatchSettings, WatchSignal, WatchUserEntry } from './types.js';

/**
 * 警戒ユーザー (watch tier) classification.
 *
 * Discord's API exposes neither member IPs nor device information, so "same
 * operator" is estimated from what is available: account creation timestamps,
 * custom-avatar hashes, and normalized names.
 *
 * The exported matcher is pure and Discord-object free so it can be tested
 * directly.
 */

/** Join history used as the correlation comparison set. */
export const WATCH_JOIN_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Rolling window for applied detection points. */
export const WATCH_POINT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Accounts minted within this distance are treated as one creation batch. */
export const WATCH_BATCH_CREATION_WINDOW_MS = 10 * 60 * 1000;
/** Joins inside this window that make the recent set a "burst". */
export const WATCH_BURST_WINDOW_MS = 10 * 60 * 1000;
/** Minimum joins in the burst window (including the evaluated member). */
export const WATCH_BURST_MIN_JOINS = 2;
/** Normalized names shorter than this are too generic to compare. */
export const WATCH_MIN_NORMALIZED_LENGTH = 3;

export const WATCH_KICK_REASON = '警戒ユーザーの危険判定による自動キック';

export const WATCH_SIGNAL_LABELS: Record<WatchSignal, string> = {
    'name-match': '表示名がユーザー名と同一',
    'id-like-name': '表示名が数字のみ/ユーザーID',
    'new-account': '新規アカウント',
    'batch-creation': '同一バッチ作成（作成時刻が近接）',
    'shared-avatar': '警戒ユーザーと同一アバター',
    'similar-name': '警戒ユーザーと類似名',
    'webauth-match': 'Web認証で同一IP/端末を検出'
};

export interface WatchJoinRecord {
    userId: string;
    ts: number;
    displayName?: string;
    normalizedName?: string;
    avatarHash?: string | null;
    accountCreatedAt?: number;
}

/** One comparison target for the correlation signals. */
export interface WatchPeer {
    userId: string;
    normalizedName: string;
    avatarHash: string | null;
    accountCreatedAt: number;
    /** True when this peer is an already-flagged watch user. */
    flagged: boolean;
}

/** Peer candidate before the burst/flagged qualification filter. */
export interface WatchPeerCandidate extends WatchPeer {
    joinedAt?: number;
}

export interface WatchMatchInput {
    userId: string;
    username: string;
    /** Guild nickname if set, else the global display name. */
    displayName: string;
    accountCreatedAt: number;
    avatarHash: string | null;
    now: number;
    newAccountDays: number;
    /** Already-qualified comparison targets (see selectWatchPeers). */
    peers: WatchPeer[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const positiveNumber = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Reads the watch settings block with the same tolerance as the raid config. */
export function readWatchSettings(value: Partial<WatchSettings> | null | undefined, fallback?: Partial<WatchSettings>): WatchSettings {
    const source = value || {};
    const base = fallback || {};
    return {
        enabled: readToggle(source.enabled, readToggle(base.enabled, true)),
        notifyOnFlag: readToggle(source.notifyOnFlag, readToggle(base.notifyOnFlag, true)),
        newAccountDays: Math.max(1, Math.floor(positiveNumber(source.newAccountDays ?? base.newAccountDays, 7))),
        kickThresholdPoints: Math.max(1, Math.floor(positiveNumber(source.kickThresholdPoints ?? base.kickThresholdPoints, 5))),
        autoKickOnDanger: readToggle(source.autoKickOnDanger, readToggle(base.autoKickOnDanger, true)),
        purgeWindowHours: Math.max(1, Math.floor(positiveNumber(source.purgeWindowHours ?? base.purgeWindowHours, 24)))
    };
}

/**
 * Lowercases and strips trailing digits/symbols. Mass-created accounts share a
 * prefix and differ only in the numeric suffix ("raidbot001", "raidbot_12").
 * A fully numeric name is returned unchanged so it still compares.
 */
export function normalizeWatchName(value: unknown): string {
    const text = String(value ?? '').toLowerCase().trim();
    if (!text) return '';
    const stripped = text.replace(/[\s\p{P}\p{S}\d]+$/gu, '').trim();
    return stripped || text;
}

export function readWatchJoinRecords(value: unknown, now: number): WatchJoinRecord[] {
    if (!Array.isArray(value)) return [];
    const records: WatchJoinRecord[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const { userId, ts, displayName, normalizedName, avatarHash, accountCreatedAt } = entry as Partial<WatchJoinRecord>;
        if (typeof userId !== 'string' || !userId || !Number.isFinite(ts)) continue;
        if (now - Number(ts) > WATCH_JOIN_WINDOW_MS || Number(ts) > now) continue;
        records.push({
            userId,
            ts: Number(ts),
            ...(typeof displayName === 'string' ? { displayName } : {}),
            ...(typeof normalizedName === 'string' ? { normalizedName } : {}),
            ...(avatarHash === null || typeof avatarHash === 'string' ? { avatarHash } : {}),
            ...(Number.isFinite(accountCreatedAt) ? { accountCreatedAt: Number(accountCreatedAt) } : {})
        });
    }
    return records;
}

/** Joins inside the burst window, used to decide whether recent joiners are a burst. */
export function isWatchBurst(records: Array<{ ts: number }>, now: number): boolean {
    return records.filter((record) => now - record.ts <= WATCH_BURST_WINDOW_MS && record.ts <= now).length >= WATCH_BURST_MIN_JOINS;
}

/**
 * Comparison set for signals 4–6. A peer only qualifies when it is either an
 * already-flagged watch user, or a recent joiner observed during a join burst.
 * Clean records never form a comparison set on their own.
 */
export function selectWatchPeers(candidates: WatchPeerCandidate[], burstActive: boolean): WatchPeer[] {
    const seen = new Set<string>();
    const peers: WatchPeer[] = [];
    for (const candidate of candidates) {
        if (!candidate || !candidate.userId || seen.has(candidate.userId)) continue;
        const qualifies = candidate.flagged || (burstActive && (candidate.joinedAt ?? 0) > 0);
        if (!qualifies) continue;
        seen.add(candidate.userId);
        peers.push({
            userId: candidate.userId,
            normalizedName: candidate.normalizedName || '',
            avatarHash: candidate.avatarHash || null,
            accountCreatedAt: candidate.accountCreatedAt || 0,
            flagged: candidate.flagged
        });
    }
    return peers;
}

function isIdLikeName(displayName: string, userId: string): boolean {
    const trimmed = displayName.trim();
    if (!trimmed) return false;
    if (/^\d+$/.test(trimmed)) return true;
    return trimmed === userId;
}

/**
 * Pure signal matcher. Signals 1–3 judge the account itself; 4–6 compare with
 * the already-qualified peer set. Returns an empty array when nothing matches.
 */
export function matchWatchSignals(input: WatchMatchInput): WatchSignal[] {
    const signals = new Set<WatchSignal>();
    const displayName = String(input.displayName ?? '').trim();
    const username = String(input.username ?? '').trim();

    if (displayName) {
        if (username && displayName.toLowerCase() === username.toLowerCase()) {
            signals.add('name-match');
        }
        if (isIdLikeName(displayName, input.userId)) {
            signals.add('id-like-name');
        }
    }

    const createdAt = Number(input.accountCreatedAt);
    if (Number.isFinite(createdAt) && createdAt > 0) {
        const age = input.now - createdAt;
        if (age >= 0 && age <= input.newAccountDays * DAY_MS) {
            signals.add('new-account');
        }
    }

    const names = new Set(
        [normalizeWatchName(username), normalizeWatchName(displayName)]
            .filter((name) => name.length >= WATCH_MIN_NORMALIZED_LENGTH)
    );
    const avatarHash = input.avatarHash || null;

    for (const peer of input.peers || []) {
        if (!peer || peer.userId === input.userId) continue;
        if (peer.accountCreatedAt && createdAt && Math.abs(peer.accountCreatedAt - createdAt) <= WATCH_BATCH_CREATION_WINDOW_MS) {
            signals.add('batch-creation');
        }
        // shared-avatar needs a custom avatar; Discord's default avatar hash is null.
        if (avatarHash && peer.avatarHash && peer.avatarHash === avatarHash) {
            signals.add('shared-avatar');
        }
        if (peer.normalizedName && peer.normalizedName.length >= WATCH_MIN_NORMALIZED_LENGTH && names.has(peer.normalizedName)) {
            signals.add('similar-name');
        }
    }

    return [...signals];
}

export function formatWatchSignals(signals: string[]): string {
    return signals
        .map((signal) => WATCH_SIGNAL_LABELS[signal as WatchSignal] || signal)
        .join(' / ');
}

/** Rolling point total, pruning entries outside the 24 h window. */
export function pruneWatchDangerPoints(points: unknown, now: number): NonNullable<WatchUserEntry['dangerPoints']> {
    if (!Array.isArray(points)) return [];
    return points
        .filter((entry): entry is { ts: number; points: number; detector?: string; reason?: string } => (
            !!entry && typeof entry === 'object'
            && Number.isFinite((entry as any).ts)
            && Number.isFinite((entry as any).points)
        ))
        .map((entry) => ({
            ts: Number(entry.ts),
            points: Math.max(0, Number(entry.points)),
            ...(typeof entry.detector === 'string' ? { detector: entry.detector } : {}),
            ...(typeof entry.reason === 'string' ? { reason: entry.reason } : {})
        }))
        .filter((entry) => entry.ts <= now && now - entry.ts <= WATCH_POINT_WINDOW_MS);
}

export function watchDangerPointTotal(points: Array<{ points: number }> | null | undefined): number {
    return (points || []).reduce((sum, entry) => sum + (Number(entry.points) || 0), 0);
}

/** Validates stored watch entries (settings normalization). */
export function normalizeWatchUserEntries(value: unknown): Record<string, WatchUserEntry> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const normalized: Record<string, WatchUserEntry> = {};
    for (const [userId, raw] of Object.entries(value as Record<string, any>)) {
        if (!userId || !raw || typeof raw !== 'object') continue;
        const signals = Array.isArray(raw.signals) ? raw.signals.filter((item: unknown) => typeof item === 'string') : [];
        normalized[userId] = {
            reason: typeof raw.reason === 'string' ? raw.reason : formatWatchSignals(signals),
            signals,
            since: typeof raw.since === 'string' ? raw.since : new Date(0).toISOString(),
            source: (['join', 'member-update', 'message', 'webauth-match'].includes(raw.source) ? raw.source : 'join') as WatchUserEntry['source'],
            nameSnapshot: typeof raw.nameSnapshot === 'string' ? raw.nameSnapshot : '',
            ...(typeof raw.accountCreatedAt === 'string' || raw.accountCreatedAt === null ? { accountCreatedAt: raw.accountCreatedAt } : {}),
            ...(typeof raw.avatarHash === 'string' || raw.avatarHash === null ? { avatarHash: raw.avatarHash } : {}),
            ...(typeof raw.normalizedName === 'string' ? { normalizedName: raw.normalizedName } : {}),
            ...(typeof raw.dismissed === 'string' || raw.dismissed === null ? { dismissed: raw.dismissed } : {}),
            ...(Array.isArray(raw.dangerPoints) ? { dangerPoints: pruneWatchDangerPoints(raw.dangerPoints, Date.now()) } : {}),
            ...(typeof raw.lastDangerAt === 'string' || raw.lastDangerAt === null ? { lastDangerAt: raw.lastDangerAt } : {})
        };
    }
    return normalized;
}
