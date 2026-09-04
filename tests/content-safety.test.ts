import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { fetchPublicMedia, isPublicAddress, sampleImageFrames } from '../src/core/anticheat/ContentMedia.ts';
import { ContentSafetyDetector, parseContentVerdict, matchingContentCategories } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';
import { repostWithSpoilers, spoilerText } from '../src/core/anticheat/ContentRepost.ts';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

const safe = { suggestive: 0, explicit: 0, harassment: 0, hate: 0, threat: 0, violence: 0 };
const context = (config = {}) => ({ settings: { detectors: { contentSafety: { enabled: true, config } } } } as any);
const textMessage = (content: string) => ({ content, attachments: new Collection(), embeds: [] } as any);

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

test('image sampling produces real resized JPEG frames', async () => {
    const png = await sharp({ create: { width: 1600, height: 800, channels: 3, background: 'blue' } }).png().toBuffer();
    const frames = await sampleImageFrames(png, 6);
    assert.equal(frames.length, 1);
    const meta = await sharp(Buffer.from(frames[0].split(',')[1], 'base64')).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width, 768);
});

test('text categories, thresholds, disabled categories, cache and API failure', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (_url, options) => {
        calls++;
        const request = JSON.parse(String(options?.body));
        assert.equal(request.model, 'gemma4:e2b-it-qat');
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...safe, suggestive: 0.85 }) } }] }));
    }) as typeof fetch;
    try {
        const detector = new ContentSafetyDetector();
        const message = textMessage('分類用の文章');
        const result = await detector.detect(message, context());
        assert.ok(result.spoilerRepost);
        assert.equal(result.scoreDelta, 0);
        assert.equal(result.deleteMessage, undefined);
        assert.equal((await detector.detect(message, context({ textThreshold: 0.9, textSuggestiveThreshold: 0.9 }))).spoilerRepost, undefined);
        assert.equal((await detector.detect(message, context({ suggestive: 0 }))).spoilerRepost, undefined);
        assert.equal(calls, 1);
        globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
        await assert.rejects(detector.detect(textMessage('different'), context()), /incomplete/);
    } finally { globalThis.fetch = original; }
});

test('spoiler wrapper cannot be closed by user markdown and mentions', () => {
    const result = spoilerText('hello || @everyone \\ || **bold**');
    assert.equal((result.match(/\|\|/g) || []).length, 2);
    assert.ok(!result.includes('@everyone'));
});

test('mild-image threshold flags the observed sample score without lowering R18 or threat thresholds', () => {
    const observed = { ...safe, suggestive: 0.2 };
    assert.deepEqual(matchingContentCategories(observed, true), ['suggestive']);
    assert.deepEqual(matchingContentCategories(observed, true, { imageSuggestiveThreshold: 0.5 }), []);
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
    await repostWithSpoilers(mock.message, { categories: ['H系'], files: [{ data: Buffer.from('gif'), name: 'sample.gif' }] });
    assert.deepEqual(mock.operations, ['send', 'delete']);
    assert.deepEqual(mock.payload().allowedMentions.parse, []);
    assert.ok(mock.payload().files[0].name.startsWith('SPOILER_'));
    const embed = mock.payload().embeds[0].toJSON();
    assert.equal(embed.image, undefined);
    assert.ok(embed.author.name.includes('投稿者'));
    assert.ok(embed.fields[0].value.includes('456'));
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
