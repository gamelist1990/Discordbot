import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyContent, parseContentVerdict } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';

const categories = ['suggestive', 'explicit', 'harassment', 'hate', 'threat', 'violence'] as const;
const safe = Object.fromEntries(categories.map((category) => [category, 0.1]));

function gemma(scores: Record<string, unknown>) {
  return async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(scores) } }],
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('malformed model-point proposals are discarded, not awarded', () => {
  for (const points of [-1, .5, 101, '3']) {
    const verdict = parseContentVerdict(JSON.stringify({ ...safe, suggestedPoints: points, pointsReason: 'x' }));
    assert.equal(verdict.suggestedPoints, undefined, `points=${points}`);
    assert.equal(verdict.suggestive, .1);
  }
  const noReason = parseContentVerdict(JSON.stringify({ ...safe, suggestedPoints: 4, pointsReason: 7 }));
  assert.equal(noReason.suggestedPoints, 4);
  assert.equal(noReason.pointsReason, undefined);
});

test('model-proposed points are used verbatim and clamped to the policy maximum', async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = gemma({ ...safe, suggestive: .8, suggestedPoints: 99, pointsReason: '悪質な誘いです' }) as typeof fetch;
    const clamped = await classifyContent('point clamp fixture', [], undefined, '', {
      maxPoints: 5, categories: ['suggestive'],
    });
    assert.equal(clamped.suggestedPoints, 5);
    assert.equal(clamped.pointsReason, '悪質な誘いです');

    globalThis.fetch = gemma({ ...safe, suggestive: .8, suggestedPoints: 3, pointsReason: '中程度の悪質さです' }) as typeof fetch;
    const verbatim = await classifyContent('point verbatim fixture', [], undefined, '', {
      maxPoints: 5, categories: ['suggestive'],
    });
    assert.equal(verbatim.suggestedPoints, 3);
    assert.equal(verbatim.pointsReason, '中程度の悪質さです');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('classifier leaves points unset when the model proposes none', async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = gemma({ ...safe, violence: 1, threat: .5 }) as typeof fetch;
    const result = await classifyContent('local points', [], undefined, '', {
      maxPoints: 5, categories: ['violence'],
    });
    assert.equal(result.violence, 1);
    assert.equal(result.suggestedPoints, undefined);
    assert.equal(result.pointsReason, undefined);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
