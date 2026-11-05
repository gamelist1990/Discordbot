import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';
import { MentionSpamDetector } from '../src/core/anticheat/detectors/MentionSpamDetector.ts';
import { MentionLimitDetector } from '../src/core/anticheat/detectors/MentionLimitDetector.ts';
import { CacheManager } from '../src/utils/CacheManager.ts';
import { database } from '../src/core/persistence/Database.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();
const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function promptly<T>(task: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
        return await Promise.race([task, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Realtime processing waited for a blocked task')), 1000);
        })]);
    } finally { clearTimeout(timer!); }
}

function setup(names = ['mentionSpam']) {
    CacheManager.clear();
    const manager = new AntiCheatManager();
    const settings = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
    settings.enabled = true;
    for (const [name, value] of Object.entries(settings.detectors)) value.enabled = names.includes(name);
    manager.getSettings = async () => settings;
    manager.setSettings = async () => {};
    (manager as any).deleteRecentMessages = async () => 0;
    const deleted: string[] = [];
    const build = (id: string, content: string, overrides: Record<string, any> = {}): any => ({
        id, content, createdTimestamp: Date.now(), editedTimestamp: null, partial: false,
        attachments: new Collection(), embeds: [], channelId: 'channel',
        guild: { id: 'guild', channels: { cache: new Map() }, members: { me: null } },
        author: { id: 'author', bot: false }, channel: { id: 'channel' },
        mentions: { roles: new Collection([['134039019352', {}]]), users: new Collection() },
        delete: async () => { deleted.push(id); }, ...overrides
    });
    return { manager, settings, deleted, build };
}

function context(settings: typeof DEFAULT_ANTICHEAT_SETTINGS, receivedAt = 1000, overrides = {}) {
    return { settings, guildId: 'guild', userId: 'author', channelId: 'channel', receivedAt, ...overrides };
}

test('screenshot: six occurrences of one role are detected even when Discord has one unique role', async () => {
    const { manager, build, deleted, settings } = setup();
    let fetches = 0;
    await manager.onMessage(build('six', '<@&134039019352>\n'.repeat(6), {
        fetch: async () => { fetches++; throw new Error('Realtime rules must not fetch'); }
    }));
    assert.deepEqual(deleted, ['six']);
    assert.equal(fetches, 0);
    const log = settings.recentLogs[0];
    assert.equal(log.detector, 'mentionSpam');
    assert.equal(log.metadata?.roleMentionCount, 6);
    assert.equal(log.metadata?.repeatedRoleMentions, 6);
    assert.equal(log.metadata?.processingLane, 'realtime');
});

test('screenshot: 1 + 2 + 4 role mentions across channels are counted while an earlier AI request is blocked', async () => {
    const { manager, build, settings, deleted } = setup(['mentionSpam', 'contentSafety']);
    const entered = deferred(), gate = deferred();
    manager.registerDetector({ name: 'contentSafety', detect: async () => {
        entered.resolve(); await gate.promise; return { scoreDelta: 0, reasons: [] };
    } });
    const first = manager.onMessage(build('one', '<@&134039019352>'));
    await entered.promise;
    const second = manager.onMessage(build('two', '<@&134039019352>\n'.repeat(2), { channel: { id: 'other' } }));
    try {
        await promptly(manager.onMessage(build('four', '<@&134039019352>\n'.repeat(4))));
        assert.deepEqual(deleted, ['four']);
        assert.equal(settings.recentLogs[0].metadata?.windowRoleMentions, 7);
    } finally { gate.resolve(); await Promise.all([first, second]); }
});

test('all messages in a sub-150ms burst are evaluated and handled', async () => {
    const { manager, build, settings, deleted } = setup();
    settings.detectors.mentionSpam.config!.roleMentionThreshold = 1;
    await Promise.all(Array.from({ length: 20 }, (_, i) => manager.onMessage(build(`burst-${i}`, '<@&1>'))));
    assert.equal(deleted.length, 20);
    assert.equal(settings.recentLogs.length, 20);
});

test('a blocked delete or notification cannot hold the next message in the realtime lane', async () => {
    const { manager, build, settings, deleted } = setup();
    const gate = deferred(), entered = deferred();
    settings.detectors.mentionSpam.config!.roleMentionThreshold = 1;
    (manager as any).sendDetectionSummary = async () => gate.promise;
    const first = manager.onMessage(build('blocked-delete', '<@&1>', {
        delete: async () => { entered.resolve(); await gate.promise; }
    }));
    await entered.promise;
    try {
        await promptly(manager.onMessage(build('next', '<@&1>')));
        assert.deepEqual(deleted, ['next']);
    } finally { gate.resolve(); await first; }
});

test('a stalled media/URL detector does not delay another detector on the same message or the next post', async () => {
    const { manager, build, deleted } = setup(['mentionSpam', 'redirectLink', 'gifFlash']);
    const gate = deferred(), entered = deferred(), gifEntered = deferred();
    manager.registerDetector({ name: 'redirectLink', detect: async () => {
        entered.resolve(); await gate.promise; return { scoreDelta: 0, reasons: [] };
    } });
    manager.registerDetector({ name: 'gifFlash', detect: async () => {
        gifEntered.resolve(); return { scoreDelta: 0, reasons: [] };
    } });
    const first = manager.onMessage(build('url', 'https://example.com'));
    await entered.promise;
    try {
        await promptly(gifEntered.promise);
        await promptly(manager.onMessage(build('spam', '<@&1>'.repeat(6))));
        assert.deepEqual(deleted, ['spam']);
    } finally { gate.resolve(); await first; }
});

test('message edits run mention rules with chat logging disabled', async () => {
    const { manager, build, deleted } = setup();
    const original = build('edit', 'hello');
    await manager.onMessage(original);
    await manager.onMessageUpdate(original, build('edit', '<@&1>\n'.repeat(6), { editedTimestamp: Date.now() }));
    assert.deepEqual(deleted, ['edit']);
});

test('duplicate gateway events do not repeat stateless rules, deletion, scoring or logging', async () => {
    const { manager, build, settings, deleted } = setup(['maxLines']);
    let evaluations = 0;
    manager.registerDetector({ name: 'maxLines', detect: async () => {
        evaluations++; return { scoreDelta: 2, reasons: ['too many lines'], deleteMessage: true };
    } });
    const post = build('same', 'spam');
    await Promise.all([manager.onMessage(post), manager.onMessage(post), manager.onMessage(post)]);
    await manager.onMessage(post);
    assert.equal(evaluations, 1);
    assert.deepEqual(deleted, ['same']);
    assert.equal(settings.userTrust.author.score, 2);
    assert.equal(settings.recentLogs.length, 1);
});

test('a stale AI result cannot punish an edited harmless message', async () => {
    const { manager, build, settings, deleted } = setup(['contentSafety']);
    const gate = deferred(), entered = deferred();
    manager.registerDetector({ name: 'contentSafety', detect: async post => {
        if (post.content === 'old') {
            entered.resolve(); await gate.promise;
            return { scoreDelta: 5, reasons: ['old result'], deleteMessage: true };
        }
        return { scoreDelta: 0, reasons: [] };
    } });
    const old = build('edited-during-ai', 'old');
    const first = manager.onMessage(old);
    await entered.promise;
    const edit = manager.onMessageUpdate(old, build(old.id, 'safe', { editedTimestamp: 123 }));
    gate.resolve();
    await Promise.all([first, edit]);
    assert.deepEqual(deleted, []);
    assert.equal(settings.recentLogs.length, 0);
    assert.equal(settings.userTrust.author, undefined);
});

test('the received content is pinned before waiting for settings', async () => {
    const { manager, build, settings, deleted } = setup();
    const gate = deferred();
    manager.getSettings = async () => { await gate.promise; return settings; };
    const post = build('mutated-cache', '<@&1>'.repeat(6));
    const task = manager.onMessage(post);
    post.content = 'cache mutated';
    gate.resolve();
    await task;
    assert.deepEqual(deleted, ['mutated-cache']);
    assert.equal(settings.recentLogs[0].metadata?.roleMentionCount, 6);
});

test('rolling mentions expire exactly at the boundary and histories stay isolated', async () => {
    const { settings, build } = setup();
    settings.detectors.mentionSpam.config!.roleMentionThreshold = 2;
    const detector = new MentionSpamDetector();
    await detector.detect(build('first', '<@&1>'), context(settings, 1000));
    assert.deepEqual((await detector.detect(build('boundary', '<@&1>'), context(settings, 31000))).reasons, []);
    assert.deepEqual((await detector.detect(build('other-user', '<@&1>'), context(settings, 31001, { userId: 'other' }))).reasons, []);
    assert.deepEqual((await detector.detect(build('other-guild', '<@&1>'), context(settings, 31001, { guildId: 'other' }))).reasons, []);
    assert.equal((await detector.detect(build('within', '<@&1>'), context(settings, 31001))).deleteMessage, true);
});

test('edits replace mention contributions and removing mentions clears their counters', async () => {
    const { settings, build } = setup();
    settings.detectors.mentionSpam.config!.roleMentionThreshold = 3;
    const detector = new MentionSpamDetector(), ctx = context(settings);
    await detector.detect(build('edit', '<@&1>'.repeat(2)), ctx);
    assert.deepEqual((await detector.detect(build('edit', '<@&1>'.repeat(2)), ctx)).reasons, []);
    await detector.detect(build('edit', 'removed'), ctx);
    assert.deepEqual((await detector.detect(build('new', '<@&1>'), ctx)).reasons, []);
});

test('mention limits count repeated occurrences instead of unique targets and ignore reply metadata', async () => {
    const { settings, build } = setup();
    settings.detectors.mentionLimit.config = { maxUserMentions: 2, maxRoleMentions: 2 };
    const detector = new MentionLimitDetector(), ctx = context(settings);
    const result = await detector.detect(build('limit', '<@&1>'.repeat(3) + '<@!2>'.repeat(3)), ctx);
    assert.equal(result.metadata?.roleMentionCount, 3);
    assert.equal(result.metadata?.userMentionCount, 3);
    assert.equal(result.deleteMessage, true);
    assert.deepEqual((await detector.detect(build('reply', 'normal reply'), ctx)).reasons, []);
});

test('roles, channels, per-detector exclusions, disabled AC and bots retain their bypass settings', async () => {
    const { manager, build, settings, deleted } = setup();
    const spam = '<@&1>'.repeat(6);
    settings.excludedRoles = ['staff'];
    await manager.onMessage(build('staff', spam, { member: { roles: { cache: new Map([['staff', {}]]) } } }));
    settings.excludedChannels = ['parent'];
    await manager.onMessage(build('thread', spam, { channel: { id: 'thread', parentId: 'parent' } }));
    settings.excludedChannels = [];
    settings.channelDetectorExclusions = { channel: ['mentionSpam'] };
    await manager.onMessage(build('detector-excluded', spam));
    settings.channelDetectorExclusions = {};
    settings.enabled = false;
    await manager.onMessage(build('disabled', spam));
    settings.enabled = true;
    await manager.onMessage(build('bot', spam, { author: { id: 'bot', bot: true } }));
    assert.deepEqual(deleted, []);
});

test('Unknown Message during immediate DELETE produces no score, log or notice', async () => {
    const { manager, build, settings } = setup();
    await manager.onMessage(build('already-gone', '<@&1>'.repeat(6), {
        delete: async () => { throw Object.assign(new Error('Unknown Message'), { code: 10008 }); }
    }));
    assert.equal(settings.recentLogs.length, 0);
    assert.equal(settings.userTrust.author, undefined);
});

test('permission failures remain visible in detection logs', async () => {
    const { manager, build, settings } = setup();
    await manager.onMessage(build('forbidden', '<@&1>'.repeat(6), {
        delete: async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); }
    }));
    assert.equal(settings.recentLogs[0].metadata?.deletedMessage, false);
    assert.match(settings.recentLogs[0].metadata?.deleteError, /Missing Permissions/);
});

test('concurrent deletions preserve every score and log when cached settings are normalized between commits', async () => {
    const { manager, build, settings } = setup();
    (manager as any).settingsCache.set('guild', settings);
    manager.getSettings = async () => (manager as any).settingsCache.get('guild');
    manager.setSettings = async (_guild, next) => {
        (manager as any).settingsCache.set('guild', (manager as any).normalizeSettings(next));
    };
    const gate = deferred(), entered = deferred();
    const first = manager.onMessage(build('slow-delete', '<@&1>'.repeat(6), {
        delete: async () => { entered.resolve(); await gate.promise; }
    }));
    await entered.promise;
    await manager.onMessage(build('fast-delete', '<@&1>'.repeat(6)));
    gate.resolve(); await first;
    const latest = await manager.getSettings('guild');
    assert.deepEqual(latest.recentLogs.map(log => log.messageId).sort(), ['fast-delete', 'slow-delete']);
    assert.equal(latest.userTrust.author.score, latest.recentLogs.reduce((sum, log) => sum + log.scoreDelta, 0));
});

test('burst cleanup is coalesced into one scan per author while each offending post is deleted', async () => {
    const { manager, build, deleted } = setup();
    const gate = deferred();
    let scans = 0;
    (manager as any).deleteRecentMessages = async () => { scans++; await gate.promise; return 0; };
    try {
        await Promise.all(Array.from({ length: 10 }, (_, i) => manager.onMessage(build(`cleanup-${i}`, '<@&1>'.repeat(6)))));
        assert.equal(deleted.length, 10);
        assert.equal(scans, 1);
    } finally { gate.resolve(); await tick(); }
});

test('automatic timeouts reuse cached members and coalesce a burst without waiting for audit channels', async () => {
    const { manager, build, settings, deleted } = setup();
    settings.autoTimeout.enabled = true;
    settings.logChannelId = 'slow-audit';
    (manager as any).sendDetectionSummary = async () => {};
    (manager as any).fetchLogChannel = async () => { throw new Error('Containment must not fetch audit channels'); };
    const gate = deferred();
    let timeouts = 0;
    const member: any = {
        id: 'author', moderatable: true,
        user: { id: 'author', username: 'Author', tag: 'Author' },
        communicationDisabledUntilTimestamp: null,
        timeout: async () => {
            timeouts++; await gate.promise;
            member.communicationDisabledUntilTimestamp = Date.now() + 600_000;
        }
    };
    const guild = { id: 'guild', members: { cache: new Map([['author', member]]),
        fetch: async () => { throw new Error('Member already cached'); } } };
    try {
        await Promise.all(Array.from({ length: 10 }, (_, i) => manager.onMessage(build(`timeout-${i}`, '<@&1>'.repeat(6), { guild }))));
        assert.equal(timeouts, 1);
        assert.equal(deleted.length, 10);
        gate.resolve(); await tick();
        await manager.onMessage(build('already-timed-out', '<@&1>'.repeat(6), { guild }));
        await tick();
        assert.equal(timeouts, 1);
        assert.equal(settings.recentLogs[0].metadata?.isTimedOut, true);
    } finally { gate.resolve(); await tick(); }
});

test('settings writes coalesce while retaining the latest state and never overlap', async () => {
    const manager = new AntiCheatManager();
    const settings = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
    const original = database.set;
    const gate = deferred(), entered = deferred();
    const saved: number[] = [];
    let active = 0;
    database.set = async (_guild, _key, data: any) => {
        active++;
        assert.equal(active, 1);
        saved.push(data.autoTimeout.durationSeconds);
        if (saved.length === 1) { entered.resolve(); await gate.promise; }
        active--;
    };
    try {
        const first = manager.setSettings('coalesced-test', settings);
        await entered.promise;
        const updates = Array.from({ length: 100 }, (_, i) => manager.setSettings('coalesced-test', {
            ...settings, autoTimeout: { ...settings.autoTimeout, durationSeconds: i + 1 }
        }));
        gate.resolve(); await Promise.all([first, ...updates]);
        assert.deepEqual(saved, [600, 100]);
        assert.equal((manager as any).settingsWriteQueues.size, 0);
        assert.equal((manager as any).dirtySettings.size, 0);
    } finally { gate.resolve(); database.set = original; }
});

test('evicting the duplicate-event cache never drops a pending realtime evaluation', async () => {
    const { manager, build, deleted, settings } = setup();
    const gate = deferred();
    manager.getSettings = async () => { await gate.promise; return settings; };
    const first = manager.onMessage(build('must-still-run', '<@&1>'.repeat(6)));
    const versions = (manager as any).messageVersions;
    for (let i = 0; i < 9999; i++) versions.set(`old-${i}`, { revision: '', timestamp: 0, current: true, task: Promise.resolve(false) });
    const next = manager.onMessage(build('new-arrival', '<@&1>'.repeat(6)));
    assert.equal(versions.has('must-still-run'), false);
    gate.resolve(); await Promise.all([first, next]);
    assert.deepEqual(deleted.sort(), ['must-still-run', 'new-arrival']);
});
