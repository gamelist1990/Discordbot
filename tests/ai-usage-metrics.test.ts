import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { database } from '../src/core/persistence/Database.ts';
import {
    aiCacheHitRate, aiGenerationSpeed, ensureAIUsageMetrics, getAIUsageMetrics,
    getGlobalAIUsageMetrics, recordAIUsage, resetAIUsageMetrics,
} from '../src/core/ai/AIUsageMetrics.ts';
import { chatUsageOf, ChatGPTClient } from '../src/core/ai/ChatGPTClient.ts';

/** database をインメモリ Map に差し替える（staff-ai-memory.test.ts と同じ流儀）。 */
async function withMockDatabase<T>(run: (store: Map<string, unknown>) => Promise<T>): Promise<T> {
    const get = database.get.bind(database), set = database.set.bind(database);
    const store = new Map<string, unknown>();
    (database as any).get = async (guild: string, key: string, fallback: unknown) =>
        store.has(`${guild}/${key}`) ? structuredClone(store.get(`${guild}/${key}`)) : fallback;
    (database as any).set = async (guild: string, key: string, value: unknown) => {
        store.set(`${guild}/${key}`, structuredClone(value));
    };
    try { return await run(store); }
    finally { (database as any).get = get; (database as any).set = set; }
}

test('KVヒット率は cached ÷ 入力 で、取得できない経路は不明（null）として 0% と偽らない', async () => {
    assert.equal(aiCacheHitRate({ cacheHitTokens: 250, cacheInputTokens: 1000 }), 0.25);
    assert.equal(aiCacheHitRate({ cacheHitTokens: 0, cacheInputTokens: 0 }), null);
    await withMockDatabase(async () => {
        await recordAIUsage({ guildId: 'g1', purpose: 'dot-judge', inputTokens: 500, outputTokens: 10 });
        const metrics = await getAIUsageMetrics('g1');
        assert.equal(metrics.cacheInputTokens, 0);
        assert.equal(aiCacheHitRate(metrics), null);
    });
});

test('生成速度は生成時間の分かる出力だけで計算する（prefill を含まない）', async () => {
    assert.equal(aiGenerationSpeed({ timedOutputTokens: 100, generatedSeconds: 2 }), 50);
    assert.equal(aiGenerationSpeed({ timedOutputTokens: 0, generatedSeconds: 0 }), null);
    await withMockDatabase(async () => {
        // 時間の分かる 100 トークンと、分からない 900 トークンを混ぜても速度は 50 のまま。
        await recordAIUsage({ guildId: 'g1', purpose: 'chat-ai', inputTokens: 10, outputTokens: 100, generatedSeconds: 2 });
        await recordAIUsage({ guildId: 'g1', purpose: 'chat-ai', inputTokens: 10, outputTokens: 900 });
        const metrics = await getAIUsageMetrics('g1');
        assert.equal(metrics.outputTokens, 1000);
        assert.equal(metrics.timedOutputTokens, 100);
        assert.equal(aiGenerationSpeed(metrics), 50);
    });
});

test('共通記録: ギルド別と全体へ振り分け、用途別・モデル別にも残る。ギルドなしは全体のみ', async () => {
    await withMockDatabase(async () => {
        await recordAIUsage({ guildId: 'g1', purpose: 'dot-judge', model: 'gemma-4-E4B-it', inputTokens: 1000, outputTokens: 100, cachedTokens: 250, generatedSeconds: 2 });
        await recordAIUsage({ purpose: 'media', model: 'gemma-4-E4B-it', inputTokens: 300, outputTokens: 30, cachedTokens: 0 });
        const guild = await getAIUsageMetrics('g1');
        assert.equal(guild.requests, 1);
        assert.equal(guild.totalTokens, 1100);
        assert.equal(aiCacheHitRate(guild), 0.25);
        assert.equal(guild.byPurpose['dot-judge']?.requests, 1);
        assert.equal(guild.byModel['gemma-4-E4B-it']?.inputTokens, 1000);
        const global = await getGlobalAIUsageMetrics();
        assert.equal(global.requests, 2);
        assert.equal(global.byPurpose['media']?.requests, 1);
        assert.equal((await getAIUsageMetrics('g2')).requests, 0);
    });
});

test('cached は入力を超えて数えない。同時記録でも取りこぼさない', async () => {
    await withMockDatabase(async () => {
        await Promise.all(Array.from({ length: 10 }, () =>
            recordAIUsage({ guildId: 'g1', purpose: 'episode', inputTokens: 100, outputTokens: 10, cachedTokens: 999 })));
        const metrics = await getAIUsageMetrics('g1');
        assert.equal(metrics.requests, 10);
        assert.equal(metrics.cacheHitTokens, 1000);
        assert.equal(aiCacheHitRate(metrics), 1);
    });
});

test('開始日時は最初の記録で決まり、以後は再リセットされない。明示リセットでのみゼロに戻る', async () => {
    await withMockDatabase(async () => {
        const first = await ensureAIUsageMetrics('g1');
        assert.ok(first.startedAt);
        await recordAIUsage({ guildId: 'g1', purpose: 'persona', inputTokens: 10, outputTokens: 5 });
        const after = await ensureAIUsageMetrics('g1');
        assert.equal(after.startedAt, first.startedAt);
        assert.equal(after.requests, 1);
        await resetAIUsageMetrics('g1');
        const reset = await getAIUsageMetrics('g1');
        assert.equal(reset.requests, 0);
        assert.ok(reset.startedAt);
    });
});

test('chatUsageOf: 実測形式（prompt_tokens_details.cached_tokens / timings.predicted_ms）を拾う', () => {
    const usage = chatUsageOf({
        usage: { prompt_tokens: 1221, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 1220 } },
        timings: { predicted_ms: 198.455, predicted_n: 3, predicted_per_second: 10.07 },
    });
    assert.equal(usage.inputTokens, 1221);
    assert.equal(usage.cachedTokens, 1220);
    assert.ok(Math.abs((usage.generatedSeconds ?? 0) - 0.198455) < 1e-9);
    assert.equal(chatUsageOf({ usage: { prompt_tokens: 10, completion_tokens: 2 } }).cachedTokens, null);
});

test('共通層: ChatGPTClient の Chat Completions と Responses の両経路が記録される', async () => {
    await withMockDatabase(async () => {
        const server = http.createServer(async (request, response) => {
            const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
            if (request.url?.endsWith('/chat/completions')) {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(JSON.stringify({
                    id: 'chatcmpl-x', object: 'chat.completion', created: 0, model: 'test-model',
                    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, prompt_tokens_details: { cached_tokens: 400 } },
                    timings: { cache_n: 400, prompt_n: 600, predicted_n: 50, predicted_ms: 2500, predicted_per_second: 20 },
                }));
                return;
            }
            if (request.url?.endsWith('/responses')) {
                response.writeHead(200, { 'content-type': 'text/event-stream' });
                const event = {
                    type: 'response.completed',
                    response: {
                        id: 'resp_x', output: [{ type: 'message', id: 'm1', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
                        usage: { input_tokens: 2000, output_tokens: 80, total_tokens: 2080, input_tokens_details: { cached_tokens: 1500 } },
                    },
                    timings: { cache_n: 1500, prompt_n: 500, predicted_n: 80, predicted_ms: 2000, predicted_per_second: 40 },
                };
                response.end(`data: ${JSON.stringify(event)}\n\n`);
                return;
            }
            response.writeHead(404); response.end();
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address(); assert.ok(address && typeof address !== 'string');
        const endpoint = `http://127.0.0.1:${address.port}`;
        const client = new ChatGPTClient({ apiEndpoint: endpoint, apiKey: 'test', defaultModel: 'test-model' });
        (client as any).resolveModelCandidates = async () => ['test-model'];
        (client as any).resolveAuthCandidates = () => [{ apiEndpoint: endpoint, apiKey: 'test' }];
        try {
            await client.sendMessage([{ role: 'user', content: 'hi' }],
                { model: 'test-model', strictModel: true, usageContext: { guildId: 'gx', purpose: 'dot-judge' } });
            let text = '';
            await client.streamResponse([{ role: 'user', content: 'hi' }], delta => {
                if (delta.type === 'text') text += delta.text;
            }, { model: 'test-model', strictModel: true, usageContext: { guildId: 'gy', purpose: 'chat-ai' } });
            assert.equal(text, 'ok');
            // 記録は fire-and-forget なので少し待ってから検証する。
            await new Promise(resolve => setTimeout(resolve, 100));
            const gx = await getAIUsageMetrics('gx');
            assert.equal(gx.requests, 1);
            assert.equal(gx.inputTokens, 1000);
            assert.equal(aiCacheHitRate(gx), 0.4);
            assert.equal(aiGenerationSpeed(gx), 20);
            const gy = await getAIUsageMetrics('gy');
            assert.equal(gy.requests, 1);
            assert.equal(aiCacheHitRate(gy), 0.75);
            assert.equal(aiGenerationSpeed(gy), 40);
            assert.equal(gy.byPurpose['chat-ai']?.requests, 1);
            assert.equal((await getGlobalAIUsageMetrics()).requests, 2);
        } finally {
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});
