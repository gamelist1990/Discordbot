import crypto from 'node:crypto';
import type { WebAuthTokenRecord } from './types.js';

/** One-time links are valid for 10 minutes. */
export const WEBAUTH_TOKEN_TTL_MS = 10 * 60 * 1000;
/** 32 random bytes = 256 bits of entropy (brief requires >= 128 bits). */
export const WEBAUTH_TOKEN_BYTES = 32;

export type WebAuthTokenStatus = 'valid' | 'in-use' | 'expired' | 'missing';

export interface WebAuthTokenLookup {
    status: WebAuthTokenStatus;
    record: WebAuthTokenRecord | null;
}

/** URL-safe random token. Never persisted in plaintext. */
export function createTokenValue(random: () => Buffer = () => crypto.randomBytes(WEBAUTH_TOKEN_BYTES)): string {
    return random().toString('base64url');
}

/** Only the SHA-256 of a token is kept in memory, so a heap dump has no usable link. */
export function hashWebAuthToken(token: string): string {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isWellFormedWebAuthToken(token: unknown): token is string {
    return typeof token === 'string' && /^[A-Za-z0-9_-]{22,128}$/.test(token);
}

export interface CreateTokenInput {
    guildId: string;
    userId: string;
    presetId?: string | null;
    roleIds?: string[];
}

/**
 * In-memory one-time token registry.
 *
 * The lifetime is 10 minutes and links are deliberately not persisted: a bot
 * restart invalidates outstanding links, which is acceptable (the panel can
 * issue a new one) and avoids durable bearer secrets on disk.
 */
export class WebAuthTokenStore {
    private entries = new Map<string, WebAuthTokenRecord>();

    constructor(
        private readonly now: () => number = Date.now,
        private readonly random: () => Buffer = () => crypto.randomBytes(WEBAUTH_TOKEN_BYTES)
    ) {}

    create(input: CreateTokenInput): { token: string; record: WebAuthTokenRecord } {
        this.prune();
        const token = createTokenValue(this.random);
        const record: WebAuthTokenRecord = {
            guildId: input.guildId,
            userId: input.userId,
            presetId: input.presetId ?? null,
            roleIds: Array.isArray(input.roleIds) ? [...input.roleIds] : [],
            createdAt: this.now(),
            expiresAt: this.now() + WEBAUTH_TOKEN_TTL_MS,
            claimedAt: null
        };
        this.entries.set(hashWebAuthToken(token), record);
        return { token, record };
    }

    /** Read-only check used when rendering the auth page. */
    peek(token: string): WebAuthTokenLookup {
        const entry = this.lookup(token);
        return entry.record ? { status: 'valid', record: entry.record } : entry;
    }

    /**
     * Reserves the token for one submit request. A second concurrent submit
     * gets `in-use` instead of racing to create two records.
     */
    claim(token: string): WebAuthTokenLookup {
        const entry = this.lookup(token);
        if (!entry.record) return entry;
        if (entry.record.claimedAt !== null) return { status: 'in-use', record: null };
        entry.record.claimedAt = this.now();
        return { status: 'valid', record: entry.record };
    }

    /** Releases a claim after a failed submit so the member can retry. */
    release(token: string): void {
        const entry = this.lookup(token);
        if (entry.record) entry.record.claimedAt = null;
    }

    /** Deletes the token. Only called after a successful submit. */
    consume(token: string): WebAuthTokenRecord | null {
        const key = hashWebAuthToken(token);
        const record = this.entries.get(key) || null;
        if (!record) return null;
        if (this.isExpired(record)) {
            this.entries.delete(key);
            return null;
        }
        this.entries.delete(key);
        return record;
    }

    prune(): void {
        for (const [key, record] of this.entries.entries()) {
            if (this.isExpired(record)) this.entries.delete(key);
        }
    }

    get size(): number {
        return this.entries.size;
    }

    private lookup(token: string): WebAuthTokenLookup {
        if (!isWellFormedWebAuthToken(token)) return { status: 'missing', record: null };
        const key = hashWebAuthToken(token);
        const record = this.entries.get(key) || null;
        if (!record) return { status: 'missing', record: null };
        if (this.isExpired(record)) {
            this.entries.delete(key);
            return { status: 'expired', record: null };
        }
        return { status: 'valid', record };
    }

    private isExpired(record: WebAuthTokenRecord): boolean {
        return this.now() >= record.expiresAt;
    }
}
