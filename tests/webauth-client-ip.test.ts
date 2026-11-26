import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientIp } from '../src/web/middleware/clientIp.ts';

test('a public socket peer is the client; forwarded headers are ignored', () => {
    const resolved = resolveClientIp({
        socketAddress: '198.51.100.7',
        forwardedFor: '1.2.3.4'
    });
    assert.equal(resolved.trustedProxy, false);
    assert.equal(resolved.clientIp, '198.51.100.7');
    assert.equal(resolved.source, 'socket');
});

test('a private/loopback proxy hop makes X-Forwarded-For authoritative', () => {
    const resolved = resolveClientIp({
        socketAddress: '::ffff:10.0.0.225',
        forwardedFor: '203.0.113.10'
    });
    assert.equal(resolved.socketIp, '10.0.0.225');
    assert.equal(resolved.clientIp, '203.0.113.10');
    assert.equal(resolved.trustedProxy, true);
    assert.equal(resolved.source, 'x-forwarded-for');
    assert.equal(resolved.chain[0], '203.0.113.10');
});

test('right-to-left walk ignores private hops and spoofed non-IP prefixes', () => {
    assert.equal(resolveClientIp({
        socketAddress: '10.0.0.97',
        forwardedFor: '203.0.113.10, 10.0.0.5'
    }).clientIp, '203.0.113.10');

    assert.equal(resolveClientIp({
        socketAddress: '127.0.0.1',
        forwardedFor: 'evil.example, 203.0.113.11, 10.0.0.5'
    }).clientIp, '203.0.113.11');
});

test('all-private chains keep the leftmost client entry', () => {
    assert.equal(resolveClientIp({
        socketAddress: '10.0.0.97',
        forwardedFor: '10.1.2.3, 10.0.0.5'
    }).clientIp, '10.1.2.3');
});

test('X-Real-IP is used when X-Forwarded-For is absent', () => {
    const resolved = resolveClientIp({
        socketAddress: '10.0.0.97',
        realIp: '203.0.113.12'
    });
    assert.equal(resolved.clientIp, '203.0.113.12');
    assert.equal(resolved.source, 'x-real-ip');
});

test('IPv6 and bracketed values are normalized', () => {
    const resolved = resolveClientIp({
        socketAddress: '10.0.0.97',
        forwardedFor: '[2001:db8::5]:443'
    });
    assert.equal(resolved.clientIp, '2001:db8::5');
});

test('an unusable socket address yields an empty client IP', () => {
    const resolved = resolveClientIp({ socketAddress: undefined });
    assert.equal(resolved.socketIp, '');
    assert.equal(resolved.clientIp, '');
    assert.equal(resolved.trustedProxy, false);
});
