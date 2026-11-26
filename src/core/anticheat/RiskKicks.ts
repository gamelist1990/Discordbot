import { database } from '../persistence/Database.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Durable ledger of members kicked by the anti-raid or the watch danger path.
 *
 * The guild settings cannot hold this: the watch danger pipeline deletes the
 * watch entry (and its logs) on a successful kick, and raid kicks are never
 * written to `recentLogs`. A small separate file keeps the fact available for
 * the WebAuth correlation ("this new account shares an IP/device with an
 * account we already kicked").
 */

export type RiskKickSource = 'raid' | 'watch-danger';

export interface RiskKickEntry {
    userId: string;
    ts: number;
    source: RiskKickSource;
    reason: string;
}

export const RISK_KICK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const RISK_KICK_MAX = 5000;
export const RISK_KICK_KEY = 'anticheat/risk-kicks';

export function pruneRiskKicks(value: unknown, now: number): RiskKickEntry[] {
    if (!Array.isArray(value)) return [];
    const entries: RiskKickEntry[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const entry = raw as Partial<RiskKickEntry>;
        if (typeof entry.userId !== 'string' || !entry.userId) continue;
        if (!Number.isFinite(entry.ts)) continue;
        const ts = Number(entry.ts);
        if (ts > now || now - ts > RISK_KICK_TTL_MS) continue;
        entries.push({
            userId: entry.userId,
            ts,
            source: entry.source === 'watch-danger' ? 'watch-danger' : 'raid',
            reason: typeof entry.reason === 'string' ? entry.reason.slice(0, 300) : ''
        });
    }
    return entries
        .sort((left, right) => left.ts - right.ts)
        .slice(-RISK_KICK_MAX);
}

export function addRiskKicks(
    value: unknown,
    userIds: string[],
    source: RiskKickSource,
    reason: string,
    now: number
): RiskKickEntry[] {
    const entries = pruneRiskKicks(value, now);
    const seen = new Set(userIds.filter((userId) => typeof userId === 'string' && userId));
    const next = entries.filter((entry) => !seen.has(entry.userId));
    for (const userId of seen) {
        next.push({ userId, ts: now, source, reason: reason.slice(0, 300) });
    }
    return pruneRiskKicks(next, now);
}

export interface RiskKickDatabase {
    get: <T>(guildId: string, key: string, defaultValue?: T | null) => Promise<T | null>;
    set: <T>(guildId: string, key: string, value: T) => Promise<void>;
}

export class RiskKickLedger {
    constructor(
        private readonly db: RiskKickDatabase = database,
        private readonly now: () => number = Date.now
    ) {}

    async list(guildId: string): Promise<RiskKickEntry[]> {
        const stored = await this.db.get<RiskKickEntry[]>(guildId, RISK_KICK_KEY, null);
        return pruneRiskKicks(stored, this.now());
    }

    async recordMany(
        guildId: string,
        userIds: string[],
        source: RiskKickSource,
        reason: string
    ): Promise<RiskKickEntry[]> {
        const unique = [...new Set(userIds.filter(Boolean))];
        if (!unique.length) return this.list(guildId);
        const stored = await this.db.get<RiskKickEntry[]>(guildId, RISK_KICK_KEY, null);
        const next = addRiskKicks(stored, unique, source, reason, this.now());
        await this.db.set(guildId, RISK_KICK_KEY, next);
        return next;
    }

    async record(guildId: string, userId: string, source: RiskKickSource, reason: string): Promise<void> {
        await this.recordMany(guildId, [userId], source, reason);
    }

    async has(guildId: string, userId: string): Promise<RiskKickSource | null> {
        const entries = await this.list(guildId);
        const found = entries.find((entry) => entry.userId === userId);
        return found ? found.source : null;
    }
}

export const riskKickLedger = new RiskKickLedger();

/** Never let ledger I/O break a kick path that already succeeded. */
export async function recordRiskKicksSafely(
    guildId: string,
    userIds: string[],
    source: RiskKickSource,
    reason: string
): Promise<void> {
    try {
        await riskKickLedger.recordMany(guildId, userIds, source, reason);
    } catch (error) {
        Logger.warn(`[RiskKicks] failed to record ${source} kicks for guild ${guildId}: ${String(error)}`);
    }
}
