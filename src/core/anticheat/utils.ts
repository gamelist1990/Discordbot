import { isIP } from 'node:net';
import { CacheManager } from '../../utils/CacheManager.js';
import { DetectionContext, DetectionResult, DetectorConfig } from './types.js';

export interface RedirectResolution {
    chain: string[];
    finalUrl: string;
    changed: boolean;
}

export interface RedirectRiskAssessment {
    level: 'danger';
    summary: string;
    suspectUrl: string;
}

const SAFE_REDIRECT_HOSTS = [
    'discord.com',
    'discordapp.com',
    'discord.gg',
    'google.com',
    'x.com',
    'twitter.com',
    't.co',
    'facebook.com',
    'l.facebook.com',
    'lm.facebook.com',
    'instagram.com',
    'youtu.be',
    'youtube.com',
    'github.com',
    'githubusercontent.com',
    'microsoft.com',
    'aka.ms',
    'apple.com',
    'amazon.com',
    'amazon.co.jp'
];

const DANGEROUS_REDIRECT_HOSTS = [
    'grabify.link',
    'grabify.org',
    'grabify.me',
    'iplogger.org',
    'iplogger.com',
    'iplogger.co',
    'iplogger.info',
    '2no.co',
    'yip.su',
    'bmwforum.co',
    'blasze.com',
    'spottyfly.com',
    'stopify.co'
];

const DANGEROUS_REDIRECT_TOKENS = [
    'grabify',
    'iplogger'
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

function normalizeHostname(hostname: string): string {
    return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
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

export function isKnownDangerousRedirectHost(hostname: string): boolean {
    const normalizedHost = normalizeHostname(hostname);
    return DANGEROUS_REDIRECT_HOSTS.some((domain) => hostMatches(normalizedHost, domain))
        || DANGEROUS_REDIRECT_TOKENS.some((token) => normalizedHost.includes(token));
}

function isPrivateOrLocalIpv4(host: string): boolean {
    const octets = host.split('.').map((part) => Number(part));
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
    }

    const [first, second] = octets;

    return first === 0
        || first === 10
        || first === 127
        || (first === 100 && second >= 64 && second <= 127)
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168);
}

function isPrivateOrLocalIpv6(host: string): boolean {
    const normalized = host.toLowerCase();
    return normalized === '::1'
        || normalized === '::'
        || normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('fe8')
        || normalized.startsWith('fe9')
        || normalized.startsWith('fea')
        || normalized.startsWith('feb')
        || normalized.startsWith('::ffff:127.');
}

export function isLocalOrSpecialNetworkHost(hostname: string): boolean {
    const normalizedHost = normalizeHostname(hostname);
    const ipType = isIP(normalizedHost);

    if (ipType === 4) {
        return isPrivateOrLocalIpv4(normalizedHost);
    }

    if (ipType === 6) {
        return isPrivateOrLocalIpv6(normalizedHost);
    }

    return hostMatches(normalizedHost, 'localhost')
        || normalizedHost.endsWith('.local')
        || normalizedHost.endsWith('.internal')
        || normalizedHost.endsWith('.lan');
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

function getDangerousRedirectSummary(input: string, extraAllowDomains: string[] = []): string | null {
    try {
        const url = new URL(input);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return 'HTTP/HTTPS 以外の危険な転送先が含まれています';
        }

        if (isKnownSafeRedirectHost(url.hostname, extraAllowDomains)) {
            return null;
        }

        if (isKnownDangerousRedirectHost(url.hostname)) {
            return 'IPロガーとして知られるドメインを経由しています';
        }

        if (isLocalOrSpecialNetworkHost(url.hostname)) {
            return 'ローカルネットワークまたは特殊IPへの転送が含まれています';
        }

        return null;
    } catch {
        return '解析できない不審な転送先が含まれています';
    }
}

export function assessRedirectRisk(
    resolution: RedirectResolution,
    extraAllowDomains: string[] = []
): RedirectRiskAssessment | null {
    for (const url of resolution.chain) {
        const summary = getDangerousRedirectSummary(url, extraAllowDomains);
        if (summary) {
            return {
                level: 'danger',
                summary,
                suspectUrl: url
            };
        }
    }

    if (isDiscordInvite(resolution.finalUrl)) {
        return {
            level: 'danger',
            summary: '最終到達先がDiscord招待リンクです',
            suspectUrl: resolution.finalUrl
        };
    }

    if (urlHasReferralPattern(resolution.finalUrl)) {
        return {
            level: 'danger',
            summary: '最終到達先に紹介・アフィリエイト系パラメータが含まれています',
            suspectUrl: resolution.finalUrl
        };
    }

    return null;
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
