import { CacheManager } from '../../utils/CacheManager.js';
import { DetectionContext, DetectionResult, DetectorConfig } from './types.js';

export interface RedirectResolution {
    chain: string[];
    finalUrl: string;
    changed: boolean;
}

const SAFE_REDIRECT_HOSTS = [
    'google.com',
    'www.google.com',
    'x.com',
    'twitter.com',
    't.co',
    'l.facebook.com',
    'lm.facebook.com',
    'youtu.be',
    'youtube.com',
    'www.youtube.com'
];

const REFERRAL_QUERY_KEYS = new Set([
    'ref',
    'referrer',
    'ref_id',
    'refid',
    'invite',
    'invite_code',
    'aff',
    'affiliate',
    'partner'
]);

export function getDetectorConfig(context: DetectionContext, detectorName: string): DetectorConfig {
    return context.settings.detectors[detectorName] || {
        enabled: false,
        score: 1,
        deleteMessage: false,
        notifyChannel: false,
        config: {}
    };
}

export function hasMeaningfulDetection(result: DetectionResult): boolean {
    return result.scoreDelta > 0
        || result.reasons.length > 0
        || !!result.publicNotice;
}

export function normalizeContent(content: string): string {
    return content.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function extractUrls(content: string): string[] {
    const matches = content.match(/(https?:\/\/[^\s<>()]+|discord\.gg\/[A-Za-z0-9-]+|discord(?:app)?\.com\/invite\/[A-Za-z0-9-]+)/gi);
    return matches ? Array.from(new Set(matches)) : [];
}

export function ensureAbsoluteUrl(input: string): string {
    if (/^https?:\/\//i.test(input)) {
        return input;
    }
    return `https://${input}`;
}

export function hostMatches(hostname: string, expected: string): boolean {
    const host = hostname.toLowerCase();
    const domain = expected.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
}

export function isDiscordInvite(input: string): boolean {
    try {
        const url = new URL(ensureAbsoluteUrl(input));
        const host = url.hostname.toLowerCase();
        return hostMatches(host, 'discord.gg')
            || (hostMatches(host, 'discord.com') && url.pathname.startsWith('/invite/'))
            || (hostMatches(host, 'discordapp.com') && url.pathname.startsWith('/invite/'));
    } catch {
        return false;
    }
}

export function isKnownSafeRedirectHost(hostname: string, extraAllowDomains: string[] = []): boolean {
    return [...SAFE_REDIRECT_HOSTS, ...extraAllowDomains].some((domain) => hostMatches(hostname, domain));
}

export function urlHasReferralPattern(input: string): boolean {
    try {
        const url = new URL(ensureAbsoluteUrl(input));
        for (const [key] of url.searchParams.entries()) {
            if (REFERRAL_QUERY_KEYS.has(key.toLowerCase())) {
                return true;
            }
        }
        return false;
    } catch {
        return false;
    }
}

export function scoreBuckets(actual: number, limit: number): number {
    if (limit <= 0 || actual <= limit) {
        return 0;
    }
    return Math.max(1, Math.ceil(actual / limit) - 1);
}

function extractMetaRefreshRedirect(html: string, currentUrl: string): string | null {
    const metaMatch = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"']+)["']/i);
    if (!metaMatch?.[1]) {
        return null;
    }

    try {
        return new URL(metaMatch[1], currentUrl).toString();
    } catch {
        return null;
    }
}

function extractJsRedirect(html: string, currentUrl: string): string | null {
    const patterns = [
        /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
        /location\.replace\(\s*["']([^"']+)["']\s*\)/i,
        /location\.assign\(\s*["']([^"']+)["']\s*\)/i
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (!match?.[1]) {
            continue;
        }

        try {
            return new URL(match[1], currentUrl).toString();
        } catch {
            return null;
        }
    }

    return null;
}

async function fetchWithTimeout(url: string, timeoutMs: number, redirect: RequestRedirect = 'manual'): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            redirect,
            signal: controller.signal,
            headers: {
                'User-Agent': 'PEXServer AntiCheat/1.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });
    } finally {
        clearTimeout(timer);
    }
}

export async function resolveRedirectChain(
    initialUrl: string,
    options: {
        maxDepth?: number;
        timeoutMs?: number;
    } = {}
): Promise<RedirectResolution> {
    const maxDepth = options.maxDepth ?? 5;
    const timeoutMs = options.timeoutMs ?? 2500;
    const normalizedInput = ensureAbsoluteUrl(initialUrl);
    const cacheKey = `anticheat:redirect:${normalizedInput}`;
    const cached = CacheManager.get<RedirectResolution>(cacheKey);
    if (cached) {
        return cached;
    }

    const chain: string[] = [normalizedInput];
    let currentUrl = normalizedInput;

    for (let depth = 0; depth < maxDepth; depth += 1) {
        try {
            const response = await fetchWithTimeout(currentUrl, timeoutMs);
            const location = response.headers.get('location');

            if (location && response.status >= 300 && response.status < 400) {
                const nextUrl = new URL(location, currentUrl).toString();
                if (chain.includes(nextUrl)) {
                    break;
                }
                chain.push(nextUrl);
                currentUrl = nextUrl;
                continue;
            }

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('text/html')) {
                const html = await response.text();
                const metaRedirect = extractMetaRefreshRedirect(html, currentUrl);
                const jsRedirect = extractJsRedirect(html, currentUrl);
                const nextUrl = metaRedirect || jsRedirect;

                if (nextUrl && !chain.includes(nextUrl)) {
                    chain.push(nextUrl);
                    currentUrl = nextUrl;
                    continue;
                }
            }

            break;
        } catch {
            break;
        }
    }

    const result: RedirectResolution = {
        chain,
        finalUrl: chain[chain.length - 1],
        changed: chain.length > 1
    };

    CacheManager.set(cacheKey, result, 30 * 60 * 1000);
    return result;
}
