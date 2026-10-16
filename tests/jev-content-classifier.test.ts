import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJevModerationRequest, classifyWithJev, verdictFromJev, JEV_CATEGORY_RULES } from '../src/core/anticheat/JevContentClassifier.ts';
import { jevResponse } from './fixtures/jev.ts';
import { similarityInput, inputSimilarity } from '../src/core/anticheat/ContentVerdictCache.ts';

test('jev uses evidence gates and severity decisions for every category', () => {
    const request = buildJevModerationRequest('hello', []);
    assert.equal(request.state, 'hello');
    for (const category of Object.keys(JEV_CATEGORY_RULES)) {
        assert.equal((request.questions[category] as any).type, 'noul');
        assert.equal((request.questions[category + '_strength'] as any).type, 'score');
    }
});

test('GIF and MP4 use temporal video parts, and video cache requires identical bytes and captions', async () => {
    const media = ['data:image/gif;base64,R0lGODlh', 'data:video/mp4;base64,AAAA'];
    for (const url of media) {
        const request = buildJevModerationRequest('caption', [url]);
        assert.equal((request.state as any).messages[0].content[1].type, 'video_url');
        assert.equal((request.state as any).messages[0].content[1].video_url.url, url);
        const first = await similarityInput('caption', [url]);
        assert.equal(inputSimilarity(first, await similarityInput('caption', [url])), 1);
        assert.equal(inputSimilarity(first, await similarityInput('different', [url])), 0);
        assert.equal(inputSimilarity(first, await similarityInput('caption', [url + 'AA'])), 0);
    }
});

test('absent category evidence cannot turn an unrelated severe score into a violation', async () => {
    const response = await jevResponse({ threat: .9 }).json() as any;
    const result = JSON.parse(response.choices[0].message.content);
    result.answers.explicit_strength.score = 3;
    assert.equal(verdictFromJev(result).explicit, 0);
    assert.ok(verdictFromJev(result).threat >= .89);
    for (const invalid of [NaN, -1, 4, '3']) {
        result.answers.threat_strength.score = invalid;
        assert.throws(() => verdictFromJev(result), /Invalid jev/);
    }
});

test('missing categories and conversational replies fail without manufacturing safe scores', async () => {
    assert.throws(() => verdictFromJev({ answers: {} }), /Invalid jev/);
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not a decision' } }] }))) as typeof fetch;
    try { await assert.rejects(classifyWithJev('test', [], 1000, false, undefined, 'jeff-base', [], ''), /JSON|Unexpected/); }
    finally { globalThis.fetch = original; }
});

test('requested custom rules require a valid rule decision', async () => {
    const response = await jevResponse().json() as any;
    const result = JSON.parse(response.choices[0].message.content);
    assert.throws(() => verdictFromJev(result, undefined, true), /custom rule/);
    result.answers.custom_rules = { type: 'score', score: 2.5 };
    assert.deepEqual(verdictFromJev(result, undefined, true).customRuleViolations, ['サーバー独自ルール']);
});

test('decision request preserves attached frames and records zero generated tokens', async () => {
    const original = globalThis.fetch;
    let sent: any;
    globalThis.fetch = (async (_url, options) => { sent = JSON.parse(String(options?.body)); return jevResponse(); }) as typeof fetch;
    const metrics: any[] = [];
    try {
        await classifyWithJev('caption', ['data:image/png;base64,AA=='], 1000, false, undefined, 'jeff-base', metrics, '');
        assert.equal(sent.model, 'jeff-base');
        assert.equal(sent.stream, false);
        assert.equal(sent.tools, undefined);
        assert.equal(sent.decision.state.messages[0].content[0].text, 'caption');
        assert.equal(sent.decision.state.messages[0].content[1].image_url.url, 'data:image/png;base64,AA==');
        assert.equal(metrics[0].outputTokens, 0);
    } finally { globalThis.fetch = original; }
});
