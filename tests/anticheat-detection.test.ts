import test from 'node:test';
import assert from 'node:assert/strict';

import { antiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';
import { RedirectLinkDetector } from '../src/core/anticheat/detectors/RedirectLinkDetector.ts';
import { TextSpamDetector } from '../src/core/anticheat/detectors/TextSpamDetector.ts';
import { MentionSpamDetector } from '../src/core/anticheat/detectors/MentionSpamDetector.ts';
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

function createMentionSpamContext(overrides: Record<string, any> = {}) {
    return {
        guildId: 'guild-mention-spam',
        userId: 'user-mention-spammer',
        channelId: 'channel-mention-spam',
        userTrustScore: 0,
        settings: {
            detectors: {
                mentionSpam: {
                    enabled: true,
                    score: 2,
                    deleteMessage: true,
                    notifyChannel: false,
                    config: {
                        windowSeconds: 30,
                        sameUserMentionThreshold: 3,
                        roleMentionThreshold: 3,
                        totalMentionThreshold: 6,
                        ...overrides
                    }
                }
            }
        }
    } as any;
}

test('mentionSpam detects repeated mentions to the same user across messages', async (t) => {
    CacheManager.clear();
    t.after(() => CacheManager.clear());

    const detector = new MentionSpamDetector();
    const context = createMentionSpamContext();

    assert.equal((await detector.detect({ id: 'mention-1', content: '<@123>' } as any, context)).scoreDelta, 0);
    assert.equal((await detector.detect({ id: 'mention-2', content: '<@123>' } as any, context)).scoreDelta, 0);

    const result = await detector.detect({ id: 'mention-3', content: '<@123>' } as any, context);
    assert.equal(result.scoreDelta, 2);
    assert.match(result.reasons[0], /同一ユーザー/);
    assert.equal(result.deleteMessage, true);
    assert.equal(result.metadata?.repeatedUserMentions, 3);
});

test('mentionSpam detects role mention bursts', async (t) => {
    CacheManager.clear();
    t.after(() => CacheManager.clear());

    const detector = new MentionSpamDetector();
    const result = await detector.detect(
        { id: 'role-mention-1', content: '<@&1> <@&2> <@&3>' } as any,
        createMentionSpamContext()
    );

    assert.equal(result.scoreDelta, 2);
    assert.match(result.reasons[0], /ロールメンション/);
    assert.equal(result.metadata?.roleMentionCount, 3);
});

test('autoDelete off suppresses detector-driven message deletion', async (t) => {
    const detectorName = 'testAutoDeleteGuard';
    const originalGetSettings = antiCheatManager.getSettings;
    const originalSetSettings = antiCheatManager.setSettings;

    const settings = JSON.parse(JSON.stringify(DEFAULT_ANTICHEAT_SETTINGS)) as typeof DEFAULT_ANTICHEAT_SETTINGS;
    settings.enabled = true;
    settings.autoDelete.enabled = false;
    settings.autoTimeout.enabled = false;
    settings.punishments = [];
    settings.excludedRoles = [];
    settings.excludedChannels = [];
    settings.logChannelId = null;
    settings.avatarLogChannelId = null;
    settings.userTrust = {};
    settings.recentLogs = [];
    settings.detectors = {
        ...settings.detectors,
        [detectorName]: {
            enabled: true,
            score: 1,
            deleteMessage: true,
            notifyChannel: false,
            config: {}
        }
    };

    antiCheatManager.registerDetector({
        name: detectorName,
        detect: async () => ({
            scoreDelta: 1,
            reasons: ['test detection'],
            deleteMessage: true
        })
    });

    (antiCheatManager as any).getSettings = async () => settings;
    (antiCheatManager as any).setSettings = async () => {};

    t.after(() => {
        (antiCheatManager as any).getSettings = originalGetSettings;
        (antiCheatManager as any).setSettings = originalSetSettings;
    });

    let deleteCalls = 0;
    await antiCheatManager.onMessage({
        id: 'message-guard-1',
        content: 'guard check',
        author: {
            id: 'user-guard-1',
            bot: false,
            tag: 'Guard#0001',
            username: 'Guard',
            toString: () => '<@user-guard-1>'
        },
        guild: {
            id: 'guild-guard-1',
            members: {
                me: null
            }
        },
        channel: {
            id: 'channel-guard-1'
        },
        member: {
            permissions: {
                has: () => false
            },
            roles: {
                cache: {
                    has: () => false
                }
            }
        },
        mentions: {
            users: new Map(),
            roles: {
                size: 0,
                some: () => false
            }
        },
        delete: async () => {
            deleteCalls += 1;
        }
    } as any);

    assert.equal(deleteCalls, 0);
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

test('messageUpdate ignores attachment URL-only refreshes', async (t) => {
    const originalGetSettings = antiCheatManager.getSettings;
    const originalSendChatLog = (antiCheatManager as any).sendChatLog;

    const settings = JSON.parse(JSON.stringify(DEFAULT_ANTICHEAT_SETTINGS)) as typeof DEFAULT_ANTICHEAT_SETTINGS;
    settings.chatLogChannelId = 'chat-log-channel';

    (antiCheatManager as any).getSettings = async () => settings;

    let sendChatLogCalls = 0;
    (antiCheatManager as any).sendChatLog = async () => {
        sendChatLogCalls += 1;
    };

    t.after(() => {
        (antiCheatManager as any).getSettings = originalGetSettings;
        (antiCheatManager as any).sendChatLog = originalSendChatLog;
    });

    const author = {
        id: 'user-url-refresh',
        bot: false,
        tag: 'User#0001',
        username: 'User',
        toString: () => '<@user-url-refresh>'
    };

    const oldAttachment = {
        id: 'attachment-1',
        name: 'image.png',
        size: 1234,
        contentType: 'image/png',
        url: 'https://cdn.discordapp.com/attachments/old-url',
        proxyURL: 'https://media.discordapp.net/attachments/old-url'
    };

    const newAttachment = {
        id: 'attachment-1',
        name: 'image.png',
        size: 1234,
        contentType: 'image/png',
        url: 'https://cdn.discordapp.com/attachments/new-url',
        proxyURL: 'https://media.discordapp.net/attachments/new-url'
    };

    await antiCheatManager.onMessageUpdate(
        {
            partial: false,
            id: 'message-url-refresh',
            channelId: 'channel-1',
            content: '',
            attachments: new Map([['attachment-1', oldAttachment]]),
            author,
            guild: {
                id: 'guild-url-refresh'
            }
        } as any,
        {
            partial: false,
            id: 'message-url-refresh',
            channelId: 'channel-1',
            content: '',
            editedTimestamp: 1700000000000,
            attachments: new Map([['attachment-1', newAttachment]]),
            author,
            guild: {
                id: 'guild-url-refresh'
            }
        } as any
    );

    assert.equal(sendChatLogCalls, 0);
});

test('messageUpdate ignores partial cache updates without editedTimestamp', async (t) => {
    const originalGetSettings = antiCheatManager.getSettings;
    const originalSendChatLog = (antiCheatManager as any).sendChatLog;

    const settings = JSON.parse(JSON.stringify(DEFAULT_ANTICHEAT_SETTINGS)) as typeof DEFAULT_ANTICHEAT_SETTINGS;
    settings.chatLogChannelId = 'chat-log-channel';

    (antiCheatManager as any).getSettings = async () => settings;

    let sendChatLogCalls = 0;
    (antiCheatManager as any).sendChatLog = async () => {
        sendChatLogCalls += 1;
    };

    t.after(() => {
        (antiCheatManager as any).getSettings = originalGetSettings;
        (antiCheatManager as any).sendChatLog = originalSendChatLog;
    });

    const author = {
        id: 'user-partial-refresh',
        bot: false,
        tag: 'User#0002',
        username: 'User',
        toString: () => '<@user-partial-refresh>'
    };

    await antiCheatManager.onMessageUpdate(
        {
            partial: true,
            id: 'message-partial-refresh',
            channelId: 'channel-2',
            guild: {
                id: 'guild-partial-refresh'
            }
        } as any,
        {
            partial: false,
            id: 'message-partial-refresh',
            channelId: 'channel-2',
            content: '',
            editedTimestamp: null,
            attachments: new Map([['attachment-2', {
                id: 'attachment-2',
                name: 'photo.jpg',
                size: 2048,
                contentType: 'image/jpeg',
                url: 'https://cdn.discordapp.com/attachments/partial-refresh'
            }]]),
            author,
            guild: {
                id: 'guild-partial-refresh'
            }
        } as any
    );

    assert.equal(sendChatLogCalls, 0);
});
