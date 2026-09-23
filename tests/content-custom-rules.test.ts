import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyContent, parseContentVerdict } from '../src/core/anticheat/detectors/ContentSafetyDetector.js';

const base = {
  suggestive: 0, explicit: 0, harassment: 0, hate: 0, threat: 0, violence: 0,
  explanation: '宣伝リンクが含まれています。', customRuleViolations: ['外部サービスの宣伝禁止'],
};

test('独自ルール違反の配列を判定結果として受け付ける', () => {
  assert.deepEqual(parseContentVerdict(JSON.stringify(base)).customRuleViolations, ['外部サービスの宣伝禁止']);
  assert.throws(() => parseContentVerdict(JSON.stringify({ ...base, customRuleViolations: [1] })), /Invalid moderation verdict/);
});

test('複数行の独自ルールをAIリクエストへ含める', async () => {
  const original = globalThis.fetch;
  let requestBody: any;
  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{
      type: 'function', function: { name: 'submit_verdict', arguments: JSON.stringify({ verdict: JSON.stringify(base) }) },
    }] } }] });
  }) as typeof fetch;
  try {
    const verdict = await classifyContent('宣伝です', [], 5000, false, undefined, 'test', [], '外部サービスの宣伝禁止\n個人情報の掲載禁止');
    assert.match(requestBody.messages[1].content, /個人情報の掲載禁止/);
    assert.deepEqual(verdict.customRuleViolations, ['外部サービスの宣伝禁止']);
  } finally { globalThis.fetch = original; }
});
