import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyContent, ContentSafetyDetector } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';

const verdict = { suggestive: .8, explicit: 0, harassment: 0, hate: 0, threat: 0, violence: 0,
    explanation: '身体を強調する仕草がある。', suggestedPoints: 2, pointsReason: '強調はあるが軽微なため2点。' };
const response = (value: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: {
    tool_calls: [{ type: 'function', function: { name: 'submit_verdict', arguments: JSON.stringify(value) } }]
} }] }));
const policy = { maxPoints: 10, categories: ['suggestive'] as ['suggestive'] };

test('points validation rejects missing, fractional, negative and above-cap proposals and missing reasons', async () => {
    const original = globalThis.fetch;
    try {
        for (const suggestedPoints of [undefined, -1, .5, 11, '2']) {
            globalThis.fetch = (async () => response({ ...verdict, suggestedPoints })) as typeof fetch;
            await assert.rejects(classifyContent('test', [], 5000, false, policy), /Invalid moderation points/);
        }
        for (const value of [{ ...verdict, explanation: '' }, { ...verdict, pointsReason: '' }, { ...verdict, pointsReason: undefined }]) {
            globalThis.fetch = (async () => response(value)) as typeof fetch;
            await assert.rejects(classifyContent('test', [], 5000, false, policy), /Invalid moderation/);
        }
    } finally { globalThis.fetch = original; }
});

test('AI may propose zero for a match and scoring settings invalidate exact cache', async () => {
    const original = globalThis.fetch;
    const requests: any[] = [];
    let points = 2;
    globalThis.fetch = (async (_url, options) => {
        requests.push(JSON.parse(String(options?.body)));
        return response({ ...verdict, suggestedPoints: points });
    }) as typeof fetch;
    const detector = new ContentSafetyDetector();
    const message = { id: 'points-test', content: 'test', editedTimestamp: null, attachments: new Map(), embeds: [] } as any;
    const config = { awardScore: 1, maxAiScore: 10, action: 'spoiler', violence: 0 };
    const context = { settings: { detectors: { contentSafety: { enabled: true, config } } } } as any;
    try {
        assert.equal((await detector.detect(message, context)).scoreDelta, 2);
        assert.equal((await detector.detect(message, context)).scoreDelta, 2);
        assert.equal(requests.length, 1);
        assert.ok(!requests[0].messages[0].content.split('対象カテゴリは')[1].split('。')[0].includes('violence'));
        config.maxAiScore = 5;
        points = 0;
        const zero = await detector.detect(message, context);
        assert.equal(zero.scoreDelta, 0);
        assert.ok(zero.spoilerRepost);
        assert.ok(zero.aiExplanation?.includes('加算0点：'));
        assert.equal(requests.length, 2);
        assert.equal(requests[1].tools[0].function.parameters.properties.suggestedPoints.maximum, 5);
        config.violence = 1;
        await detector.detect(message, context);
        assert.equal(requests.length, 3);
    } finally { globalThis.fetch = original; }
});

test('zero classifications retain observed explanation and do not apply proposed points', async () => {
    const original = globalThis.fetch;
    const safe = { ...verdict, suggestive: 0, explanation: '単色の青い背景のみで人物や文字がない。' };
    globalThis.fetch = (async () => response(safe)) as typeof fetch;
    try {
        const result = await new ContentSafetyDetector().detect({ content: 'test', attachments: new Map(), embeds: [] } as any,
            { settings: { detectors: { contentSafety: { enabled: true, config: { awardScore: 1 } } } } } as any);
        assert.equal(result.scoreDelta, 0);
        assert.deepEqual(result.reasons, []);
        assert.equal(result.metadata?.analyses[0].scores.explanation, safe.explanation);
    } finally { globalThis.fetch = original; }
});

test('split frame requests preserve points policy and use the largest proposal without summing', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        assert.equal(body.tools[0].function.parameters.properties.suggestedPoints.maximum, 10);
        const frames = body.messages[1].content.filter((part: any) => part.type === 'image_url');
        if (frames.length > 1) return new Response('', { status: 413 });
        const points = frames[0].image_url.url === 'first' ? 2 : 4;
        return response({ ...verdict, suggestedPoints: points, pointsReason: `${points}点が妥当。` });
    }) as typeof fetch;
    try {
        const result = await classifyContent('test', ['first', 'second'], 5000, false, policy);
        assert.equal(result.suggestedPoints, 4);
        assert.equal(result.pointsReason, '4点が妥当。');
    } finally { globalThis.fetch = original; }
});
