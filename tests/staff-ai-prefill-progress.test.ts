import test from 'node:test';
import assert from 'node:assert/strict';
import { StaffAIStreamState, formatPrefillProgress } from '../src/commands/staff/subcommands/StaffAIStreamState.ts';
import { estimatePromptTokensFromPayload } from '../src/core/ai/ChatGPTClient.ts';

test('first-output waiting message uses only actual elapsed time, never inferred progress', () => {
    assert.equal(formatPrefillProgress(12000, 0), null);
    assert.equal(formatPrefillProgress(12000, 400), null);
    assert.equal(formatPrefillProgress(1500, 5000), '⏳ AIからの初回出力を待機中（5秒経過）');
    assert.equal(formatPrefillProgress(12000, 5000), '⏳ AIからの初回出力を待機中（5秒経過）');
    assert.equal(formatPrefillProgress(12000, 60000), '⏳ AIからの初回出力を待機中（60秒経過）');
    assert.doesNotMatch(formatPrefillProgress(12000, 60000)!, /%|推定|toks|▓|░/);
});

test('estimatePromptTokensFromPayload handles chat and responses payloads', () => {
    const chat = estimatePromptTokensFromPayload({ messages: [{ role: 'user', content: 'あ'.repeat(10000) }] });
    assert.ok(chat > 4000 && chat < 6500, `chat estimate ${chat}`);
    const responses = estimatePromptTokensFromPayload({ instructions: 'x'.repeat(2000), input: [{ type: 'message', content: 'y'.repeat(6000) }] });
    assert.ok(responses > 3000 && responses < 4500, `responses estimate ${responses}`);
    assert.equal(estimatePromptTokensFromPayload(null), 0);
    assert.equal(estimatePromptTokensFromPayload({}), 0);
});

test('stream state shows real elapsed waiting until actual output, not role-only SSE', () => {
    const state = new StaffAIStreamState(false, true);
    state.notePrefillStart(500);
    (state as any).prefill.startedAt -= 5000;
    assert.match(state.renderDiscord(false).embeds[0]?.description ?? '', /初回出力を待機中/,
        'small prompts still show a truthful waiting state');

    state.notePrefillStart(12431);
    (state as any).prefill.startedAt -= 5300;
    const waiting = state.renderDiscord(false);
    assert.match(waiting.embeds[0]?.description ?? '', /⏳ AIからの初回出力を待機中（5秒経過）/);
    state.consume({ choices: [{ delta: { role: 'assistant' } }] } as any);
    assert.match(state.renderDiscord(false).embeds[0]?.description ?? '', /初回出力を待機中/,
        'role-only SSE must not falsely end waiting');

    state.consumeResponse({ type: 'usage', inputTokens: 1, outputTokens: 0 } as any);
    assert.match(state.renderDiscord(false).embeds[0]?.description ?? '', /初回出力を待機中/,
        'usage-only SSE must not end prefill waiting');
    state.consumeResponse({ type: 'text', text: 'こんにちは' } as any);
    const generating = state.renderDiscord(false);
    assert.ok(!generating.embeds[0]?.description?.includes('初回出力を待機中'),
        'the estimate must disappear once generation starts');
    assert.ok(!state.renderDiscord(true).embeds[0]?.description?.includes('初回出力を待機中'),
        'the estimate must not leak into the completed card');
});
