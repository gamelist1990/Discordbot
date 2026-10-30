import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { classifyContent } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';
import { buildLfmModerationRequest, LFM3_MODEL, LFM_CATEGORY_RULES } from '../src/core/anticheat/LfmContentClassifier.ts';
import { lfmResponse } from './fixtures/lfm.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('text-only posts go to LFM3 chat completions with a strict JSON schema', async () => {
    const calls: any[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
        calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return lfmResponse({ harassment: 0.67 });
    }) as typeof fetch;
    const verdict = await classifyContent('お前なんか消えろ');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/chat\/completions$/);
    assert.equal(calls[0].body.model, LFM3_MODEL);
    assert.equal(calls[0].body.response_format.type, 'json_schema');
    assert.equal(calls[0].body.messages[1].content, 'お前なんか消えろ');
    assert.equal(verdict.harassment, 0.67);
});

test('images are sent to the same LFM3 model, never to a separate media model', async () => {
    const calls: any[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
        calls.push(JSON.parse(String(init.body)));
        return lfmResponse();
    }) as typeof fetch;
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
    await classifyContent('', [`data:image/png;base64,${png.toString('base64')}`]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, LFM3_MODEL);
    assert.equal(calls[0].messages[1].content.filter((part: any) => part.type === 'image_url').length, 1);
});

test('several frames are merged into one image so the LFM3 context is not exceeded', async () => {
    let body: any;
    globalThis.fetch = (async (_url: any, init: any) => { body = JSON.parse(String(init.body)); return lfmResponse(); }) as typeof fetch;
    const make = async (color: string) => `data:image/png;base64,${(await sharp({ create: { width: 16, height: 16, channels: 3, background: color } }).png().toBuffer()).toString('base64')}`;
    await classifyContent('', [await make('#f00'), await make('#0f0'), await make('#00f')]);
    assert.equal(body.messages[1].content.filter((part: any) => part.type === 'image_url').length, 1);
});

test('a transient gateway error is retried once and a persistent one is not a safe verdict', async () => {
    let attempts = 0;
    globalThis.fetch = (async () => { attempts++; return new Response('{}', { status: 503 }); }) as typeof fetch;
    await assert.rejects(classifyContent('hello'), /Moderation API HTTP 503/);
    assert.equal(attempts, 2);
});

test('custom server rules require a customRuleViolations answer in the schema', () => {
    const request = buildLfmModerationRequest('post', [], 'No spoilers');
    assert.ok(request.response_format.json_schema.schema.required.includes('customRuleViolations'));
    assert.match(String(request.messages[0].content), /No spoilers/);
    assert.deepEqual(Object.keys(LFM_CATEGORY_RULES), ['suggestive', 'explicit', 'harassment', 'hate', 'threat', 'violence']);
});
