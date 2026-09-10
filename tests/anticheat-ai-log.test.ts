import test from 'node:test';
import assert from 'node:assert/strict';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';
import { classifyContent, type AiRequestMetrics } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

test('safe AI results are logged independently without detection logs or points; unset channel disables logging', async () => {
    const manager = new AntiCheatManager();
    const settings = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
    settings.enabled = true;
    settings.aiLogChannelId = 'audit';
    for (const [name, config] of Object.entries(settings.detectors)) config.enabled = name === 'contentSafety';
    manager.getSettings = async () => settings;
    let writes = 0;
    manager.setSettings = async () => { writes++; };
    const sent: any[] = [];
    (manager as any).fetchLogChannel = async () => ({ send: async (payload: any) => { sent.push(payload); } });
    manager.registerDetector({ name: 'contentSafety', detect: async () => ({
        scoreDelta: 0, reasons: [], metadata: { model: 'test', analyses: [
            { source: 'text', scores: { suggestive: 0.4, explicit: 0, harassment: 0, hate: 0, threat: 0, violence: 0,
                explanation: '軽度の性的示唆があります。' }, cache: 'exact', requests: [], matchedCategories: [] }
        ], thresholds: { image: 0.7, text: 0.8, imageSuggestive: 0.65, textSuggestive: 0.7 },
        enabledCategories: ['suggestive', 'explicit', 'harassment', 'hate', 'threat', 'violence'] }
    }) });
    const message = { id: 'safe', content: 'こんにちは', author: { id: 'user', bot: false },
        guild: { id: 'guild' }, channel: { id: 'channel' }, channelId: 'channel', member: null,
        url: 'https://discord.com/channels/guild/channel/safe' } as any;
    await manager.onMessage(message);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sent.length, 1);
    assert.match(sent[0].embeds[0].data.description, /軽度の性的示唆/);
    const scoreField = sent[0].embeds[0].data.fields.find((field: any) => field.name === 'カテゴリ別スコア / しきい値');
    assert.match(scoreField.value, /軽度の性的表現・H系 0\.40\/0\.70/);
    assert.match(scoreField.value, /検知: なし/);
    const details = JSON.parse(sent[0].files[0].attachment.toString());
    assert.equal(details.status, '検知なし');
    assert.equal(details.appliedPoints, 0);
    assert.deepEqual(sent[0].allowedMentions, { parse: [] });
    assert.equal(writes, 0);
    assert.equal(settings.recentLogs.length, 0);
    settings.aiLogChannelId = null;
    await manager.onMessage(message);
    assert.equal(sent.length, 1);
});

test('retry usage is retained per request, absent usage is not invented', async () => {
    const original = globalThis.fetch;
    const requests: AiRequestMetrics[] = [];
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        if (calls === 1) return Response.json({ usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 }, choices: [{ finish_reason: 'stop', message: {} }] });
        return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: {
            name: 'submit_verdict', arguments: JSON.stringify({ suggestive: 0, explicit: 0, harassment: 0, hate: 0, threat: 0, violence: 0, explanation: '挨拶です。' })
        } }] } }] });
    };
    try {
        await classifyContent('こんにちは', [], 5000, false, undefined, 'test', requests);
        assert.equal(requests.length, 2);
        assert.equal(requests[0].totalTokens, 110);
        assert.equal(requests[1].retry, true);
        assert.equal(requests[1].outputTokens, undefined);
        assert.ok(requests.every(request => typeof request.elapsedMs === 'number'));
    } finally { globalThis.fetch = original; }
});

test('AI failure is logged as failure rather than a safe verdict', async () => {
    const manager = new AntiCheatManager();
    const sent: any[] = [];
    (manager as any).fetchLogChannel = async () => ({ send: async (payload: any) => sent.push(payload) });
    await (manager as any).sendAiDecisionLog({ id: 'failed', guild: { id: 'guild' }, author: { id: 'user' },
        channelId: 'channel', url: 'https://discord.com/channels/guild/channel/failed' }, 'audit',
        { scoreDelta: 0, reasons: [] }, 1000, 'タイムアウト');
    const details = JSON.parse(sent[0].files[0].attachment.toString());
    assert.match(details.status, /判定失敗/);
    assert.equal(details.totalElapsedMs, 1000);
});
