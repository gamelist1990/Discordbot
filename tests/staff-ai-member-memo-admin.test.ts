import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import {
    loadGuildMemberMemoStore,
    normalizeMemberMemoStore,
    removeGuildMemberMemo,
    saveGuildMemberMemoStore,
    toMemberMemoAdminItem,
    MEMBER_MEMO_STORE_KEY,
    type GuildMemberMemo,
    type MemberMemoStoreAdapter,
} from '../src/core/ai/GuildMemberMemory.ts';
import { database } from '../src/core/persistence/Database.ts';
import { createStaffAIRoutes } from '../src/web/routes/staff/ai.ts';
import type { SettingsSession } from '../src/web/types/index.ts';

// ---------------------------------------------------------------------------
// removeGuildMemberMemo（管理画面からの正規の削除経路）
// ---------------------------------------------------------------------------

function memo(overrides: Partial<GuildMemberMemo> = {}): GuildMemberMemo {
    return {
        userId: '111111111111111111',
        name: 'テストメンバー',
        memo: 'マイクラの建築の話題が多い。',
        messageCount: 12,
        updatedAt: '2026-11-08T00:00:00.000Z',
        lastSeenAt: 1_700_000_000_000,
        ...overrides,
    };
}

function memoryAdapter(initial: unknown) {
    let stored = initial;
    const adapter: MemberMemoStoreAdapter = {
        get: async () => stored,
        set: async (_guildId, _key, value) => { stored = value; },
    };
    return { adapter, read: () => stored };
}

test('removeGuildMemberMemo: 対象を削除して永続化し、削除レコードを返す', async () => {
    const { adapter, read } = memoryAdapter({
        version: 1,
        memos: [memo(), memo({ userId: '222222222222222222', name: '別人' })],
    });
    const removed = await removeGuildMemberMemo('g1', '111111111111111111', adapter);
    assert.equal(removed?.userId, '111111111111111111');
    assert.equal(removed?.name, 'テストメンバー');
    const afterStore = normalizeMemberMemoStore(read());
    assert.deepEqual(afterStore.memos.map(m => m.userId), ['222222222222222222']);
    const loaded = await loadGuildMemberMemoStore('g1', adapter);
    assert.equal(loaded.memos.length, 1);
});

test('removeGuildMemberMemo: 対象が無ければ null で、ストアは変わらない', async () => {
    const { adapter, read } = memoryAdapter({ version: 1, memos: [memo()] });
    const removed = await removeGuildMemberMemo('g1', '999999999999999999', adapter);
    assert.equal(removed, null);
    assert.equal(normalizeMemberMemoStore(read()).memos.length, 1);
});

test('removeGuildMemberMemo: 空のIDでは何もしない', async () => {
    const { adapter } = memoryAdapter({ version: 1, memos: [memo()] });
    assert.equal(await removeGuildMemberMemo('', '111111111111111111', adapter), null);
    assert.equal(await removeGuildMemberMemo('g1', '', adapter), null);
});

test('toMemberMemoAdminItem: 表示に必要な項目だけへ整形する', () => {
    const item = toMemberMemoAdminItem(memo());
    assert.deepEqual(item, {
        userId: '111111111111111111',
        name: 'テストメンバー',
        memo: 'マイクラの建築の話題が多い。',
        messageCount: 12,
        updatedAt: '2026-11-08T00:00:00.000Z',
        lastSeenAt: 1_700_000_000_000,
    });
});

// ---------------------------------------------------------------------------
// ルート（GET閲覧はレベル1以上、DELETEはレベル2以上またはBot管理者）
// ---------------------------------------------------------------------------

const GUILD_ID = '987654321098765432';
const TARGET_ID = '111111111111111111';

function session(overrides: Partial<SettingsSession>): SettingsSession {
    return {
        userId: '333333333333333333',
        username: 'tester',
        guildId: GUILD_ID,
        guildIds: [GUILD_ID],
        permissions: [{ guildId: GUILD_ID, level: 1 }],
        expiresAt: Date.now() + 60_000,
        ...overrides,
    };
}

let baseUrl = '';
let server: ReturnType<typeof express.application.listen>;

before(async () => {
    const sessions = new Map<string, SettingsSession>();
    sessions.set('tok-level1', session({ userId: '333333333333333333' }));
    sessions.set('tok-level2', session({
        userId: '444444444444444444',
        permissions: [{ guildId: GUILD_ID, level: 2 }],
    }));
    sessions.set('tok-owner', session({
        userId: '555555555555555555',
        isOwner: true,
    }));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        (req as any).cookies = {};
        const header = req.headers.cookie;
        if (header) {
            for (const part of header.split(';')) {
                const [name, value] = part.trim().split('=');
                if (name) (req as any).cookies[name] = value;
            }
        }
        next();
    });
    app.use('/api/staff/ai', createStaffAIRoutes(sessions, {} as never));
    server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await saveGuildMemberMemoStore(GUILD_ID, {
        version: 1,
        memos: [memo(), memo({ userId: '222222222222222222', name: '別人', memo: '' })],
    });
});

after(async () => {
    await database.delete(GUILD_ID, MEMBER_MEMO_STORE_KEY);
    await new Promise<void>(resolve => server.close(() => resolve()));
});

async function call(method: string, path: string, token?: string) {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: token ? { cookie: `sessionId=${token}` } : {},
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

test('GET member-memos: 未認証は401', async () => {
    const { status } = await call('GET', `/api/staff/ai/${GUILD_ID}/member-memos`);
    assert.equal(status, 401);
});

test('GET member-memos: レベル1で閲覧でき、canManage は false', async () => {
    const { status, body } = await call('GET', `/api/staff/ai/${GUILD_ID}/member-memos`, 'tok-level1');
    assert.equal(status, 200);
    assert.equal(body.canManage, false);
    assert.equal(body.memos.length, 2);
    assert.equal(body.memos[0].name, 'テストメンバー');
    assert.equal(body.memos[0].memo, 'マイクラの建築の話題が多い。');
});

test('GET member-memos: レベル2では canManage が true', async () => {
    const { status, body } = await call('GET', `/api/staff/ai/${GUILD_ID}/member-memos`, 'tok-level2');
    assert.equal(status, 200);
    assert.equal(body.canManage, true);
});

test('DELETE member-memos: レベル1では403で、メモは残る', async () => {
    const { status } = await call('DELETE', `/api/staff/ai/${GUILD_ID}/member-memos/${TARGET_ID}`, 'tok-level1');
    assert.equal(status, 403);
    const store = await loadGuildMemberMemoStore(GUILD_ID);
    assert.equal(store.memos.some(m => m.userId === TARGET_ID), true);
});

test('DELETE member-memos: 不正なユーザーIDは400', async () => {
    const { status } = await call('DELETE', `/api/staff/ai/${GUILD_ID}/member-memos/not-a-user`, 'tok-level2');
    assert.equal(status, 400);
});

test('DELETE member-memos: レベル2で削除でき、ストアから消える', async () => {
    const { status, body } = await call('DELETE', `/api/staff/ai/${GUILD_ID}/member-memos/${TARGET_ID}`, 'tok-level2');
    assert.equal(status, 200);
    assert.equal(body.removed, true);
    const store = await loadGuildMemberMemoStore(GUILD_ID);
    assert.equal(store.memos.some(m => m.userId === TARGET_ID), false);
    // 既に無いものを消しても 200 で removed=false（冪等な応答）。
    const again = await call('DELETE', `/api/staff/ai/${GUILD_ID}/member-memos/${TARGET_ID}`, 'tok-level2');
    assert.equal(again.status, 200);
    assert.equal(again.body.removed, false);
});

test('DELETE member-memos: Bot管理者はレベル1でも削除できる', async () => {
    const { status, body } = await call('DELETE', `/api/staff/ai/${GUILD_ID}/member-memos/222222222222222222`, 'tok-owner');
    assert.equal(status, 200);
    assert.equal(body.removed, true);
});
