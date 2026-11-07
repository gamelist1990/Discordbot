import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLfmInstructions,
  buildLfmModerationRequest,
} from '../src/core/anticheat/LfmContentClassifier.ts';
import {
  parseContentVerdict,
  ContentSafetyDetector,
  SPAM_LABEL,
} from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';

const categories = ['suggestive', 'explicit', 'harassment', 'hate', 'threat', 'violence'] as const;
const zeros = Object.fromEntries(categories.map((category) => [category, 0]));

function aiResponse(verdict: Record<string, unknown>) {
  return async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(verdict) } }],
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function detectWith(verdict: Record<string, unknown>, config: Record<string, unknown>, content: string) {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = aiResponse(verdict) as typeof fetch;
    const detector = new ContentSafetyDetector();
    const message = { id: `spam-test-${Math.random()}`, content, attachments: new Map(), embeds: [] } as any;
    const context = { settings: { detectors: { contentSafety: { enabled: true, config } } } } as any;
    return await detector.detect(message, context);
  } finally {
    globalThis.fetch = previousFetch;
  }
}

const INMU_TEXT = 'Raid by INMU dsc.gg/inmu x8f2kq9z randomtail';

test('parseContentVerdict accepts and validates the optional spam score', () => {
  const withSpam = parseContentVerdict(JSON.stringify({ ...zeros, spam: 0.95, explanation: '荒らしです' }));
  assert.equal(withSpam.spam, .95);
  const withoutSpam = parseContentVerdict(JSON.stringify({ ...zeros, explanation: '通常の投稿です' }));
  assert.equal(withoutSpam.spam, undefined);
  assert.throws(() => parseContentVerdict(JSON.stringify({ ...zeros, spam: 2 })), /Invalid moderation verdict/);
  assert.throws(() => parseContentVerdict(JSON.stringify({ ...zeros, spam: 'high' })), /Invalid moderation verdict/);
});

test('detector flags INMU-style raid spam, deletes it and clamps AI points', async () => {
  const result = await detectWith(
    { ...zeros, spam: 0.95, explanation: '招待リンクとランダム文字列の荒らしです', suggestedPoints: 30, pointsReason: 'レイドスパムのため' },
    { awardScore: 1, maxAiScore: 10, fallbackScore: 20, spam: 1, action: 'delete' },
    INMU_TEXT,
  );
  assert.ok(result.reasons.includes(SPAM_LABEL), JSON.stringify(result));
  assert.equal(result.scoreDelta, 10);
  assert.ok(result.contentDeletion, JSON.stringify(result));
  assert.equal(result.metadata?.spamMatched, true);
  assert.equal(result.metadata?.pointsSource, 'ai');
});

test('spam hits delete even when the configured action is spoiler', async () => {
  const result = await detectWith(
    { ...zeros, spam: 0.9, explanation: '荒らしです', suggestedPoints: 4, pointsReason: '連投スパム' },
    { awardScore: 1, maxAiScore: 10, spam: 1, action: 'spoiler' },
    INMU_TEXT,
  );
  assert.ok(result.reasons.includes(SPAM_LABEL));
  assert.ok(result.contentDeletion, JSON.stringify(result));
  assert.equal(result.spoilerRepost, undefined);
});

test('missing AI points fall back to the configured fixed score', async () => {
  const capped = await detectWith(
    { ...zeros, spam: 0.9, explanation: '荒らしです' },
    { awardScore: 1, maxAiScore: 10, fallbackScore: 20, spam: 1, action: 'delete' },
    INMU_TEXT,
  );
  assert.equal(capped.scoreDelta, 10);
  assert.equal(capped.metadata?.pointsSource, 'fallback');

  const uncapped = await detectWith(
    { ...zeros, spam: 0.9, explanation: '荒らしです' },
    { awardScore: 1, maxAiScore: 50, fallbackScore: 20, spam: 1, action: 'delete' },
    INMU_TEXT,
  );
  assert.equal(uncapped.scoreDelta, 20);
  assert.equal(uncapped.metadata?.pointsSource, 'fallback');
});

test('category hits with oversized AI points are clamped to maxAiScore', async () => {
  const result = await detectWith(
    { ...zeros, threat: 0.9, explanation: '脅迫です', suggestedPoints: 87, pointsReason: '重大な脅迫のため' },
    { awardScore: 1, maxAiScore: 10, spam: 1, action: 'delete' },
    'お前を殺すぞ、住所も分かってる',
  );
  assert.equal(result.scoreDelta, 10);
  assert.equal(result.metadata?.pointsSource, 'ai');
});

test('ordinary conversation scores zero even with the spam judge enabled', async () => {
  const result = await detectWith(
    { ...zeros, spam: 0, explanation: '通常の雑談です', suggestedPoints: 0, pointsReason: '問題なし' },
    { awardScore: 1, maxAiScore: 10, spam: 1, action: 'delete' },
    '今日はいい天気だね、明日も晴れるといいな',
  );
  assert.deepEqual(result.reasons, []);
  assert.equal(result.scoreDelta, 0);
  assert.equal(result.contentDeletion, undefined);
});

test('spam verdicts are ignored while the spam category is disabled', async () => {
  const result = await detectWith(
    { ...zeros, spam: 0.95, explanation: '荒らしです', suggestedPoints: 5, pointsReason: 'スパム' },
    { awardScore: 1, maxAiScore: 10, spam: 0, action: 'delete' },
    INMU_TEXT,
  );
  assert.equal(result.reasons.includes(SPAM_LABEL), false);
  assert.equal(result.scoreDelta, 0);
});

test('scoring requests demand spam and model-proposed points in the schema', () => {
  const scoring = { maxPoints: 10, categories: ['harassment' as const], fallbackPoints: 20 };
  const request = buildLfmModerationRequest('hello', [], '', '', scoring) as any;
  const schema = request.response_format.json_schema.schema;
  assert.ok(schema.properties.spam);
  assert.equal(schema.properties.suggestedPoints.maximum, 10);
  assert.ok(schema.required.includes('spam'));
  assert.ok(schema.required.includes('suggestedPoints'));
  assert.ok(schema.required.includes('pointsReason'));
  const instructions = buildLfmInstructions('', scoring);
  assert.match(instructions, /spam: raid\/spam posts/);
  assert.match(instructions, /Raid by INMU/);
  assert.match(instructions, /suggestedPoints scale: 0 = no violation/);

  const plain = buildLfmModerationRequest('hello', []) as any;
  const plainSchema = plain.response_format.json_schema.schema;
  assert.ok(plainSchema.properties.spam);
  assert.equal(plainSchema.properties.suggestedPoints, undefined);
  assert.ok(plainSchema.required.includes('spam'));
});
