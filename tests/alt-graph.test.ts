import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ALT_GRAPH_EDGE_LABELS,
    buildAltGraph,
    evaluateGraphPropagation,
    linkAltGraphNodes,
    readAltGraphSettings,
    type AltGraphNode
} from '../src/core/anticheat/AltGraph.ts';
import {
    DEFAULT_ALT_GRAPH_SETTINGS,
    type WatchUserEntry
} from '../src/core/anticheat/types.ts';
import { createWebAuthRecord } from '../src/core/webauth/records.ts';
import { hashFingerprintSignalComponents, normalizeFingerprintSignals } from '../src/core/webauth/fingerprint.ts';

const SECRET = Buffer.alloc(32, 41);
const NOW = 1_700_000_000_000;
const WEIGHTS = DEFAULT_ALT_GRAPH_SETTINGS.weights;

function node(userId: string, overrides: Partial<AltGraphNode> = {}): AltGraphNode {
    return {
        userId,
        ipHashes: [],
        fingerprints: [],
        subnetPairs: [],
        avatarHash: null,
        accountCreatedAt: 0,
        normalizedName: '',
        bad: false,
        badTags: [],
        ...overrides
    };
}

const signals = hashFingerprintSignalComponents(SECRET, normalizeFingerprintSignals({
    userAgent: 'Mozilla/5.0 Chrome/131.0.0.0',
    screen: { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 },
    timezone: 'Asia/Tokyo',
    languages: ['ja-JP'],
    hardwareConcurrency: 8,
    deviceMemory: 8,
    canvasHash: 'canvas',
    webglVendor: 'Google Inc.',
    webglRenderer: 'ANGLE'
}));

test('every documented edge type carries its configured weight', () => {
    const base = node('a');
    const cases: Array<[string, AltGraphNode, string, number]> = [
        ['ip', node('b', { ipHashes: ['h1'] }), 'ip', WEIGHTS.ipHash],
        ['fp', node('b', { fingerprints: [{ fpHash: 'f1', signalHashes: null }] }), 'fp', WEIGHTS.fpHash],
        ['fuzzy', node('b', { fingerprints: [{ fpHash: 'f2', signalHashes: signals }] }), 'fuzzy', WEIGHTS.fuzzyFingerprint],
        ['subnet', node('b', { subnetPairs: [{ subnetHash: 's1', asn: 'AS1' }] }), 'subnet', WEIGHTS.subnetAsn],
        ['avatar', node('b', { avatarHash: 'avatar' }), 'avatar', WEIGHTS.avatarHash],
        ['creation', node('b', { accountCreatedAt: NOW }), 'creation', WEIGHTS.creationCluster],
        ['name', node('b', { normalizedName: 'sharedname' }), 'name', WEIGHTS.similarName]
    ];
    const counterpart: Record<string, AltGraphNode> = {
        ip: node('a', { ipHashes: ['h1'] }),
        fp: node('a', { fingerprints: [{ fpHash: 'f1', signalHashes: null }] }),
        fuzzy: node('a', { fingerprints: [{ fpHash: 'f9', signalHashes: signals }] }),
        subnet: node('a', { subnetPairs: [{ subnetHash: 's1', asn: 'AS1' }] }),
        avatar: node('a', { avatarHash: 'avatar' }),
        creation: node('a', { accountCreatedAt: NOW + 60_000 }),
        name: node('a', { normalizedName: 'sharedname' })
    };
    for (const [name, peer, type, weight] of cases) {
        const links = linkAltGraphNodes(counterpart[name], peer, DEFAULT_ALT_GRAPH_SETTINGS);
        const link = links.find((entry) => entry.type === type);
        assert.ok(link, `${name} edge must exist`);
        assert.equal(link.weight, weight, `${name} weight`);
    }
    // A clean pair has no edges at all.
    assert.deepEqual(linkAltGraphNodes(base, node('b')), []);
});

test('weights are read from one config object and can be tuned', () => {
    const tuned = readAltGraphSettings({
        weights: { subnetAsn: 9, similarName: 0 },
        flagThreshold: 7
    });
    assert.equal(tuned.weights.subnetAsn, 9);
    assert.equal(tuned.weights.similarName, 0);
    assert.equal(tuned.flagThreshold, 7);
    const link = linkAltGraphNodes(
        node('a', { subnetPairs: [{ subnetHash: 's', asn: 'AS' }] }),
        node('b', { subnetPairs: [{ subnetHash: 's', asn: 'AS' }] }),
        tuned
    );
    assert.equal(link[0].weight, 9);
});

test('subnet matching requires the same ASN, and creation clusters need a close timestamp', () => {
    const sameSubnetDifferentAsn = linkAltGraphNodes(
        node('a', { subnetPairs: [{ subnetHash: 's', asn: 'AS1' }] }),
        node('b', { subnetPairs: [{ subnetHash: 's', asn: 'AS2' }] })
    );
    assert.deepEqual(sameSubnetDifferentAsn, []);
    const tooFar = linkAltGraphNodes(
        node('a', { accountCreatedAt: NOW }),
        node('b', { accountCreatedAt: NOW + 11 * 60_000 })
    );
    assert.deepEqual(tooFar, []);
    const shortName = linkAltGraphNodes(
        node('a', { normalizedName: 'ab' }),
        node('b', { normalizedName: 'ab' })
    );
    assert.deepEqual(shortName, []);
});

test('exact fingerprint match replaces the fuzzy edge and a user cannot link to itself', () => {
    const exact = linkAltGraphNodes(
        node('a', { fingerprints: [{ fpHash: 'f1', signalHashes: signals }] }),
        node('b', { fingerprints: [{ fpHash: 'f1', signalHashes: signals }] })
    );
    assert.deepEqual(exact.map((entry) => entry.type), ['fp']);
    assert.deepEqual(linkAltGraphNodes(node('a'), node('a')), []);
});

test('propagation sums toward bad nodes only and flags at the threshold', () => {
    const record = (userId: string, overrides: Record<string, unknown> = {}) => createWebAuthRecord({
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

    const exact = buildAltGraph({
        webAuthRecords: [
            record('target', { fpHash: 'f'.repeat(64) }),
            record('bad', { fpHash: 'f'.repeat(64) })
        ],
        riskKicks: [{ userId: 'bad', ts: NOW, source: 'raid', reason: 'raid' }]
    });
    const exactResult = evaluateGraphPropagation(exact, 'target');
    assert.equal(exactResult.total, 5);
    assert.equal(exactResult.flagged, true);
    assert.deepEqual(exactResult.topTypes, ['fp']);
    assert.deepEqual(exactResult.badUserIds, ['bad']);

    // Subnet + ASN alone is a weak edge and never flags.
    const subnetOnly = buildAltGraph({
        webAuthRecords: [
            record('target', { subnetHash: 'a1'.repeat(32), asn: 'AS2516' }),
            record('bad', { subnetHash: 'a1'.repeat(32), asn: 'AS2516' })
        ],
        riskKicks: [{ userId: 'bad', ts: NOW, source: 'raid', reason: 'raid' }]
    });
    const subnetResult = evaluateGraphPropagation(subnetOnly, 'target');
    assert.equal(subnetResult.total, 2);
    assert.equal(subnetResult.flagged, false);

    // Subnet (2) + fuzzy fingerprint (3) reaches the threshold together.
    const combined = buildAltGraph({
        webAuthRecords: [
            record('target', { fpHash: 'a'.repeat(64), subnetHash: 'a1'.repeat(32), asn: 'AS2516', signalHashes: signals }),
            record('bad', { fpHash: 'b'.repeat(64), subnetHash: 'a1'.repeat(32), asn: 'AS2516', signalHashes: signals })
        ],
        riskKicks: [{ userId: 'bad', ts: NOW, source: 'raid', reason: 'raid' }]
    });
    const combinedResult = evaluateGraphPropagation(combined, 'target');
    assert.equal(combinedResult.total, 5);
    assert.equal(combinedResult.flagged, true);
    assert.deepEqual(combinedResult.topTypes, ['fuzzy', 'subnet']);
});

test('watch danger points mark a bad node, but dismissed entries do not', () => {
    const entry = (overrides: Partial<WatchUserEntry>): WatchUserEntry => ({
        reason: 'test',
        signals: [],
        since: new Date(NOW).toISOString(),
        source: 'join',
        nameSnapshot: 'bad',
        accountCreatedAt: new Date(NOW - 1000).toISOString(),
        avatarHash: 'shared-avatar',
        normalizedName: 'sharedname',
        dismissed: null,
        dangerPoints: [{ ts: NOW, points: 3 }],
        ...overrides
    });
    const graph = buildAltGraph({
        watchEntries: [
            { userId: 'bad', entry: entry({}) }
        ],
        webAuthRecords: [],
        riskKicks: []
    });
    assert.equal(graph.nodes.get('bad')?.bad, true);
    assert.deepEqual(graph.nodes.get('bad')?.badTags, ['watch-danger-points']);

    const dismissed = buildAltGraph({
        watchEntries: [
            { userId: 'bad', entry: entry({ dismissed: 'bad' }) }
        ]
    });
    assert.equal(dismissed.nodes.get('bad'), undefined);

    // No danger points means "watched" but not bad yet.
    const zeroPoints = buildAltGraph({
        watchEntries: [{ userId: 'bad', entry: entry({ dangerPoints: [] }) }]
    });
    assert.equal(zeroPoints.nodes.get('bad')?.bad, false);
});

test('a target that is already bad never flags itself', () => {
    const graph = buildAltGraph({
        webAuthRecords: [
            createWebAuthRecord({
                guildId: 'guild', userId: 'target', source: 'web',
                browser: { name: 'chrome', reason: 'ok' },
                intel: { verdict: 'clean', flags: [], source: 'ip-api.com' },
                ipHash: null, fpHash: 'f'.repeat(64), sealed: null, now: NOW
            })
        ],
        riskKicks: [{ userId: 'target', ts: NOW, source: 'raid', reason: 'raid' }]
    });
    assert.equal(graph.edges.some((edge) => edge.a === edge.b), false);
    const result = evaluateGraphPropagation(graph, 'target');
    assert.equal(result.targetBad, true);
    assert.equal(result.flagged, false);
    assert.equal(result.total, 0);
});

test('multiple WebAuth records per user are compared pairwise', () => {
    const record = (userId: string, fpHash: string, signalHashes: any) => createWebAuthRecord({
        guildId: 'guild', userId, source: 'web',
        browser: { name: 'chrome', reason: 'ok' },
        intel: { verdict: 'clean', flags: [], source: 'ip-api.com' },
        ipHash: null, fpHash, signalHashes, sealed: null, now: NOW
    });
    const graph = buildAltGraph({
        webAuthRecords: [
            record('target', 'a'.repeat(64), signals),
            record('target', 'a'.repeat(64), signals),
            record('bad', 'b'.repeat(64), signals)
        ],
        riskKicks: [{ userId: 'bad', ts: NOW, source: 'raid', reason: 'raid' }]
    });
    const result = evaluateGraphPropagation(graph, 'target');
    assert.deepEqual(result.topTypes, ['fuzzy']);
    assert.equal(result.flagged, false); // 3 < 5, one fuzzy edge per pair
});

test('every edge type has a staff-facing label', () => {
    for (const type of ['ip', 'fp', 'fuzzy', 'subnet', 'avatar', 'creation', 'name'] as const) {
        assert.ok(ALT_GRAPH_EDGE_LABELS[type]);
    }
});
