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
import { correlateWebAuthRecord, createWebAuthRecord } from '../src/core/webauth/records.ts';

const SECRET = Buffer.alloc(32, 21);
const NOW = 1_700_000_000_000;

const baseSignals = {
    userAgent: 'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36',
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

const normalized = (overrides: Record<string, unknown> = {}) =>
    normalizeFingerprintSignals({ ...baseSignals, ...overrides } as any);

/** Weight of the components this browser actually reports (audio is absent). */
const OBSERVABLE_WEIGHT = Object.entries(FINGERPRINT_FUZZY_CONFIG.weights)
    .filter(([key]) => key !== 'audio')
    .reduce((sum, [, weight]) => sum + weight, 0);

test('each fingerprint component is hashed independently with the same secret', () => {
    const first = hashFingerprintSignalComponents(SECRET, normalized());
    const keys = Object.keys(first).sort();
    assert.deepEqual(keys, ['canvas', 'hardware', 'locale', 'platform', 'screen', 'webgl']);
    for (const value of Object.values(first)) assert.match(value, /^[0-9a-f]{64}$/);

    const changedCanvas = hashFingerprintSignalComponents(SECRET, normalized({ canvasHash: 'other' }));
    assert.notEqual(changedCanvas.canvas, first.canvas);
    for (const key of ['webgl', 'screen', 'platform', 'locale', 'hardware'] as const) {
        assert.equal(changedCanvas[key], first[key], `${key} must not change when canvas changes`);
    }

    const changedWebgl = hashFingerprintSignalComponents(SECRET, normalized({ webglRenderer: 'Other GPU' }));
    assert.notEqual(changedWebgl.webgl, first.webgl);
    assert.equal(changedWebgl.canvas, first.canvas);

    // Component hashes are independent of the whole-fingerprint hash.
    assert.notEqual(first.canvas, hashFingerprint(SECRET, normalized()));
    // Deterministic per secret.
    assert.deepEqual(hashFingerprintSignalComponents(SECRET, normalized()), first);
    assert.notEqual(hashFingerprintSignalComponents(Buffer.alloc(32, 22), normalized()).canvas, first.canvas);
});

test('component values omit empty groups so missing data never looks equal', () => {
    const values = fingerprintComponentValues(normalized({
        canvasHash: '',
        webglVendor: '',
        webglRenderer: '',
        timezone: '',
        languages: [],
        hardwareConcurrency: 0,
        deviceMemory: 0
    }));
    assert.equal(values.canvas, '');
    assert.equal(values.webgl, '');
    assert.equal(values.locale, '');
    assert.equal(values.hardware, '');
    const hashes = hashFingerprintSignalComponents(SECRET, normalized({
        canvasHash: '', webglVendor: '', webglRenderer: '',
        timezone: '', languages: [], hardwareConcurrency: 0, deviceMemory: 0
    }));
    assert.equal(hashes.canvas, undefined);
    assert.equal(hashes.webgl, undefined);
});

test('fuzzy score is a weighted ratio with canvas/webgl heaviest', () => {
    const same = scoreFingerprintSimilarity(
        hashFingerprintSignalComponents(SECRET, normalized()),
        hashFingerprintSignalComponents(SECRET, normalized())
    );
    assert.equal(same.comparable, true);
    assert.equal(same.totalWeight, OBSERVABLE_WEIGHT);
    assert.equal(same.matchedWeight, OBSERVABLE_WEIGHT);
    assert.equal(same.ratio, 1);
    assert.equal(same.matches, true);

    // Canvas (3) alone changed: 9 / 12 = 0.75, still a fuzzy match.
    const canvasChanged = scoreFingerprintSimilarity(
        hashFingerprintSignalComponents(SECRET, normalized()),
        hashFingerprintSignalComponents(SECRET, normalized({ canvasHash: 'other' }))
    );
    assert.equal(canvasChanged.matchedWeight, OBSERVABLE_WEIGHT - 3);
    assert.equal(canvasChanged.totalWeight, OBSERVABLE_WEIGHT);
    assert.equal(canvasChanged.matchedKeys.includes('canvas'), false);
    assert.equal(canvasChanged.ratio, 0.75);
    assert.equal(canvasChanged.matches, true);

    // Canvas + WebGL (6) changed: 6 / 12 = 0.5 < 0.75.
    const heavyChanged = scoreFingerprintSimilarity(
        hashFingerprintSignalComponents(SECRET, normalized()),
        hashFingerprintSignalComponents(SECRET, normalized({ canvasHash: 'other', webglRenderer: 'Other GPU' }))
    );
    assert.equal(heavyChanged.matchedWeight, OBSERVABLE_WEIGHT - 6);
    assert.equal(heavyChanged.matches, false);
    // Lowering the threshold accepts it.
    assert.equal(scoreFingerprintSimilarity(
        hashFingerprintSignalComponents(SECRET, normalized()),
        hashFingerprintSignalComponents(SECRET, normalized({ canvasHash: 'other', webglRenderer: 'Other GPU' })),
        { threshold: 0.5 }
    ).matches, true);
});

test('legacy records without component hashes are not comparable', () => {
    const score = scoreFingerprintSimilarity(null, hashFingerprintSignalComponents(SECRET, normalized()));
    assert.equal(score.comparable, false);
    assert.equal(score.matches, false);
    assert.equal(score.ratio, 0);
});

function record(userId: string, overrides: Record<string, unknown> = {}) {
    return createWebAuthRecord({
        guildId: 'guild',
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

test('correlation matches fuzzily when the whole-hash does not, and logs the score', () => {
    const target = record('new', {
        fpHash: 'a'.repeat(64),
        signalHashes: hashFingerprintSignalComponents(SECRET, normalized())
    });
    const fuzzyPeer = record('fuzzy-peer', {
        fpHash: 'b'.repeat(64),
        signalHashes: hashFingerprintSignalComponents(SECRET, normalized())
    });
    const { matches } = correlateWebAuthRecord([target, fuzzyPeer], target);
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0].hashTypes, ['fp-fuzzy']);
    assert.equal(matches[0].fpScore, 1);
    assert.equal(matches[0].hashCount, 1);
});

test('exact fingerprint matches stay exact, and legacy peers never fuzzy-match', () => {
    const signals = hashFingerprintSignalComponents(SECRET, normalized());
    const target = record('new', { fpHash: 'a'.repeat(64), signalHashes: signals });
    const exactPeer = record('exact', { fpHash: 'a'.repeat(64), signalHashes: signals });
    const legacyPeer = record('legacy', { fpHash: 'b'.repeat(64), signalHashes: null });
    const { matches } = correlateWebAuthRecord([target, exactPeer, legacyPeer], target);
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0].hashTypes, ['fp']);
    assert.equal(matches[0].fpScore, 1);
});

test('a partially matching fingerprint still needs the configured threshold', () => {
    const target = record('new', {
        fpHash: 'a'.repeat(64),
        signalHashes: hashFingerprintSignalComponents(SECRET, normalized())
    });
    // Canvas + WebGL differ: 8 / 14 = 0.571, below 0.75.
    const weakPeer = record('weak', {
        fpHash: 'b'.repeat(64),
        signalHashes: hashFingerprintSignalComponents(SECRET, normalized({
            canvasHash: 'other', webglRenderer: 'Other GPU'
        }))
    });
    assert.equal(correlateWebAuthRecord([target, weakPeer], target).matchCount, 0);
    // The threshold is configurable.
    assert.equal(correlateWebAuthRecord([target, weakPeer], target, { fuzzy: { threshold: 0.5 } }).matches[0].hashTypes[0], 'fp-fuzzy');
});
