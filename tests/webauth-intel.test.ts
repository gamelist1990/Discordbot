import test from 'node:test';
import assert from 'node:assert/strict';
import {
    IP_INTEL_FAILURE_TTL_MS,
    IP_INTEL_SOURCE,
    IpIntelClient,
    isPrivateOrLocalIp,
    mapIpApiResponse
} from '../src/core/webauth/ipIntel.ts';

test('verdict mapping: clean, proxy, hosting, blocked, unavailable', () => {
    const now = 1_700_000_000_000;
    assert.deepEqual(mapIpApiResponse({ status: 'success' }, now), {
        verdict: 'clean', flags: [], source: IP_INTEL_SOURCE, checkedAt: now, cached: false
    });
    assert.deepEqual(mapIpApiResponse({ status: 'success', proxy: true }, now), {
        verdict: 'blocked', flags: ['proxy'], source: IP_INTEL_SOURCE, checkedAt: now,
        cached: false, detail: 'flagged-proxy'
    });
    assert.deepEqual(mapIpApiResponse({ status: 'success', hosting: true }, now), {
        verdict: 'blocked', flags: ['hosting'], source: IP_INTEL_SOURCE, checkedAt: now,
        cached: false, detail: 'flagged-hosting'
    });
    assert.deepEqual(mapIpApiResponse({ status: 'success', proxy: true, hosting: true }, now).flags, ['proxy', 'hosting']);
    assert.equal(mapIpApiResponse({ status: 'fail', message: 'private range' }, now).verdict, 'unavailable');
    assert.equal(mapIpApiResponse({ status: 'fail' }, now).detail, 'api-fail');
    assert.equal(mapIpApiResponse(null, now).verdict, 'unavailable');
});

test('private, loopback and invalid addresses never reach the network', async () => {
    let calls = 0;
    const client = new IpIntelClient({
        fetchImpl: (async () => { calls += 1; throw new Error('should not fetch'); }) as any
    });
    for (const ip of ['10.0.0.5', '192.168.1.1', '172.16.0.1', '127.0.0.1', '::1', 'fd00::1', 'not-an-ip']) {
        assert.equal(isPrivateOrLocalIp(ip), true, ip);
        const result = await client.lookup(ip);
        assert.equal(result.verdict, 'unavailable');
        assert.equal(result.detail, 'private-ip');
    }
    assert.equal(calls, 0);
    assert.equal(isPrivateOrLocalIp('203.0.113.10'), false);
    assert.equal(isPrivateOrLocalIp('2001:db8::1'), false);
});

test('a lookup is cached for 24 h and returns cached=true', async () => {
    let calls = 0;
    let clock = 1_700_000_000_000;
    const client = new IpIntelClient({
        now: () => clock,
        fetchImpl: (async (url: string) => {
            calls += 1;
            assert.match(url, /fields=status,message,query,proxy,hosting,mobile/);
            return new Response(JSON.stringify({ status: 'success', proxy: false, hosting: false }), { status: 200 });
        }) as any
    });
    const first = await client.lookup('203.0.113.10');
    assert.equal(first.verdict, 'clean');
    assert.equal(first.cached, false);
    const second = await client.lookup('::ffff:203.0.113.10');
    assert.equal(second.verdict, 'clean');
    assert.equal(second.cached, true);
    assert.equal(calls, 1);

    clock += 24 * 60 * 60 * 1000 - 1;
    assert.equal((await client.lookup('203.0.113.10')).cached, true);
    assert.equal(calls, 1);

    clock += 1;
    await client.lookup('203.0.113.10');
    assert.equal(calls, 2);
});

test('failures are cached briefly, then retried', async () => {
    let calls = 0;
    let clock = 1_700_000_000_000;
    const client = new IpIntelClient({
        now: () => clock,
        fetchImpl: (async () => {
            calls += 1;
            throw new Error('network down');
        }) as any
    });
    const first = await client.lookup('203.0.113.20');
    assert.equal(first.verdict, 'unavailable');
    assert.equal(first.detail, 'lookup-failed');
    assert.equal(calls, 1);

    clock += IP_INTEL_FAILURE_TTL_MS - 1;
    assert.equal((await client.lookup('203.0.113.20')).cached, true);
    assert.equal(calls, 1);

    clock += 1;
    await client.lookup('203.0.113.20');
    assert.equal(calls, 2);
});

test('HTTP failures map to unavailable without throwing', async () => {
    const client = new IpIntelClient({
        fetchImpl: (async () => new Response('rate limited', { status: 429 })) as any
    });
    const result = await client.lookup('203.0.113.30');
    assert.equal(result.verdict, 'unavailable');
    assert.equal(result.detail, 'http-429');
});
