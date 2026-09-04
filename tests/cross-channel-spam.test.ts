import test from 'node:test';
import assert from 'node:assert/strict';
import { CrossChannelSpamDetector } from '../src/core/anticheat/detectors/CrossChannelSpamDetector.ts';
import { GifFlashDetector } from '../src/core/anticheat/detectors/GifFlashDetector.ts';
import { downloadAttachment } from '../src/core/anticheat/detectors/MediaSafetyUtils.ts';
import { CacheManager } from '../src/utils/CacheManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();
const detector = new CrossChannelSpamDetector();
const context = (channelId: string, userId = 'user', guildId = 'guild') => ({
    channelId, userId, guildId, settings: structuredClone(DEFAULT_ANTICHEAT_SETTINGS)
});
const message = (id: string, content: string, createdTimestamp = Date.now()) => ({ id, content, createdTimestamp } as any);

test('same user spreading text across channels is detected on second and every subsequent post', async () => {
    CacheManager.clear();
    assert.equal((await detector.detect(message('1', 'ＳＰＡＭ'), context('a'))).deleteMessage, undefined);
    const second = await detector.detect(message('2', 'sp\u200bam'), context('b'));
    assert.equal(second.deleteMessage, true);
    assert.equal(second.metadata?.duplicateCount, 2);
    assert.deepEqual(second.metadata?.duplicateChannelIds, ['a', 'b']);
    assert.equal((await detector.detect(message('3', 'spam'), context('c'))).deleteMessage, true);
});

test('separate guilds, users and single-channel posts do not combine', async () => {
    CacheManager.clear();
    for (const [id, ctx] of [['1', context('a')], ['2', context('a')], ['3', context('b', 'other')], ['4', context('b', 'user', 'other-guild')]] as const) {
        assert.deepEqual((await detector.detect(message(id, 'same'), ctx)).reasons, []);
    }
});

test('varied content and attachment-only posts count toward cross-channel bursts', async () => {
    CacheManager.clear();
    for (let index = 0; index < 6; index++) {
        const result = await detector.detect(message(String(index), index % 2 ? '' : `different ${index}`), context(index % 2 ? 'a' : 'b'));
        assert.equal(Boolean(result.deleteMessage), index === 5);
        if (index === 5) assert.equal(result.metadata?.rapidCount, 6);
    }
});

test('expiry and repeated events do not inflate counts; edits to duplicate content are detected', async () => {
    CacheManager.clear();
    await detector.detect(message('old', 'same', Date.now() - 121000), context('a'));
    assert.deepEqual((await detector.detect(message('1', 'same'), context('b'))).reasons, []);
    assert.deepEqual((await detector.detect(message('1', 'same'), context('b'))).reasons, []);
    await detector.detect(message('2', 'different'), context('a'));
    assert.equal((await detector.detect(message('2', 'same'), context('a'))).deleteMessage, true);
    assert.deepEqual((await detector.detect(message('2', 'same'), context('a'))).reasons, []);
});

test('cross-channel response runs while an earlier AI scan is blocked', async () => {
    CacheManager.clear();
    const manager = new AntiCheatManager();
    const settings = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
    settings.enabled = true;
    for (const [name, config] of Object.entries(settings.detectors)) config.enabled = ['crossChannelSpam', 'contentSafety'].includes(name);
    settings.detectors.crossChannelSpam.score = 0;
    manager.getSettings = async () => settings;
    manager.setSettings = async () => {};
    let started!: () => void;
    const aiStarted = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    const aiGate = new Promise<void>(resolve => { release = resolve; });
    manager.registerDetector({ name: 'contentSafety', detect: async () => {
        started(); await aiGate; return { scoreDelta: 0, reasons: [] };
    } });
    const events: string[] = [];
    const build = (id: string, channelId: string): any => ({ ...message(id, 'spam'),
        guild: { id: 'guild' }, author: { id: 'user', bot: false }, channel: { id: channelId },
        delete: async () => { events.push(id); }
    });
    const first = manager.onMessage(build('1', 'a'));
    await aiStarted;
    try {
        const timeout = AbortSignal.timeout(2000);
        await Promise.race([manager.onMessage(build('2', 'b')), new Promise((_, reject) => timeout.addEventListener('abort', () => reject(new Error('blocked by AI')), { once: true }))]);
        assert.deepEqual(events, ['2']);
        assert.equal(settings.recentLogs[0].detector, 'crossChannelSpam');
    } finally { release(); await first; }
});

test('large flashing GIF is scanned even when legacy MB limit is configured', async () => {
    // Six 1x1 black/white frames with trailing padding exceed the old 8MB cutoff.
    const header = Buffer.from('47494638396101000100800000000000ffffff', 'hex');
    const frames = Array.from({ length: 6 }, (_, i) => Buffer.from(`21f904000a0000002c0000000001000100000202${i % 2 ? '4c' : '44'}0100`, 'hex'));
    const gif = Buffer.concat([header, ...frames, Buffer.from([0x3b]), Buffer.alloc(9 * 1024 * 1024)]);
    const original = globalThis.fetch;
    let downloads = 0;
    globalThis.fetch = (async () => { downloads++; return new Response(gif, { headers: { 'content-type': 'image/gif', 'content-length': String(gif.length) } }); }) as typeof fetch;
    try {
        const attachment = { id: 'gif', name: 'large.gif', contentType: 'image/gif', size: gif.length, url: 'https://cdn.discordapp.com/attachments/test/large.gif' };
        assert.equal(await downloadAttachment(attachment, 8 * 1024 * 1024, 3000), null);
        const ctx = context('a');
        ctx.settings.detectors.gifFlash.config!.maxFileSizeMb = 1;
        const result = await new GifFlashDetector().detect({ attachments: new Map([['gif', attachment]]) } as any, ctx);
        assert.equal(downloads, 1);
        assert.equal(result.deleteMessage, true);
        assert.equal(result.metadata?.frameCount, 6);
    } finally { globalThis.fetch = original; }
});
