import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIChatManager } from '../src/core/ai/OpenAIChatManager.ts';
import { DOT_AMBIENT } from '../src/core/ai/StaffAIDotAmbient.ts';

test('Discord reply thinking medium is forwarded through non-stream Chat Completions', () => {
    const client = new OpenAIChatManager();
    const build = (client as any).buildRequestPayload.bind(client);
    const request = build(
        [{ role: 'user', content: '円周率の下4桁で' }],
        { reasoningEffort: 'medium', maxTokens: DOT_AMBIENT.generationMaxTokens },
        'ornith-1.5-35b-a3b-strata', false, [], 0,
    );
    assert.equal(request.reasoning_effort, 'medium');
    assert.equal(request.max_tokens, 4096);
    assert.equal(request.chat_template_kwargs?.enable_thinking, undefined);
});

test('Both addressed and participation judging use medium thinking', () => {
    const client = new OpenAIChatManager();
    const build = (client as any).buildRequestPayload.bind(client);
    const request = build([{ role: 'user', content: '判定する' }],
        { reasoningEffort: 'medium', maxTokens: DOT_AMBIENT.judgeMaxTokens },
        'ornith-1.5-35b-a3b-strata', false, [], 0);
    assert.equal(request.chat_template_kwargs?.enable_thinking, undefined);
    assert.equal(request.reasoning_effort, 'medium');
    assert.equal(request.max_tokens, 3072);
});
