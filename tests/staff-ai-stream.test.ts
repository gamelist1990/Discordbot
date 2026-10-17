import test from 'node:test';
import assert from 'node:assert/strict';
import { StaffAIStreamState } from '../src/commands/staff/subcommands/StaffAIStreamState.ts';

test('通常のDiscord本文にツール進捗をMarkdown表示する（Embedなし）', () => {
    const stream = new StaffAIStreamState();
    stream.consume({ choices: [{ delta: { content: 'こんにちは！' } }] } as any);
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call1', function: { name: 'get_weather', arguments: '{"prefecture":' } }] } }] } as any);
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"東京"}' } }] } }] } as any);
    assert.equal(stream.renderDiscord().embeds.length, 0);
    assert.match(stream.render(), /東京/);
    stream.recordToolStep({ phase: 'started', name: 'get_weather', round: 1 });
    assert.match(stream.render(), /実行中/);
    stream.recordToolStep({ phase: 'completed', name: 'get_weather', round: 1 });
    stream.consume({ choices: [], usage: { prompt_tokens: 400, completion_tokens: 24, total_tokens: 424 }, timings: { predicted_n: 24, predicted_ms: 600, predicted_per_second: 40 } } as any);
    stream.consume({ choices: [{ delta: { content: '晴れだよ！' } }] } as any);
    stream.consume({ choices: [], usage: { prompt_tokens: 480, completion_tokens: 18, total_tokens: 498 }, timings: { predicted_n: 18, predicted_ms: 360, predicted_per_second: 50 } } as any);
    const result = stream.renderDiscord(true);
    assert.equal(result.embeds.length, 0);
    assert.match(result.content, /こんにちは！晴れだよ！/);
    assert.match(result.content, /✅ 天気/);
    assert.match(result.content, /43\.8 toks\/s · toks: 922 \(in 880 \/ out 42\)/);
    assert.equal(result.content.includes('▌'), false);
});

test('Discord2000字制限とtoken欄を守る', () => {
    const stream = new StaffAIStreamState();
    stream.consume({ choices: [{ delta: { content: 'あ'.repeat(8000) } }] } as any);
    const text = stream.render(true);
    assert.ok(text.length <= 2000);
    assert.ok(text.endsWith('— toks/s · toks: 未取得 (API未提供)'));
});

test('ツールの秘密引数・生JSON・コードブロック注入を出さない', () => {
    const stream = new StaffAIStreamState();
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'secret', function: { name: 'tool', arguments: '{"token":"top-secret","name":"```"}' } }] } }] } as any);
    const text = stream.renderDiscord().content;
    assert.ok(!text.includes('top-secret'));
    assert.match(text, /```ansi/);
    assert.equal((text.match(/```/g) || []).length, 2);
    assert.match(text, /ツール/);
});

test('同じindexで別ラウンドのツールは区別する', () => {
    const stream = new StaffAIStreamState();
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'first', function: { name: 'time' } }] } }] } as any);
    stream.recordToolStep({ phase: 'completed', name: 'time', round: 1 });
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'second', function: { name: 'status' } }] } }] } as any);
    stream.recordToolStep({ phase: 'started', name: 'status', round: 2 });
    assert.match(stream.render(), /実行中/);
    assert.match(stream.render(), /完了/);
});

test('生成速度はprefill時間を含まない値を出す', () => {
    const stream = new StaffAIStreamState();
    stream.consume({ choices: [], usage: { prompt_tokens: 2000, completion_tokens: 2, total_tokens: 2002 }, timings: { predicted_n: 2, predicted_ms: 100, predicted_per_second: 9.8157582 } } as any);
    assert.match(stream.render(true), /9\.8 toks\/s · toks: 2002/);
});

test('Thinkingの生内容は絶対に表示せず小さな進捗だけを出す', () => {
    const stream = new StaffAIStreamState();
    stream.consume({ choices: [{ delta: { reasoning_content: 'Internal hidden reasoning must not leak' } }] } as any);
    assert.match(stream.render(), /💭 Thinking/);
    assert.doesNotMatch(stream.render(), /Internal/);
    stream.consume({ choices: [{ delta: { content: '調べたよ！' } }] } as any);
    const result = stream.renderDiscord(true);
    assert.equal(result.embeds.length, 0);
    assert.equal(result.content.includes('Internal'), false);
    assert.match(result.content, /調べたよ！/);
    assert.equal(new StaffAIStreamState().renderDiscord(true).embeds.length, 0);
});

test('Web検索結果をMarkdownで短く表示し秘密は漏らさない', () => {
    const stream = new StaffAIStreamState();
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'web1', function: { name: 'web_search', arguments: '{"query":"inmu king","api_key":"secret-123"}' } }] } }] } as any);
    stream.recordToolStep({ phase: 'started', name: 'web_search', round: 1 });
    const first = stream.renderDiscord().content;
    assert.match(first, /Web検索/);
    assert.match(first, /inmu king/);
    assert.doesNotMatch(first, /secret-123/);
    stream.recordToolStep({ phase: 'completed', name: 'web_search', round: 1 });
    assert.match(stream.renderDiscord(true).content, /完了/);
});

test('Responses SSE のThinkingと本文は別に描画し、usage/timingsを合計する', () => {
    const stream = new StaffAIStreamState();
    stream.consumeResponse({ type: 'thinking', text: 'abc' });
    const before = stream.render();
    assert.match(before, /💭 Thinking/);
    assert.match(before, /3文字/);
    stream.consumeResponse({ type: 'thinking', text: 'defgh' });
    assert.match(stream.render(), /8文字/);
    assert.equal((stream.render().match(/Thinking/g) || []).length, 1);
    stream.consumeResponse({ type: 'text', text: '画像は赤だよ。' });
    assert.doesNotMatch(stream.render(), /Thinking/);
    stream.consumeResponse({ type: 'usage', inputTokens: 100, outputTokens: 50, totalTokens: 150,
        predictedTokens: 50, predictedPerSecond: 25 });
    const final = stream.renderDiscord(true);
    assert.equal(final.embeds.length, 0);
    assert.match(final.content, /画像は赤だよ/);
    assert.match(final.content, /25\.0 toks\/s · toks: 150 \(in 100 \/ out 50\)/);
    assert.match(final.content, /💭 Thinking · 完了/);
    assert.doesNotMatch(final.content, /abcdefgh/);
});
