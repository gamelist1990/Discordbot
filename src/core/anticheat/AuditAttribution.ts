import { AuditLogEvent, Guild } from 'discord.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Audit-log attribution shared by the AntiNuke and self-defense paths.
 *
 * Gateway events tell us *what* happened; the audit log tells us *who* did it.
 * Discord fills the audit log asynchronously, so a single fetch immediately
 * after the gateway event often returns nothing. We retry with a short,
 * bounded backoff (total < 2 s) before giving up. Giving up is reported, never
 * guessed: an unattributed event is not counted against anybody.
 */

/** Audit entries may be stamped slightly before the gateway event reaches us. */
export const AUDIT_LAG_TOLERANCE_MS = 5_000;
export const AUDIT_RETRY_ATTEMPTS = 4;
export const AUDIT_RETRY_DELAY_MS = 250;

export interface AuditAttribution {
    entryId: string;
    executorId: string;
    executorTag: string | null;
    executorIsBot: boolean | null;
    targetId: string | null;
    action: number;
    createdAt: number;
}

export interface AuditAttributionOptions {
    type: AuditLogEvent;
    /** Gateway event timestamp (ms). Entries older than this minus tolerance are ignored. */
    since: number;
    /** Extra predicate, e.g. matching `extra.channelId` for webhook creates. */
    match?: (entry: any) => boolean;
    attempts?: number;
    delayMs?: number;
    /** Entries already claimed by another gateway event are ignored. */
    isConsumed?: (entryId: string) => boolean;
    onError?: (error: unknown, attempt: number) => void;
    sleep?: (ms: number) => Promise<void>;
}

export const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
    });

const entryTime = (entry: any): number => {
    const created = entry?.createdTimestamp;
    return typeof created === 'number' ? created : 0;
};

function pickEntry(entries: unknown, options: AuditAttributionOptions): AuditAttribution | null {
    const since = options.since - AUDIT_LAG_TOLERANCE_MS;
    const candidates = Array.from((entries as any)?.values?.() || []) as any[];
    let best: any = null;
    for (const entry of candidates) {
        if (!entry?.executorId) continue;
        if (typeof options.match === 'function' && !options.match(entry)) continue;
        if (entryTime(entry) < since) continue;
        if (options.isConsumed?.(String(entry.id))) continue;
        if (!best || entryTime(entry) > entryTime(best)) best = entry;
    }
    if (!best) return null;
    return {
        entryId: String(best.id),
        executorId: String(best.executorId),
        executorTag: best.executor?.tag ? String(best.executor.tag) : null,
        executorIsBot: typeof best.executor?.bot === 'boolean' ? best.executor.bot : null,
        targetId: best.targetId ? String(best.targetId) : null,
        action: Number(best.action),
        createdAt: entryTime(best)
    };
}

/**
 * Fetch the audit entry that explains one gateway event. Retries because the
 * audit log lags behind the gateway by up to a couple of seconds.
 */
export async function attributeAuditAction(
    guild: Guild,
    options: AuditAttributionOptions
): Promise<AuditAttribution | null> {
    const attempts = Math.max(1, options.attempts ?? AUDIT_RETRY_ATTEMPTS);
    const delayMs = Math.max(0, options.delayMs ?? AUDIT_RETRY_DELAY_MS);
    const wait = options.sleep ?? sleep;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const logs = await guild.fetchAuditLogs({ type: options.type, limit: 20 });
            const found = pickEntry(logs.entries, options);
            if (found) return found;
        } catch (error) {
            options.onError?.(error, attempt);
            Logger.debug(
                `[AntiNuke] audit fetch failed type=${options.type} attempt=${attempt}/${attempts}: ${String(error)}`
            );
        }
        if (attempt < attempts && delayMs > 0) {
            await wait(delayMs * attempt);
        }
    }
    return null;
}

/** One audit entry reduced for incident records. */
export interface AuditActorEntry {
    action: number;
    targetId: string | null;
    createdAt: number;
    entryId: string;
}

/**
 * Entries by one actor since `since`, used to list the objects an attack
 * affected. Fetches once with the maximum page size: audit log reads are rate
 * limited and the incident is already urgent.
 */
export async function collectActorAuditEntries(
    guild: Guild,
    actorId: string,
    since: number
): Promise<AuditActorEntry[]> {
    try {
        const logs = await guild.fetchAuditLogs({ limit: 100 });
        const entries = Array.from((logs.entries as any).values?.() || []) as any[];
        const cutoff = since - AUDIT_LAG_TOLERANCE_MS;
        return entries
            .filter((entry) => entry?.executorId === actorId && entryTime(entry) >= cutoff)
            .map((entry) => ({
                action: Number(entry.action),
                targetId: entry.targetId ? String(entry.targetId) : null,
                createdAt: entryTime(entry),
                entryId: String(entry.id)
            }));
    } catch (error) {
        Logger.debug(`[AntiNuke] affected-object audit fetch failed: ${String(error)}`);
        return [];
    }
}
