import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentVerdictCache, similarityInput, inputSimilarity } from '../src/core/anticheat/ContentVerdictCache.ts';
import { sampleImageFrames, composeFrameSheet } from '../src/core/anticheat/ContentMedia.ts';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AntiCheatController } from '../src/web/controllers/staff/AntiCheatController.ts';
import { antiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
(globalThis as any)._cacheCleanupInterval?.unref?.();
const positive = { suggestive: 1, explicit: 0, harassment: 0, hate: 0, threat: 0, violence: 0 };

test('similar positive text is reused without crossing guilds or contextual guards', async () => {
    const cache = new ContentVerdictCache();
    const input = await similarityInput('A very long repeated message that should have the same meaning across different identical posts!', []);
    const variant = await similarityInput('A very long repeated message that should have the same meaning across different identical posts!!', []);
    cache.set('a', 'first', input, positive, 60000, 0);
    assert.ok(inputSimilarity(input, variant) >= .9);
    assert.equal(cache.get('a', 'variant', variant, .9, () => true)?.cache, 'similar');
    assert.equal(cache.get('b', 'variant', variant, .9, () => true), undefined);
    assert.equal(cache.get('a', 'variant', variant, 2, () => true), undefined);
    assert.equal(cache.get('a', 'variant', variant, .9, () => false), undefined);
    const negated = await similarityInput(String(input.features) + ' not', []);
    assert.equal(inputSimilarity(input, negated), 0);
});

test('clear affects one guild and prevents old in-flight results from repopulating cache', async () => {
    const cache = new ContentVerdictCache();
    const input = await similarityInput('test', []);
    cache.set('a', 'key', input, positive, 60000, 0);
    cache.set('b', 'key', input, positive, 60000, 0);
    assert.equal(cache.clear('a'), 1);
    cache.set('a', 'key', input, positive, 60000, 0);
    assert.equal(cache.get('a', 'key', input, 2, () => true), undefined);
    assert.equal(cache.get('b', 'key', input, 2, () => true)?.cache, 'exact');
    cache.set('a', 'new', input, positive, -1, cache.revision('a'));
    assert.equal(cache.get('a', 'new', input, 2, () => true), undefined);
});

test('cache survives recreation on disk and clear is persisted', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'content-verdict-cache-'));
    const cachePath = path.join(directory, 'cache.json');
    try {
        const input = await similarityInput('persist me', []);
        const first = new ContentVerdictCache(cachePath);
        first.set('guild', 'key', input, positive, 90 * 86400000, first.revision('guild'));
        await first.flush();

        const restored = new ContentVerdictCache(cachePath);
        assert.equal(restored.get('guild', 'key', input, 2, () => true)?.cache, 'exact');
        assert.equal(restored.clear('guild'), 1);
        await restored.flush();

        const cleared = new ContentVerdictCache(cachePath);
        assert.equal(cleared.get('guild', 'key', input, 2, () => true), undefined);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('frame sheet keeps distinct frames in separate cells', async () => {
    const red = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'red' } }).png().toBuffer();
    const blue = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'blue' } }).png().toBuffer();
    const frames = [...await sampleImageFrames(red), ...await sampleImageFrames(blue)];
    const data = Buffer.from((await composeFrameSheet(frames)).split(',')[1], 'base64');
    const meta = await sharp(data).metadata();
    assert.equal(meta.width, 768); assert.equal(meta.height, 408);
    const left = await sharp(data).extract({ left: 150, top: 150, width: 1, height: 1 }).raw().toBuffer();
    const right = await sharp(data).extract({ left: 534, top: 150, width: 1, height: 1 }).raw().toBuffer();
    assert.ok(left[0] > 200 && right[2] > 200);
    const first = await similarityInput('', [frames[0], frames[0]]);
    const changedLater = await similarityInput('', frames);
    assert.ok(inputSimilarity(first, changedLater) < .9);
    assert.equal(inputSimilarity(first, await similarityInput('', [frames[0]])), 0);
});

test('cache clear endpoint denies other guilds and clears only the authorized guild', async () => {
    const controller = new AntiCheatController({} as any);
    const original = antiCheatManager.clearContentCache;
    const cleared: string[] = [];
    antiCheatManager.clearContentCache = (guildId: string) => { cleared.push(guildId); return 4; };
    const responses: any[] = [];
    const res: any = { status: (code: number) => { responses.push(code); return res; }, json: (value: any) => { responses.push(value); } };
    try {
        await controller.clearContentCache({ params: { guildId: 'b' }, session: { guildIds: ['a'] } } as any, res);
        assert.equal(responses[0], 403); assert.deepEqual(cleared, []);
        await controller.clearContentCache({ params: { guildId: 'a' }, session: { guildIds: ['a'] } } as any, res);
        assert.deepEqual(cleared, ['a']); assert.deepEqual(responses.at(-1), { success: true, removed: 4 });
    } finally { antiCheatManager.clearContentCache = original; }
});
