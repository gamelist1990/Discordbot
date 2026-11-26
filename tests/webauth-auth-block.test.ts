import test from 'node:test';
import assert from 'node:assert/strict';
import {
    evaluateWebAuthBlock,
    readWebAuthBlockSettings,
    WEB_AUTH_BLOCK_RULE_LABELS
} from '../src/core/webauth/authBlock.ts';
import { createWebAuthRecord } from '../src/core/webauth/records.ts';
import { DEFAULT_ALT_GRAPH_SETTINGS, type WatchUserEntry } from '../src/core/anticheat/types.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import type { RiskKickEntry } from '../src/core/anticheat/RiskKicks.ts';
import type { FingerprintSignalHashes } from '../src/core/webauth/types.ts';

const GUILD = 'guild-block';
/** Any 64-char hex value is a valid stored HMAC hash. */
const H = (char: string) => char.repeat(64);

const SIGNAL_HASHES: FingerprintSignalHashes = {
    canvas: H('1'),
    webgl: H('2'),
    screen: H('3'),
    platform: H('4'),
    locale: H('5'),
    hardware: H('6')
};

function record(userId: string, overrides: Record<string, unknown> = {}) {
    return createWebAuthRecord({
        guildId: GUILD,
        userId,
        source: 'web',
        browser: { name: 'chrome', reason: 'ok' },
        intel: { verdict: 'clean', flags: [], source: 'ip-api.com' },
        ipHash: null,
        fpHash: null,
        sealed: null,
        ...overrides
    } as any);
}

function kick(userId: string, source: RiskKickEntry['source'] = 'raid'): RiskKickEntry {
    return { userId, ts: Date.now(), source, reason: 'test' };
}

function watchEntry(overrides: Partial<WatchUserEntry> = {}): WatchUserEntry {
    return {
        reason: 'new-account',
        signals: ['new-account'],
        since: new Date().toISOString(),
        source: 'join',
        nameSnapshot: '',
        dismissed: null,
        ...overrides
    };
}

const watched = (userId: string, entry: WatchUserEntry = watchEntry()) => ({ userId, entry });

test('an exact device-fingerprint match to a kicked user blocks', () => {
    const candidate = record('new-user', { fpHash: H('f') });
    const peer = record('kicked-peer', { fpHash: H('f') });

    const decision = evaluateWebAuthBlock({
        record: candidate,
        records: [peer],
        riskKicks: [kick('kicked-peer')],
        // Isolate rule 1: an exact match is also a graph edge, so the graph
        // rule is switched off for this assertion.
        settings: { graph: false }
    });

    assert.equal(decision.blocked, true);
    assert.deepEqual(decision.rules, ['exact']);
    assert.equal(decision.matches.length, 1);
    assert.equal(decision.matches[0].userId, 'kicked-peer');
    assert.deepEqual(decision.matches[0].badTags, ['raid-kick']);
});

test('an exact IP match to a kicked user blocks (also for a watch-danger kick)', () => {
    const candidate = record('new-user', { ipHash: H('a') });
    const peer = record('kicked-peer', { ipHash: H('a') });

    const decision = evaluateWebAuthBlock({
        record: candidate,
        records: [peer],
        riskKicks: [kick('kicked-peer', 'watch-danger')],
        settings: { graph: false }
    });

    assert.equal(decision.blocked, true);
    assert.deepEqual(decision.rules, ['exact']);
    assert.deepEqual(decision.matches[0].badTags, ['watch-danger-kick']);
});

test('a fuzzy fingerprint match at the 4A threshold against a kicked user blocks', () => {
    // canvas changed only: 9/12 observed weight = 0.75, exactly at threshold.
    const candidate = record('new-user', { signalHashes: { ...SIGNAL_HASHES, canvas: H('9') } });
    const peer = record('kicked-peer', { signalHashes: SIGNAL_HASHES });

    const decision = evaluateWebAuthBlock({
        record: candidate,
        records: [peer],
        riskKicks: [kick('kicked-peer')]
    });

    assert.equal(decision.blocked, true);
    assert.deepEqual(decision.rules, ['fuzzy']);
    assert.equal(decision.fpScore, 0.75);
});

test('a legacy stored record still blocks a full new candidate at the auth point', () => {
    // The stored peer predates brief 9: six groups, no schema marker.
    const peer = record('kicked-peer', { signalHashes: SIGNAL_HASHES });
    const candidate = record('new-user', {
        signalSchema: 2,
        signalHashes: {
            ...SIGNAL_HASHES,
            audio: H('a'),
            fonts: H('b'),
            webgl2: H('c'),
            display: H('d')
        }
    });

    const decision = evaluateWebAuthBlock({
        record: candidate,
        records: [peer],
        riskKicks: [kick('kicked-peer')],
        settings: { graph: false }
    });

    assert.equal(decision.blocked, true);
    assert.deepEqual(decision.rules, ['fuzzy']);
    assert.ok(decision.fpScore >= 0.75, 'the legacy peer cannot deflate the score to 12/18');
});

test('a fuzzy score below the threshold does not block', () => {
    // canvas + webgl changed: 6/12 = 0.50, below 0.75.
    const candidate = record('new-user', {
        signalHashes: { ...SIGNAL_HASHES, canvas: H('8'), webgl: H('9') }
    });
    const peer = record('kicked-peer', { signalHashes: SIGNAL_HASHES });

    const decision = evaluateWebAuthBlock({
        record: candidate,
        records: [peer],
        riskKicks: [kick('kicked-peer')]
    });

    assert.equal(decision.blocked, false);
    assert.deepEqual(decision.rules, []);
});

test('graph weight at the propagation threshold toward a bad node blocks', () => {
    // subnet+ASN 2 + same avatar 2 + same normalized name 1 = 5.
    const candidate = record('new-user', { subnetHash: H('a'), asn: 'AS2516' });
    const bad = record('bad-user', { subnetHash: H('a'), asn: 'AS2516' });
    const entries = [
        watched('new-user', watchEntry({ nameSnapshot: 'raid alt', avatarHash: H('9') })),
        watched('bad-user', watchEntry({ nameSnapshot: 'raid alt', avatarHash: H('9') }))
    ];

    const decision = evaluateWebAuthBlock({
        record: candidate,
        records: [bad],
        riskKicks: [kick('bad-user')],
        watchEntries: entries
    });

    assert.equal(decision.blocked, true);
    assert.deepEqual(decision.rules, ['graph']);
    assert.equal(decision.graphScore, 5);
    assert.equal(decision.graphThreshold, 5);
    assert.equal(decision.matches[0].userId, 'bad-user');
});

test('graph weight below the threshold does not block', () => {
    // subnet+ASN 2 + avatar 2 = 4 < 5 (no name edge: names differ).
    const candidate = record('new-user', { subnetHash: H('a'), asn: 'AS2516' });
    const bad = record('bad-user', { subnetHash: H('a'), asn: 'AS2516' });

    const decision = evaluateWebAuthBlock({
        record: candidate,
        records: [bad],
        riskKicks: [kick('bad-user')],
        watchEntries: [
            watched('new-user', watchEntry({ nameSnapshot: 'first name', avatarHash: H('9') })),
            watched('bad-user', watchEntry({ nameSnapshot: 'second name', avatarHash: H('9') }))
        ]
    });

    assert.equal(decision.blocked, false);
    assert.equal(decision.graphScore, 0);
});

test('a mere watch flag on the user (no bad match) never blocks', () => {
    const candidate = record('watched-user', { ipHash: H('b') });
    const decision = evaluateWebAuthBlock({
        record: candidate,
        watchEntries: [
            watched('watched-user', watchEntry({
                reason: 'graph',
                signals: ['graph'],
                source: 'graph',
                dangerPoints: [{ ts: Date.now(), points: 5 }]
            }))
        ]
    });

    // The target is a bad node itself: the graph never counts its own record,
    // and there is no kicked account to match, so auth proceeds.
    assert.equal(decision.blocked, false);
    assert.deepEqual(decision.rules, []);
});

test('a match to a merely flagged (not kicked) user does not block by rules 1-2', () => {
    const candidate = record('new-user', { ipHash: H('a') });
    const peer = record('flagged-peer', { ipHash: H('a') });

    const decision = evaluateWebAuthBlock({
        record: candidate,
        records: [peer],
        watchEntries: [
            watched('flagged-peer', watchEntry({ dangerPoints: [{ ts: Date.now(), points: 3 }] }))
        ],
        // Rules 1–2 are the subject here; the graph edge is a separate rule.
        settings: { exact: true, fuzzy: true, graph: false }
    });

    assert.equal(decision.blocked, false);
    assert.deepEqual(decision.rules, []);
    assert.equal(decision.correlation.length, 1, 'the correlation still reports the match');
});

test('a kicked member re-joining with the same account is blocked by their own record', () => {
    const previous = record('kicked-user', {
        ipHash: H('a'),
        fpHash: H('f'),
        signalHashes: SIGNAL_HASHES
    });
    const returning = record('kicked-user', {
        ipHash: H('a'),
        fpHash: H('f'),
        signalHashes: SIGNAL_HASHES
    });

    const decision = evaluateWebAuthBlock({
        record: returning,
        records: [previous],
        riskKicks: [kick('kicked-user')],
        settings: { graph: false }
    });

    assert.equal(decision.blocked, true);
    assert.deepEqual(decision.rules, ['exact']);
    assert.deepEqual(decision.matches.map((match) => match.userId), ['kicked-user']);
});

test('a clean user passes with no rules hit', () => {
    const candidate = record('clean-user', { ipHash: H('c'), fpHash: H('c'), signalHashes: SIGNAL_HASHES });
    const peer = record('other-user', { ipHash: H('d'), fpHash: H('d') });

    const decision = evaluateWebAuthBlock({
        record: candidate,
        records: [peer],
        riskKicks: [kick('kicked-elsewhere')]
    });

    assert.equal(decision.blocked, false);
    assert.deepEqual(decision.rules, []);
    assert.deepEqual(decision.matches, []);
});

test('each rule can be disabled by its own setting', () => {
    // exact: legacy records without component hashes (fuzzy not comparable).
    const exactCandidate = record('new-user', { fpHash: H('e') });
    const exactPeer = record('kicked-peer', { fpHash: H('e') });
    const exactInput = {
        record: exactCandidate,
        records: [exactPeer],
        riskKicks: [kick('kicked-peer')]
    };
    assert.equal(evaluateWebAuthBlock({ ...exactInput, settings: { exact: true, graph: false } }).blocked, true);
    assert.equal(evaluateWebAuthBlock({ ...exactInput, settings: { exact: false, graph: false } }).blocked, false);

    // fuzzy: only the component score connects the two devices.
    const fuzzyCandidate = record('new-user', { signalHashes: { ...SIGNAL_HASHES, canvas: H('9') } });
    const fuzzyPeer = record('kicked-peer', { signalHashes: SIGNAL_HASHES });
    const fuzzyInput = {
        record: fuzzyCandidate,
        records: [fuzzyPeer],
        riskKicks: [kick('kicked-peer')]
    };
    assert.equal(evaluateWebAuthBlock({ ...fuzzyInput, settings: { exact: true, fuzzy: true } }).blocked, true);
    assert.equal(evaluateWebAuthBlock({ ...fuzzyInput, settings: { exact: true, fuzzy: false } }).blocked, false);

    // graph: subnet + avatar + name only, no IP/FP/fuzzy edge.
    const graphCandidate = record('new-user', { subnetHash: H('a'), asn: 'AS2516' });
    const graphBad = record('bad-user', { subnetHash: H('a'), asn: 'AS2516' });
    const graphInput = {
        record: graphCandidate,
        records: [graphBad],
        riskKicks: [kick('bad-user')],
        watchEntries: [
            watched('new-user', watchEntry({ nameSnapshot: 'raid alt', avatarHash: H('9') })),
            watched('bad-user', watchEntry({ nameSnapshot: 'raid alt', avatarHash: H('9') }))
        ]
    };
    assert.equal(evaluateWebAuthBlock({ ...graphInput, settings: { graph: true } }).blocked, true);
    assert.equal(evaluateWebAuthBlock({ ...graphInput, settings: { graph: false } }).blocked, false);
    // A disabled alt-graph softens the graph rule too.
    assert.equal(evaluateWebAuthBlock({
        ...graphInput,
        settings: { graph: true },
        altGraph: { ...DEFAULT_ALT_GRAPH_SETTINGS, enabled: false }
    }).blocked, false);
});

test('block settings default to ON and are read per rule', () => {
    assert.deepEqual(readWebAuthBlockSettings(null), { automation: true, exact: true, fuzzy: true, graph: true });
    assert.deepEqual(readWebAuthBlockSettings({ fuzzy: false }), { automation: true, exact: true, fuzzy: false, graph: true });
    assert.deepEqual(readWebAuthBlockSettings({ exact: 0, graph: 'off', automation: false }), { automation: false, exact: false, fuzzy: true, graph: false });
});

test('rule labels are the staff-facing names only', () => {
    assert.deepEqual(Object.keys(WEB_AUTH_BLOCK_RULE_LABELS).sort(), ['automation', 'exact', 'fuzzy', 'graph']);
    for (const label of Object.values(WEB_AUTH_BLOCK_RULE_LABELS)) {
        assert.equal(/[0-9a-f]{16,}/.test(label), false);
    }
});

test('the block log is one embed with the user, guild, rules and matched account', async () => {
    const manager = new AntiCheatManager();
    const settings = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
    settings.logChannelId = 'log-channel';
    manager.getSettings = async () => settings;

    const sent: any[] = [];
    (manager as any).fetchLogChannel = async () => ({
        send: async (payload: any) => { sent.push(payload); return null; }
    });
    const member = (id: string, tag: string) => ({
        id,
        displayName: tag,
        user: { id, tag, username: tag, bot: false }
    });
    const members = new Map([
        ['target', member('target', 'newbie#0002')],
        ['bad-user', member('bad-user', 'bad#0001')]
    ]);
    const guild: any = {
        id: 'guild-block',
        name: 'Test Guild',
        members: { cache: members, fetch: async (id: string) => members.get(id) ?? null }
    };
    (manager as any).client = {
        guilds: { cache: new Map([['guild-block', guild]]), fetch: async () => guild }
    };

    await manager.sendWebAuthBlockLog('guild-block', 'target', {
        blocked: true,
        rules: ['exact', 'graph'],
        matches: [{ userId: 'bad-user', rules: ['exact', 'graph'], badTags: ['raid-kick'] }],
        correlation: [],
        fpScore: 0,
        graphScore: 5,
        graphThreshold: 5
    });

    assert.equal(sent.length, 1, 'exactly one embed per block');
    const embed = sent[0].embeds[0];
    assert.match(embed.data.title, /Web認証をブロック/);
    const fields = Object.fromEntries(embed.data.fields.map((field: any) => [field.name, field.value]));
    assert.match(fields['ユーザー'], /newbie#0002/);
    assert.match(fields['ユーザー'], /target/);
    assert.match(fields['サーバー'], /Test Guild/);
    assert.match(fields['判定ルール'], /IP・端末の完全一致/);
    assert.match(fields['判定ルール'], /相関グラフの危険アカウント連結/);
    assert.match(fields['一致したアカウント'], /bad#0001 \(bad-user\)/);
    assert.match(fields['一致したアカウント'], /AntiRaidでキック済み/);
    assert.equal(/[0-9a-f]{32,}/.test(JSON.stringify(embed.data)), false, 'no hash appears in the log');
});
