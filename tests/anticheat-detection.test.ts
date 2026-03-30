import test from 'node:test';
import assert from 'node:assert/strict';

import { RedirectLinkDetector } from '../src/core/anticheat/detectors/RedirectLinkDetector.ts';
import { TextSpamDetector } from '../src/core/anticheat/detectors/TextSpamDetector.ts';
import { hasMeaningfulDetection } from '../src/core/anticheat/utils.ts';
import { CacheManager } from '../src/utils/CacheManager.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

test('textSpam does not flag a normal message only because deleteMessage is enabled', async () => {
    const detector = new TextSpamDetector();
    const result = await detector.detect(
        {
            id: 'message-1',
            content: 'こんにちは'
        } as any,
        {
            guildId: 'guild-1',
            userId: 'user-1',
            channelId: 'channel-1',
            userTrustScore: 0,
            settings: {
                detectors: {
                    textSpam: {
                        enabled: true,
                        score: 2,
                        deleteMessage: true,
                        notifyChannel: false,
                        config: {
                            windowSeconds: 5,
                            rapidMessageCount: 6,
                            duplicateThreshold: 3,
                            capsRatio: 0.88
                        }
                    }
                }
            }
        } as any
    );

    assert.equal(result.scoreDelta, 0);
    assert.deepEqual(result.reasons, []);
    assert.equal(result.deleteMessage, undefined);
    assert.equal(hasMeaningfulDetection(result), false);
});

test('manager safety guard ignores delete-only results with no detection signal', () => {
    assert.equal(hasMeaningfulDetection({
        scoreDelta: 0,
        reasons: [],
        deleteMessage: true
    }), false);
});

test('duplicate-message style results still count as meaningful when they provide a reason', () => {
    assert.equal(hasMeaningfulDetection({
        scoreDelta: 0,
        reasons: ['重複メッセージを 2 回送信しました'],
        deleteMessage: true
    }), true);
});

function createRedirectContext() {
    return {
        guildId: 'guild-1',
        userId: 'user-1',
        channelId: 'channel-1',
        userTrustScore: 0,
        settings: {
            detectors: {
                redirectLink: {
                    enabled: true,
                    score: 2,
                    deleteMessage: true,
                    notifyChannel: true,
                    config: {
                        allowDomains: [],
                        maxDepth: 5,
                        timeoutMs: 2500
                    }
                }
            }
        }
    } as any;
}

test('redirectLink allows Discord canonical redirects', async (t) => {
    CacheManager.clear();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

        if (url === 'https://discordapp.com/channels/890315487962095637/1391437254160945162') {
            return new Response('', {
                status: 301,
                headers: { location: 'https://discord.com/channels/890315487962095637/1391437254160945162' }
            });
        }

        if (url === 'https://discord.com/channels/890315487962095637/1391437254160945162') {
            return new Response('<html><body>ok</body></html>', {
                status: 200,
                headers: { 'content-type': 'text/html' }
            });
        }

        throw new Error(`Unexpected URL: ${url}`);
    }) as typeof globalThis.fetch;

    t.after(() => {
        globalThis.fetch = originalFetch;
        CacheManager.clear();
    });

    const detector = new RedirectLinkDetector();
    const result = await detector.detect(
        {
            content: 'https://discordapp.com/channels/890315487962095637/1391437254160945162'
        } as any,
        createRedirectContext()
    );

    assert.equal(result.scoreDelta, 0);
    assert.deepEqual(result.reasons, []);
    assert.equal(result.deleteMessage, undefined);
});

test('redirectLink ignores neutral shorteners that resolve to a normal site', async (t) => {
    CacheManager.clear();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

        if (url === 'https://short.example/normal') {
            return new Response('', {
                status: 302,
                headers: { location: 'https://example.com/articles/safe' }
            });
        }

        if (url === 'https://example.com/articles/safe') {
            return new Response('<html><body>safe</body></html>', {
                status: 200,
                headers: { 'content-type': 'text/html' }
            });
        }

        throw new Error(`Unexpected URL: ${url}`);
    }) as typeof globalThis.fetch;

    t.after(() => {
        globalThis.fetch = originalFetch;
        CacheManager.clear();
    });

    const detector = new RedirectLinkDetector();
    const result = await detector.detect(
        {
            content: 'https://short.example/normal'
        } as any,
        createRedirectContext()
    );

    assert.equal(result.scoreDelta, 0);
    assert.deepEqual(result.reasons, []);
    assert.equal(result.deleteMessage, undefined);
});

test('redirectLink blocks chains that pass through IP logger domains', async (t) => {
    CacheManager.clear();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

        if (url === 'https://short.example/logger') {
            return new Response('', {
                status: 302,
                headers: { location: 'https://grabify.link/track?id=abc123' }
            });
        }

        if (url === 'https://grabify.link/track?id=abc123') {
            return new Response('', {
                status: 302,
                headers: { location: 'https://discord.com/channels/890315487962095637/1391437254160945162' }
            });
        }

        if (url === 'https://discord.com/channels/890315487962095637/1391437254160945162') {
            return new Response('<html><body>discord</body></html>', {
                status: 200,
                headers: { 'content-type': 'text/html' }
            });
        }

        throw new Error(`Unexpected URL: ${url}`);
    }) as typeof globalThis.fetch;

    t.after(() => {
        globalThis.fetch = originalFetch;
        CacheManager.clear();
    });

    const detector = new RedirectLinkDetector();
    const result = await detector.detect(
        {
            content: 'https://short.example/logger'
        } as any,
        createRedirectContext()
    );

    assert.equal(result.scoreDelta, 2);
    assert.match(result.reasons[0], /IPロガー/);
    assert.equal(result.deleteMessage, true);
    assert.equal(result.metadata?.suspectUrl, 'https://grabify.link/track?id=abc123');
    assert.equal(result.metadata?.finalUrl, 'https://discord.com/channels/890315487962095637/1391437254160945162');
});
