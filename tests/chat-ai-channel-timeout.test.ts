import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createChannelUserTimeoutHandler } from '../src/core/ChatAIChannel/tools/channelUserTimeout.js';
import { ChatAIChannelManager } from '../src/core/ChatAIChannel/ChatAIChannelManager.js';

test('channel_user_timeoutは現在の会話参加者だけを対象チャンネルで停止する', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-ai-timeout-'));
    const timeoutFile = path.join(directory, 'channel-user-timeouts.json');
    const handler = createChannelUserTimeoutHandler(timeoutFile);

    const result = await handler({
        userId: '123456789012345678',
        durationSeconds: 60,
        reason: '注意後も同じ妨害投稿を繰り返したため',
    }, {
        client: { user: { id: '999999999999999999' } },
        guildId: '111111111111111111',
        channelId: '222222222222222222',
        allowedUserIds: ['123456789012345678'],
    });

    const parsedResult = JSON.parse(String(result));
    assert.equal(parsedResult.status, 'CHANNEL_TIMEOUT_SET');
    assert.equal(parsedResult.userId, '123456789012345678');
    assert.equal(parsedResult.guildId, '111111111111111111');
    assert.equal(parsedResult.channelId, '222222222222222222');
    assert.equal(parsedResult.durationSeconds, 60);

    const saved = JSON.parse(await fs.readFile(timeoutFile, 'utf8'));
    const entry = saved.entries['222222222222222222:123456789012345678'];
    assert.equal(entry.reason, '注意後も同じ妨害投稿を繰り返したため');
    assert.ok(Date.parse(entry.expiresAt) > Date.parse(entry.createdAt));

    await fs.rm(directory, { recursive: true, force: true });
});

test('channel_user_timeoutは会話外ユーザーとBot自身を拒否する', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-ai-timeout-'));
    const timeoutFile = path.join(directory, 'channel-user-timeouts.json');
    const handler = createChannelUserTimeoutHandler(timeoutFile);
    const context = {
        client: { user: { id: '999999999999999999' } },
        guildId: '111111111111111111',
        channelId: '222222222222222222',
        allowedUserIds: ['123456789012345678', '999999999999999999'],
    };

    const outsider = await handler({
        userId: '333333333333333333',
        durationSeconds: 60,
        reason: '会話外ユーザーを指定する試行',
    }, context);
    assert.match(String(outsider), /現在の会話参加者/);

    const bot = await handler({
        userId: '999999999999999999',
        durationSeconds: 60,
        reason: 'Bot自身を指定する試行',
    }, context);
    assert.match(String(bot), /Bot自身/);

    await assert.rejects(fs.access(timeoutFile));
    await fs.rm(directory, { recursive: true, force: true });
});

test('channel_user_timeoutは期間と理由を検証する', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-ai-timeout-'));
    const timeoutFile = path.join(directory, 'channel-user-timeouts.json');
    const handler = createChannelUserTimeoutHandler(timeoutFile);
    const context = {
        client: { user: { id: '999999999999999999' } },
        guildId: '111111111111111111',
        channelId: '222222222222222222',
        allowedUserIds: ['123456789012345678'],
    };

    const excessive = await handler({
        userId: '123456789012345678',
        durationSeconds: 604801,
        reason: '上限を超える停止期間',
    }, context);
    assert.match(String(excessive), /期間は1〜604800秒/);

    const vague = await handler({
        userId: '123456789012345678',
        durationSeconds: 60,
        reason: '荒らし',
    }, context);
    assert.match(String(vague), /具体的な理由/);

    await fs.rm(directory, { recursive: true, force: true });
});

test('停止中ユーザーの投稿は本人へのDM通知後に削除しAI処理へ渡さない', async () => {
    const manager = new ChatAIChannelManager({
        guildId: '111111111111111111',
        channelId: '222222222222222222',
        enabled: true,
        botName: 'PEXserver',
    });
    const sentNotices: string[] = [];
    let deleted = false;
    let queued = false;
    let remembered = false;
    const timeout = {
        userId: '123456789012345678',
        guildId: '111111111111111111',
        channelId: '222222222222222222',
        reason: '注意後も同じ妨害投稿を繰り返したため',
        createdAt: new Date(Date.now() - 1_000).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const message = {
        id: 'message-1',
        content: '@PEXserver まだ続ける',
        guild: { id: '111111111111111111' },
        channel: { id: '222222222222222222' },
        author: {
            id: '123456789012345678',
            bot: false,
            send: async (text: string) => { sentNotices.push(text); },
        },
        delete: async () => { deleted = true; },
    };

    (manager as any).getActiveChannelUserTimeout = async () => timeout;
    (manager as any).queueResponse = () => { queued = true; };
    (manager as any).rememberLightweight = async () => { remembered = true; };

    await (manager as any).onMessageCreate(message);

    assert.equal(sentNotices.length, 1);
    assert.match(sentNotices[0], /理由: 注意後も同じ妨害投稿を繰り返したため/);
    assert.match(sentNotices[0], /解除:/);
    assert.match(sentNotices[0], /Discord標準タイムアウトではなく/);
    assert.equal(deleted, true);
    assert.equal(queued, false);
    assert.equal(remembered, false);
});

test('停止中ユーザーの残存投稿は会話履歴からも除外する', async () => {
    const manager = new ChatAIChannelManager({
        guildId: '111111111111111111',
        channelId: '222222222222222222',
        enabled: true,
        botName: 'PEXserver',
    });
    const blocked = {
        id: 'blocked-1',
        content: '停止中の投稿',
        createdTimestamp: Date.now(),
        author: { id: '123456789012345678', bot: false },
    };
    const allowed = {
        id: 'allowed-1',
        content: '通常の投稿',
        createdTimestamp: Date.now(),
        author: { id: '333333333333333333', bot: false },
    };
    const channel = {
        messages: {
            fetch: async () => new Map([
                [allowed.id, allowed],
                [blocked.id, blocked],
            ]),
        },
    };
    (manager as any).getActiveChannelUserTimeout = async (userId: string) => (
        userId === blocked.author.id ? { expiresAt: new Date(Date.now() + 60_000).toISOString() } : null
    );

    const history = await (manager as any).fetchRecentMessages(channel);
    assert.deepEqual(history.map((entry: any) => entry.id), ['allowed-1']);
});
