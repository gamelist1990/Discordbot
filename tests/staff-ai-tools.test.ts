import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatGPTClient } from '../src/core/ai/ChatGPTClient.ts';
import { registerStaffAITools } from '../src/commands/staff/subcommands/ai-tools/catalog.ts';
import { staffMemoryHandler } from '../src/commands/staff/subcommands/ai-tools/staff_memory.ts';
import { database } from '../src/core/persistence/Database.ts';
import { toolResultError, toolStepArguments } from '../src/core/ai/ToolResultStatus.ts';
import { StaffAIStreamState } from '../src/commands/staff/subcommands/StaffAIStreamState.ts';

const sentence = '検索結果が空だったので、もう一度違う言葉で検索してみる。';

test('Short follow-ups receive every tool and two memory calls still reach the normal final answer', async () => {
    const originalGet = database.get;
    database.get = async (_guild: string, _key: string, fallback: any) => fallback;
    try {
        const client = new ChatGPTClient({apiEndpoint: 'http://127.0.0.1:1', apiKey: 'test', defaultModel: 'test-model'});
        const internal = client as any;
        registerStaffAITools(client);
        client.setToolContext({guild: {id: 'guild'}, user: {id: 'user'}});
        internal.resolveAuthCandidates = () => [{apiEndpoint: 'test', apiKey: 'test'}];
        internal.resolveModelCandidates = async () => ['test-model'];
        let requests = 0;
        internal.streamResponseApiPayload = async (_auth: unknown, payload: any, emit: any) => {
            assert.ok(++requests <= 3);
            const names = new Set(payload.tools.map((tool: any) => tool.name));
            assert.equal(names.size, 15);
            for (const name of ['manage_memory', 'manage_schedule', 'web_search', 'fetch_url',
                'get_weather', 'get_time', 'search_channel_messages', 'output_file', 'get_server_status']) assert.ok(names.has(name), name);
            assert.notEqual(payload.tool_choice, 'none');
            emit({type: 'thinking', text: sentence.repeat(3)});
            if (requests === 3) {
                emit({type: 'text', text: '共有メモはまだありません。'});
                return {responseId: 'done', functionCalls: [], outputItems: []};
            }
            const call = {id: `fc_${requests}`, type: 'function_call', call_id: `call_${requests}`,
                name: 'manage_memory', arguments: '{"action":"list","store":"server_memos"}'};
            return {responseId: 'memory', functionCalls: [{callId: call.call_id, name: call.name, arguments: call.arguments}], outputItems: [call]};
        };
        const state = new StaffAIStreamState();
        await client.streamResponse([{role: 'user', content: 'それお願い'}], delta => state.consumeResponse(delta), {
            model: 'test-model', strictModel: true, onToolStep: step => state.recordToolStep(step),
        });
        const rendered = state.renderDiscord(true).content;
        assert.equal(requests, 3);
        assert.match(rendered, /共有メモはまだありません/);
        assert.match(rendered, /共有メモ一覧を取得/);
        assert.doesNotMatch(rendered, /調査を停止しました/);
    } finally { database.get = originalGet; }
});

test('Memory argument failures report failed status and return actionable errors to the model', async () => {
    for (const api of ['responses', 'chat']) {
        const client = new ChatGPTClient({apiEndpoint: 'http://127.0.0.1:1', apiKey: 'test', defaultModel: 'test-model'});
        const internal = client as any;
        client.registerTool({type: 'function', function: {name: 'manage_memory', parameters: {type: 'object'}}}, staffMemoryHandler);
        internal.resolveAuthCandidates = () => [{apiEndpoint: 'test', apiKey: 'test'}];
        internal.resolveModelCandidates = async () => ['test-model'];
        let requests = 0;
        const call = {id: 'call_bad', type: 'function', function: {name: 'manage_memory', arguments: '{}'}};
        internal.streamResponseApiPayload = async (_auth: unknown, payload: any, emit: any) => {
            if (++requests === 1) return {responseId: 'bad', functionCalls: [{callId: call.id, name: call.function.name, arguments: '{}'}], outputItems: [
                {id: 'fc_bad', type: 'function_call', call_id: call.id, name: call.function.name, arguments: '{}'},
            ]};
            assert.match(payload.input.find((item: any) => item.type === 'function_call_output').output, /storeとaction/);
            emit({type: 'text', text: '必要なメモの種類を確認してください。'});
            return {responseId: 'done', functionCalls: [], outputItems: []};
        };
        internal.createClient = () => ({chat: {completions: {create: async (payload: any) => {
            if (++requests === 1) return {choices: [{message: {role: 'assistant', content: null, tool_calls: [call]}}]};
            assert.match(payload.messages.find((item: any) => item.role === 'tool').content, /storeとaction/);
            return {choices: [{message: {role: 'assistant', content: '必要なメモの種類を確認してください。'}}]};
        }}}});
        const phases: string[] = [];
        const options = {model: 'test-model', strictModel: true, onToolStep: (step: any) => { phases.push(step.phase); }};
        if (api === 'responses') await client.streamResponse([{role: 'user', content: 'メモを確認して'}], () => {}, options);
        else await client.sendMessage([{role: 'user', content: 'メモを確認して'}], options);
        assert.deepEqual(phases, ['started', 'failed']);
        assert.equal(requests, 2);
    }
});

test('UI metadata excludes memory and file contents and structured errors are recognized', async () => {
    assert.deepEqual(JSON.parse(toolStepArguments('manage_memory', JSON.stringify({action: 'create', store: 'server_memos', content: 'private', title: 'secret'}))!),
        {action: 'create', store: 'server_memos'});
    assert.equal(toolStepArguments('output_file', '{bad json'), undefined);
    assert.deepEqual(JSON.parse(toolStepArguments('output_file', '{"filename":"test.txt","content":"secret"}')!), {filename: 'test.txt'});
    assert.equal(toolResultError({error: '入力が不正です'}), '入力が不正です');
    assert.equal(toolResultError({error: null, data: []}), undefined);
    assert.equal(toolResultError('記録されたメモリーはありません'), undefined);
    assert.match(toolResultError(await staffMemoryHandler({}))!, /storeとaction/);
});
