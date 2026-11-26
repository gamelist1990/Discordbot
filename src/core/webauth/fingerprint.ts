import crypto from 'node:crypto';
import net from 'node:net';
import type {
    BrowserBrand,
    FingerprintComponentKey,
    FingerprintSignalHashes,
    FingerprintSignals,
    NormalizedFingerprintSignals
} from './types.js';

export const FINGERPRINT_CANONICAL_VERSION = 'webauth-fp-v1';
/** Version tag for the per-component hashes (independent of the canonical hash). */
export const FINGERPRINT_SIGNAL_HASH_VERSION = 'webauth-fp-sig-v1';
export const FINGERPRINT_SUBNET_HASH_VERSION = 'webauth-subnet-v1';
const MAX_TEXT = 512;
const MAX_ARRAY = 20;

const text = (value: unknown, fallback = ''): string => (
    typeof value === 'string'
        ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_TEXT)
        : fallback
);

const finiteInt = (value: unknown, min: number, max: number, fallback = 0): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

export function normalizeBrandList(value: unknown): BrowserBrand[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const brands: BrowserBrand[] = [];
    for (const entry of value) {
        const brand = typeof entry === 'string'
            ? entry
            : (entry && typeof entry === 'object' ? (entry as BrowserBrand).brand : '');
        const name = text(brand);
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const version = entry && typeof entry === 'object' ? text((entry as BrowserBrand).version) : '';
        brands.push(version ? { brand: name, version } : { brand: name });
    }
    return brands
        .sort((left, right) => left.brand.toLowerCase().localeCompare(right.brand.toLowerCase()))
        .slice(0, MAX_ARRAY);
}

/** Whitelists and bounds the posted signals. Unknown fields are dropped. */
export function normalizeFingerprintSignals(input: FingerprintSignals | null | undefined): NormalizedFingerprintSignals {
    const source = input || {};
    const uaCh = source.uaCh || {};
    const screen = source.screen || {};
    const touch = source.touch || {};
    return {
        userAgent: text(source.userAgent),
        uaCh: {
            platform: text(uaCh.platform),
            platformVersion: text(uaCh.platformVersion),
            model: text(uaCh.model),
            mobile: uaCh.mobile === true,
            brands: normalizeBrandList(uaCh.brands)
        },
        screen: {
            width: finiteInt(screen.width, 0, 100_000),
            height: finiteInt(screen.height, 0, 100_000),
            colorDepth: finiteInt(screen.colorDepth, 0, 1_000),
            pixelDepth: finiteInt(screen.pixelDepth, 0, 1_000)
        },
        timezone: text(source.timezone),
        languages: (Array.isArray(source.languages) ? source.languages : [])
            .map((language) => text(language))
            .filter(Boolean)
            .slice(0, MAX_ARRAY),
        hardwareConcurrency: finiteInt(source.hardwareConcurrency, 0, 10_000),
        deviceMemory: finiteInt(source.deviceMemory, 0, 10_000),
        canvasHash: text(source.canvasHash).toLowerCase(),
        webglVendor: text(source.webglVendor),
        webglRenderer: text(source.webglRenderer),
        audioHash: text(source.audioHash).toLowerCase(),
        touch: {
            maxTouchPoints: finiteInt(touch.maxTouchPoints, 0, 10_000),
            touchEvent: touch.touchEvent === true
        }
    };
}

/**
 * Stable, line-oriented canonical form. Construction order is fixed and the
 * value format is versioned so a future change cannot silently collide with
 * hashes created by this version.
 */
export function canonicalizeFingerprint(input: NormalizedFingerprintSignals): string {
    const brands = input.uaCh.brands
        .map((brand) => `${brand.brand.toLowerCase()}/${brand.version || ''}`)
        .join('|');
    return [
        FINGERPRINT_CANONICAL_VERSION,
        `ua=${input.userAgent}`,
        `uach.platform=${input.uaCh.platform}`,
        `uach.platformVersion=${input.uaCh.platformVersion}`,
        `uach.model=${input.uaCh.model}`,
        `uach.mobile=${input.uaCh.mobile ? '1' : '0'}`,
        `uach.brands=${brands}`,
        `screen=${input.screen.width}x${input.screen.height}x${input.screen.colorDepth}x${input.screen.pixelDepth}`,
        `tz=${input.timezone}`,
        `langs=${input.languages.join(',')}`,
        `cores=${input.hardwareConcurrency}`,
        `mem=${input.deviceMemory}`,
        `canvas=${input.canvasHash}`,
        `webgl.vendor=${input.webglVendor}`,
        `webgl.renderer=${input.webglRenderer}`,
        `touch.points=${input.touch.maxTouchPoints}`,
        `touch.event=${input.touch.touchEvent ? '1' : '0'}`
    ].join('\n');
}

export function hmacSha256Hex(secret: Buffer | string, value: string): string {
    return crypto.createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

export function hashFingerprint(secret: Buffer | string, normalized: NormalizedFingerprintSignals): string {
    return hmacSha256Hex(secret, canonicalizeFingerprint(normalized));
}

/** Normalizes an IP string before hashing so formatting cannot split matches. */
export function normalizeIpForHash(ip: string): string {
    return String(ip || '')
        .trim()
        .replace(/^\[|\]$/g, '')
        .replace(/^::ffff:/i, '')
        .toLowerCase();
}

export function hashIp(secret: Buffer | string, ip: string): string {
    const normalized = normalizeIpForHash(ip);
    if (!normalized) return '';
    return hmacSha256Hex(secret, `webauth-ip-v1\n${normalized}`);
}

// ---------------------------------------------------------------------------
// Fuzzy fingerprint components
// ---------------------------------------------------------------------------

/**
 * One place for every fuzzy-matching threshold and weight. Canvas and WebGL
 * are the heaviest because they are the most device-specific components.
 */
export interface FingerprintFuzzyConfig {
    /** Fraction of the total weight required for a fuzzy device match. */
    threshold: number;
    weights: Record<FingerprintComponentKey, number>;
}

export const FINGERPRINT_FUZZY_CONFIG: FingerprintFuzzyConfig = {
    threshold: 0.75,
    weights: {
        canvas: 3,
        webgl: 3,
        screen: 2,
        platform: 2,
        locale: 1,
        hardware: 1,
        audio: 2
    }
};

/**
 * Coarse OS label derived from the UA. Safari exposes no UA-CH platform, so
 * the `platform` fuzzy component falls back to this; Chromium keeps using the
 * higher-fidelity UA-CH value.
 */
export function platformFromUserAgent(userAgent: string): string {
    const ua = String(userAgent || '');
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile\//.test(ua))) return 'iOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/CrOS/i.test(ua)) return 'Chrome OS';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return '';
}

/**
 * Splits the canonical fingerprint back into independent component values.
 * Empty components are omitted from the stored hashes so two missing values
 * never look like a match.
 */
export function fingerprintComponentValues(input: NormalizedFingerprintSignals): Record<FingerprintComponentKey, string> {
    const brandList = input.uaCh.brands
        .map((brand) => `${brand.brand.toLowerCase()}/${brand.version || ''}`)
        .join('|');
    const platform = [
        input.userAgent,
        input.uaCh.platform || platformFromUserAgent(input.userAgent),
        input.uaCh.platformVersion,
        input.uaCh.model,
        input.uaCh.mobile ? 'mobile' : '',
        brandList
    ].filter((part) => part).join('|');
    const screen = (input.screen.width || input.screen.height || input.screen.colorDepth || input.screen.pixelDepth)
        ? `${input.screen.width}x${input.screen.height}x${input.screen.colorDepth}x${input.screen.pixelDepth}`
        : '';
    const locale = (input.timezone || input.languages.length)
        ? `${input.timezone}|${input.languages.join(',')}`
        : '';
    const hardware = (input.hardwareConcurrency || input.deviceMemory)
        ? `${input.hardwareConcurrency}|${input.deviceMemory}`
        : '';
    const webgl = (input.webglVendor || input.webglRenderer)
        ? `${input.webglVendor}|${input.webglRenderer}`
        : '';
    return {
        canvas: input.canvasHash,
        webgl,
        screen,
        platform,
        locale,
        hardware,
        audio: input.audioHash
    };
}

/** HMAC-SHA256 of each non-empty component, with the same secret as `fpHash`. */
export function hashFingerprintSignalComponents(
    secret: Buffer | string,
    normalized: NormalizedFingerprintSignals
): FingerprintSignalHashes {
    const values = fingerprintComponentValues(normalized);
    const hashes: FingerprintSignalHashes = {};
    for (const key of Object.keys(FINGERPRINT_FUZZY_CONFIG.weights) as FingerprintComponentKey[]) {
        const value = values[key];
        if (!value) continue;
        hashes[key] = hmacSha256Hex(secret, `${FINGERPRINT_SIGNAL_HASH_VERSION}\n${key}=${value}`);
    }
    return hashes;
}

export interface FingerprintFuzzyScore {
    /** False when either side has no component hashes (old/staff records). */
    comparable: boolean;
    matchedWeight: number;
    /** Weight of the components observed on either side (the denominator). */
    totalWeight: number;
    ratio: number;
    threshold: number;
    matchedKeys: FingerprintComponentKey[];
    matches: boolean;
}

/**
 * Weighted component similarity. `ratio` is matched weight divided by the
 * weight of the components observed on either side: a group missing on BOTH
 * sides (e.g. audio, which the page does not collect yet) is not held against
 * the pair, while a group present on only one side counts as unconfirmed.
 *
 * The denominator is therefore never the full configured weight, only what
 * the two records actually expose. A Safari record — no UA-CH platform
 * detail, no `deviceMemory`, a generic/restricted WebGL renderer — scores
 * 1.00 against itself, so the ratio is not systematically deflated by
 * components the browser cannot provide.
 *
 * One-sided groups stay in the denominator on purpose: dropping them
 * (intersection semantics) would let a client omit canvas + WebGL and match
 * on the remaining low-entropy groups alone.
 */
export function scoreFingerprintSimilarity(
    left: FingerprintSignalHashes | null | undefined,
    right: FingerprintSignalHashes | null | undefined,
    config: Partial<FingerprintFuzzyConfig> = {}
): FingerprintFuzzyScore {
    const weights = { ...FINGERPRINT_FUZZY_CONFIG.weights, ...(config.weights || {}) };
    const threshold = Number.isFinite(config.threshold) ? Number(config.threshold) : FINGERPRINT_FUZZY_CONFIG.threshold;
    if (!left || !right) {
        return {
            comparable: false, matchedWeight: 0, totalWeight: 0,
            ratio: 0, threshold, matchedKeys: [], matches: false
        };
    }
    let matchedWeight = 0;
    let totalWeight = 0;
    const matchedKeys: FingerprintComponentKey[] = [];
    for (const key of Object.keys(weights) as FingerprintComponentKey[]) {
        const a = left[key];
        const b = right[key];
        // Unobserved on both sides: no evidence either way, no weight.
        if (!a && !b) continue;
        totalWeight += Math.max(0, Number(weights[key]) || 0);
        if (!a || !b || a !== b) continue;
        matchedWeight += Math.max(0, Number(weights[key]) || 0);
        matchedKeys.push(key);
    }
    const ratio = totalWeight > 0 ? matchedWeight / totalWeight : 0;
    return {
        comparable: true,
        matchedWeight,
        totalWeight,
        ratio,
        threshold,
        matchedKeys,
        matches: totalWeight > 0 && ratio >= threshold
    };
}

// ---------------------------------------------------------------------------
// Subnet derivation (/24 IPv4, /48 IPv6)
// ---------------------------------------------------------------------------

/** Expands an IPv6 address to eight 4-hex-digit groups; null when invalid. */
export function expandIpv6Groups(value: string): string[] | null {
    const ip = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    if (net.isIP(ip) !== 6) return null;
    const compressed = ip.includes('::');
    const [head, tail = ''] = compressed ? ip.split('::') : [ip, ''];
    const headGroups = head ? head.split(':') : [];
    const tailGroups = tail ? tail.split(':') : [];
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 0) return null;
    if (!compressed && missing !== 0) return null;
    const groups = [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
    if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
    return groups.map((group) => group.padStart(4, '0'));
}

/**
 * Canonical /24 (IPv4) or /48 (IPv6) prefix. IPv4-mapped IPv6 is normalized
 * to IPv4 first, so `::ffff:203.0.113.10` and `203.0.113.10` share a prefix.
 */
export function subnetPrefixForIp(value: string): string {
    const ip = normalizeIpForHash(value);
    const version = net.isIP(ip);
    if (version === 4) {
        const [a, b, c] = ip.split('.');
        return `${a}.${b}.${c}.0/24`;
    }
    if (version === 6) {
        const groups = expandIpv6Groups(ip);
        if (!groups) return '';
        return `${groups.slice(0, 3).join(':')}::/48`;
    }
    return '';
}

/** HMAC hex of the subnet prefix; empty for invalid input. */
export function hashSubnet(secret: Buffer | string, ip: string): string {
    const prefix = subnetPrefixForIp(ip);
    if (!prefix) return '';
    return hmacSha256Hex(secret, `${FINGERPRINT_SUBNET_HASH_VERSION}\n${prefix}`);
}
