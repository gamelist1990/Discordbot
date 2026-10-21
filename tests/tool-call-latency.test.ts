import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { executeToolBatch, isReadOnlyTool } from '../src/core/ai/ToolCallBatch.ts';
import { ChatGPTClient } from '../src/core/ai/ChatGPTClient.ts';
import { StaffAILiveUpdates } from '../src/commands/staff/subcommands/StaffAILiveUpdates.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('Reads use three working slots, keep result order, and fill freed slots immediately', async () => {
    const started: number[] = [];
    const releases = new Map<number, () => void>();
    const work = executeToolBatch([0, 1, 2, 3, 4], () => 'fetch_url', () => '{}', async index => {
        started.push(index);
        await new Promise<void>(resolve => releases.set(index, resolve));
        return `page${index}`;
    });
    await tick();
    assert.deepEqual(started, [0, 1, 2]);
    releases.get(2)!();
    await tick();
    assert.deepEqual(started, [0, 1, 2, 3]);
    releases.get(3)!();
    await tick();
    assert.deepEqual(started, [0, 1, 2, 3, 4]);
    for (const release of releases.values()) release();
    assert.deepEqual(await work, ['page0', 'page1', 'page2', 'page3', 'page4']);
});

test('Writes and unknown tools remain barriers between independent reads', async () => {
    const calls = ['get_time', 'fetch_url', 'output_file', 'get_weather', 'unknown_mutation', 'fetch_url'];
    const events: string[] = [];
    await executeToolBatch(calls, name => name, () => '{}', async name => {
        events.push('start:' + name);
        await tick();
        events.push('end:' + name);
        return name;
    });
    assert.ok(events.indexOf('start:output_file') > events.indexOf('end:get_time'));
    assert.ok(events.indexOf('start:output_file') > events.indexOf('end:fetch_url'));
    assert.ok(events.indexOf('start:get_weather') > events.indexOf('end:output_file'));
    assert.ok(events.indexOf('start:unknown_mutation') > events.indexOf('end:get_weather'));
    assert.ok(events.lastIndexOf('start:fetch_url') > events.indexOf('end:unknown_mutation'));
    for (const action of ['create', 'update', 'delete']) assert.equal(isReadOnlyTool('manage_memory', JSON.stringify({action})), false);
    for (const action of ['recall', 'list', 'get', 'search']) assert.equal(isReadOnlyTool('manage_memory', JSON.stringify({action})), true);
    assert.equal(isReadOnlyTool('manage_schedule', '{"action":"list"}'), true);
    assert.equal(isReadOnlyTool('manage_schedule', '{"action":"create"}'), false);
});

test('Fatal read failure drains active reads and never starts a later mutation', async () => {
    let active = 0, writes = 0;
    await assert.rejects(executeToolBatch(['fetch_url', 'get_time', 'output_file'], name => name, () => '{}', async name => {
        if (name === 'output_file') { writes++; return name; }
        active++;
        try { await tick(); if (name === 'fetch_url') throw new Error('aborted'); return name; }
        finally { active--; }
    }), /aborted/);
    assert.equal(active, 0);
    assert.equal(writes, 0);
});

test('Responses starts tools and completes answers on response.completed without waiting for proxy EOF', {timeout: 3000}, async () => {
    let requests = 0, executions = 0;
    const call = {type: 'function_call', id: 'fc_time', call_id: 'call_time', name: 'get_time', arguments: '{}'};
    const server = http.createServer(async (request, response) => {
        let body = '';
        for await (const chunk of request) body += chunk;
        const payload = JSON.parse(body);
        requests++;
        response.writeHead(200, {'content-type': 'text/event-stream'});
        const emit = (data: unknown) => response.write(`data: ${JSON.stringify(data)}\n\n`);
        assert.equal(payload.parallel_tool_calls, true);
        if (requests === 1) {
            emit({type: 'response.output_item.done', output_index: 0, item: call});
            emit({type: 'response.completed', response: {id: 'resp_tool', output: [call], usage: {input_tokens: 11, output_tokens: 3, total_tokens: 14}}});
        } else {
            const outputs = payload.input.filter((item: any) => item.type === 'function_call_output');
            assert.deepEqual(outputs, [{type: 'function_call_output', call_id: 'call_time', output: '現在時刻のテスト結果'}]);
            assert.ok(payload.input.some((item: any) => item.type === 'function_call' && item.call_id === 'call_time'));
            emit({type: 'response.output_text.delta', delta: '確認できました。'});
            emit({type: 'response.completed', response: {id: 'resp_answer', output: [], usage: {input_tokens: 20, output_tokens: 4, total_tokens: 24}}});
        }
        // Deliberately keep the HTTP stream open. Client must use the native terminal event.
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const auth = {apiEndpoint: `http://127.0.0.1:${address.port}`, apiKey: 'test'};
    const client = new ChatGPTClient({...auth, defaultModel: 'test-model'});
    (client as any).resolveAuthCandidates = () => [auth];
    (client as any).resolveModelCandidates = async () => ['test-model'];
    client.registerTool({type: 'function', function: {name: 'get_time', parameters: {type: 'object'}}}, () => {
        executions++;
        return '現在時刻のテスト結果';
    });
    let text = '', usageEvents = 0;
    try {
        await client.streamResponse([{role: 'user', content: '時刻を確認'}], delta => {
            if (delta.type === 'text') text += delta.text;
            if (delta.type === 'usage') usageEvents++;
        }, {model: 'test-model', strictModel: true, signal: AbortSignal.timeout(2000)});
        assert.equal(executions, 1);
        assert.equal(requests, 2);
        assert.equal(usageEvents, 2);
        assert.equal(text, '確認できました。');
    } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});

test('Native Responses executes a tool batch concurrently and binds each output to its original call ID', {timeout: 2000}, async () => {
    const client = new ChatGPTClient({apiEndpoint: 'test', apiKey: 'test', defaultModel: 'test-model'});
    const internal = client as any;
    internal.resolveAuthCandidates = () => [{apiEndpoint: 'test', apiKey: 'test'}];
    internal.resolveModelCandidates = async () => ['test-model'];
    let started = 0, requests = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>(resolve => { release = resolve; });
    for (const name of ['get_time', 'get_weather']) client.registerTool({type: 'function', function: {name, parameters: {type: 'object'}}}, async () => {
        if (++started === 2) release();
        await bothStarted;
        if (name === 'get_time') await tick();
        return name + ' result';
    });
    const calls = ['get_time', 'get_weather'].map((name, index) => ({id: `fc${index}`, type: 'function_call', call_id: `call${index}`, name, arguments: '{}'}));
    internal.streamResponseApiPayload = async (_auth: unknown, payload: any, emit: any) => {
        if (++requests === 1) return {responseId: 'resp_tools', outputItems: calls,
            functionCalls: calls.map(call => ({callId: call.call_id, name: call.name, arguments: call.arguments}))};
        assert.equal(started, 2);
        assert.deepEqual(payload.input.filter((item: any) => item.type === 'function_call_output'), [
            {type: 'function_call_output', call_id: 'call0', output: 'get_time result'},
            {type: 'function_call_output', call_id: 'call1', output: 'get_weather result'},
        ]);
        emit({type: 'thinking', text: '結果を確認しています。'});
        emit({type: 'text', text: '時刻と天気を確認しました。'});
        return {responseId: 'resp_final', functionCalls: [], outputItems: []};
    };
    let text = '';
    await client.streamResponse([{role: 'user', content: '時刻と天気を確認'}], delta => {
        if (delta.type === 'text') text += delta.text;
    }, {model: 'test-model', strictModel: true});
    assert.equal(requests, 2);
    assert.equal(text, '時刻と天気を確認しました。');
});

test('Production-style progress keeps recent timeline snapshots instead of delaying Thinking behind stale edits', async () => {
    const sent: string[] = [];
    let release!: () => void;
    const first = new Promise<void>(resolve => { release = resolve; });
    const updates = new StaffAILiveUpdates<string>(async snapshot => {
        sent.push(snapshot);
        if (snapshot === 'first') await first;
    }, 1, () => {}, 2);
    updates.queue('first', true);
    await tick();
    for (let index = 0; index < 10; index++) updates.queue(`timeline${index}`, true);
    updates.queue('new Thinking', true);
    const done = updates.finish();
    release();
    await done;
    assert.deepEqual(sent, ['first', 'timeline9', 'new Thinking']);
});
