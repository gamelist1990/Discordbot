import test from 'node:test';
import assert from 'node:assert/strict';
import {
    WATCH_BATCH_CREATION_WINDOW_MS,
    WATCH_JOIN_WINDOW_MS,
    WATCH_MIN_NORMALIZED_LENGTH,
    WATCH_POINT_WINDOW_MS,
    isWatchBurst,
    matchWatchSignals,
    normalizeWatchName,
    normalizeWatchUserEntries,
    pruneWatchDangerPoints,
    readWatchJoinRecords,
    readWatchSettings,
    selectWatchPeers,
    watchDangerPointTotal,
    type WatchMatchInput,
    type WatchPeerCandidate
} from '../src/core/anticheat/WatchUsers.ts';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-11-26T12:00:00.000Z');

function input(overrides: Partial<WatchMatchInput> = {}): WatchMatchInput {
    return {
        userId: '100000000000000001',
        username: 'clean_member',
        displayName: 'CleanMember',
        accountCreatedAt: now - 400 * DAY,
        avatarHash: null,
        now,
        newAccountDays: 7,
        peers: [],
        ...overrides
    };
}

test('name-match requires the display name to equal the trimmed username case-insensitively', () => {
    assert.deepEqual(
        matchWatchSignals(input({ username: 'RaidBot', displayName: '  raidbot  ' })),
        ['name-match']
    );
    // A real nickname (different from the handle) is not a match.
    assert.deepEqual(
        matchWatchSignals(input({ username: 'raidbot', displayName: 'Raid Bot' })),
        []
    );
});

test('id-like-name matches digit-only names and the numeric user id', () => {
    assert.deepEqual(
        matchWatchSignals(input({ username: 'x', displayName: '8237461928' })),
        ['id-like-name']
    );
    assert.deepEqual(
        matchWatchSignals(input({ userId: '100000000000000001', username: 'x', displayName: '100000000000000001' })),
        ['id-like-name']
    );
    assert.deepEqual(
        matchWatchSignals(input({ username: 'x', displayName: 'abc123' })),
        []
    );
});

test('new-account matches inside newAccountDays and ages out on its own', () => {
    const fresh = matchWatchSignals(input({
        username: 'x', displayName: 'Nick', accountCreatedAt: now - 6 * DAY
    }));
    assert.deepEqual(fresh, ['new-account']);

    const aged = matchWatchSignals(input({
        username: 'x', displayName: 'Nick', accountCreatedAt: now - 8 * DAY
    }));
    assert.deepEqual(aged, []);
});

test('batch-creation compares creation times against the qualified peer set only', () => {
    const peer = {
        userId: 'peer1',
        normalizedName: 'peer',
        avatarHash: null,
        accountCreatedAt: now - 100 * DAY,
        flagged: false
    };
    const matched = matchWatchSignals(input({
        username: 'x',
        displayName: 'Nick',
        accountCreatedAt: now - 100 * DAY + 5 * 60_000,
        peers: [peer]
    }));
    assert.deepEqual(matched, ['batch-creation']);

    const outsideWindow = matchWatchSignals(input({
        username: 'x',
        displayName: 'Nick',
        accountCreatedAt: now - 100 * DAY + WATCH_BATCH_CREATION_WINDOW_MS + 1000,
        peers: [peer]
    }));
    assert.deepEqual(outsideWindow, []);

    // A clean record with no peers never flags on correlation alone.
    assert.deepEqual(matchWatchSignals(input({ username: 'x', displayName: 'Nick', accountCreatedAt: now })), ['new-account']);
});

test('shared-avatar needs a custom avatar and a matching peer hash', () => {
    const peer = {
        userId: 'peer1', normalizedName: '', avatarHash: 'abc123',
        accountCreatedAt: now - 200 * DAY, flagged: true
    };
    assert.deepEqual(
        matchWatchSignals(input({ username: 'x', displayName: 'Nick', avatarHash: 'abc123', peers: [peer] })),
        ['shared-avatar']
    );
    // Default avatars (null) never match each other.
    assert.deepEqual(
        matchWatchSignals(input({ username: 'x', displayName: 'Nick', avatarHash: null, peers: [{ ...peer, avatarHash: null }] })),
        []
    );
    // The member's own hash is not compared with itself.
    assert.deepEqual(
        matchWatchSignals(input({ userId: 'peer1', username: 'x', displayName: 'Nick', avatarHash: 'abc123', peers: [peer] })),
        []
    );
});

test('similar-name uses normalized names and ignores too-short ones', () => {
    const peer = {
        userId: 'peer1', normalizedName: normalizeWatchName('RaidBot_0042'),
        avatarHash: null, accountCreatedAt: 0, flagged: true
    };
    assert.deepEqual(
        matchWatchSignals(input({ username: 'raidbot123', displayName: 'Nick', peers: [peer] })),
        ['similar-name']
    );
    assert.deepEqual(
        matchWatchSignals(input({ username: 'somethingelse', displayName: 'Nick', peers: [peer] })),
        []
    );

    // Names that normalize to an empty/short stub never compare.
    assert.equal(normalizeWatchName('ab1').length >= WATCH_MIN_NORMALIZED_LENGTH, false);
    const stubPeer = { userId: 'peer2', normalizedName: 'ab', avatarHash: null, accountCreatedAt: 0, flagged: true };
    assert.deepEqual(
        matchWatchSignals(input({ username: 'abc', displayName: 'Nick', peers: [stubPeer] })),
        []
    );
});

test('normalizeWatchName lowercases and strips trailing digits and symbols', () => {
    assert.equal(normalizeWatchName('  RaidBot_0042 '), 'raidbot');
    assert.equal(normalizeWatchName('ユーザー１２３'), 'ユーザー１２３');
    assert.equal(normalizeWatchName(''), '');
    assert.equal(normalizeWatchName('12345'), '12345');
});

test('selectWatchPeers keeps flagged users always and clean joiners only during a burst', () => {
    const candidates: WatchPeerCandidate[] = [
        { userId: 'flag', normalizedName: 'flag', avatarHash: null, accountCreatedAt: 1, flagged: true },
        { userId: 'join', normalizedName: 'join', avatarHash: null, accountCreatedAt: 2, flagged: false, joinedAt: now },
        { userId: 'stale', normalizedName: 'stale', avatarHash: null, accountCreatedAt: 3, flagged: false }
    ];

    assert.deepEqual(selectWatchPeers(candidates, false).map((peer) => peer.userId), ['flag']);
    assert.deepEqual(selectWatchPeers(candidates, true).map((peer) => peer.userId), ['flag', 'join']);
});

test('isWatchBurst requires at least two joins inside the burst window', () => {
    assert.equal(isWatchBurst([{ ts: now }], now), false);
    assert.equal(isWatchBurst([{ ts: now }, { ts: now - 60_000 }], now), true);
    assert.equal(isWatchBurst([{ ts: now }, { ts: now - 11 * 60_000 }], now), false);
});

test('rolling watch points prune anything older than 24 hours', () => {
    const points = pruneWatchDangerPoints([
        { ts: now - 1000, points: 2, detector: 'textSpam' },
        { ts: now - WATCH_POINT_WINDOW_MS - 1, points: 5 },
        { ts: now + 10_000, points: 9 },
        { ts: 'bad', points: 1 }
    ], now);

    assert.deepEqual(points, [{ ts: now - 1000, points: 2, detector: 'textSpam' }]);
    assert.equal(watchDangerPointTotal(points), 2);
    assert.equal(watchDangerPointTotal(null), 0);
});

test('readWatchSettings falls back to the documented defaults and clamps', () => {
    const defaults = readWatchSettings(undefined);
    assert.deepEqual(defaults, {
        enabled: true,
        notifyOnFlag: true,
        newAccountDays: 7,
        kickThresholdPoints: 5,
        autoKickOnDanger: true,
        purgeWindowHours: 24
    });

    const configured = readWatchSettings({
        enabled: 0, notifyOnFlag: false, newAccountDays: 0,
        kickThresholdPoints: -2, autoKickOnDanger: 'off', purgeWindowHours: 3
    });
    assert.equal(configured.enabled, false);
    assert.equal(configured.notifyOnFlag, false);
    assert.equal(configured.newAccountDays, 7);
    assert.equal(configured.kickThresholdPoints, 5);
    assert.equal(configured.autoKickOnDanger, false);
    assert.equal(configured.purgeWindowHours, 3);
});

test('join records are validated and limited to the 24 hour window', () => {
    const records = readWatchJoinRecords([
        { userId: 'fresh', ts: now - 1000, normalizedName: 'fresh', avatarHash: 'h', accountCreatedAt: 5 },
        { userId: 'stale', ts: now - WATCH_JOIN_WINDOW_MS - 1 },
        { userId: '', ts: now },
        { userId: 'future', ts: now + 1000 },
        null
    ], now);

    assert.deepEqual(records, [{
        userId: 'fresh', ts: now - 1000, normalizedName: 'fresh', avatarHash: 'h', accountCreatedAt: 5
    }]);
});

test('normalizeWatchUserEntries drops invalid entries and keeps valid ones', () => {
    const normalized = normalizeWatchUserEntries({
        u1: { reason: 'r', signals: ['name-match'], since: '2026-11-20T00:00:00.000Z', source: 'join', nameSnapshot: 'r' },
        u2: { signals: ['similar-name', 5], since: 1, source: 'bogus', nameSnapshot: 5 },
        u3: null
    });

    assert.deepEqual(Object.keys(normalized), ['u1', 'u2']);
    assert.equal(normalized.u1.signals.length, 1);
    assert.deepEqual(normalized.u2.signals, ['similar-name']);
    assert.equal(normalized.u2.source, 'join');
    assert.equal(normalized.u2.nameSnapshot, '');
});
