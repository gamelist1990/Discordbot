import test from 'node:test';
import assert from 'node:assert/strict';

import {
    AIConversationEntry,
    buildConversationHistory,
} from '../src/core/ai/AIConversationHistory.ts';

const dataset: AIConversationEntry[] = [
    {
        id: 'legacy',
        timestamp: 50,
        userId: 'legacy-user',
        userName: 'Legacy',
        prompt: '以前の保存形式の会話',
        response: '以前の応答',
    },
    {
        id: 'other-channel',
        timestamp: 100,
        channelId: 'channel-b',
        userId: 'user-b',
        userName: 'Bob',
        prompt: '別チャンネルの秘密',
        response: '別チャンネルの応答',
    },
    {
        id: 'same-channel',
        timestamp: 200,
        channelId: 'channel-a',
        userId: 'user-a',
        userName: 'Alice',
        prompt: '好きな色は青です',
        response: '青が好きなんですね。',
    },
    {
        id: 'incomplete',
        timestamp: 300,
        channelId: 'channel-a',
        userId: 'user-a',
        userName: 'Alice',
        prompt: '未完了の質問',
        response: '途中の回答',
        incomplete: true,
    },
];

test('同じチャンネルの永続AI対話をuser/assistantの組として復元する', () => {
    const history = buildConversationHistory({
        dataset,
        channelMessages: [],
        channelId: 'channel-a',
    });

    assert.equal(history[0]?.role, 'system');
    assert.equal(history[1]?.role, 'user');
    assert.match(String(history[1]?.content), /Alice/);
    assert.match(String(history[1]?.content), /好きな色は青です/);
    assert.equal(history[2]?.role, 'assistant');
    assert.equal(history[2]?.content, '青が好きなんですね。');
    assert.ok(history.every((message) => !String(message.content).includes('別チャンネルの秘密')));
    assert.ok(history.every((message) => !String(message.content).includes('未完了の質問')));
});

test('永続AI対話とチャンネル発言を時系列に統合する', () => {
    const history = buildConversationHistory({
        dataset,
        channelId: 'channel-a',
        channelMessages: [
            {
                id: 'channel-message',
                timestamp: 250,
                role: 'user',
                authorName: 'Alice',
                content: 'その色に合うものは？',
            },
        ],
    });

    const contents = history.map((message) => String(message.content));
    const savedAnswerIndex = contents.indexOf('青が好きなんですね。');
    const followUpIndex = contents.findIndex((content) => content.includes('その色に合うものは？'));

    assert.ok(savedAnswerIndex > 0);
    assert.ok(followUpIndex > savedAnswerIndex);
});

test('チャンネル指定のない旧データも、新形式がない場合だけ利用する', () => {
    const history = buildConversationHistory({
        dataset: dataset.filter((entry) => !entry.channelId),
        channelMessages: [],
        channelId: 'channel-c',
    });

    assert.ok(history.some((message) => String(message.content).includes('以前の保存形式の会話')));
    assert.ok(history.some((message) => String(message.content).includes('以前の応答')));
});
