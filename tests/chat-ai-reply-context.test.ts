import test from 'node:test';
import assert from 'node:assert/strict';

import { ChatAIChannelManager } from '../src/core/ChatAIChannel/ChatAIChannelManager.ts';

function createManager(): ChatAIChannelManager {
    const manager = new ChatAIChannelManager({
        guildId: 'guild-1',
        channelId: 'channel-1',
        enabled: true,
        botName: 'ぺぺちゃん',
    });
    (manager as any).client = { user: { id: 'bot-1' } };
    return manager;
}

test('Bot自身へのリプライは名前やメンションがなくても応答対象になる', async () => {
    const manager = createManager();
    const message = {
        content: 'それってどういう意味？',
        reference: { messageId: 'bot-message-1' },
        mentions: { users: { has: () => false } },
        author: { id: 'user-1' },
        fetchReference: async () => ({ author: { id: 'bot-1' } }),
    };

    assert.equal(await (manager as any).shouldTrigger(message), true);
});

test('別ユーザーへのリプライだけでは常駐AIを呼び出さない', async () => {
    const manager = createManager();
    const message = {
        content: 'なるほど',
        reference: { messageId: 'human-message-1' },
        mentions: { users: { has: () => false } },
        author: { id: 'user-1' },
        fetchReference: async () => ({ author: { id: 'user-2' } }),
    };

    assert.equal(await (manager as any).shouldTrigger(message), false);
});

test('現在ターンのリプライは返信先本文と投稿者を引用する', async () => {
    const manager = createManager();
    const referenced = {
        content: 'この機能は明日有効になります',
        author: { id: 'bot-1', displayName: 'ぺぺちゃん', username: 'pex-bot' },
        member: null,
        attachments: new Map(),
    };
    const message = {
        id: 'reply-1',
        content: 'この部分を詳しく教えて',
        createdTimestamp: Date.now(),
        reference: { messageId: 'bot-message-1' },
        author: { id: 'user-1', displayName: '利用者', username: 'user' },
        member: null,
        attachments: new Map(),
        fetchReference: async () => referenced,
    };

    const formatted = await (manager as any).formatCurrentTurnLine(message);
    assert.match(formatted, /【返信先の引用】ぺぺちゃん \(bot-1\): この機能は明日有効になります/);
    assert.match(formatted, /この部分を詳しく教えて/);
});

test('返信先を取得できなくても応答処理は継続する', async () => {
    const manager = createManager();
    const message = {
        id: 'reply-1',
        content: '元メッセージは消えた？',
        createdTimestamp: Date.now(),
        reference: { messageId: 'deleted-message' },
        author: { id: 'user-1', displayName: '利用者', username: 'user' },
        member: null,
        attachments: new Map(),
        fetchReference: async () => { throw new Error('Unknown Message'); },
    };

    const formatted = await (manager as any).formatCurrentTurnLine(message);
    assert.match(formatted, /返信先の引用.*取得できませんでした/);
    assert.match(formatted, /deleted-message/);
});

test('最新Bot応答より後に人間の発言がなければ処理済み発言を再処理しない', () => {
    const manager = createManager();
    const history = [
        { author: { bot: false }, content: '@PEXserver', id: 'human-1' },
        { author: { bot: true }, content: '何か用かな？', id: 'bot-1' },
    ];

    assert.equal((manager as any).hasUnansweredHumanMessage(history), false);
});

test('生成中に届いた人間の新着発言がBot応答より後にあれば次の処理対象にする', () => {
    const manager = createManager();
    const history = [
        { author: { bot: false }, content: '@PEXserver', id: 'human-1' },
        { author: { bot: true }, content: '最初の応答', id: 'bot-1' },
        { author: { bot: false }, content: '追加で聞きたい', id: 'human-2' },
    ];

    assert.equal((manager as any).hasUnansweredHumanMessage(history), true);
});

test('返信先はClientのチャンネルキャッシュではなく現在チャンネルから優先取得する', async () => {
    const manager = createManager();
    let legacyFetchCalled = false;
    const message = {
        content: '続き教えて',
        reference: { messageId: 'bot-message-1', channelId: 'uncached-channel' },
        mentions: { users: { has: () => false } },
        author: { id: 'user-1' },
        channel: {
            messages: { fetch: async () => ({ author: { id: 'bot-1' } }) },
        },
        fetchReference: async () => {
            legacyFetchCalled = true;
            throw new Error('GuildChannelResolve');
        },
    };

    assert.equal(await (manager as any).shouldTrigger(message), true);
    assert.equal(legacyFetchCalled, false);
});