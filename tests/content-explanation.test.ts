import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentSafetyDetector, parseContentVerdict } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';
import { displayContentExplanation } from '../src/core/anticheat/ContentExplanation.ts';
(globalThis as any)._cacheCleanupInterval?.unref?.();
const explanation = '性的なポーズが強調されているため。';
const scores = { suggestive: .8, explicit: 0, harassment: 0, hate: 0, threat: 0, violence: 0, explanation };
const message = () => ({ id: 'id', content: 'This is a long content moderation fixture with punctuation!', editedTimestamp: null, attachments: new Map(), embeds: [] } as any);

test('brief explanation is normalized, bounded and cannot create Discord mention formatting', () => {
    assert.equal(parseContentVerdict(JSON.stringify(scores)).explanation, explanation);
    assert.equal(Array.from(parseContentVerdict(JSON.stringify({ ...scores, explanation: '🙂'.repeat(100) })).explanation!).length, 80);
    assert.ok(!parseContentVerdict(JSON.stringify({ ...scores, explanation: 'one\ntwo' })).explanation!.includes('\n'));
    assert.throws(() => parseContentVerdict(JSON.stringify({ ...scores, explanation: 123 })), /explanation/);
    assert.ok(!displayContentExplanation('**理由** @everyone').includes('@everyone'));
});

test('AI explanations reach repost/delete metadata and survive exact/similar cache reuse without new requests', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
        calls++;
        return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_verdict', arguments: JSON.stringify(scores) } }] } }] }));
    }) as typeof fetch;
    try {
        const detector = new ContentSafetyDetector();
        const context: any = { settings: { detectors: { contentSafety: { enabled: true, config: { action: 'spoiler' } } } } };
        const post = message();
        const first = await detector.detect(post, context);
        assert.equal(first.aiExplanation, explanation);
        assert.equal(first.spoilerRepost?.aiExplanation, explanation);
        context.settings.detectors.contentSafety.config.action = 'delete';
        assert.equal((await detector.detect(post, context)).metadata?.aiExplanation, explanation);
        context.settings.detectors.contentSafety.config.action = 'spoiler';
        post.content += '!';
        assert.equal((await detector.detect(post, context)).aiExplanation, `類似投稿の判定理由：${explanation}`);
        assert.equal(calls, 1);
    } finally { globalThis.fetch = original; }
});

test('stored detection reason and Discord summary both display the AI explanation in delete mode', async () => {
    const manager = new AntiCheatManager();
    const settings = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
    settings.enabled = true;
    for (const [name, detector] of Object.entries(settings.detectors)) detector.enabled = name === 'contentSafety';
    manager.getSettings = async () => settings;
    manager.setSettings = async () => {};
    let payload: any;
    (manager as any).fetchLogChannel = async () => ({ send: async (value: any) => { payload = value; } });
    const post = { ...message(), author: { id: 'user', tag: 'user', bot: false, toString: () => '<@user>' }, guild: { id: 'guild' }, channel: { id: 'channel' } };
    post.fetch = async () => post; post.delete = async () => {};
    manager.registerDetector({ name: 'contentSafety', detect: async () => ({ scoreDelta: 0, reasons: ['H系'], aiExplanation: explanation,
        contentDeletion: { content: post.content, editedTimestamp: null, attachmentIds: '' } }) });
    await manager.onMessage(post);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(settings.recentLogs[0].reason.includes(explanation));
    assert.equal(payload.embeds[0].toJSON().fields.find((field: any) => field.name === 'AIの判定理由（参考）').value, explanation);
});
