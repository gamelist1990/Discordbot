import test from 'node:test';
import assert from 'node:assert/strict';
import {
    WEBAUTH_MAX_RECORDS,
    WEBAUTH_RECORD_TTL_MS,
    correlateWebAuthRecord,
    createWebAuthRecord,
    normalizeWebAuthRecords,
    pruneWebAuthRecords,
    withWebAuthMatchCounts
} from '../src/core/webauth/records.ts';
import {
    RISK_KICK_MAX,
    RISK_KICK_TTL_MS,
    addRiskKicks,
    pruneRiskKicks
} from '../src/core/anticheat/RiskKicks.ts';

const NOW = 1_700_000_000_000;
const IP_A = 'a'.repeat(64);
const IP_B = 'b'.repeat(64);
const FP_A = 'c'.repeat(64);
const FP_B = 'd'.repeat(64);

function record(overrides: Record<string, unknown> = {}) {
    return createWebAuthRecord({
        guildId: 'guild',
        userId: 'user-1',
        source: 'web',
        browser: { name: 'chrome', reason: 'ok' },
        intel: { verdict: 'clean', flags: [], source: 'ip-api.com' },
        ipHash: IP_A,
        fpHash: FP_A,
        sealed: 'ab'.repeat(40),
        now: NOW,
        ...overrides
    } as any);
}

test('record creation validates hashes and sealed form', () => {
    const valid = record();
    assert.equal(valid.ipHash, IP_A);
    assert.equal(valid.fpHash, FP_A);
    assert.equal(valid.sealed?.length, 80);
    assert.equal(valid.verified, true);

    const invalid = record({ ipHash: 'not-a-hash', fpHash: 'xyz', sealed: 'zz' });
    assert.equal(invalid.ipHash, null);
    assert.equal(invalid.fpHash, null);
    assert.equal(invalid.sealed, null);
});

test('staff records carry the override verdicts', () => {
    const staff = record({
        source: 'staff',
        browser: { name: null, reason: 'staff' },
        intel: { verdict: 'staff', flags: [], source: 'staff' },
        ipHash: null,
        fpHash: null,
        sealed: null,
        note: 'VPN誤検知'
    });
    assert.equal(staff.source, 'staff');
    assert.equal(staff.browser.reason, 'staff');
    assert.equal(staff.intel.verdict, 'staff');
    assert.equal(staff.note, 'VPN誤検知');
});

test('records are pruned by age and bounded per guild', () => {
    const old = record({ userId: 'old', createdAt: new Date(NOW - WEBAUTH_RECORD_TTL_MS - 1).toISOString() });
    const fresh = record({ userId: 'fresh', createdAt: new Date(NOW - 1000).toISOString() });
    assert.deepEqual(pruneWebAuthRecords([old, fresh], NOW).map((entry) => entry.userId), ['fresh']);

    const many = [...Array(WEBAUTH_MAX_RECORDS + 5)].map((_, index) => record({
        userId: `u${index}`,
        createdAt: new Date(NOW - (WEBAUTH_MAX_RECORDS + 5 - index) * 1000).toISOString()
    }));
    const pruned = pruneWebAuthRecords(many, NOW);
    assert.equal(pruned.length, WEBAUTH_MAX_RECORDS);
    assert.equal(pruned[pruned.length - 1].userId, `u${WEBAUTH_MAX_RECORDS + 4}`);
});

test('normalization accepts a document or a bare array and drops malformed rows', () => {
    const fresh = record({ createdAt: new Date(NOW - 1000).toISOString() });
    assert.deepEqual(
        normalizeWebAuthRecords({ version: 1, records: [fresh, { userId: 'broken' }] }, NOW).map((entry) => entry.id),
        [fresh.id]
    );
    assert.equal(normalizeWebAuthRecords([fresh], NOW).length, 1);
    assert.equal(normalizeWebAuthRecords(null, NOW).length, 0);
});

test('correlation matches IP and fingerprint hashes per distinct user', () => {
    const target = record({ userId: 'new', ipHash: IP_A, fpHash: FP_A });
    const others = [
        record({ userId: 'same-both', ipHash: IP_A, fpHash: FP_A }),
        record({ userId: 'same-ip', ipHash: IP_A, fpHash: FP_B }),
        record({ userId: 'same-fp', ipHash: IP_B, fpHash: FP_A }),
        record({ userId: 'same-ip', ipHash: IP_A, fpHash: FP_B }),
        record({ userId: 'none', ipHash: IP_B, fpHash: FP_B }),
        record({ userId: 'new', ipHash: IP_A, fpHash: FP_A })
    ];
    const { matches, matchCount } = correlateWebAuthRecord([target, ...others], target);
    assert.equal(matchCount, 3);
    assert.deepEqual(matches.map((match) => match.userId).sort(), ['same-both', 'same-fp', 'same-ip']);
    assert.deepEqual(matches.find((match) => match.userId === 'same-both')?.hashTypes, ['ip', 'fp']);
    assert.deepEqual(matches.find((match) => match.userId === 'same-ip')?.hashTypes, ['ip']);
    assert.equal(matches.find((match) => match.userId === 'same-ip')?.hashCount, 2);
});

test('other guilds and null hashes never match', () => {
    const target = record({ userId: 'new', ipHash: null, fpHash: null });
    const other = record({ userId: 'other', guildId: 'other-guild', ipHash: IP_A, fpHash: FP_A });
    assert.equal(correlateWebAuthRecord([target, other], target).matchCount, 0);
    assert.equal(withWebAuthMatchCounts([target, other])[0].matchCount, 0);
});

test('staff views include the 同一IP/端末アカウント数 count', () => {
    const target = record({ userId: 'new' });
    const peer = record({ userId: 'peer' });
    const views = withWebAuthMatchCounts([target, peer]);
    const targetView = views.find((entry) => entry.userId === 'new');
    assert.equal(targetView?.matchCount, 1);
    assert.deepEqual(targetView?.matchedUserIds, ['peer']);
});

test('risk kick ledger prunes by age, deduplicates and is bounded', () => {
    const stale = [{ userId: 'old', ts: NOW - RISK_KICK_TTL_MS - 1, source: 'raid', reason: '' }];
    assert.deepEqual(pruneRiskKicks(stale, NOW), []);

    const added = addRiskKicks([], ['a', 'b', 'a'], 'raid', 'raid-kick', NOW);
    assert.deepEqual(added.map((entry) => entry.userId), ['a', 'b']);
    assert.equal(added[0].source, 'raid');

    const replaced = addRiskKicks(added, ['a'], 'watch-danger', 'watch', NOW + 1);
    assert.equal(replaced.find((entry) => entry.userId === 'a')?.source, 'watch-danger');

    const many = [...Array(RISK_KICK_MAX + 10)].map((_, index) => ({
        userId: `u${index}`, ts: NOW, source: 'raid' as const, reason: ''
    }));
    assert.equal(pruneRiskKicks(many, NOW).length, RISK_KICK_MAX);
});
