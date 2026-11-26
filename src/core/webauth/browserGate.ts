import type { BrowserBrand, BrowserGateInput, BrowserGateResult } from './types.js';

/** Parses a raw `Sec-CH-UA` header such as `"Chromium";v="131", "Google Chrome";v="131"`. */
export function parseBrandHeader(value: unknown): BrowserBrand[] {
    if (typeof value !== 'string' || !value.trim()) return [];
    const brands: BrowserBrand[] = [];
    for (const part of value.split(',')) {
        const match = part.match(/"([^"]+)"\s*;\s*v\s*=\s*"([^"]*)"/);
        if (match) {
            brands.push({ brand: match[1], version: match[2] });
            continue;
        }
        const bare = part.match(/"([^"]+)"/);
        if (bare) brands.push({ brand: bare[1] });
    }
    return brands;
}

function normalizeBrands(value: BrowserGateInput['brands']): BrowserBrand[] {
    if (!value) return [];
    if (typeof value === 'string') return parseBrandHeader(value);
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        if (typeof entry === 'string') return [{ brand: entry }];
        if (entry && typeof entry === 'object' && typeof entry.brand === 'string') {
            return [{ brand: entry.brand, version: entry.version }];
        }
        return [];
    });
}

const hasBrand = (brands: BrowserBrand[], needle: string): boolean =>
    brands.some((brand) => brand.brand.toLowerCase().includes(needle));

/**
 * Chrome/Edge-only browser gate.
 *
 * Both the UA string and, when present, the UA-CH brands (posted
 * `navigator.userAgentData.brands` or the `Sec-CH-UA` request header) must
 * agree. Firefox, Safari, iOS WebKit shells, in-app webviews and other
 * Chromium browsers are rejected.
 */
export function evaluateBrowserGate(input: BrowserGateInput): BrowserGateResult {
    const userAgent = String(input?.userAgent || '').trim();
    if (!userAgent) {
        return { allowed: false, browser: null, reason: 'missing-user-agent' };
    }
    const ua = userAgent.toLowerCase();
    const postedBrands = normalizeBrands(input?.brands);
    const hintBrands = parseBrandHeader(input?.clientHint);
    const brands = [...postedBrands, ...hintBrands];
    const brandsPresent = brands.length > 0;

    if (ua.includes('headlesschrome') || ua.includes('phantomjs')) {
        return { allowed: false, browser: null, reason: 'headless' };
    }

    // In-app webviews identify themselves with these tokens. They are
    // Chromium-based on Android but the automation/consent surface is not the
    // Chrome browser the auth flow requires.
    if (
        /;\s*wv\)/.test(ua)
        || ua.includes('; wv')
        || ua.includes('webview')
        || /(?:fban|fbav|instagram|micromessenger|snapchat|pinterest|twitter|linkedin|line\/|elegram)/i.test(ua)
    ) {
        return { allowed: false, browser: null, reason: 'in-app-webview' };
    }
    if (ua.includes('electron/')) {
        return { allowed: false, browser: null, reason: 'in-app-webview' };
    }

    // iOS browsers are WebKit shells, including "Chrome" (CriOS) and Firefox
    // (FxiOS); neither is the real Chromium engine.
    if (/crios\//.test(ua) || /fxios\//.test(ua) || /edgios\//.test(ua)) {
        return { allowed: false, browser: null, reason: 'ios-chrome' };
    }

    if (/firefox\//.test(ua)) {
        return { allowed: false, browser: null, reason: 'firefox' };
    }

    const edgeUa = /\bedg(?:a|e)?\//.test(ua);
    const chromeUa = /chrome\//.test(ua) || /chromium\//.test(ua);
    const otherChromium = /(?:opr\/|opera|samsungbrowser|vivaldi|yabrowser|brave)/i.test(ua);

    if (!edgeUa && !chromeUa) {
        if (ua.includes('safari/')) {
            return { allowed: false, browser: null, reason: 'safari' };
        }
        return { allowed: false, browser: null, reason: 'unsupported-chromium' };
    }

    if (otherChromium) {
        return { allowed: false, browser: null, reason: 'unsupported-chromium' };
    }

    const edgeBrand = hasBrand(brands, 'microsoft edge');
    const chromeBrand = hasBrand(brands, 'google chrome');
    const chromiumBrand = hasBrand(brands, 'chromium');

    if (brandsPresent && !edgeBrand && !chromeBrand && !chromiumBrand) {
        return { allowed: false, browser: null, reason: 'brand-mismatch' };
    }

    // A Chromium-based browser that advertises its own brand (Brave, Opera,
    // Vivaldi, Arc, …) is not Google Chrome or Microsoft Edge.
    const foreignBrand = brands.some((brand) => (
        !/google chrome|microsoft edge|chromium|^not.*brand$/i.test(brand.brand.trim())
    ));
    if (brandsPresent && foreignBrand) {
        return { allowed: false, browser: null, reason: 'unsupported-chromium' };
    }

    // UA-CH is more specific than the UA for Chromium-family detection.
    if (edgeUa) {
        if (brandsPresent && !edgeBrand) {
            return { allowed: false, browser: null, reason: 'brand-mismatch' };
        }
        return { allowed: true, browser: 'edge', reason: 'ok' };
    }

    if (brandsPresent && edgeBrand) {
        // Hint says Edge but the UA does not; a spoofed or rewritten request.
        return { allowed: false, browser: null, reason: 'brand-mismatch' };
    }

    if (brandsPresent && !chromeBrand && !chromiumBrand) {
        return { allowed: false, browser: null, reason: 'brand-mismatch' };
    }

    return { allowed: true, browser: 'chrome', reason: 'ok' };
}
