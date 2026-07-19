import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createUserMemoryEditHandler } from '../src/core/ChatAIChannel/tools/userMemoryEdit.ts';
import { ChatAIChannelManager } from '../src/core/ChatAIChannel/ChatAIChannelManager.ts';

test('user_memory_editは既存ユーザーを部分更新しJSONを壊さない', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-ai-memory-'));
    const memoryFile = path.join(directory, 'user-memory.json');
    await fs.writeFile(memoryFile, JSON.stringify({
        users: {
            '735854461636837389': {
                userId: '735854461636837389',
                displayName: 'こう君',
                aliases: ['koukun_'],
                profile: '',
                likes: [],
                notes: ['サーバー主'],
                updatedAt: '2026-01-01T00:00:00.000Z',
            },
        },
        updatedAt: '2026-01-01T00:00:00.000Z',
    }, null, 2), 'utf8');

    const handler = createUserMemoryEditHandler(memoryFile);
    const result = await handler({
        action: 'update',
        userId: '735854461636837389',
        profile: 'Minecraftサーバーを管理している',
        likes: ['開発', '開発', 'Minecraft'],
        notes: ['サーバー主', 'Botを開発している'],
        conversationTone: '簡潔でフレンドリーに話す',
        cautions: ['技術的な依頼は結論を先に伝える'],
        relationshipTone: 'friendly',
        relationshipContext: '協力的な技術相談が続いている',
    }, {});

    assert.match(String(result), /USER_MEMORY_UPDATED/);
    const saved = JSON.parse(await fs.readFile(memoryFile, 'utf8'));
    assert.equal(saved.users['735854461636837389'].displayName, 'こう君');
    assert.equal(saved.users['735854461636837389'].profile, 'Minecraftサーバーを管理している');
    assert.deepEqual(saved.users['735854461636837389'].likes, ['開発', 'Minecraft']);
    assert.deepEqual(saved.users['735854461636837389'].notes, ['サーバー主', 'Botを開発している']);
    assert.equal(saved.users['735854461636837389'].conversationTone, '簡潔でフレンドリーに話す');
    assert.deepEqual(saved.users['735854461636837389'].cautions, ['技術的な依頼は結論を先に伝える']);
    assert.equal(saved.users['735854461636837389'].relationshipTone, 'friendly');
    assert.equal(saved.users['735854461636837389'].relationshipContext, '協力的な技術相談が続いている');
    await fs.rm(directory, { recursive: true, force: true });
});

test('user_memory_editは未観測ユーザーを勝手に新規作成しない', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-ai-memory-'));
    const memoryFile = path.join(directory, 'user-memory.json');
    await fs.writeFile(memoryFile, JSON.stringify({ users: {}, updatedAt: new Date().toISOString() }), 'utf8');
    const handler = createUserMemoryEditHandler(memoryFile);

    const result = await handler({
        action: 'update',
        userId: '999999999999999999',
        notes: ['未確認情報'],
    }, {});

    assert.match(String(result), /USER_MEMORY_NOT_FOUND/);
    const saved = JSON.parse(await fs.readFile(memoryFile, 'utf8'));
    assert.deepEqual(saved.users, {});
    await fs.rm(directory, { recursive: true, force: true });
});

test('user_memory_editは一覧取得と削除を実行できる', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-ai-memory-'));
    const memoryFile = path.join(directory, 'user-memory.json');
    await fs.writeFile(memoryFile, JSON.stringify({
        users: {
            '735854461636837389': {
                userId: '735854461636837389', displayName: 'こう君', aliases: [], profile: '', likes: [], notes: [], updatedAt: new Date().toISOString(),
            },
        },
        updatedAt: new Date().toISOString(),
    }), 'utf8');
    const handler = createUserMemoryEditHandler(memoryFile);

    const listed = await handler({ action: 'list' }, {});
    assert.match(String(listed), /735854461636837389/);
    const deleted = await handler({ action: 'delete', userId: '735854461636837389' }, {});
    assert.match(String(deleted), /USER_MEMORY_DELETED/);
    const saved = JSON.parse(await fs.readFile(memoryFile, 'utf8'));
    assert.deepEqual(saved.users, {});
    await fs.rm(directory, { recursive: true, force: true });
});

test('user_memory_editは会話トーンと注意事項を空値で削除できる', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-ai-memory-'));
    const memoryFile = path.join(directory, 'user-memory.json');
    await fs.writeFile(memoryFile, JSON.stringify({
        users: {
            '735854461636837389': {
                userId: '735854461636837389', displayName: 'こう君', aliases: [], profile: '', likes: [], notes: [],
                conversationTone: '丁寧に話す', cautions: ['短く答える'], updatedAt: new Date().toISOString(),
            },
        },
        updatedAt: new Date().toISOString(),
    }), 'utf8');
    const handler = createUserMemoryEditHandler(memoryFile);

    await handler({
        action: 'update', userId: '735854461636837389', conversationTone: '', cautions: [],
    }, {});

    const saved = JSON.parse(await fs.readFile(memoryFile, 'utf8'));
    assert.equal(saved.users['735854461636837389'].conversationTone, undefined);
    assert.deepEqual(saved.users['735854461636837389'].cautions, []);
    await fs.rm(directory, { recursive: true, force: true });
});

test('user_memory_editは関係姿勢を安全な3段階だけに制限する', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-ai-memory-'));
    const memoryFile = path.join(directory, 'user-memory.json');
    await fs.writeFile(memoryFile, JSON.stringify({
        users: {
            '735854461636837389': {
                userId: '735854461636837389', displayName: 'こう君', aliases: [], profile: '', likes: [], notes: [],
                relationshipTone: 'neutral', updatedAt: new Date().toISOString(),
            },
        },
        updatedAt: new Date().toISOString(),
    }), 'utf8');
    const handler = createUserMemoryEditHandler(memoryFile);

    await handler({ action: 'update', userId: '735854461636837389', relationshipTone: 'hostile' }, {});
    let saved = JSON.parse(await fs.readFile(memoryFile, 'utf8'));
    assert.equal(saved.users['735854461636837389'].relationshipTone, 'neutral');

    await handler({
        action: 'update', userId: '735854461636837389', relationshipTone: 'firm',
        relationshipContext: '境界を越える冗談が繰り返されたため、簡潔に線を引く',
    }, {});
    saved = JSON.parse(await fs.readFile(memoryFile, 'utf8'));
    assert.equal(saved.users['735854461636837389'].relationshipTone, 'firm');
    assert.match(saved.users['735854461636837389'].relationshipContext, /簡潔に線を引く/);
    await fs.rm(directory, { recursive: true, force: true });
});

test('user_memory_editのツール実行状況はDiscord表示へ出さない', () => {
    const manager = new ChatAIChannelManager({
        guildId: 'guild-1',
        channelId: 'channel-1',
        enabled: true,
        botName: 'ぺぺちゃん',
    });

    const hidden = (manager as any).formatStreamingResponse('', '', false, {
        phase: 'started',
        name: 'user_memory_edit',
        round: 1,
    });
    assert.equal(hidden, '…');
    assert.doesNotMatch(hidden, /user_memory_edit|Step|実行中/);

    const visible = (manager as any).formatStreamingResponse('', '', false, {
        phase: 'started',
        name: 'weather_lookup',
        round: 1,
    });
    assert.match(visible, /weather_lookup/);
    assert.match(visible, /実行中/);
});

test('関係姿勢の文脈は人物への罵倒ではなく観測可能な行動として保存できる', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-ai-memory-'));
    const memoryFile = path.join(directory, 'user-memory.json');
    await fs.writeFile(memoryFile, JSON.stringify({
        users: {
            '735854461636837389': {
                userId: '735854461636837389', displayName: '利用者', aliases: [], profile: '', likes: [], notes: [],
                relationshipTone: 'neutral', updatedAt: new Date().toISOString(),
            },
        },
        updatedAt: new Date().toISOString(),
    }), 'utf8');
    const handler = createUserMemoryEditHandler(memoryFile);

    await handler({
        action: 'update',
        userId: '735854461636837389',
        relationshipTone: 'firm',
        relationshipContext: '注意後も同じ嫌がらせの話題が繰り返されたため、その話題への応答を短く打ち切る',
        cautions: ['人格ではなく問題となる発言を具体的に指摘する'],
    }, {});

    const saved = JSON.parse(await fs.readFile(memoryFile, 'utf8'));
    assert.equal(saved.users['735854461636837389'].relationshipTone, 'firm');
    assert.match(saved.users['735854461636837389'].relationshipContext, /嫌がらせの話題が繰り返された/);
    assert.deepEqual(saved.users['735854461636837389'].cautions, ['人格ではなく問題となる発言を具体的に指摘する']);
    await fs.rm(directory, { recursive: true, force: true });
});

test('謝罪待ちの境界状態をユーザー別に保存し明示的に解除できる', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-ai-memory-'));
    const memoryFile = path.join(directory, 'user-memory.json');
    await fs.writeFile(memoryFile, JSON.stringify({
        users: {
            '735854461636837389': {
                userId: '735854461636837389', displayName: '利用者', aliases: [], profile: '', likes: [], notes: [],
                relationshipTone: 'firm', updatedAt: new Date().toISOString(),
            },
        },
        updatedAt: new Date().toISOString(),
    }), 'utf8');
    const handler = createUserMemoryEditHandler(memoryFile);

    await handler({
        action: 'update', userId: '735854461636837389',
        boundaryState: 'awaiting-apology',
        relationshipContext: '脅しを含む命令があり、具体的な謝罪と行動改善を確認するまで線を引く',
    }, {});
    let saved = JSON.parse(await fs.readFile(memoryFile, 'utf8'));
    assert.equal(saved.users['735854461636837389'].boundaryState, 'awaiting-apology');

    await handler({ action: 'update', userId: '735854461636837389', boundaryState: 'clear' }, {});
    saved = JSON.parse(await fs.readFile(memoryFile, 'utf8'));
    assert.equal(saved.users['735854461636837389'].boundaryState, 'clear');
    await fs.rm(directory, { recursive: true, force: true });
});