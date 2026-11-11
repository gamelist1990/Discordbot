import test from 'node:test';
import assert from 'node:assert/strict';
import { StaffAIStreamState, formatPrefillProgress, PREFILL_TOKENS_PER_SECOND } from '../src/commands/staff/subcommands/StaffAIStreamState.ts';
import { estimatePromptTokensFromPayload } from '../src/core/ai/ChatGPTClient.ts';

test('formatPrefillProgress: small prompts stay hidden, progress grows and caps at 99%', () => {
    assert.equal(formatPrefillProgress(1500, 5000), null);
    assert.equal(formatPrefillProgress(12000, 0), null);
    const early = formatPrefillProgress(12000, 1000)!;
    assert.match(early, /prefill 推定/);
    assert.match(early, new RegExp(`${Math.floor((1000 / 1000 * PREFILL_TOKENS_PER_SECOND) / 12000 * 100)}%`));
    const late = formatPrefillProgress(12000, 60000)!;
    assert.match(late, /99%/);
    assert.match(late, /12,000 toks/);
});

test('estimatePromptTokensFromPayload handles chat and responses payloads', () => {
    const chat = estimatePromptTokensFromPayload({ messages: [{ role: 'user', content: 'あ'.repeat(10000) }] });
    assert.ok(chat > 4000 && chat < 6500, `chat estimate ${chat}`);
    const responses = estimatePromptTokensFromPayload({ instructions: 'x'.repeat(2000), input: [{ type: 'message', content: 'y'.repeat(6000) }] });
    assert.ok(responses > 3000 && responses < 4500, `responses estimate ${responses}`);
    assert.equal(estimatePromptTokensFromPayload(null), 0);
    assert.equal(estimatePromptTokensFromPayload({}), 0);
});

test('stream state shows the prefill estimate only while waiting for the first delta', () => {
    const state = new StaffAIStreamState(false, true);
    state.notePrefillStart(500);
    (state as any).prefill.startedAt -= 5000;
    assert.ok(!state.renderDiscord(false).embeds[0]?.description?.includes('prefill 推定'),
        'small prompts must not show the estimate');

    state.notePrefillStart(12431);
    (state as any).prefill.startedAt -= 5300;
    const waiting = state.renderDiscord(false);
    assert.match(waiting.embeds[0]?.description ?? '', /⏳ prefill 推定 ▓{5}░{5} 50%（約 6,[0-9]{3} \/ 12,431 toks）/);

    state.consumeResponse({ type: 'text', text: 'こんにちは' } as any);
    const generating = state.renderDiscord(false);
    assert.ok(!generating.embeds[0]?.description?.includes('prefill 推定'),
        'the estimate must disappear once generation starts');
    assert.ok(!state.renderDiscord(true).embeds[0]?.description?.includes('prefill 推定'),
        'the estimate must not leak into the completed card');
});
