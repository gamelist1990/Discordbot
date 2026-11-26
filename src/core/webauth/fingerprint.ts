import crypto from 'node:crypto';
import type {
    BrowserBrand,
    FingerprintSignals,
    NormalizedFingerprintSignals
} from './types.js';

export const FINGERPRINT_CANONICAL_VERSION = 'webauth-fp-v1';
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
