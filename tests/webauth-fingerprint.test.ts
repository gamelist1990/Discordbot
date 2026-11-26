import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FINGERPRINT_CANONICAL_VERSION,
    canonicalizeFingerprint,
    hashFingerprint,
    hashIp,
    hmacSha256Hex,
    normalizeBrandList,
    normalizeFingerprintSignals,
    normalizeIpForHash
} from '../src/core/webauth/fingerprint.ts';

const baseSignals = {
    userAgent: 'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36',
    uaCh: {
        platform: 'Windows',
        platformVersion: '15.0.0',
        model: '',
        mobile: false,
        brands: [
            { brand: 'Chromium', version: '131' },
            { brand: 'Google Chrome', version: '131' }
        ]
    },
    screen: { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 },
    timezone: 'Asia/Tokyo',
    languages: ['ja-JP', 'en-US'],
    hardwareConcurrency: 8,
    deviceMemory: 8,
    canvasHash: 'ABCDEF',
    webglVendor: 'Google Inc.',
    webglRenderer: 'ANGLE (Intel)',
    touch: { maxTouchPoints: 0, touchEvent: false }
};

test('normalization drops unknown fields, bounds values and lowercases hashes', () => {
    const normalized = normalizeFingerprintSignals({
        ...baseSignals,
        canvasHash: 'AbCdEf',
        languages: [...Array(40)].map((_, index) => `l${index}`),
        hardwareConcurrency: 999_999,
        screen: { width: -5, height: 1.9, colorDepth: 999_999, pixelDepth: 0 },
        userAgent: 'a'.repeat(2000),
        extra: 'ignored'
    } as any);

    assert.equal(normalized.canvasHash, 'abcdef');
    assert.equal(normalized.languages.length, 20);
    assert.equal(normalized.hardwareConcurrency, 10_000);
    assert.equal(normalized.screen.width, 0);
    assert.equal(normalized.screen.height, 1);
    assert.equal(normalized.screen.colorDepth, 1_000);
    assert.equal(normalized.userAgent.length, 512);
    assert.equal('extra' in normalized, false);
});

test('brand lists are deduplicated and sorted for a stable canonical form', () => {
    const brands = normalizeBrandList([
        { brand: 'Google Chrome', version: '131' },
        { brand: 'chromium', version: '131' },
        { brand: 'Google Chrome', version: '999' }
    ]);
    assert.deepEqual(brands.map((brand) => brand.brand), ['chromium', 'Google Chrome']);
});

test('canonical form is versioned and stable regardless of object key order', () => {
    const first = canonicalizeFingerprint(normalizeFingerprintSignals(baseSignals));
    const reordered = {
        touch: baseSignals.touch,
        webglRenderer: baseSignals.webglRenderer,
        webglVendor: baseSignals.webglVendor,
        canvasHash: baseSignals.canvasHash,
        deviceMemory: baseSignals.deviceMemory,
        hardwareConcurrency: baseSignals.hardwareConcurrency,
        languages: baseSignals.languages,
        timezone: baseSignals.timezone,
        screen: baseSignals.screen,
        uaCh: baseSignals.uaCh,
        userAgent: baseSignals.userAgent
    };
    const second = canonicalizeFingerprint(normalizeFingerprintSignals(reordered));
    assert.equal(first, second);
    assert.ok(first.startsWith(FINGERPRINT_CANONICAL_VERSION));
    assert.match(first, /uach\.brands=chromium\/131\|google chrome\/131/);
});

test('any meaningful signal change produces a different hash', () => {
    const secret = Buffer.alloc(32, 7);
    const base = normalizeFingerprintSignals(baseSignals);
    const baseHash = hashFingerprint(secret, base);
    assert.match(baseHash, /^[0-9a-f]{64}$/);

    const changed = normalizeFingerprintSignals({ ...baseSignals, canvasHash: 'other' });
    assert.notEqual(hashFingerprint(secret, changed), baseHash);

    const changedTz = normalizeFingerprintSignals({ ...baseSignals, timezone: 'Europe/London' });
    assert.notEqual(hashFingerprint(secret, changedTz), baseHash);
});

test('hashing is deterministic per secret and differs across secrets', () => {
    const base = normalizeFingerprintSignals(baseSignals);
    const one = hashFingerprint(Buffer.alloc(32, 1), base);
    assert.equal(hashFingerprint(Buffer.alloc(32, 1), base), one);
    assert.notEqual(hashFingerprint(Buffer.alloc(32, 2), base), one);
    assert.equal(hmacSha256Hex('text', 'value'), hmacSha256Hex(Buffer.from('text'), 'value'));
});

test('IP hashing normalizes IPv4-mapped and whitespace forms', () => {
    const secret = Buffer.alloc(32, 3);
    const plain = hashIp(secret, '203.0.113.10');
    assert.equal(hashIp(secret, ' ::ffff:203.0.113.10 '), plain);
    assert.equal(hashIp(secret, '[203.0.113.10]'), plain);
    assert.equal(hashIp(secret, ''), '');
    assert.notEqual(hashIp(secret, '203.0.113.11'), plain);
    assert.equal(normalizeIpForHash('::FFFF:203.0.113.10'), '203.0.113.10');
});
