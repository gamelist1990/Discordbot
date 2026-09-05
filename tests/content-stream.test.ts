import test from 'node:test';
import assert from 'node:assert/strict';
import { readContentStream } from '../src/core/anticheat/ContentStream.ts';

const sse = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    return new Response(new ReadableStream({ pull(controller) {
        if (offset === bytes.length) controller.close();
        else controller.enqueue(bytes.slice(offset, ++offset));
    } }), { headers: { 'Content-Type': 'text/event-stream' } });
};
const chunk = (delta: any, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\r\n\r\n`;

test('SSE assembles fragmented function names, Japanese arguments and ignores reasoning/usage', async () => {
    const text = ': keepalive\r\n\r\n'
        + chunk({ reasoning_content: 'private reasoning' })
        + chunk({ tool_calls: [{ index: 0, type: 'function', function: { name: 'submit_', arguments: '{"explanation":"' } }] })
        + chunk({ tool_calls: [{ index: 0, function: { name: 'verdict', arguments: '画像の説明"}' } }] })
        + chunk({}, 'tool_calls')
        + 'data: {"choices":[],"usage":{}}\n\n'
        + 'data: [DONE]\n\n';
    const progress: number[] = [];
    const result = await readContentStream(sse(text), count => progress.push(count));
    assert.deepEqual(result.choices[0], { finish_reason: 'tool_calls', message: { tool_calls: [
        { type: 'function', function: { name: 'submit_verdict', arguments: '{"explanation":"画像の説明"}' } }
    ] } });
    assert.deepEqual(progress, [1]);
    assert.ok(!JSON.stringify(result).includes('private reasoning'));
});

test('stream disconnect, missing finish, malformed JSON and error events reject', async () => {
    for (const text of [chunk({}, 'tool_calls'), 'data: [DONE]\n\n', 'data: {broken}\n\n', 'data: {"error":{"message":"private"}}\n\n']) {
        await assert.rejects(readContentStream(sse(text), () => {}));
    }
});

test('finish length and multiple calls are retained for verdict protocol validation', async () => {
    const text = chunk({ tool_calls: [
        { index: 1, type: 'function', function: { name: 'second', arguments: '{}' } },
        { index: 0, type: 'function', function: { name: 'first', arguments: '{}' } }
    ] }, 'length') + 'data: [DONE]\n\n';
    const result = await readContentStream(sse(text), () => {});
    assert.equal(result.choices[0].finish_reason, 'length');
    assert.deepEqual(result.choices[0].message.tool_calls.map((call: any) => call.function.name), ['first', 'second']);
});

test('JSON fallback supports proxies ignoring stream flag', async () => {
    const value = { choices: [{ message: { tool_calls: [] }, finish_reason: 'stop' }] };
    assert.deepEqual(await readContentStream(Response.json(value), () => {}), value);
});
