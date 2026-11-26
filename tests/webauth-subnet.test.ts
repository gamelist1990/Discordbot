import test from 'node:test';
import assert from 'node:assert/strict';
import {
    expandIpv6Groups,
    hashIp,
    hashSubnet,
    subnetPrefixForIp
} from '../src/core/webauth/fingerprint.ts';
import { mapIpApiResponse } from '../src/core/webauth/ipIntel.ts';
import { createWebAuthRecord } from '../src/core/webauth/records.ts';

const SECRET = Buffer.alloc(32, 31);
const NOW = 1_700_000_000_000;

test('IPv4 subnet derivation keeps the /24 prefix and ignores the host octet', () => {
    assert.equal(subnetPrefixForIp('203.0.113.10'), '203.0.113.0/24');
    assert.equal(subnetPrefixForIp('203.0.113.250'), '203.0.113.0/24');
    assert.notEqual(subnetPrefixForIp('203.0.113.10'), subnetPrefixForIp('203.0.114.10'));
    // IPv4-mapped IPv6 normalizes to the same /24.
    assert.equal(subnetPrefixForIp('::ffff:203.0.113.10'), '203.0.113.0/24');
    assert.equal(subnetPrefixForIp(''), '');
    assert.equal(subnetPrefixForIp('not-an-ip'), '');
});

test('IPv6 subnet derivation uses the /48 prefix for compressed and full forms', () => {
    assert.equal(expandIpv6Groups('2001:db8:abcd:12::1')?.length, 8);
    assert.equal(subnetPrefixForIp('2001:db8:abcd:12::1'), '2001:0db8:abcd::/48');
    assert.equal(subnetPrefixForIp('2001:0DB8:ABCD:0012:0:0:0:1'), '2001:0db8:abcd::/48');
    assert.equal(subnetPrefixForIp('2001:db8:abcd:ffff::1'), '2001:0db8:abcd::/48');
    assert.notEqual(subnetPrefixForIp('2001:db8:abcd::1'), subnetPrefixForIp('2001:db8:abce::1'));
    assert.equal(subnetPrefixForIp('::1'), '0000:0000:0000::/48');
});

test('subnet hashes are deterministic and independent from the full IP hash', () => {
    const one = hashSubnet(SECRET, '203.0.113.10');
    assert.match(one, /^[0-9a-f]{64}$/);
    assert.equal(hashSubnet(SECRET, '203.0.113.10'), one);
    assert.equal(hashSubnet(SECRET, '203.0.113.99'), one);
    assert.notEqual(hashSubnet(SECRET, '203.0.114.10'), one);
    assert.notEqual(hashSubnet(Buffer.alloc(32, 32), '203.0.113.10'), one);
    assert.notEqual(one, hashIp(SECRET, '203.0.113.10'));
    assert.equal(hashSubnet(SECRET, 'bad'), '');
});

test('ip-api ASN is captured as plain text and failures leave it absent', () => {
    const clean = mapIpApiResponse({
        status: 'success',
        as: 'AS2516 KDDI CORPORATION',
        proxy: false,
        hosting: false
    }, NOW);
    assert.equal(clean.verdict, 'clean');
    assert.equal(clean.asn, 'AS2516 KDDI CORPORATION');

    const unavailable = mapIpApiResponse({ status: 'fail', message: 'private range' }, NOW);
    assert.equal(unavailable.verdict, 'unavailable');
    assert.equal(unavailable.asn, undefined);
});

test('records store and validate signalHashes, ASN and subnetHash', () => {
    const signalHashes = { canvas: 'a'.repeat(64), webgl: 'b'.repeat(64) };
    const record = createWebAuthRecord({
        guildId: 'guild',
        userId: 'user',
        source: 'web',
        browser: { name: 'chrome', reason: 'ok' },
        intel: { verdict: 'clean', flags: [], source: 'ip-api.com' },
        ipHash: null,
        fpHash: null,
        signalHashes: { ...signalHashes, screen: 'not-a-hash' } as any,
        asn: 'AS2516 KDDI CORPORATION',
        subnetHash: 'c'.repeat(64),
        sealed: null,
        now: NOW
    });
    assert.deepEqual(record.signalHashes, signalHashes);
    assert.equal(record.asn, 'AS2516 KDDI CORPORATION');
    assert.equal(record.subnetHash, 'c'.repeat(64));

    const invalid = createWebAuthRecord({
        guildId: 'guild',
        userId: 'user',
        source: 'web',
        browser: { name: 'chrome', reason: 'ok' },
        intel: { verdict: 'clean', flags: [], source: 'ip-api.com' },
        ipHash: null,
        fpHash: null,
        signalHashes: { canvas: 'x' } as any,
        asn: '   ',
        subnetHash: 'zzz',
        sealed: null,
        now: NOW
    });
    assert.equal(invalid.signalHashes, null);
    assert.equal(invalid.asn, null);
    assert.equal(invalid.subnetHash, null);
});
