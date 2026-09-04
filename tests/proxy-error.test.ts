import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { normalizeProxyError } from '../src/core/ai/normalizeProxyError.ts';

test('gateway rejection preserves status and exposes message to SDK without credentials', async () => {
    const client = new OpenAI({ apiKey: 'secret-key', maxRetries: 0,
        fetch: async () => normalizeProxyError(new Response(JSON.stringify({ detail: 'Model access denied secret-key' }), {
            status: 403, headers: { 'content-type': 'application/json' },
        }), 'secret-key'),
    });
    await assert.rejects(client.responses.create({ model: 'test', input: 'hello' }), (error: any) => {
        assert.equal(error.status, 403);
        assert.match(error.message, /Model access denied/);
        assert.ok(!error.message.includes('secret-key'));
        return true;
    });
});

test('successful streams and standard errors remain untouched', async () => {
    for (const response of [new Response('stream'), new Response(JSON.stringify({ error: { message: 'denied' } }), {
        status: 403, headers: { 'content-type': 'application/json' },
    })]) assert.equal(await normalizeProxyError(response, ''), response);
});

test('unknown error envelopes and mislabeled text expose bounded diagnostics', async () => {
    for (const body of [JSON.stringify({ reason: 'model forbidden', token: 'hidden' }), 'model forbidden']) {
        const result = await normalizeProxyError(new Response(body, { status: 403,
            headers: { 'content-type': 'application/json' } }), 'key');
        const json = await result.json() as any;
        assert.match(json.error.message, /proxy-error-body/);
        assert.match(json.error.message, /model forbidden/);
        assert.ok(!json.error.message.includes('hidden'));
    }
});
