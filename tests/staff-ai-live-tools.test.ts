import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ChatGPTClient } from '../src/core/ai/ChatGPTClient.ts';
import { StaffAIStreamState } from '../src/commands/staff/subcommands/StaffAIStreamState.ts';
import { StaffAILiveUpdates } from '../src/commands/staff/subcommands/StaffAILiveUpdates.ts';

test('Native tool cards stream Thinking alongside tools and hide its text when complete', () => {
    const state = new StaffAIStreamState(true, true);
    state.consumeResponse({type: 'thinking', text: '必要な情報を確認しています。'});
    state.recordToolCall({name: 'output_file', round: 1, itemId: 'item', index: 0, argumentCharacters: 20, argumentsComplete: false});
    let card = state.renderDiscord();
    assert.equal(card.embeds.length, 1);
    assert.match(JSON.stringify(card), /引数を生成中（20文字）/);
    assert.match(JSON.stringify(card), /必要な情報を確認しています/);
    assert.doesNotMatch(JSON.stringify(card), /```ansi/);
    state.recordToolCall({name: 'output_file', round: 1, callId: 'call', itemId: 'item', index: 0,
        argumentCharacters: 100, argumentsComplete: true, arguments: '{"filename":"answer.txt"}'});
    assert.equal(state.renderDiscord().embeds[0].fields!.length, 2);
    state.recordToolStep({name: 'output_file', round: 1, callId: 'call', phase: 'started'});
    card = state.renderDiscord();
    assert.match(JSON.stringify(card), /実行中|answer/);
    state.recordToolStep({name: 'output_file', round: 1, callId: 'call', phase: 'completed'});
    state.consumeResponse({type: 'text', text: 'ファイルを添付しました。'});
    card = state.renderDiscord(true);
    assert.equal(card.content, 'ファイルを添付しました。');
    assert.equal(card.embeds[0].fields!.length, 1);
    assert.match(JSON.stringify(card.embeds), /完了 1件/);
    assert.doesNotMatch(JSON.stringify(card), /必要な情報を確認しています/);
    assert.match(JSON.stringify(card.embeds), /Thinking · 完了/);
    assert.match(card.embeds[0].footer!.text, /toks\/s/);
});

test('Native Thinking updates while the answer streams, uses a rolling preview, and escapes tool protocol', () => {
    const state = new StaffAIStreamState(false, true);
    state.consumeResponse({type: 'thinking', text: '最初の確認。'});
    const first = JSON.stringify(state.renderDiscord());
    assert.match(first, /最初の確認/);
    state.consumeResponse({type: 'text', text: '回答の途中です。'});
    state.consumeResponse({type: 'thinking', text: '次の確認をしています。'});
    const second = state.renderDiscord();
    assert.equal(second.content, '回答の途中です。');
    assert.match(JSON.stringify(second.embeds), /次の確認をしています/);
    assert.notEqual(first, JSON.stringify(second));
    state.consumeResponse({type: 'thinking', text: 'あ'.repeat(400) + '@everyone ``` <tool_call>SECRET</tool_call>'});
    const rendered = JSON.stringify(state.renderDiscord());
    assert.match(rendered, /…/);
    assert.doesNotMatch(rendered, /最初の確認|SECRET|<tool_call>|@everyone/);
    assert.ok(state.renderDiscord().embeds[0].fields![0].value.length <= 1024);
});

test('Parallel active tools stay visible, round/index reuse does not merge calls, and Discord limits are respected', () => {
    const state = new StaffAIStreamState(true, true);
    state.recordToolCall({name: 'web_search', round: 1, callId: 'active', index: 0, argumentCharacters: 10, argumentsComplete: false});
    for (let index = 0; index < 15; index++) {
        state.recordToolCall({name: 'get_time', round: index + 2, callId: `call${index}`, index: 0, argumentCharacters: 0, argumentsComplete: true});
        state.recordToolStep({name: 'get_time', round: index + 2, callId: `call${index}`, phase: 'started'});
        state.recordToolStep({name: 'get_time', round: index + 2, callId: `call${index}`, phase: index === 14 ? 'failed' : 'completed'});
    }
    state.consumeResponse({type: 'text', text: '長文'.repeat(2000)});
    const card = state.renderDiscord();
    assert.ok(card.content.length <= 2000);
    assert.equal(card.embeds[0].fields!.length, 8);
    assert.match(JSON.stringify(card.embeds), /ツール 16件/);
    assert.match(JSON.stringify(card.embeds), /Web検索/);
    assert.ok(JSON.stringify(card.embeds).length < 6000);
    assert.deepEqual(card.allowedMentions, {parse: []});
});

test('Discord edits are serialized and coalesce text without dropping tool milestones or overwriting the final answer', async () => {
    const sent: string[] = [];
    let finishFirst!: () => void;
    const gate = new Promise<void>(resolve => { finishFirst = resolve; });
    let inFlight = 0, maxInFlight = 0;
    const updates = new StaffAILiveUpdates<string>(async value => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        sent.push(value);
        if (value === 'preparing') await gate;
        inFlight--;
    }, 2);
    updates.queue('preparing', true);
    await Promise.resolve();
    updates.queue('old text');
    updates.queue('running', true);
    updates.queue('newer text');
    updates.queue('completed', true);
    const finish = updates.finish();
    updates.queue('must not overwrite final');
    finishFirst();
    await finish;
    assert.deepEqual(sent, ['preparing', 'running', 'completed']);
    assert.equal(maxInFlight, 1);
    sent.push('final');
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(sent.at(-1), 'final');
});

test('A Discord edit failure ends the update queue cleanly', async () => {
    let failures = 0;
    const updates = new StaffAILiveUpdates<string>(async () => { throw new Error('Discord unavailable'); }, 1,
        () => { failures++; });
    updates.queue('first', true);
    updates.queue('second', true);
    await updates.finish();
    assert.equal(failures, 1);
});

test('Chat Completions fallback streams native preparation without mixing raw arguments into the card', async () => {
    const state = new StaffAIStreamState(true, true);
    const client = new ChatGPTClient({apiEndpoint: 'http://127.0.0.1:1', apiKey: 'test', defaultModel: 'test-model'});
    const internal = client as any;
    internal.resolveAuthCandidates = () => [{apiEndpoint: 'test', apiKey: 'test'}];
    internal.resolveModelCandidates = async () => ['test-model'];
    let requests = 0, prepared = false, executed = false;
    internal.createClient = () => ({chat: {completions: {create: async () => {
        requests++;
        return (async function* () {
            if (requests === 1) {
                yield {choices: [{delta: {tool_calls: [{index: 0, id: 'call', type: 'function', function: {name: 'output_file', arguments: '{"filename":"result'}}]}, finish_reason: null}]};
                yield {choices: [{delta: {tool_calls: [{index: 0, function: {arguments: '.txt","content":"SECRET_CODE"}'}}]}, finish_reason: 'tool_calls'}]};
            } else yield {choices: [{delta: {content: '添付済みです。'}, finish_reason: 'stop'}]};
        })();
    }}}});
    client.registerTool({type: 'function', function: {name: 'output_file', parameters: {type: 'object'}}}, () => {
        executed = true;
        assert.ok(prepared);
        return 'FILE_UPLOADED: result.txt';
    });
    await client.streamMessage([{role: 'user', content: 'ファイルを作って'}], chunk => state.consume(chunk), {
        model: 'test-model', strictModel: true,
        onToolCallDelta: call => {
            assert.equal(executed, false);
            prepared = true;
            state.recordToolCall(call);
        },
        onToolStep: step => state.recordToolStep(step),
    });
    const final = state.renderDiscord(true);
    assert.equal(requests, 2);
    assert.equal(final.embeds[0].fields!.length, 1);
    assert.match(JSON.stringify(final.embeds), /result/);
    assert.doesNotMatch(JSON.stringify(final), /SECRET_CODE/);
});

test('Real Responses SSE exposes generating arguments before execution and resolves aliases to one native card', async () => {
    let requests = 0, executed = false, observedPreparing = false;
    const state = new StaffAIStreamState(true, true);
    const call = {type: 'function_call', id: 'item_final', call_id: 'call_file', name: 'output_file',
        arguments: JSON.stringify({filename: 'result.txt', content: 'SECRET_FILE_CONTENT', token: 'SECRET_TOKEN'})};
    const server = http.createServer(async (request, response) => {
        for await (const _chunk of request) { /* consume SDK request */ }
        response.writeHead(200, {'content-type': 'text/event-stream'});
        const emit = (data: any) => response.write(`data: ${JSON.stringify(data)}\n\n`);
        requests++;
        if (requests === 1) {
            emit({type: 'response.output_item.added', output_index: 0,
                item: {...call, id: 'item_first', arguments: ''}});
            emit({type: 'response.function_call_arguments.delta', item_id: 'item_first', output_index: 0, delta: '{"filename":"result'});
            await new Promise(resolve => setTimeout(resolve, 25));
            emit({type: 'response.function_call_arguments.done', item_id: 'item_first', output_index: 0, arguments: call.arguments});
            emit({type: 'response.output_item.done', output_index: 0, item: {...call, id: 'item_first'}});
            emit({type: 'response.output_item.done', output_index: 1, item: call});
            emit({type: 'response.completed', response: {id: 'resp_call', output: [call]}});
        } else {
            emit({type: 'response.output_text.delta', delta: '添付しました。'});
            emit({type: 'response.completed', response: {id: 'resp_done', output: []}});
        }
        response.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const client = new ChatGPTClient({apiEndpoint: `http://127.0.0.1:${address.port}`, apiKey: 'test', defaultModel: 'test-model'});
    const internal = client as any;
    internal.resolveAuthCandidates = () => [{apiEndpoint: `http://127.0.0.1:${address.port}`, apiKey: 'test'}];
    internal.resolveModelCandidates = async () => ['test-model'];
    client.registerTool({type: 'function', function: {name: 'output_file', parameters: {type: 'object'}}}, () => {
        assert.ok(observedPreparing, 'tool was invisible until execution');
        executed = true;
        return 'FILE_UPLOADED: result.txt';
    });
    try {
        await client.streamResponse([{role: 'user', content: 'ファイルを作って'}], delta => state.consumeResponse(delta), {
            model: 'test-model', strictModel: true,
            onToolCallDelta: call => {
                assert.doesNotMatch(JSON.stringify(call), /SECRET_FILE_CONTENT|SECRET_TOKEN/);
                state.recordToolCall(call);
                if (!call.argumentsComplete && call.argumentCharacters > 0) {
                    assert.equal(executed, false);
                    observedPreparing = true;
                    assert.match(JSON.stringify(state.renderDiscord()), /引数を生成中/);
                }
            },
            onToolStep: step => state.recordToolStep(step),
        });
        const final = state.renderDiscord(true);
        assert.ok(executed);
        assert.equal(requests, 2);
        assert.equal(final.embeds[0].fields!.length, 1);
        assert.match(JSON.stringify(final), /完了 1件/);
        assert.match(JSON.stringify(final), /Discordへのファイル添付完了/);
        assert.doesNotMatch(JSON.stringify(final), /SECRET_FILE_CONTENT|SECRET_TOKEN/);
    } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
