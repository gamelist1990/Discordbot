import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWithQwopus } from '../src/core/anticheat/QwopusContentClassifier.ts';
import type { AiRequestMetrics } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';

test('一時的な502では残り時間内に一度だけ再試行し成功する', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
        calls++;
        return calls === 1
            ? new Response('', { status: 502 })
            : Response.json({ choices: [{ message: { content: JSON.stringify({
                suggestive: 0, explicit: 0, harassment: 0,
                hate: 0, threat: 0, violence: 0, explanation: '問題なし',
            }) } }], usage: { prompt_tokens: 100, completion_tokens: 22, total_tokens: 122 } });
    }) as typeof fetch;
    try {
        const metrics: AiRequestMetrics[] = [];
        const verdict = await classifyWithQwopus('こんにちは', [], 5000, false, undefined, metrics, '');
        assert.equal(calls, 2);
        assert.equal(verdict.hate, 0);
        assert.deepEqual(metrics.map(item => item.status), [502, 200]);
    } finally {
        globalThis.fetch = original;
    }
});

test('恒久的な502でも最大一度しか再試行しない・安全扱いしない', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response('', { status: 502 }); }) as typeof fetch;
    try {
        await assert.rejects(classifyWithQwopus('重要な判定', [], 5000, false, undefined, [], ''),
            /Moderation API HTTP 502/);
        assert.equal(calls, 2);
    } finally {
        globalThis.fetch = original;
    }
});
