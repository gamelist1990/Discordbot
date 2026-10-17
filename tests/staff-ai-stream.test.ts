import test from 'node:test';
import assert from 'node:assert/strict';
import { StaffAIStreamState } from '../src/commands/staff/subcommands/StaffAIStreamState.ts';

test('SSEテキストとツール引数を逐次表示して実行状態を更新する', () => {
    const stream = new StaffAIStreamState();
    stream.consume({ choices: [{ delta: { content: 'こんにちは！' } }] } as any);
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call1', function: { name: 'get_weather', arguments: '{"prefecture":' } }] } }] } as any);
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"東京"}' } }] } }] } as any);
    assert.equal(stream.render().includes('```'), false);
    assert.match(stream.renderDiscord().embeds[0].toJSON().fields![0].value, /東京/);
    stream.recordToolStep({ phase: 'started', name: 'get_weather', round: 1 });
    assert.match(stream.renderDiscord().embeds[0].toJSON().fields![0].value, /実行中/);
    stream.recordToolStep({ phase: 'completed', name: 'get_weather', round: 1 });
    stream.consume({ choices: [], usage: { prompt_tokens: 400, completion_tokens: 24, total_tokens: 424 }, timings: { predicted_n: 24, predicted_ms: 600, predicted_per_second: 40 } } as any);
    stream.consume({ choices: [{ delta: { content: '晴れだよ！' } }] } as any);
    stream.consume({ choices: [], usage: { prompt_tokens: 480, completion_tokens: 18, total_tokens: 498 }, timings: { predicted_n: 18, predicted_ms: 360, predicted_per_second: 50 } } as any);
    const completed = stream.render(true);
    assert.match(stream.renderDiscord(true).embeds[0].toJSON().fields![0].value, /完了/);
    assert.match(completed, /こんにちは！晴れだよ！/);
    assert.match(completed, /43\.8 toks\/s · toks: 922 \(in 880 \/ out 42\)$/);
    assert.equal(completed.includes('▌'), false);
});

test('長文でもDiscordの文字制限内にトークン欄を残す', () => {
    const stream = new StaffAIStreamState();
    stream.consume({ choices: [{ delta: { content: 'あ'.repeat(8000) } }] } as any);
    assert.ok(stream.render(true).length <= 2000);
    assert.ok(stream.render(true).endsWith('— toks/s · toks: 未取得 (API未提供)'));
});

test('ツール引数を伏字にしてコードブロック注入を避ける', () => {
    const stream = new StaffAIStreamState();
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'secret', function: { name: 'tool', arguments: '{"token":"top-secret","name":"```"}' } }] } }] } as any);
    const rendered = JSON.stringify(stream.renderDiscord());
    assert.ok(!rendered.includes('top-secret'));
    assert.ok(!rendered.includes('\`\`\`'));
    assert.ok(rendered.includes('ツール'));
});

test('同じindexの複数ラウンドのツール呼び出しを別として記録する', () => {
    const stream = new StaffAIStreamState();
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'first', function: { name: 'time' } }] } }] } as any);
    stream.recordToolStep({ phase: 'completed', name: 'time', round: 1 });
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'second', function: { name: 'status' } }] } }] } as any);
    stream.recordToolStep({ phase: 'started', name: 'status', round: 2 });
    const display = JSON.stringify(stream.renderDiscord().embeds.map(embed => embed.toJSON()));
    assert.match(display, /ツール/);
    assert.match(display, /実行中/);
});

test('APIの生成速度があれば実測値を使用してprefill時間を含めない', () => {
    const stream = new StaffAIStreamState();
    stream.consume({
        choices: [], usage: { prompt_tokens: 2000, completion_tokens: 2, total_tokens: 2002 },
        timings: { predicted_n: 2, predicted_ms: 100, predicted_per_second: 9.8157582 },
    } as any);
    assert.match(stream.render(true), /9\.8 toks\/s · toks: 2002/);
});

test('Thinkingは通常文とは異なる紫色のEmbedに、実データがある場合だけ表示', () => {
    const stream = new StaffAIStreamState();
    assert.equal(stream.renderDiscord().embeds.length, 1);
    assert.equal(stream.renderDiscord().embeds[0].toJSON().color, 0x8b5cf6);
    stream.consume({ choices: [{ delta: { reasoning_content: '検索してから答える' } }] } as any);
    stream.consume({ choices: [{ delta: { content: '調べたよ！' } }] } as any);
    const result = stream.renderDiscord(true);
    assert.equal(result.content.includes('検索してから答える'), false);
    assert.equal(result.embeds[0].toJSON().color, 0x8b5cf6);
    assert.match(result.embeds[0].toJSON().description!, /検索してから答える/);
    const plain = new StaffAIStreamState();
    plain.consume({ choices: [{ delta: { content: 'こんにちは' } }] } as any);
    assert.equal(plain.renderDiscord(true).embeds.length, 0);
});

test('Web検索は引数JSONを出さず短い説明をEmbedに表示', () => {
    const stream = new StaffAIStreamState();
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'web1', function: {
        name: 'web_search', arguments: '{"query":"inmu king","api_key":"secret-123"}',
    } }] } }] } as any);
    stream.recordToolStep({ phase: 'started', name: 'web_search', round: 1 });
    const embed = stream.renderDiscord().embeds[0].toJSON();
    assert.equal(embed.color, 0xf59e0b);
    assert.match(embed.fields![0].name, /Web検索/);
    assert.match(embed.fields![0].value, /inmu king/);
    assert.equal(JSON.stringify(embed).includes('secret-123'), false);
    stream.recordToolStep({ phase: 'completed', name: 'web_search', round: 1 });
    assert.equal(stream.renderDiscord(true).embeds[0].toJSON().color, 0x22c55e);
});
