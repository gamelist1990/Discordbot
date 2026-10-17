import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import config from '../src/config.ts';
import {
    appendPendingOAuthNonce, consumePendingOAuthNonce, createDiscordOAuthState,
    safeOAuthRedirectPath, verifyDiscordOAuthState, OAUTH_STATE_MAX_AGE_MS,
} from '../src/web/services/DiscordOAuthState.ts';
import { createAuthRoutes } from '../src/web/routes/auth.ts';

const SECRET = 'oauth-tests-stable-HMAC-signing-key';
test('state is signed, expiring, and valid across stateless verifier instances', () => {
    const now = Date.now();
    const { state, nonce } = createDiscordOAuthState(SECRET, '123456789012345678', '/staff/ai?view=stats', now);
    assert.equal(verifyDiscordOAuthState(SECRET, state, now).status, 'valid');
    const parsed = verifyDiscordOAuthState(SECRET, state, now + 5000);
    assert.equal(parsed.status, 'valid');
    if (parsed.status === 'valid') {
        assert.equal(parsed.value.redirectPath, '/staff/ai?view=stats');
        assert.equal(parsed.value.nonce, nonce);
    }
    assert.equal(verifyDiscordOAuthState(SECRET, state, now + OAUTH_STATE_MAX_AGE_MS + 1).status, 'expired');
    assert.equal(verifyDiscordOAuthState(SECRET, state, now - 60_000).status, 'invalid');
    const [payload, signature] = state.split('.');
    assert.equal(verifyDiscordOAuthState(SECRET, payload + '.' + ('A' === signature[0] ? 'B' : 'A') + signature.slice(1)).status, 'invalid');
    assert.equal(verifyDiscordOAuthState('wrong-key', state).status, 'invalid');
    assert.equal(verifyDiscordOAuthState(SECRET, 'not-a-signed-state').status, 'invalid');
});

test('only local paths are accepted for post-login return', () => {
    for (const unsafe of ['https://evil.example', '//evil.example', '/\\evil.example', '/%2Fmalicious', '/%5Cmalicious', '', undefined, '/hello\r\nfoo']) {
        assert.equal(safeOAuthRedirectPath(unsafe), '/', String(unsafe));
    }
    assert.equal(safeOAuthRedirectPath('/staff/ai?q=hello'), '/staff/ai?q=hello');
});

test('browser nonces support parallel authorization windows and one-time consumption', () => {
    const one = createDiscordOAuthState(SECRET, 'g', '/');
    const two = createDiscordOAuthState(SECRET, 'g', '/settings');
    const cookies = appendPendingOAuthNonce(appendPendingOAuthNonce('', one.nonce), two.nonce);
    const c1 = consumePendingOAuthNonce(cookies, one.nonce);
    assert.equal(c1.found, true);
    assert.equal(consumePendingOAuthNonce(c1.remaining, one.nonce).found, false);
    assert.equal(consumePendingOAuthNonce(c1.remaining, two.nonce).found, true);
});

function createTestServer() {
    const app = express();
    app.use((req, _res, next) => {
        const cookie: Record<string, string> = {};
        for (const part of (req.headers.cookie || '').split(';')) {
            const pos = part.indexOf('=');
            if (pos > 0) cookie[part.slice(0, pos).trim()] = decodeURIComponent(part.slice(pos + 1).trim());
        }
        (req as any).cookies = cookie;
        next();
    });
    const fakeBot = { getClientId: () => '123456789012345678', getGuildList: () => [] };
    app.use('/api/auth', createAuthRoutes(new Map(), fakeBot as any));
    return app;
}

async function serve(app: ReturnType<typeof createTestServer>) {
    const server = await new Promise<import('node:http').Server>(resolve => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return {
        base: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((resolve, reject) =>
            server.close(err => err ? reject(err) : resolve())),
    };
}

test('Discord cancel redirects to friendly screen, not raw API text', async () => {
    const host = await serve(createTestServer());
    try {
        const login = await fetch(host.base + '/api/auth/discord?redirect=%2Fstaff%2Fai', { redirect: 'manual' });
        assert.equal(login.status, 302);
        const redirect = new URL(login.headers.get('location')!);
        assert.equal(redirect.hostname, 'discord.com');
        const state = redirect.searchParams.get('state');
        assert.ok(state);
        const cookie = login.headers.get('set-cookie')?.split(';')[0];
        assert.ok(cookie?.startsWith('oauthPending='));
        const callback = await fetch(host.base + '/api/auth/callback?error=access_denied&state=' + encodeURIComponent(state), {
            redirect: 'manual', headers: { cookie },
        });
        assert.equal(callback.status, 303);
        assert.match(callback.headers.get('location') || '', /^\/auth\/result\?status=canceled/);
        assert.match(callback.headers.get('location') || '', /redirect=%2Fstaff%2Fai/);
        assert.equal(callback.headers.get('cache-control'), 'no-store');
    } finally {
        await host.close();
    }
});

test('Callback rejects missing browser cookie even with otherwise valid signed state', async () => {
    const host = await serve(createTestServer());
    try {
        const { state } = createDiscordOAuthState(config.DISCORD_CLIENT_SECRET, 'g', '/');
        const callback = await fetch(host.base + '/api/auth/callback?code=fake&state=' + encodeURIComponent(state), {
            redirect: 'manual',
        });
        assert.equal(callback.status, 303);
        assert.match(callback.headers.get('location') || '', /status=invalid/);
    } finally {
        await host.close();
    }
});

test('Server restart does not lose issued OAuth state before exchange', async () => {
    const originalFetch = globalThis.fetch;
    const first = await serve(createTestServer());
    let state = '', cookie = '';
    try {
        const started = await originalFetch(first.base + '/api/auth/discord', { redirect: 'manual' });
        state = new URL(started.headers.get('location')!).searchParams.get('state') || '';
        cookie = started.headers.get('set-cookie')?.split(';')[0] || '';
    } finally {
        await first.close();
    }
    const second = await serve(createTestServer());
    try {
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input) === 'https://discord.com/api/oauth2/token') {
                return Response.json({ error: 'invalid_grant' }, { status: 401 });
            }
            return originalFetch(input, init);
        }) as typeof fetch;
        const callback = await originalFetch(second.base + '/api/auth/callback?code=invalid_code&state=' + encodeURIComponent(state), {
            headers: { cookie }, redirect: 'manual',
        });
        assert.equal(callback.status, 303);
        // State was accepted and OAuth reached Discord; a missing state would
        // return status=invalid before attempting to exchange the code.
        assert.match(callback.headers.get('location') || '', /status=failed/);
    } finally {
        globalThis.fetch = originalFetch;
        await second.close();
    }
});

test('expired and tampered state callback open the recovery page without token exchange', async () => {
    const host = await serve(createTestServer());
    try {
        const expired = createDiscordOAuthState(
            config.DISCORD_CLIENT_SECRET, 'guild', '/staff/ai',
            Date.now() - OAUTH_STATE_MAX_AGE_MS - 2000,
        );
        const cookie = 'oauthPending=' + expired.nonce;
        const expiredResponse = await fetch(
            host.base + '/api/auth/callback?code=unused&state=' + encodeURIComponent(expired.state),
            { redirect: 'manual', headers: { cookie } },
        );
        assert.equal(expiredResponse.status, 303);
        assert.match(expiredResponse.headers.get('location') || '', /status=expired/);

        const modified = expired.state.slice(0, -1) + (expired.state.at(-1) === 'a' ? 'b' : 'a');
        const invalidResponse = await fetch(
            host.base + '/api/auth/callback?code=unused&state=' + encodeURIComponent(modified),
            { redirect: 'manual', headers: { cookie } },
        );
        assert.equal(invalidResponse.status, 303);
        assert.match(invalidResponse.headers.get('location') || '', /status=invalid/);
    } finally {
        await host.close();
    }
});
