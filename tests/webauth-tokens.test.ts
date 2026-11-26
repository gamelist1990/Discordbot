import test from 'node:test';
import assert from 'node:assert/strict';
import {
    WebAuthTokenStore,
    WEBAUTH_TOKEN_TTL_MS,
    createTokenValue,
    hashWebAuthToken,
    isWellFormedWebAuthToken
} from '../src/core/webauth/tokens.ts';

function deterministicStore() {
    let clock = 1_700_000_000_000;
    let counter = 0;
    const store = new WebAuthTokenStore(
        () => clock,
        () => Buffer.alloc(32, ++counter)
    );
    return {
        store,
        advance: (ms: number) => { clock += ms; },
        now: () => clock
    };
}

test('token value is URL-safe and has >= 128 bits of entropy', () => {
    const token = createTokenValue(() => Buffer.from('a'.repeat(32)));
    assert.equal(token.length, 43);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.equal(Buffer.from(token, 'base64url').length, 32);
    assert.equal(isWellFormedWebAuthToken(token), true);
    assert.equal(isWellFormedWebAuthToken('short'), false);
    assert.equal(isWellFormedWebAuthToken('bad token with spaces'), false);
});

test('only the hash is stored and tokens are bound to guild/user/preset roles', () => {
    const { store } = deterministicStore();
    const created = store.create({
        guildId: 'guild-1',
        userId: 'user-1',
        presetId: 'preset-1',
        roleIds: ['role-a', 'role-b']
    });
    const hash = hashWebAuthToken(created.token);
    assert.notEqual(hash, created.token);
    assert.equal(hash.length, 64);

    const peeked = store.peek(created.token);
    assert.equal(peeked.status, 'valid');
    assert.equal(peeked.record?.guildId, 'guild-1');
    assert.equal(peeked.record?.userId, 'user-1');
    assert.equal(peeked.record?.presetId, 'preset-1');
    assert.deepEqual(peeked.record?.roleIds, ['role-a', 'role-b']);
    assert.equal(peeked.record?.expiresAt, created.record.createdAt + WEBAUTH_TOKEN_TTL_MS);
});

test('peek is read-only but expiry is enforced', () => {
    const { store, advance } = deterministicStore();
    const { token } = store.create({ guildId: 'g', userId: 'u' });
    assert.equal(store.peek(token).status, 'valid');
    advance(WEBAUTH_TOKEN_TTL_MS - 1);
    assert.equal(store.peek(token).status, 'valid');
    advance(1);
    assert.equal(store.peek(token).status, 'expired');
    assert.equal(store.peek(token).record, null);
    assert.equal(store.size, 0);
});

test('claim is exclusive, release allows retry, consume is single-use', () => {
    const { store } = deterministicStore();
    const { token } = store.create({ guildId: 'g', userId: 'u' });

    assert.equal(store.claim(token).status, 'valid');
    assert.equal(store.claim(token).status, 'in-use');
    assert.equal(store.claim(token).record, null);

    store.release(token);
    assert.equal(store.claim(token).status, 'valid');

    const consumed = store.consume(token);
    assert.equal(consumed?.userId, 'u');
    assert.equal(store.consume(token), null);
    assert.equal(store.claim(token).status, 'missing');
    assert.equal(store.size, 0);
});

test('expired tokens cannot be claimed or consumed', () => {
    const { store, advance } = deterministicStore();
    const { token } = store.create({ guildId: 'g', userId: 'u' });
    advance(WEBAUTH_TOKEN_TTL_MS);
    assert.equal(store.claim(token).status, 'expired');
    assert.equal(store.consume(token), null);
});

test('unknown and malformed tokens are missing', () => {
    const { store } = deterministicStore();
    assert.equal(store.peek('A'.repeat(43)).status, 'missing');
    assert.equal(store.claim('not-a-token').status, 'missing');
    assert.equal(store.consume('not-a-token'), null);
});

test('prune drops only expired entries', () => {
    const { store, advance } = deterministicStore();
    const first = store.create({ guildId: 'g', userId: 'u1' }).token;
    advance(1000);
    const second = store.create({ guildId: 'g', userId: 'u2' }).token;
    advance(WEBAUTH_TOKEN_TTL_MS - 1000);
    assert.equal(store.peek(first).status, 'expired');
    assert.equal(store.peek(second).status, 'valid');
    store.prune();
    assert.equal(store.size, 1);
});
