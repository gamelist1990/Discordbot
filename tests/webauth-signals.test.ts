import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FINGERPRINT_FUZZY_CONFIG,
    fingerprintComponentValues,
    hashFingerprint,
    hashFingerprintSignalComponents,
    normalizeFingerprintSignals,
    scoreFingerprintSimilarity
} from '../src/core/webauth/fingerprint.ts';
import {
    correlateWebAuthRecord,
    createWebAuthRecord,
    normalizeWebAuthRecords
} from '../src/core/webauth/records.ts';
import { evaluateWebAuthBlock, readWebAuthBlockSettings } from '../src/core/webauth/authBlock.ts';
import { isSoftwareRenderer, SOFTWARE_RENDERER_PATTERNS } from '../src/core/webauth/renderer.ts';
import {
    computeGeoMismatch,
    languageCountry,
    normalizeCountryCode,
    timezoneCountry
} from '../src/core/webauth/geo.ts';
import { mapIpApiResponse } from '../src/core/webauth/ipIntel.ts';

const SECRET = Buffer.alloc(32, 31);
const NOW = 1_700_000_000_000;
const H = (char: string) => char.repeat(64);

const baseSignals = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    uaCh: {
        platform: 'Windows',
        platformVersion: '15.0.0',
        model: '',
        mobile: false,
        brands: [{ brand: 'Google Chrome', version: '131' }]
    },
    screen: { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 },
    timezone: 'Asia/Tokyo',
    languages: ['ja-JP', 'en-US'],
    hardwareConcurrency: 8,
    deviceMemory: 8,
    canvasHash: 'abcdef',
    webglVendor: 'Google Inc.',
    webglRenderer: 'ANGLE (Intel)',
    touch: { maxTouchPoints: 0, touchEvent: false }
};

/** Everything a post-brief-9 Chromium page can report. */
const fullSignals = {
    ...baseSignals,
    audioHash: 'audio-signature-hex',
    fonts: ['Arial', 'Meiryo', 'Yu Gothic'],
    webglDetail: {
        extensions: ['EXT_color_buffer_float', 'WEBGL_debug_renderer_info'],
        maxTextureSize: 16384,
        maxViewportWidth: 32767,
        maxViewportHeight: 32767,
        fragmentHighp: '127/127/23'
    },
    screen: {
        ...baseSignals.screen,
        devicePixelRatio: 2,
        colorGamut: 'srgb',
        orientation: 'landscape-primary'
    }
};

const norm = (overrides: Record<string, unknown> = {}) =>
    normalizeFingerprintSignals({ ...baseSignals, ...overrides } as any);

const full = () => normalizeFingerprintSignals(fullSignals as any);

function record(userId: string, overrides: Record<string, unknown> = {}) {
    return createWebAuthRecord({
        guildId: 'guild-signals',
        userId,
        source: 'web',
        browser: { name: 'chrome', reason: 'ok' },
        intel: { verdict: 'clean', flags: [], source: 'ip-api.com' },
        ipHash: null,
        fpHash: null,
        sealed: null,
        now: NOW,
        ...overrides
    } as any);
}

// ---------------------------------------------------------------------------
// 1. Audio component
// ---------------------------------------------------------------------------

test('the audio component is hashed when present and scores at full weight', () => {
    const withAudio = hashFingerprintSignalComponents(SECRET, norm({ audioHash: 'audio-signature' }));
    assert.match(withAudio.audio || '', /^[0-9a-f]{64}$/);

    const self = scoreFingerprintSimilarity(withAudio, withAudio);
    assert.equal(self.comparable, true);
    // canvas 3 + webgl 3 + screen 2 + platform 2 + locale 1 + hardware 1 + audio 2
    assert.equal(self.totalWeight, 14);
    assert.equal(self.matchedWeight, 14);
    assert.equal(self.ratio, 1);
    assert.equal(self.matches, true);
    assert.ok(self.matchedKeys.includes('audio'));
});

test('old records without audio are not penalised (absent on both sides)', () => {
    const withoutAudio = hashFingerprintSignalComponents(SECRET, norm());
    assert.equal(withoutAudio.audio, undefined);

    const self = scoreFingerprintSimilarity(withoutAudio, withoutAudio);
    assert.equal(self.totalWeight, 12);
    assert.equal(self.ratio, 1);
    assert.equal(self.matches, true);
});

test('audio present on one side only is an unconfirmed group, not an automatic miss', () => {
    const withAudio = hashFingerprintSignalComponents(SECRET, norm({ audioHash: 'audio-signature' }));
    const withoutAudio = hashFingerprintSignalComponents(SECRET, norm());

    const oneSided = scoreFingerprintSimilarity(withAudio, withoutAudio);
    assert.equal(oneSided.totalWeight, 14);
    assert.equal(oneSided.matchedWeight, 12);
    assert.equal(Number(oneSided.ratio.toFixed(3)), 0.857);
    assert.equal(oneSided.matches, true, 'the same device still matches across the audio rollout');

    const differentAudio = hashFingerprintSignalComponents(SECRET, norm({ audioHash: 'other-signature' }));
    const bothDifferent = scoreFingerprintSimilarity(withAudio, differentAudio);
    assert.equal(bothDifferent.matchedWeight, 12);
    assert.equal(bothDifferent.totalWeight, 14);
    assert.equal(bothDifferent.matches, true, 'audio alone (weight 2) cannot drop a same device below 0.75');

    // A different audio stack plus a different canvas is a real miss: 9/14 = 0.643.
    const audioAndCanvas = hashFingerprintSignalComponents(SECRET, norm({
        audioHash: 'other-signature',
        canvasHash: 'other-canvas'
    }));
    const miss = scoreFingerprintSimilarity(withAudio, audioAndCanvas);
    assert.equal(miss.matchedWeight, 9);
    assert.equal(miss.totalWeight, 14);
    assert.equal(Number(miss.ratio.toFixed(3)), 0.643);
    assert.equal(miss.matches, false);
});

// ---------------------------------------------------------------------------
// 2. Automation summary + webdriver block rule
// ---------------------------------------------------------------------------

test('navigator.webdriver=true blocks under its own rule and can be disabled', () => {
    const candidate = record('automation-user', {
        automation: {
            webdriver: true,
            pluginCount: 3,
            outerWidth: 1280,
            outerHeight: 800,
            notificationPermission: 'granted',
            notificationApiState: 'granted'
        }
    });
    assert.equal(candidate.automation?.webdriver, true);

    const blocked = evaluateWebAuthBlock({ record: candidate });
    assert.equal(blocked.blocked, true);
    assert.deepEqual(blocked.rules, ['automation']);
    assert.deepEqual(blocked.matches, [], 'no account is blamed for an automation flag');

    const softened = evaluateWebAuthBlock({ record: candidate, settings: { automation: false } });
    assert.equal(softened.blocked, false);
    assert.deepEqual(softened.rules, []);
});

test('headless traits other than webdriver are stored but never block alone', () => {
    const candidate = record('headless-traits', {
        automation: {
            webdriver: false,
            pluginCount: 0,
            outerWidth: 0,
            outerHeight: 0,
            notificationPermission: 'denied',
            notificationApiState: 'granted'
        }
    });
    assert.equal(candidate.automation?.pluginCount, 0);
    assert.equal(candidate.automation?.outerWidth, 0);
    assert.equal(candidate.automation?.notificationMismatch, true, 'derived server-side from the two states');

    const decision = evaluateWebAuthBlock({ record: candidate });
    assert.equal(decision.blocked, false);
    assert.deepEqual(decision.rules, []);
});

test('a normal automation summary is stored and the block rule defaults ON', () => {
    const candidate = record('normal-user', {
        automation: {
            webdriver: false,
            pluginCount: 5,
            outerWidth: 1920,
            outerHeight: 1040,
            notificationPermission: 'default',
            notificationApiState: 'prompt'
        }
    });
    assert.equal(candidate.automation?.webdriver, false);
    assert.equal(candidate.automation?.notificationMismatch, false, 'unknown states produce no mismatch');
    assert.equal(evaluateWebAuthBlock({ record: candidate }).blocked, false);
    assert.equal(readWebAuthBlockSettings(null).automation, true);
});

// ---------------------------------------------------------------------------
// 3. Software renderer classification
// ---------------------------------------------------------------------------

test('software renderer strings are classified, real GPUs are not', () => {
    const software = [
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
        'Google SwiftShader',
        'ANGLE (Mesa/X.org, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5)',
        'softpipe (LLVM 14.0.0)',
        'Mesa swrast',
        'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'Apple Software Renderer',
        'ANGLE (Mesa, Mesa OffScreen, OpenGL 4.5)',
        'virgl (Gallium 0.4 on virgl)'
    ];
    for (const renderer of software) {
        assert.equal(isSoftwareRenderer('', renderer), true, renderer);
    }

    const real = [
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'Mesa Intel(R) UHD Graphics 620 (CML GT2)',
        'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'Apple GPU',
        'AMD Radeon Pro 5500M OpenGL Engine',
        ''
    ];
    for (const renderer of real) {
        assert.equal(isSoftwareRenderer('', renderer), false, renderer || '(empty)');
    }
    assert.equal(isSoftwareRenderer(undefined, null), false);
    assert.ok(SOFTWARE_RENDERER_PATTERNS.length >= 8);
});

test('softwareRenderer is stored on the record and defaults to false', () => {
    assert.equal(record('soft', { softwareRenderer: true }).softwareRenderer, true);
    assert.equal(record('hard').softwareRenderer, false);
    // A SwiftShader-shaped signal is detected from the posted renderer.
    assert.equal(isSoftwareRenderer('Google Inc.', 'Google SwiftShader'), true);
});

// ---------------------------------------------------------------------------
// 4. Geo consistency
// ---------------------------------------------------------------------------

test('geo mismatch matrix: JP vs Japanese timezone/language', () => {
    // JP IP + JP timezone + ja-JP language = consistent.
    assert.equal(computeGeoMismatch({
        countryCode: 'JP', timezone: 'Asia/Tokyo', languages: ['ja-JP', 'en-US']
    }), 'none');

    // JP timezone and language against a foreign IP: both disagree.
    assert.equal(computeGeoMismatch({
        countryCode: 'US', timezone: 'Asia/Tokyo', languages: ['ja-JP']
    }), 'both');
    assert.equal(computeGeoMismatch({
        countryCode: 'KR', timezone: 'Asia/Tokyo', languages: ['ja-JP']
    }), 'both');

    // Timezone only disagrees (English browser abroad).
    assert.equal(computeGeoMismatch({
        countryCode: 'US', timezone: 'Asia/Tokyo', languages: ['en-US']
    }), 'tz');

    // Language only disagrees (unknown/exotic timezone).
    assert.equal(computeGeoMismatch({
        countryCode: 'US', timezone: '', languages: ['ja-JP']
    }), 'lang');

    // Unknown on either side is no judgement, never a mismatch.
    assert.equal(computeGeoMismatch({
        countryCode: '', timezone: 'Asia/Tokyo', languages: ['ja-JP']
    }), 'none');
    assert.equal(computeGeoMismatch({
        countryCode: null, timezone: 'Asia/Tokyo', languages: ['ja-JP']
    }), 'none');
    assert.equal(computeGeoMismatch({
        countryCode: 'JP', timezone: 'Unknown/Zone', languages: ['xx']
    }), 'none');

    // Region subtags and unambiguous languages.
    assert.equal(computeGeoMismatch({
        countryCode: 'TW', timezone: 'Asia/Taipei', languages: ['zh-Hant-TW']
    }), 'none');
    assert.equal(computeGeoMismatch({
        countryCode: 'JP', timezone: 'Asia/Tokyo', languages: ['ja']
    }), 'none');
});

test('geo helpers keep the mapping coarse and explicit', () => {
    assert.equal(timezoneCountry('Asia/Tokyo'), 'JP');
    assert.equal(timezoneCountry('America/Los_Angeles'), 'US');
    assert.equal(timezoneCountry('Europe/Busingen'), null, 'unmapped zones give no judgement');
    assert.equal(timezoneCountry(''), null);

    assert.equal(languageCountry('ja'), 'JP');
    assert.equal(languageCountry('ja-JP'), 'JP');
    assert.equal(languageCountry('en-US'), 'US');
    assert.equal(languageCountry('en'), null, 'multi-country languages need a region');
    assert.equal(languageCountry('de-DE'), 'DE');
    assert.equal(languageCountry(''), null);

    assert.equal(normalizeCountryCode('jp'), 'JP');
    assert.equal(normalizeCountryCode('JPN'), null);
    assert.equal(normalizeCountryCode(null), null);
});

test('ip-api countryCode is captured (uppercased) and absent on failure', () => {
    const clean = mapIpApiResponse({ status: 'success', countryCode: 'jp' }, NOW);
    assert.equal(clean.verdict, 'clean');
    assert.equal(clean.countryCode, 'JP');

    const blocked = mapIpApiResponse({ status: 'success', proxy: true, countryCode: 'US' }, NOW);
    assert.equal(blocked.verdict, 'blocked');
    assert.equal(blocked.countryCode, 'US');

    assert.equal(mapIpApiResponse({ status: 'success' }, NOW).countryCode, undefined);
    assert.equal(mapIpApiResponse({ status: 'fail' }, NOW).countryCode, undefined);
});

test('geoMismatch is normalised on the record and old records default to none', () => {
    assert.equal(record('geo-ok', { countryCode: 'jp', geoMismatch: 'none' }).countryCode, 'JP');
    assert.equal(record('geo-both', { countryCode: 'US', geoMismatch: 'both' }).geoMismatch, 'both');
    assert.equal(record('geo-junk', { geoMismatch: 'nonsense' as any }).geoMismatch, 'none');
    assert.equal(record('geo-junk', { countryCode: 'JPN' }).countryCode, null);

    const [legacy] = normalizeWebAuthRecords([{
        guildId: 'guild-signals',
        userId: 'legacy-user',
        createdAt: new Date(NOW).toISOString(),
        source: 'web',
        verified: true,
        browser: { name: 'chrome', reason: 'ok' },
        intel: { verdict: 'clean', flags: [], source: 'ip-api.com' },
        ipHash: null,
        fpHash: H('a'),
        signalHashes: null,
        asn: null,
        subnetHash: null,
        sealed: null,
        presetId: null,
        note: null,
        roleGranted: true,
        blocked: null
    }], NOW);
    assert.ok(legacy);
    assert.equal(legacy.geoMismatch, 'none');
    assert.equal(legacy.countryCode, null);
    assert.equal(legacy.automation, null);
    assert.equal(legacy.softwareRenderer, false);
});

// ---------------------------------------------------------------------------
// 5. Fonts / webgl2 / display components
// ---------------------------------------------------------------------------

test('fonts, webgl2 and display are independent weighted components', () => {
    assert.equal(FINGERPRINT_FUZZY_CONFIG.weights.fonts, 2);
    assert.equal(FINGERPRINT_FUZZY_CONFIG.weights.webgl2, 1);
    assert.equal(FINGERPRINT_FUZZY_CONFIG.weights.display, 1);

    const hashes = hashFingerprintSignalComponents(SECRET, full());
    assert.deepEqual(Object.keys(hashes).sort(), [
        'audio', 'canvas', 'display', 'fonts', 'hardware', 'locale', 'platform', 'screen', 'webgl', 'webgl2'
    ]);

    const self = scoreFingerprintSimilarity(hashes, hashes);
    assert.equal(self.totalWeight, 18);
    assert.equal(self.ratio, 1);

    // A font set change costs exactly the fonts weight (2): 16/18 = 0.889.
    const fontsChanged = hashFingerprintSignalComponents(SECRET, norm({
        ...fullSignals,
        fonts: [...fullSignals.fonts, 'Tahoma']
    }));
    assert.notEqual(fontsChanged.fonts, hashes.fonts);
    assert.equal(fontsChanged.canvas, hashes.canvas, 'font measurement must not disturb canvas');
    assert.equal(fontsChanged.webgl2, hashes.webgl2);
    const fontScore = scoreFingerprintSimilarity(hashes, fontsChanged);
    assert.equal(fontScore.matchedWeight, 16);
    assert.equal(fontScore.totalWeight, 18);
    assert.equal(Number(fontScore.ratio.toFixed(3)), 0.889);

    // A WebGL extension/limit change costs the webgl2 weight (1): 17/18.
    const gpuChanged = hashFingerprintSignalComponents(SECRET, norm({
        ...fullSignals,
        webglDetail: { ...fullSignals.webglDetail, extensions: ['EXT_color_buffer_float'] }
    }));
    assert.notEqual(gpuChanged.webgl2, hashes.webgl2);
    assert.equal(gpuChanged.webgl, hashes.webgl, 'the canonical webgl component stays untouched');
    const gpuScore = scoreFingerprintSimilarity(hashes, gpuChanged);
    assert.equal(gpuScore.matchedWeight, 17);

    // The two heaviest groups still dominate: canvas + webgl changed = 12/18.
    const heavy = hashFingerprintSignalComponents(SECRET, norm({
        ...fullSignals,
        canvasHash: 'other-canvas',
        webglRenderer: 'Other GPU'
    }));
    const heavyScore = scoreFingerprintSimilarity(hashes, heavy);
    assert.equal(heavyScore.matchedWeight, 12);
    assert.equal(Number(heavyScore.ratio.toFixed(3)), 0.667);
    assert.equal(heavyScore.matches, false);
});

test('display extras do not change the legacy screen component or the exact hash', () => {
    const plain = norm();
    const withDisplay = norm({
        screen: {
            ...baseSignals.screen,
            devicePixelRatio: 2,
            colorGamut: 'p3',
            orientation: 'portrait-primary'
        }
    });
    const plainValues = fingerprintComponentValues(plain);
    const displayValues = fingerprintComponentValues(withDisplay);

    assert.equal(displayValues.screen, plainValues.screen, 'old screen hashes keep matching');
    assert.notEqual(displayValues.display, plainValues.display);
    assert.equal(plainValues.display, '', 'no extras = no display component');

    // The exact device hash is deliberately independent of the new groups.
    assert.equal(hashFingerprint(SECRET, plain), hashFingerprint(SECRET, normalizeFingerprintSignals(fullSignals as any)));
});

// ---------------------------------------------------------------------------
// 6. Pre-brief-9 record compatibility
// ---------------------------------------------------------------------------

test('a pre-brief-9 record still exact/fuzzy matches itself', () => {
    // Only the six components the old page collected.
    const legacyHashes = hashFingerprintSignalComponents(SECRET, norm());
    assert.deepEqual(Object.keys(legacyHashes).sort(), [
        'canvas', 'hardware', 'locale', 'platform', 'screen', 'webgl'
    ]);

    const legacy = record('legacy', { fpHash: H('a'), signalHashes: legacyHashes });
    // Exact: the stored whole-fingerprint hash of the old record.
    const exactCopy = record('exact-copy', { fpHash: H('a'), signalHashes: legacyHashes });
    const exact = correlateWebAuthRecord([legacy, exactCopy], legacy);
    assert.equal(exact.matchCount, 1);
    assert.deepEqual(exact.matches[0].hashTypes, ['fp']);

    // Fuzzy: same stored components, different (recomputed) whole hash.
    const fuzzyPeer = record('fuzzy-peer', { fpHash: H('b'), signalHashes: legacyHashes });
    const fuzzy = correlateWebAuthRecord([legacy, fuzzyPeer], legacy);
    assert.equal(fuzzy.matchCount, 1);
    assert.deepEqual(fuzzy.matches[0].hashTypes, ['fp-fuzzy']);
    assert.equal(fuzzy.matches[0].fpScore, 1);

    // A stored JSON record without the brief-9 fields normalizes with defaults.
    const [normalizedLegacy] = normalizeWebAuthRecords([{
        ...legacy,
        automation: undefined,
        softwareRenderer: undefined,
        countryCode: undefined,
        geoMismatch: undefined
    }], NOW);
    assert.equal(normalizedLegacy.automation, null);
    assert.equal(normalizedLegacy.softwareRenderer, false);
    assert.equal(normalizedLegacy.geoMismatch, 'none');
    assert.deepEqual(normalizedLegacy.signalHashes, legacyHashes);
});

test('old and new records still match exactly on IP/whole fingerprint', () => {
    const newRecord = record('new', {
        fpHash: H('c'),
        signalHashes: hashFingerprintSignalComponents(SECRET, full())
    });
    const oldRecord = record('old', { fpHash: H('c'), signalHashes: null });
    const { matches } = correlateWebAuthRecord([newRecord, oldRecord], newRecord);
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0].hashTypes, ['fp']);
});
