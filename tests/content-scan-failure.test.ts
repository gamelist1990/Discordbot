import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { contentFailureReason } from '../src/core/anticheat/ContentScanFailure.ts';
import { ContentSafetyDetector } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';

test('diagnostics retain useful codes without copying response content or credentials', () => {
    assert.equal(contentFailureReason(new Error('Media HTTP 403')), 'Media HTTP 403');
    assert.equal(contentFailureReason(new Error('fetch failed', { cause: { code: 'ECONNRESET' } })), 'ECONNRESET');
    assert.equal(contentFailureReason(new SyntaxError('private response text')), 'Invalid JSON response');
    assert.equal(contentFailureReason(new Error('https://host/image?secret=123 private text')), 'Unrecognized processing error');
});

test('incomplete scans distinguish download, frame extraction and AI failures', async () => {
    const url = 'https://cdn.discordapp.com/image.gif?hm=secret';
    const message = { id: '123', content: url, editedTimestamp: null, attachments: new Map(), embeds: [] } as any;
    const context = { guildId: '456', settings: { detectors: { contentSafety: { enabled: true, config: {} } } } } as any;
    await assert.rejects(new ContentSafetyDetector(async () => { throw new Error('Media HTTP 403'); }).detect(message, context),
        /guild=456 message=123; .*stage=download-or-image-validation.*Media HTTP 403/);
    await assert.rejects(new ContentSafetyDetector(async () => ({ data: Buffer.from('invalid'), type: 'gif', url })).detect(message, context),
        /stage=frame-extraction/);
    const data = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'blue' } }).png().toBuffer();
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response('', { status: 503 }); }) as typeof fetch;
    try {
        const detector = new ContentSafetyDetector(async () => ({ data, type: 'png', url }));
        for (let i = 0; i < 2; i++) {
            await assert.rejects(detector.detect(message, context), error => {
                assert.match(String(error), /stage=ai.*frames=1: Moderation API HTTP 503/);
                assert.ok(!String(error).includes('secret'));
                return true;
            });
        }
        assert.equal(calls, 2, 'failed verdicts must not enter the cache');
    } finally { globalThis.fetch = original; }
});

test('ordinary web pages without preview images are skipped instead of failing the scan', async () => {
    const url = 'https://example.com/page';
    const message = { id: '123', content: url, editedTimestamp: null, attachments: new Map(), embeds: [] } as any;
    const context = { guildId: '456', settings: { detectors: { contentSafety: { enabled: true, config: {} } } } } as any;
    const result = await new ContentSafetyDetector(async () => { throw new Error('No preview image'); }).detect(message, context);
    assert.deepEqual(result.reasons, []);
    assert.equal(result.scoreDelta, 0);
    assert.deepEqual(result.metadata?.errors, []);
});
