import crypto from 'node:crypto';
import { database } from '../persistence/Database.js';
import {
    legacyFingerprintGroups,
    normalizeAutomation,
    normalizeSignalSchema,
    scoreFingerprintSimilarity,
    type FingerprintFuzzyConfig
} from './fingerprint.js';
import type {
    FingerprintComponentKey,
    FingerprintSignalHashes,
    GeoMismatch,
    NormalizedFingerprintSignals,
    WebAuthBlockMark,
    WebAuthBlockRule,
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
const FINGERPRINT_COMPONENT_KEYS: FingerprintComponentKey[] = [
    'canvas', 'webgl', 'screen', 'platform', 'locale', 'hardware', 'audio',
    'fonts', 'webgl2', 'display'
];

const BROWSER_NAMES: WebAuthBrowserName[] = ['chrome', 'edge', 'safari'];
const BROWSER_REASONS: Array<WebAuthBrowserReason | 'staff'> = [
    'ok', 'missing-user-agent', 'firefox', 'safari', 'ios-chrome',
    'in-app-webview', 'headless', 'unsupported-chromium', 'unsupported-webkit', 'brand-mismatch', 'staff'
];
const INTEL_VERDICTS = ['clean', 'blocked', 'unavailable', 'staff'];

const isHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isSealed = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{60,}$/.test(value);

/** Keeps only well-formed component hashes; returns null when none remain. */
export function normalizeSignalHashes(value: unknown): FingerprintSignalHashes | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    const hashes: FingerprintSignalHashes = {};
    for (const key of FINGERPRINT_COMPONENT_KEYS) {
        if (isHash(source[key])) hashes[key] = source[key] as string;
    }
    return Object.keys(hashes).length ? hashes : null;
}

const asnText = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const text = value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 128);
    return text || null;
};

const BLOCK_RULES: WebAuthBlockRule[] = ['automation', 'exact', 'fuzzy', 'graph'];

const GEO_MISMATCHES: GeoMismatch[] = ['none', 'tz', 'lang', 'both'];

const countryCodeText = (value: unknown): string | null => {
    const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return /^[A-Z]{2}$/.test(code) ? code : null;
};

/** Keeps only well-formed block evidence; null when nothing usable remains. */
export function normalizeBlockMark(value: unknown): WebAuthBlockMark | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Partial<WebAuthBlockMark>;
    const rules = Array.isArray(source.rules)
        ? BLOCK_RULES.filter((rule) => (source.rules as WebAuthBlockRule[]).includes(rule))
        : [];
    if (!rules.length) return null;
    const matchedUserIds = Array.isArray(source.matchedUserIds)
        ? [...new Set(source.matchedUserIds.filter((id): id is string => typeof id === 'string' && !!id))].slice(0, 50)
        : [];
    const at = typeof source.at === 'string' && Number.isFinite(Date.parse(source.at))
        ? source.at
        : new Date(0).toISOString();
    const mark: WebAuthBlockMark = { rules, matchedUserIds, at };
    if (Number.isFinite(source.fpScore)) mark.fpScore = Math.min(1, Math.max(0, Number(source.fpScore)));
    if (Number.isFinite(source.graphScore)) mark.graphScore = Math.max(0, Number(source.graphScore));
    if (Number.isFinite(source.graphThreshold)) mark.graphThreshold = Math.max(0, Number(source.graphThreshold));
    return mark;
}

export interface WebAuthRecordInput {
    guildId: string;
    userId: string;
    source: WebAuthRecordSource;
    browser: WebAuthRecord['browser'];
    intel: WebAuthRecord['intel'];
    ipHash: string | null;
    fpHash: string | null;
    signalHashes?: FingerprintSignalHashes | null;
    /**
     * Signal generation of the record (see `WebAuthRecord.signalSchema`).
     * Omitted when normalizing a stored record that predates the marker; it
     * is then inferred from the groups the record carries.
     */
    signalSchema?: number | null;
    asn?: string | null;
    subnetHash?: string | null;
    automation?: NormalizedFingerprintSignals['automation'] | null;
    softwareRenderer?: boolean;
    countryCode?: string | null;
    geoMismatch?: GeoMismatch | null;
    sealed: string | null;
    presetId?: string | null;
    note?: string | null;
    roleGranted?: boolean;
    verified?: boolean;
    blocked?: WebAuthBlockMark | null;
    createdAt?: string;
    id?: string;
    now?: number;
}

export function createWebAuthRecord(input: WebAuthRecordInput): WebAuthRecord {
    const now = input.now ?? Date.now();
    const signalHashes = normalizeSignalHashes(input.signalHashes);
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
        signalHashes,
        signalSchema: normalizeSignalSchema(input.signalSchema, signalHashes),
        asn: asnText(input.asn),
        subnetHash: isHash(input.subnetHash) ? input.subnetHash : null,
        automation: input.automation ? normalizeAutomation(input.automation) : null,
        softwareRenderer: input.softwareRenderer === true,
        countryCode: countryCodeText(input.countryCode),
        geoMismatch: GEO_MISMATCHES.includes(input.geoMismatch as GeoMismatch)
            ? input.geoMismatch as GeoMismatch
            : 'none',
        sealed: isSealed(input.sealed) ? input.sealed : null,
        presetId: typeof input.presetId === 'string' && input.presetId ? input.presetId : null,
        note: typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : null,
        roleGranted: input.roleGranted === true,
        blocked: normalizeBlockMark(input.blocked)
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
        signalHashes: entry.signalHashes ?? null,
        signalSchema: entry.signalSchema ?? null,
        asn: entry.asn ?? null,
        subnetHash: entry.subnetHash ?? null,
        automation: entry.automation ?? null,
        softwareRenderer: entry.softwareRenderer === true,
        countryCode: entry.countryCode ?? null,
        geoMismatch: entry.geoMismatch ?? null,
        sealed: entry.sealed ?? null,
        presetId: entry.presetId ?? null,
        note: entry.note ?? null,
        roleGranted: entry.roleGranted === true,
        blocked: entry.blocked ?? null
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
 * Matches by IP hash, exact fingerprint hash, or fuzzy fingerprint similarity
 * against the guild's other records. Returned peer IDs are distinct users, so
 * one person with several records counts once. Raw values never leave the
 * store. Records without `signalHashes` (created before fuzzy matching, and
 * staff records) only ever match exactly.
 */
export interface WebAuthCorrelationOptions {
    /** Overrides for the fuzzy weights/threshold (tests, future tuning). */
    fuzzy?: Partial<FingerprintFuzzyConfig>;
    /**
     * True (default) when `record` is a freshly submitted candidate, i.e. the
     * auth path. Only the stored peer's legacy groups then relax the score.
     *
     * Set false for stored↔stored comparisons (staff match counts): both
     * sides are server-written records, so groups either side predates are
     * excluded and the result stays symmetric whichever record is the
     * subject.
     */
    candidateIsLive?: boolean;
}

/**
 * Groups the stored side predates, for the fuzzy relaxation of brief 9R.
 *
 * A live candidate never contributes its own legacy groups: its omissions
 * must keep costing weight (anti-lowering guard). Only records read back from
 * the store may relax, and only for groups their `signalSchema` proves they
 * never collected.
 */
function correlationLegacyGroups(
    record: WebAuthRecord,
    other: WebAuthRecord,
    candidateIsLive: boolean
): FingerprintComponentKey[] {
    const peerGroups = legacyFingerprintGroups(other.signalSchema, other.signalHashes);
    if (candidateIsLive) return peerGroups;
    const subjectGroups = legacyFingerprintGroups(record.signalSchema, record.signalHashes);
    return [...new Set([...subjectGroups, ...peerGroups])];
}

export function correlateWebAuthRecord(
    records: WebAuthRecord[],
    record: WebAuthRecord,
    options: WebAuthCorrelationOptions = {}
): { matches: WebAuthMatch[]; matchCount: number } {
    const fuzzyConfig = options.fuzzy || {};
    const candidateIsLive = options.candidateIsLive !== false;
    const byUser = new Map<string, {
        ip: number;
        fp: number;
        fpFuzzy: number;
        fpScore: number;
        hasExactFp: boolean;
    }>();
    for (const other of records) {
        if (!other || other.guildId !== record.guildId || other.userId === record.userId) continue;
        const current = byUser.get(other.userId) || { ip: 0, fp: 0, fpFuzzy: 0, fpScore: 0, hasExactFp: false };
        if (record.ipHash && other.ipHash === record.ipHash) current.ip += 1;

        const exactFp = !!(record.fpHash && other.fpHash === record.fpHash);
        if (exactFp) {
            current.fp += 1;
            current.hasExactFp = true;
            current.fpScore = 1;
        } else if (record.signalHashes && other.signalHashes) {
            const fuzzy = scoreFingerprintSimilarity(record.signalHashes, other.signalHashes, {
                ...fuzzyConfig,
                peerLegacyGroups: correlationLegacyGroups(record, other, candidateIsLive)
            });
            if (fuzzy.comparable && fuzzy.matches) {
                current.fpFuzzy += 1;
                current.fpScore = Math.max(current.fpScore, fuzzy.ratio);
            }
        }
        byUser.set(other.userId, current);
    }
    const matches: WebAuthMatch[] = [];
    for (const [userId, counts] of byUser.entries()) {
        if (!counts.ip && !counts.fp && !counts.fpFuzzy) continue;
        const hashTypes: WebAuthMatch['hashTypes'] = [];
        if (counts.ip) hashTypes.push('ip');
        if (counts.fp) hashTypes.push('fp');
        if (counts.fpFuzzy && !counts.hasExactFp) hashTypes.push('fp-fuzzy');
        matches.push({
            userId,
            hashTypes,
            risks: [],
            hashCount: counts.ip + counts.fp + counts.fpFuzzy,
            fpScore: counts.fpScore
        });
    }
    matches.sort((left, right) => right.hashCount - left.hashCount || left.userId.localeCompare(right.userId));
    return { matches, matchCount: matches.length };
}

export interface WebAuthRecordView extends WebAuthRecord {
    matchCount: number;
    matchedUserIds: string[];
}

/** Adds the "同一IP/端末アカウント数" count to each staff-facing record. */
export function withWebAuthMatchCounts(
    records: WebAuthRecord[],
    options: WebAuthCorrelationOptions = {}
): WebAuthRecordView[] {
    // Both sides are stored records here, so the relaxation applies to groups
    // either side predates (symmetric counts in the staff view).
    const stored: WebAuthCorrelationOptions = { ...options, candidateIsLive: false };
    return records
        .map((record) => {
            const { matches } = correlateWebAuthRecord(records, record, stored);
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

/** Shared store used by the WebAuth flow and the correlation graph. */
export const webAuthRecordStore = new WebAuthRecordStore();
