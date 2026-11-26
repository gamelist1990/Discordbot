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

/**
 * The one browser decision used by both the server gate and the auth page.
 *
 * Kept deliberately self-contained (no imports, no module-scope helpers) so
 * `page.ts` can embed its source with `Function.prototype.toString()` into the
 * page script. Client and server therefore cannot drift apart.
 *
 * Allowed:
 * - Chromium desktop: Google Chrome or Microsoft Edge. When UA-CH brands are
 *   present they must name Chrome/Edge only (Brave/Opera/Vivaldi/… stay out).
 * - Safari family: desktop Safari (`Version/… Safari/`, no Chrome/Chromium/
 *   Android tokens) and iOS WebKit browsers (Safari, CriOS, FxiOS, EdgiOS).
 *   Safari sends no UA-CH, so this branch ignores brands entirely and decides
 *   from the UA alone.
 *
 * Everything else (desktop Firefox, in-app webviews, unknown WebKit shells,
 * other Chromium browsers, automation) is rejected.
 */
export function evaluateBrowserUserAgent(
    userAgentInput: unknown,
    brandsInput?: BrowserBrand[] | null
): BrowserGateResult {
    const userAgent = String(userAgentInput == null ? '' : userAgentInput).trim();
    if (!userAgent) {
        return { allowed: false, browser: null, reason: 'missing-user-agent' };
    }
    const ua = userAgent.toLowerCase();
    const brands = Array.isArray(brandsInput) ? brandsInput : [];
    const brandsPresent = brands.length > 0;
    const brandNames = brands.map((entry) => String((entry && entry.brand) || '').trim().toLowerCase());
    const hasBrand = (needle: string): boolean => brandNames.some((name) => name.includes(needle));

    if (ua.includes('headlesschrome') || ua.includes('phantomjs')) {
        return { allowed: false, browser: null, reason: 'headless' };
    }

    // In-app webviews identify themselves with these tokens. They are
    // Chromium-based on Android / WebKit on iOS, but the automation/consent
    // surface is not a browser the auth flow can rely on.
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

    const android = ua.includes('android');
    const appleWebKit = ua.includes('applewebkit/');
    // iOS and iPadOS (desktop-mode iPad reports a Macintosh UA with Mobile/).
    const iosDevice = /iphone|ipad|ipod/.test(ua)
        || (ua.includes('macintosh') && ua.includes('mobile/'));

    // iOS browsers are all WebKit. Safari, Chrome (CriOS), Firefox (FxiOS) and
    // Edge (EdgiOS) are accepted; other shells (Google app, DuckDuckGo, …)
    // are not the browser the member can trust for the fingerprint flow.
    if (!android && appleWebKit && iosDevice) {
        const namedIosBrowser = /crios\/|fxios\/|edgios\//.test(ua);
        const plainSafari = /version\/[0-9.]+/.test(ua)
            && ua.includes('safari/')
            && !/(?:chrome\/|chromium\/|opios|gsa|duckduckgo|mercury|yandex|brave|firefox|samsungbrowser|opr\/)/.test(ua);
        if (namedIosBrowser || plainSafari) {
            return { allowed: true, browser: 'safari', reason: 'ok' };
        }
        return { allowed: false, browser: null, reason: 'unsupported-webkit' };
    }

    // Desktop Safari: Version/… followed by Safari/, and none of the
    // Chromium/Gecko/other-browser tokens. Safari sends no Sec-CH-UA, so this
    // path does not look at brands at all.
    if (!android && appleWebKit && !iosDevice) {
        const desktopSafari = /version\/[0-9.]+/.test(ua)
            && ua.includes('safari/')
            && !/(?:chrome\/|chromium\/|opr\/|opera|edg(?:a|e)?\/|firefox|fxios|crios|edgios|samsungbrowser|vivaldi|yabrowser|brave)/.test(ua);
        if (desktopSafari) {
            return { allowed: true, browser: 'safari', reason: 'ok' };
        }
    }

    if (/firefox\//.test(ua)) {
        return { allowed: false, browser: null, reason: 'firefox' };
    }

    const edgeUa = /\bedg(?:a|e)?\//.test(ua);
    const chromeUa = /chrome\//.test(ua) || /chromium\//.test(ua);
    const otherChromium = /(?:opr\/|opera|samsungbrowser|vivaldi|yabrowser|brave)/i.test(ua);

    if (!edgeUa && !chromeUa) {
        if (ua.includes('safari/')) {
            return { allowed: false, browser: null, reason: 'unsupported-webkit' };
        }
        return { allowed: false, browser: null, reason: 'unsupported-chromium' };
    }

    if (otherChromium) {
        return { allowed: false, browser: null, reason: 'unsupported-chromium' };
    }

    const edgeBrand = hasBrand('microsoft edge');
    const chromeBrand = hasBrand('google chrome');
    const chromiumBrand = hasBrand('chromium');

    if (brandsPresent && !edgeBrand && !chromeBrand && !chromiumBrand) {
        return { allowed: false, browser: null, reason: 'brand-mismatch' };
    }

    // A Chromium-based browser that advertises its own brand (Brave, Opera,
    // Vivaldi, Arc, …) is not Google Chrome or Microsoft Edge.
    const foreignBrand = brandNames.some((name) => (
        !/google chrome|microsoft edge|chromium|^not.*brand$/.test(name)
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

/**
 * Server entry point: normalizes the posted brands and the `Sec-CH-UA` header,
 * then applies the shared decision.
 */
export function evaluateBrowserGate(input: BrowserGateInput): BrowserGateResult {
    const postedBrands = normalizeBrands(input?.brands);
    const hintBrands = parseBrandHeader(input?.clientHint);
    return evaluateBrowserUserAgent(input?.userAgent, [...postedBrands, ...hintBrands]);
}
