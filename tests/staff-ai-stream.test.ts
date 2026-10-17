import test from 'node:test';
import assert from 'node:assert/strict';
import { StaffAIStreamState } from '../src/commands/staff/subcommands/StaffAIStreamState.ts';

test('SSEテキストとツール引数を逐次表示して実行状態を更新する', () => {
    const stream = new StaffAIStreamState();
    stream.consume({ choices: [{ delta: { content: 'こんにちは！' } }] } as any);
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call1', function: { name: 'weather', arguments: '{"city":' } }] } }] } as any);
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"東京"}' } }] } }] } as any);
    assert.match(stream.render(), /```json\n/);
    assert.match(stream.render(), /東京/);
    stream.recordToolStep({ phase: 'started', name: 'weather', round: 1 });
    assert.match(stream.render(), /実行中/);
    stream.recordToolStep({ phase: 'completed', name: 'weather', round: 1 });
    stream.consume({ choices: [], usage: { prompt_tokens: 400, completion_tokens: 24, total_tokens: 424 }, timings: { predicted_n: 24, predicted_ms: 600, predicted_per_second: 40 } } as any);
    stream.consume({ choices: [{ delta: { content: '晴れだよ！' } }] } as any);
    stream.consume({ choices: [], usage: { prompt_tokens: 480, completion_tokens: 18, total_tokens: 498 }, timings: { predicted_n: 18, predicted_ms: 360, predicted_per_second: 50 } } as any);
    const completed = stream.render(true);
    assert.match(completed, /完了/);
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
    const rendered = stream.render();
    assert.ok(!rendered.includes('top-secret'));
    assert.ok(rendered.includes('***'));
    assert.ok(!rendered.includes('name\\":\\":'));
});

test('同じindexの複数ラウンドのツール呼び出しを別として記録する', () => {
    const stream = new StaffAIStreamState();
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'first', function: { name: 'time' } }] } }] } as any);
    stream.recordToolStep({ phase: 'completed', name: 'time', round: 1 });
    stream.consume({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'second', function: { name: 'status' } }] } }] } as any);
    stream.recordToolStep({ phase: 'started', name: 'status', round: 2 });
    assert.match(stream.render(), /time/);
    assert.match(stream.render(), /status/);
    assert.match(stream.render(), /実行中/);
});

test('APIの生成速度があれば実測値を使用してprefill時間を含めない', () => {
    const stream = new StaffAIStreamState();
    stream.consume({
        choices: [], usage: { prompt_tokens: 2000, completion_tokens: 2, total_tokens: 2002 },
        timings: { predicted_n: 2, predicted_ms: 100, predicted_per_second: 9.8157582 },
    } as any);
    assert.match(stream.render(true), /9\.8 toks\/s · toks: 2002/);
});
