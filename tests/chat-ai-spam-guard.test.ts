import test from 'node:test';
import assert from 'node:assert/strict';

import { ChatAISpamGuard } from '../src/core/ChatAIChannel/ChatAISpamGuard.ts';

test('短時間の同一投稿は応答対象と履歴の両方から除外する', () => {
    const guard = new ChatAISpamGuard();
    const messages = [
        { id: '1', authorId: 'user-a', timestamp: 1_000, content: '同じ投稿' },
        { id: '2', authorId: 'user-a', timestamp: 2_000, content: '同じ投稿' },
        { id: '3', authorId: 'user-a', timestamp: 3_000, content: '同じ投稿' },
    ];

    assert.equal(guard.inspect(messages[0]).spam, false);
    assert.equal(guard.inspect(messages[1]).spam, false);
    const decision = guard.inspect(messages[2]);
    assert.equal(decision.spam, true);
    assert.equal(decision.reason, 'duplicate');
    assert.deepEqual(new Set(decision.ignoredMessageIds), new Set(['1', '2', '3']));
    assert.deepEqual(guard.filterHistory(messages), []);
});

test('短時間の大量投稿はまとめて履歴から除外する', () => {
    const guard = new ChatAISpamGuard();
    const messages = Array.from({ length: 6 }, (_, index) => ({
        id: String(index + 1),
        authorId: 'user-a',
        timestamp: 1_000 + (index * 500),
        content: `投稿${index + 1}`,
    }));

    const clean = guard.filterHistory(messages);
    assert.deepEqual(clean, []);
});

test('通常会話と別ユーザーの投稿は維持する', () => {
    const guard = new ChatAISpamGuard();
    const messages = [
        { id: '1', authorId: 'user-a', timestamp: 1_000, content: 'こんにちは' },
        { id: '2', authorId: 'user-b', timestamp: 1_100, content: 'こんにちは' },
        { id: '3', authorId: 'user-a', timestamp: 2_000, content: '今日はどう？' },
    ];

    assert.deepEqual(guard.filterHistory(messages).map(message => message.id), ['1', '2', '3']);
});

test('文字や短い語の異常反復と大量メンションを除外する', () => {
    const guard = new ChatAISpamGuard();
    assert.equal(guard.inspect({ id: 'repeat', authorId: 'a', timestamp: 1_000, content: 'aaaaaaaaaa' }).spam, true);
    assert.equal(guard.inspect({ id: 'mentions', authorId: 'b', timestamp: 2_000, content: '<@1><@2><@3><@4><@5>' }).spam, true);
});

test('大量の全角wに少量の文章を付けた荒らしも除外する', () => {
    const guard = new ChatAISpamGuard();
    const decision = guard.inspect({
        id: 'ww-flood',
        authorId: 'user-a',
        timestamp: 1_000,
        content: `${'ｗ'.repeat(2_000)} こうゆう文字 等荒らしと思わしき やつもね`,
    });

    assert.equal(decision.spam, true);
    assert.equal(decision.reason, 'dominant-character-flood');
    assert.equal(guard.isIgnored('ww-flood'), true);
});

test('長文でも通常の文章は文字洪水として誤検知しない', () => {
    const guard = new ChatAISpamGuard();
    const ordinaryText = '今日は新しい機能について相談します。会話履歴とツール実行の順序を確認したいです。'.repeat(8);
    const decision = guard.inspect({
        id: 'ordinary-long-text',
        authorId: 'user-a',
        timestamp: 1_000,
        content: ordinaryText,
    });

    assert.equal(decision.spam, false);
});

test('巨大な単一文字投稿はAPI本文へ到達する前にスパムとして除外する', () => {
    const guard = new ChatAISpamGuard();
    const decision = guard.inspect({
        id: 'oversized-flood',
        authorId: 'user-a',
        timestamp: 1_000,
        content: 'ｗ'.repeat(100_000),
    });

    assert.equal(decision.spam, true);
    assert.ok(decision.reason === 'repeated-content' || decision.reason === 'dominant-character-flood');
});
