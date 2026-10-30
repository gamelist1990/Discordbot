import { lfmResponse } from './fixtures/lfm.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { fetchPublicMedia, isPublicAddress, sampleImageFrames, extractContentUrls } from '../src/core/anticheat/ContentMedia.ts';
import { ContentSafetyDetector, classifyContent, parseContentVerdict, matchingContentCategories, CONTENT_SAFETY_MODEL, CONTENT_SAFETY_PROMPT, normalizeModerationText } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';
import { config } from '../src/config.ts';
import { repostWithSpoilers, spoilerText } from '../src/core/anticheat/ContentRepost.ts';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

const safe = { suggestive: 0, explicit: 0, harassment: 0, hate: 0, threat: 0, violence: 0 };
const context = (config = {}) => ({ settings: { detectors: { contentSafety: { enabled: true, config } } } } as any);
const textMessage = (content: string) => ({ content, attachments: new Collection(), embeds: [] } as any);

// Legacy jev chat-completion tests are superseded by content-safety-routing.test.ts.

test('signed GIF URLs preserve query parameters through bare, angle and Markdown forms', () => {
    const url = 'https://cdn.discordapp.com/attachments/1/2/image.gif?ex=abc&is=def&hm=123&';
    for (const text of [url, `<${url}>`, `||${url}||`, `[GIF](${url})`, `[${url}](${url.replaceAll('&', '\\&')})`]) {
        assert.deepEqual(extractContentUrls(text), [url]);
    }
    assert.deepEqual(extractContentUrls('[link](https://example.org/a(b).gif?token=x%26y)'), ['https://example.org/a(b).gif?token=x%26y']);
});


test('strict JSON parsing rejects refusals, missing scores, strings and out-of-range scores', () => {
    assert.deepEqual(parseContentVerdict('```json\n' + JSON.stringify(safe) + '\n```'), safe);
    for (const response of ['No', '{}', JSON.stringify({ ...safe, suggestive: '0.9' }), JSON.stringify({ ...safe, explicit: 2 })]) {
        assert.throws(() => parseContentVerdict(response));
    }
});


test('SSRF blocks private, link-local, mapped IPv6 and reserved destinations', async () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.2.1', '192.168.1.1', '100.64.0.1', '::1', '::ffff:127.0.0.1', '198.18.0.1']) {
        assert.equal(isPublicAddress(ip), false);
    }
    assert.equal(isPublicAddress('8.8.8.8'), true);
    await assert.rejects(fetchPublicMedia('http://127.0.0.1/secret'));
    await assert.rejects(fetchPublicMedia('file:///etc/passwd'));
    await assert.rejects(fetchPublicMedia('https://user:password@example.com/'));
});


test('GIF sampling preserves native dimensions and decoded pixels in PNG', async () => {
    const gif = await sharp({ create: { width: 900, height: 16, channels: 4, background: { r: 40, g: 80, b: 160, alpha: 0 } } }).gif().toBuffer();
    const frames = await sampleImageFrames(gif);
    assert.ok(frames[0].startsWith('data:image/png;base64,'));
    const bytes = Buffer.from(frames[0].split(',')[1], 'base64');
    assert.equal((await sharp(bytes).metadata()).width, 900);
    assert.deepEqual(await sharp(bytes).ensureAlpha().raw().toBuffer(), await sharp(gif).ensureAlpha().raw().toBuffer());
});


test('image sampling produces real resized JPEG frames', async () => {
    const png = await sharp({ create: { width: 1600, height: 800, channels: 3, background: 'blue' } }).png().toBuffer();
    const frames = await sampleImageFrames(png, 6);
    assert.equal(frames.length, 1);
    const meta = await sharp(Buffer.from(frames[0].split(',')[1], 'base64')).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width, 768);
});


test('spoiler wrapper cannot be closed by user markdown and mentions', () => {
    const result = spoilerText('hello || @everyone \\ || **bold**');
    assert.equal((result.match(/\|\|/g) || []).length, 2);
    assert.ok(!result.includes('@everyone'));
});


test('mild-image threshold is balanced without lowering R18 or threat thresholds', () => {
    const observed = { ...safe, suggestive: 0.65 };
    assert.deepEqual(matchingContentCategories(observed, true), ['suggestive']);
    assert.deepEqual(matchingContentCategories({ ...safe, suggestive: 0.64 }, true), []);
    assert.deepEqual(matchingContentCategories(observed, true, { imageSuggestiveThreshold: 0.7 }), []);
    assert.deepEqual(matchingContentCategories(observed, false), []);
    assert.deepEqual(matchingContentCategories({ ...safe, explicit: 0.2, threat: 0.2 }, true), []);
});


function mockMessage({ failSend = false, failDelete = false, changed = false } = {}) {
    const operations: string[] = [];
    let payload: any;
    const message: any = {
        id: '123', content: 'hidden || text @everyone', editedTimestamp: null, createdAt: new Date(),
        deletable: true, attachments: new Collection(), author: { id: '456', username: 'author' },
        member: { displayName: '投稿者' }, client: { user: {} },
        channel: {
            isSendable: () => true, isThread: () => false,
            permissionsFor: () => new PermissionsBitField(Object.values(PermissionFlagsBits)),
            send: async (value: any) => {
                operations.push('send'); payload = value;
                if (failSend) throw new Error('send failed');
                return { id: '789', delete: async () => { operations.push('rollback'); } };
            }
        },
        fetch: async () => changed ? { ...message, content: 'edited' } : message,
        delete: async () => { operations.push('delete'); if (failDelete) throw new Error('delete failed'); }
    };
    return { message, operations, payload: () => payload };
}


test('repost identifies author, hides media and succeeds before original deletion', async () => {
    const mock = mockMessage();
    await repostWithSpoilers(mock.message, { categories: ['H系'], aiExplanation: '性的なポーズが強調されているため。', files: [{ data: Buffer.from('gif'), name: 'sample.gif' }] });
    assert.deepEqual(mock.operations, ['send', 'delete']);
    assert.deepEqual(mock.payload().allowedMentions.parse, []);
    assert.ok(mock.payload().files[0].name.startsWith('SPOILER_'));
    const embed = mock.payload().embeds[0].toJSON();
    assert.equal(embed.image, undefined);
    assert.ok(embed.author.name.includes('投稿者'));
    assert.ok(embed.fields[0].value.includes('456'));
    assert.equal(embed.fields.find((field: any) => field.name === 'AIの判定理由（参考）')?.value, '性的なポーズが強調されているため。');
});


test('send failure preserves original, deletion failure rolls back, stale content is not replaced', async () => {
    for (const [options, expected] of [
        [{ failSend: true }, ['send']], [{ failDelete: true }, ['send', 'delete', 'rollback']], [{ changed: true }, []]
    ] as const) {
        const mock = mockMessage(options);
        await assert.rejects(repostWithSpoilers(mock.message, { categories: ['H系'], files: [] }));
        assert.deepEqual(mock.operations, expected);
    }
});


test('manager scans consecutive content and edited posts even without chat logging', async () => {
    const manager = new AntiCheatManager();
    const settings = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
    settings.enabled = true;
    for (const detector of Object.values(settings.detectors)) detector.enabled = false;
    settings.detectors.contentSafety.enabled = true;
    settings.chatLogChannelId = null;
    let calls = 0;
    manager.registerDetector({ name: 'contentSafety', detect: async () => { calls++; return { scoreDelta: 0, reasons: [] }; } });
    manager.getSettings = async () => settings;
    const message: any = { ...textMessage('hello'), id: 'first', author: { bot: false, id: 'author' }, guild: { id: 'guild' }, channel: { id: 'channel' }, partial: false };
    await manager.onMessage(message);
    await manager.onMessage({ ...message, id: 'second' });
    await manager.onMessageUpdate(message, { ...message, content: 'edited' });
    assert.equal(calls, 3);
});
