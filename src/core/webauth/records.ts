import crypto from 'node:crypto';
import { database } from '../persistence/Database.js';
import type {
    WebAuthBrowserName,
    WebAuthBrowserReason,
    WebAuthMatch,
    WebAuthRecord,
    WebAuthRecordDocument,
    WebAuthRecordSource
} from './types.js';

/** Records older than one year are dropped; at most 2000 per guild. */
export const WEBAUTH_RECORD_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const WEBAUTH_MAX_RECORDS = 2000;
export const WEBAUTH_RECORDS_KEY = 'webauth/records';

const BROWSER_NAMES: WebAuthBrowserName[] = ['chrome', 'edge'];
const BROWSER_REASONS: Array<WebAuthBrowserReason | 'staff'> = [
    'ok', 'missing-user-agent', 'firefox', 'safari', 'ios-chrome',
    'in-app-webview', 'headless', 'unsupported-chromium', 'brand-mismatch', 'staff'
];
const INTEL_VERDICTS = ['clean', 'blocked', 'unavailable', 'staff'];

const isHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isSealed = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{60,}$/.test(value);

export interface WebAuthRecordInput {
    guildId: string;
    userId: string;
    source: WebAuthRecordSource;
    browser: WebAuthRecord['browser'];
    intel: WebAuthRecord['intel'];
    ipHash: string | null;
    fpHash: string | null;
    sealed: string | null;
    presetId?: string | null;
    note?: string | null;
    roleGranted?: boolean;
    verified?: boolean;
    createdAt?: string;
    id?: string;
    now?: number;
}

export function createWebAuthRecord(input: WebAuthRecordInput): WebAuthRecord {
    const now = input.now ?? Date.now();
    return {
        id: input.id || crypto.randomUUID(),
        guildId: input.guildId,
        userId: input.userId,
        createdAt: input.createdAt || new Date(now).toISOString(),
        source: input.source,
        verified: input.verified !== false,
        browser: {
            name: BROWSER_NAMES.includes(input.browser?.name as WebAuthBrowserName)
                ? input.browser.name as WebAuthBrowserName
                : null,
            reason: BROWSER_REASONS.includes(input.browser?.reason as any)
                ? input.browser.reason
                : (input.source === 'staff' ? 'staff' : 'unsupported-chromium')
        },
        intel: {
            verdict: INTEL_VERDICTS.includes(input.intel?.verdict as string)
                ? input.intel.verdict
                : 'unavailable',
            flags: Array.isArray(input.intel?.flags)
                ? input.intel.flags.filter((flag): flag is string => typeof flag === 'string').slice(0, 10)
                : [],
            source: typeof input.intel?.source === 'string' ? input.intel.source : 'unknown'
        },
        ipHash: isHash(input.ipHash) ? input.ipHash : null,
        fpHash: isHash(input.fpHash) ? input.fpHash : null,
        sealed: isSealed(input.sealed) ? input.sealed : null,
        presetId: typeof input.presetId === 'string' && input.presetId ? input.presetId : null,
        note: typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : null,
        roleGranted: input.roleGranted === true
    };
}

function normalizeRecord(raw: unknown): WebAuthRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const entry = raw as Partial<WebAuthRecord>;
    if (typeof entry.guildId !== 'string' || !entry.guildId) return null;
    if (typeof entry.userId !== 'string' || !entry.userId) return null;
    const createdAt = typeof entry.createdAt === 'string' && Number.isFinite(Date.parse(entry.createdAt))
        ? entry.createdAt
        : null;
    if (!createdAt) return null;
    return createWebAuthRecord({
        id: typeof entry.id === 'string' && entry.id ? entry.id : undefined,
        guildId: entry.guildId,
        userId: entry.userId,
        createdAt,
        source: entry.source === 'staff' ? 'staff' : 'web',
        verified: entry.verified !== false,
        browser: entry.browser as WebAuthRecord['browser'],
        intel: entry.intel as WebAuthRecord['intel'],
        ipHash: entry.ipHash ?? null,
        fpHash: entry.fpHash ?? null,
        sealed: entry.sealed ?? null,
        presetId: entry.presetId ?? null,
        note: entry.note ?? null,
        roleGranted: entry.roleGranted === true
    });
}

export function pruneWebAuthRecords(records: WebAuthRecord[], now: number): WebAuthRecord[] {
    return records
        .filter((record) => {
            const created = Date.parse(record.createdAt);
            return Number.isFinite(created) && created <= now && now - created <= WEBAUTH_RECORD_TTL_MS;
        })
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
        .slice(-WEBAUTH_MAX_RECORDS);
}

export function normalizeWebAuthRecords(value: unknown, now: number): WebAuthRecord[] {
    const rawRecords = Array.isArray(value)
        ? value
        : (value && typeof value === 'object' && Array.isArray((value as WebAuthRecordDocument).records)
            ? (value as WebAuthRecordDocument).records
            : []);
    const normalized: WebAuthRecord[] = [];
    for (const raw of rawRecords) {
        const record = normalizeRecord(raw);
        if (record) normalized.push(record);
    }
    return pruneWebAuthRecords(normalized, now);
}

/**
 * Matches by IP hash and/or fingerprint hash against the guild's other
 * records. Returned peer IDs are distinct users, so one person with several
 * records counts once. Raw values never leave the store.
 */
export function correlateWebAuthRecord(
    records: WebAuthRecord[],
    record: WebAuthRecord
): { matches: WebAuthMatch[]; matchCount: number } {
    const byUser = new Map<string, { ip: number; fp: number }>();
    for (const other of records) {
        if (!other || other.guildId !== record.guildId || other.userId === record.userId) continue;
        const current = byUser.get(other.userId) || { ip: 0, fp: 0 };
        if (record.ipHash && other.ipHash === record.ipHash) current.ip += 1;
        if (record.fpHash && other.fpHash === record.fpHash) current.fp += 1;
        byUser.set(other.userId, current);
    }
    const matches: WebAuthMatch[] = [];
    for (const [userId, counts] of byUser.entries()) {
        if (!counts.ip && !counts.fp) continue;
        const hashTypes: Array<'ip' | 'fp'> = [];
        if (counts.ip) hashTypes.push('ip');
        if (counts.fp) hashTypes.push('fp');
        matches.push({ userId, hashTypes, risks: [], hashCount: counts.ip + counts.fp });
    }
    matches.sort((left, right) => right.hashCount - left.hashCount || left.userId.localeCompare(right.userId));
    return { matches, matchCount: matches.length };
}

export interface WebAuthRecordView extends WebAuthRecord {
    matchCount: number;
    matchedUserIds: string[];
}

/** Adds the "同一IP/端末アカウント数" count to each staff-facing record. */
export function withWebAuthMatchCounts(records: WebAuthRecord[]): WebAuthRecordView[] {
    return records
        .map((record) => {
            const { matches } = correlateWebAuthRecord(records, record);
            return {
                ...record,
                matchCount: matches.length,
                matchedUserIds: matches.map((match) => match.userId)
            };
        })
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export interface RecordStoreDatabase {
    get: <T>(guildId: string, key: string, defaultValue?: T | null) => Promise<T | null>;
    set: <T>(guildId: string, key: string, value: T) => Promise<void>;
}

export class WebAuthRecordStore {
    private writes = new Map<string, Promise<unknown>>();

    constructor(
        private readonly db: RecordStoreDatabase = database,
        private readonly now: () => number = Date.now
    ) {}

    async list(guildId: string): Promise<WebAuthRecord[]> {
        const stored = await this.db.get<WebAuthRecordDocument>(guildId, WEBAUTH_RECORDS_KEY, null);
        return normalizeWebAuthRecords(stored, this.now());
    }

    /** Serialized per guild so two concurrent verifications cannot drop a record. */
    async add(guildId: string, record: WebAuthRecord): Promise<WebAuthRecord[]> {
        const previous = this.writes.get(guildId) || Promise.resolve();
        const task = previous.catch(() => undefined).then(async () => {
            const records = await this.list(guildId);
            const next = pruneWebAuthRecords(
                [...records.filter((entry) => entry.id !== record.id), record],
                this.now()
            );
            await this.db.set<WebAuthRecordDocument>(guildId, WEBAUTH_RECORDS_KEY, { version: 1, records: next });
            return next;
        });
        this.writes.set(guildId, task);
        try {
            return await task;
        } finally {
            if (this.writes.get(guildId) === task) this.writes.delete(guildId);
        }
    }

    async find(guildId: string, userId?: string): Promise<WebAuthRecord[]> {
        const records = await this.list(guildId);
        return userId ? records.filter((record) => record.userId === userId) : records;
    }
}
