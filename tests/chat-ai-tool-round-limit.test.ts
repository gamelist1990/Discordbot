import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatGPTClient } from '../src/core/ai/ChatGPTClient.ts';

function setup() {
    const client = new ChatGPTClient({ apiEndpoint: 'http://207.0.0.1:1', apiKey: 'test-key', defaultModel: 'test-model' });
    const internal = client as any;
    let executions = 0;
    internal.resolveModelCandidates = async () => ['test-model'];
    client.registerTool({ type: 'function', function: {
        name: 'lookup', description: 'Lookup test data', parameters: { type: 'object', properties: {} },
    } }, async () => { executions += 1; return `new result ${executions}`; });
    return { client, internal, executions: () => executions };
}

const options = { model: 'test-model', strictModel: true };

function chatResponse(round: number) {
    return { id: `chat_${round}`, object: 'chat.completion', model: 'test-model', created: 0,
        choices: [{ index: 0, finish_reason: round <= 20 ? 'tool_calls' : 'stop', message: {
            role: 'assistant', content: round <= 20 ? null : '調査完了',
            ...(round <= 20 ? { tool_calls: [{ id: `call_${round}`, type: 'function',
                function: { name: 'lookup', arguments: '{}' } }] } : {}),
        } }] };
}

test('Responses continues beyond eight tool rounds, preserving results and automatic tool access', async () => {
    const { client, internal, executions } = setup();
    let requests = 0;
    internal.streamResponseApiPayload = async (_auth: unknown, payload: any, emit: any) => {
        requests += 1;
        assert.equal(payload.tool_choice, 'auto');
        assert.equal(payload.input.filter((item: any) => item.type === 'function_call_output').length, requests - 1);
        if (requests > 20) {
            emit({ type: 'text', text: '調査完了' });
            return { responseId: 'resp_final', functionCalls: [], outputItems: [] };
        }
        const call = { type: 'function_call', id: `fc_${requests}`, call_id: `call_${requests}`,
            name: 'lookup', arguments: '{}' };
        return { responseId: `resp_${requests}`, functionCalls: [{
            id: call.id, callId: call.call_id, name: call.name, arguments: call.arguments,
        }], outputItems: [call] };
    };
    let text = '';
    await client.streamResponse([{ role: 'user', content: '調べて' }], delta => {
        if (delta.type === 'text') text += delta.text;
    }, options);
    assert.equal(executions(), 20);
    assert.equal(requests, 21);
    assert.equal(text, '調査完了');
});

test('Non-streaming Chat Completions continues beyond eight tool rounds', async () => {
    const { client, internal, executions } = setup();
    let requests = 0;
    internal.createClient = () => ({ chat: { completions: {
        create: async () => chatResponse(++requests),
    } } });
    const result = await client.sendMessage([{ role: 'user', content: '調べて' }], options);
    assert.equal(executions(), 20);
    assert.equal(requests, 21);
    assert.equal(result.choices[0].message.content, '調査完了');
});

test('Streaming Chat Completions continues beyond eight tool rounds', async () => {
    const { client, internal, executions } = setup();
    let requests = 0;
    internal.createClient = () => ({ chat: { completions: {
        create: async () => (async function* () {
            const response = chatResponse(++requests);
            const message = response.choices[0].message;
            yield { choices: [{ index: 0, delta: message.tool_calls
                ? { tool_calls: message.tool_calls.map(call => ({ ...call, index: 0 })) }
                : { content: message.content }, finish_reason: response.choices[0].finish_reason }] };
        })(),
    } } });
    let text = '';
    await client.streamMessage([{ role: 'user', content: '調べて' }], chunk => {
        text += chunk.choices[0]?.delta?.content || '';
    }, options);
    assert.equal(executions(), 20);
    assert.equal(requests, 21);
    assert.equal(text, '調査完了');
});

test('An unlimited Responses tool chain still stops on explicit cancellation', async () => {
    const { client, internal, executions } = setup();
    const controller = new AbortController();
    let requests = 0;
    internal.streamResponseApiPayload = async () => {
        requests += 1;
        if (requests === 21) controller.abort(new DOMException('Cancelled', 'AbortError'));
        return { responseId: `resp_${requests}`, functionCalls: [{
            id: `fc_${requests}`, callId: `call_${requests}`, name: 'lookup', arguments: '{}',
        }], outputItems: [] };
    };
    await assert.rejects(client.streamResponse([{ role: 'user', content: '調べて' }], () => {}, {
        ...options, signal: controller.signal,
    }), (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
    assert.equal(executions(), 20);
    assert.equal(requests, 21);
});
