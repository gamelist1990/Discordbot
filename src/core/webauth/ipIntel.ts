import net from 'node:net';
import type { IntelFlag, IpIntelResult } from './types.js';
import { normalizeIpForHash } from './fingerprint.js';

/** Keyless source: ip-api.com free endpoint (proxy + hosting flags, 45 req/min). */
export const IP_INTEL_SOURCE = 'ip-api.com';
export const IP_INTEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Failed lookups are retried sooner so a transient outage does not block 24 h. */
export const IP_INTEL_FAILURE_TTL_MS = 5 * 60 * 1000;
export const IP_INTEL_TIMEOUT_MS = 3_000;

export interface IpApiPayload {
    status?: string;
    message?: string;
    query?: string;
    proxy?: boolean;
    hosting?: boolean;
    mobile?: boolean;
    /** Autonomous system string, e.g. "AS2516 KDDI CORPORATION". */
    as?: string;
    /** ISO 3166-1 alpha-2 country, e.g. "JP". */
    countryCode?: string;
}

const asnText = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const text = value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 128);
    return text || null;
};

const countryText = (value: unknown): string | null => {
    const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return /^[A-Z]{2}$/.test(code) ? code : null;
};

export function isPrivateOrLocalIp(value: string): boolean {
    const ip = normalizeIpForHash(value);
    const version = net.isIP(ip);
    if (version === 0) return true;
    if (version === 4) {
        const [a, b] = ip.split('.').map((part) => Number(part));
        if (a === 10 || a === 127 || a === 0) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 169 && b === 254) return true;
        return false;
    }
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    return false;
}

/** Pure verdict mapping; network I/O lives in IpIntelClient. */
export function mapIpApiResponse(payload: IpApiPayload | null, now: number): IpIntelResult {
    if (!payload || payload.status !== 'success') {
        return {
            verdict: 'unavailable',
            flags: [],
            source: IP_INTEL_SOURCE,
            checkedAt: now,
            cached: false,
            detail: payload?.status ? `api-${payload.status}` : 'api-invalid'
        };
    }
    const asn = asnText(payload.as);
    const countryCode = countryText(payload.countryCode);
    const flags: IntelFlag[] = [];
    if (payload.proxy === true) flags.push('proxy');
    if (payload.hosting === true) flags.push('hosting');
    if (flags.length) {
        return {
            verdict: 'blocked',
            flags,
            source: IP_INTEL_SOURCE,
            checkedAt: now,
            cached: false,
            detail: `flagged-${flags.join('+')}`,
            ...(asn ? { asn } : {}),
            ...(countryCode ? { countryCode } : {})
        };
    }
    return {
        verdict: 'clean',
        flags: [],
        source: IP_INTEL_SOURCE,
        checkedAt: now,
        cached: false,
        ...(asn ? { asn } : {}),
        ...(countryCode ? { countryCode } : {})
    };
}

export interface IpIntelOptions {
    fetchImpl?: typeof fetch;
    now?: () => number;
    timeoutMs?: number;
    cacheTtlMs?: number;
}

/**
 * 24 h per-IP verdict cache. Successful answers are cached for 24 h; failures
 * for 5 minutes. The cache key/IP is never logged.
 */
export class IpIntelClient {
    private cache = new Map<string, IpIntelResult>();
    private readonly fetchImpl: typeof fetch;
    private readonly now: () => number;
    private readonly timeoutMs: number;
    private readonly cacheTtlMs: number;

    constructor(options: IpIntelOptions = {}) {
        this.fetchImpl = options.fetchImpl || fetch;
        this.now = options.now || Date.now;
        this.timeoutMs = options.timeoutMs ?? IP_INTEL_TIMEOUT_MS;
        this.cacheTtlMs = options.cacheTtlMs ?? IP_INTEL_CACHE_TTL_MS;
    }

    async lookup(value: string): Promise<IpIntelResult> {
        const ip = normalizeIpForHash(value);
        const now = this.now();
        if (!ip || net.isIP(ip) === 0 || isPrivateOrLocalIp(ip)) {
            return {
                verdict: 'unavailable',
                flags: [],
                source: IP_INTEL_SOURCE,
                checkedAt: now,
                cached: false,
                detail: 'private-ip'
            };
        }

        const cached = this.cache.get(ip);
        if (cached) {
            const ttl = cached.verdict === 'unavailable' ? IP_INTEL_FAILURE_TTL_MS : this.cacheTtlMs;
            if (now - cached.checkedAt < ttl) return { ...cached, cached: true };
            this.cache.delete(ip);
        }

        const result = await this.fetchVerdict(ip, now);
        this.cache.set(ip, result);
        this.prune(now);
        return result;
    }

    private async fetchVerdict(ip: string, now: number): Promise<IpIntelResult> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        timer.unref?.();
        try {
            const response = await this.fetchImpl(
                `http://${IP_INTEL_SOURCE}/json/${encodeURIComponent(ip)}?fields=status,message,query,proxy,hosting,mobile,as,countryCode`,
                { signal: controller.signal, headers: { accept: 'application/json' } }
            );
            if (!response.ok) {
                return {
                    verdict: 'unavailable',
                    flags: [],
                    source: IP_INTEL_SOURCE,
                    checkedAt: now,
                    cached: false,
                    detail: `http-${response.status}`
                };
            }
            const payload = await response.json() as IpApiPayload;
            return mapIpApiResponse(payload, now);
        } catch {
            return {
                verdict: 'unavailable',
                flags: [],
                source: IP_INTEL_SOURCE,
                checkedAt: now,
                cached: false,
                detail: 'lookup-failed'
            };
        } finally {
            clearTimeout(timer);
        }
    }

    private prune(now: number): void {
        if (this.cache.size < 5_000) return;
        for (const [key, value] of this.cache.entries()) {
            if (now - value.checkedAt > this.cacheTtlMs) this.cache.delete(key);
        }
    }
}
