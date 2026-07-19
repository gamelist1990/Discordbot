import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { ChatGPTClient } from '../src/core/ai/ChatGPTClient.ts';
import { config } from '../src/config.ts';
import { Logger } from '../src/utils/Logger.ts';

function sendSse(response: http.ServerResponse, events: unknown[]): void {
    response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
    });
    for (const event of events) {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    response.write('data: [DONE]\n\n');
    response.end();
}

test('Responses APIのfunction_callを実行し、SDK経由で結果をモデルへ返す', async () => {
    const requests: any[] = [];
    const server = http.createServer(async (request, response) => {
        if (request.url === '/models') {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model', created: 0, owned_by: 'test' }] }));
            return;
        }

        if (request.url !== '/responses' || request.method !== 'POST') {
            response.writeHead(404).end();
            return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        requests.push(body);

        if (requests.length === 1) {
            const functionCall = {
                id: 'fc_test',
                type: 'function_call',
                call_id: 'call_test',
                name: 'echo_test',
                arguments: '{"value":"hello"}',
                status: 'completed',
            };
            sendSse(response, [
                { type: 'response.created', response: { id: 'resp_test_1' }, sequence_number: 0 },
                { type: 'response.output_item.done', output_index: 0, item: functionCall, sequence_number: 1 },
                { type: 'response.completed', response: { id: 'resp_test_1', output: [functionCall] }, sequence_number: 2 },
            ]);
            return;
        }

        const functionCall = body.input.find((item: any) => item.type === 'function_call');
        const functionOutput = body.input.find((item: any) => item.type === 'function_call_output');
        assert.equal(functionCall?.name, 'echo_test');
        assert.equal(functionCall?.call_id, 'call_test');
        assert.equal(functionOutput?.call_id, 'call_test');
        assert.equal(functionOutput?.output, 'echo:hello');
        assert.equal(body.previous_response_id, undefined);

        sendSse(response, [
            { type: 'response.created', response: { id: 'resp_test_2' }, sequence_number: 0 },
            { type: 'response.output_text.delta', item_id: 'msg_test', output_index: 0, content_index: 0, delta: '成功', logprobs: [], sequence_number: 1 },
            { type: 'response.completed', response: { id: 'resp_test_2', output: [] }, sequence_number: 2 },
        ]);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    try {
        const client = new ChatGPTClient({
            apiEndpoint: `http://127.0.0.1:${address.port}`,
            apiKey: 'test-key',
            defaultModel: 'test-model',
        });
        client.registerTool({
            type: 'function',
            function: {
                name: 'echo_test',
                description: 'テスト入力を返す',
                parameters: {
                    type: 'object',
                    properties: { value: { type: 'string' } },
                    required: ['value'],
                },
            },
        }, async (args: any) => `echo:${args.value}`);

        let output = '';
        const toolSteps: Array<{ phase: string; name: string; round: number }> = [];
        await client.streamResponse(
            [{ role: 'user', content: 'ツールを使って' }],
            (delta) => {
                if (delta.type === 'text') output += delta.text;
            },
            {
                model: 'test-model',
                strictModel: true,
                onToolStep: step => toolSteps.push({ phase: step.phase, name: step.name, round: step.round }),
            },
        );

        assert.equal(output, '成功');
        assert.equal(requests.length, 2);
        assert.deepEqual(toolSteps, [
            { phase: 'started', name: 'echo_test', round: 1 },
            { phase: 'completed', name: 'echo_test', round: 1 },
        ]);
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});

test('DEBUG=trueでは実際のツール実行を監査ログへ記録する', async () => {
    const previousDebug = config.DEBUG;
    const previousLogger = Logger.info;
    const logs: unknown[][] = [];
    config.DEBUG = 'true';
    Logger.info = (...args: unknown[]) => { logs.push(args); };

    try {
        const client = new ChatGPTClient({
            apiEndpoint: 'http://127.0.0.1:1',
            apiKey: 'test-key',
            defaultModel: 'test-model',
        });
        client.registerTool({
            type: 'function',
            function: {
                name: 'debug_test',
                description: 'デバッグ登録確認',
                parameters: { type: 'object', properties: {} },
            },
        }, async () => 'ok');

        assert.ok(logs.some(entry => String(entry[0]).includes('[DEBUG][ChatGPTClient][ToolCall][registered]')));
        assert.ok(logs.some(entry => JSON.stringify(entry[1]).includes('debug_test')));
    } finally {
        config.DEBUG = previousDebug;
        Logger.info = previousLogger;
    }
});

test('中断済みsignalではAIリクエストやツール処理を開始しない', async () => {
    const client = new ChatGPTClient({
        apiEndpoint: 'http://127.0.0.1:1',
        apiKey: 'test-key',
        defaultModel: 'test-model',
    });
    const controller = new AbortController();
    controller.abort(new DOMException('Newer message arrived.', 'AbortError'));

    await assert.rejects(
        client.streamResponse(
            [{ role: 'user', content: '古い質問' }],
            () => undefined,
            { model: 'test-model', strictModel: true, signal: controller.signal },
        ),
        (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
    );
});