import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { database } from '../src/core/persistence/Database.ts';
import {
    applyGuildAIPersona,
    applyGuildAIPersonalityLearning,
    getGuildAIPersonality,
    personaContentFingerprint,
    type GuildAIPersona,
} from '../src/core/ai/GuildAIPersonality.ts';
import { createPersonaPreview } from '../src/web/routes/staff/personaGenerationGuard.ts';
import { createStaffAIRoutes } from '../src/web/routes/staff/ai.ts';

/**
 * 性格の方向プレビュー→適用フローの回帰テスト。
 *
 * 2026-11-07 の本番障害: WebUI の preview/apply が Content-Type: application/json を
 * 付けずに fetch していたため express.json() が body を読まず、direction と
 * previewId がサーバーへ届かなかった（preview は direction="" で成功し、
 * apply は常に 400「プレビューが無効か期限切れです」になった）。
 * あわせて、楽観チェック（409）でプレビューが消費されてしまう問題もここで固定する。
 */

const USER_ID = '234567890123456789';

const personaA: GuildAIPersona = {
    name: 'キナコ', character: '現在の性格', speakingStyle: '普通の口調', behavior: '普通に振る舞う',
    generatedAt: '2026-11-01T00:00:00.000Z', source: 'generated',
};
const draftB: GuildAIPersona = {
    name: 'ルナ', character: '方向に寄せた新しい性格', speakingStyle: '短く毒舌な口調', behavior: '結論から言う',
    generatedAt: '2026-11-07T00:00:00.000Z', source: 'generated',
};

/** database をインメモリ Map に差し替える（ai-usage-metrics.test.ts と同じ流儀）。 */
async function withMockDatabase<T>(run: () => Promise<T>): Promise<T> {
    const get = database.get.bind(database), set = database.set.bind(database);
    const store = new Map<string, unknown>();
    (database as any).get = async (guild: string, key: string, fallback: unknown) =>
        store.has(`${guild}/${key}`) ? structuredClone(store.get(`${guild}/${key}`)) : fallback;
    (database as any).set = async (guild: string, key: string, value: unknown) => {
        store.set(`${guild}/${key}`, structuredClone(value));
    };
    try { return await run(); }
    finally { (database as any).get = get; (database as any).set = set; }
}

async function startApp(guildId: string, level = 2) {
    const sessions = new Map<string, any>([
        ['tok-admin', {
            userId: USER_ID, username: 'koukun_', guildIds: [guildId],
            permissions: [{ guildId, level }], expiresAt: Date.now() + 3600_000,
        }],
        ['tok-low', {
            userId: USER_ID, username: 'koukun_', guildIds: [guildId],
            permissions: [{ guildId, level: 1 }], expiresAt: Date.now() + 3600_000,
        }],
    ]);
    const app = express();
    // SettingsServer と同一の body パーサ設定。
    app.use(express.json({ limit: '1mb' }));
    app.use((req: any, _res: any, next: any) => {
        req.cookies = {};
        for (const part of (req.headers.cookie || '').split(';')) {
            const i = part.indexOf('=');
            if (i > 0) req.cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
        }
        next();
    });
    app.use('/api/staff/ai', createStaffAIRoutes(sessions, {} as any));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const port = (server.address() as any).port;
    const url = `http://127.0.0.1:${port}/api/staff/ai/${guildId}/personality/persona/apply`;
    const apply = (previewId: string, token = 'tok-admin', withJsonHeader = true) =>
        fetch(url, {
            method: 'POST',
            headers: {
                Cookie: `sessionId=${token}`,
                ...(withJsonHeader ? { 'Content-Type': 'application/json' } : {}),
            },
            body: JSON.stringify({ previewId }),
        });
    const close = () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
    return { apply, close };
}

/** プレビュールートが作るのと同じ形のプレビューを発行する（生成自体は対象外）。 */
async function issuePreview(guildId: string, draft: GuildAIPersona): Promise<string> {
    const current = await getGuildAIPersonality(guildId);
    return createPersonaPreview({
        guildId, userId: USER_ID, persona: draft,
        basePersonaFingerprint: personaContentFingerprint(current.persona),
    });
}

test('方向プレビューの適用が成功する（間に学習の再保存が挟まっても）', async () => {
    await withMockDatabase(async () => {
        const guildId = '123456789012345678';
        await applyGuildAIPersona(guildId, personaA);
        const previewId = await issuePreview(guildId, draftB);
        // dot の雰囲気学習がレコード全体を保存し直す（性格本体は不変）。
        const before = await getGuildAIPersonality(guildId);
        const learned = await applyGuildAIPersonalityLearning(
            guildId, before.learningRevision, 'ゲームの話題が多いサーバー', 20, 'msg-1');
        assert.ok(learned);
        const { apply, close } = await startApp(guildId);
        try {
            const res = await apply(previewId);
            assert.equal(res.status, 200);
            const body = await res.json() as any;
            assert.equal(body.personality.persona.name, 'ルナ');
            // 学習結果は適用で消えない。
            assert.equal(body.personality.learnedSummary, 'ゲームの話題が多いサーバー');
        } finally { await close(); }
    });
});

test('409（プレビュー後に性格が変更）でもプレビューは消費されず、戻せば再試行できる', async () => {
    await withMockDatabase(async () => {
        const guildId = '223456789012345678';
        await applyGuildAIPersona(guildId, personaA);
        const previewId = await issuePreview(guildId, draftB);
        // プレビュー後に性格そのものが別の内容へ変わる。
        await applyGuildAIPersona(guildId, {
            ...personaA, name: 'タロウ', character: '全然違う性格',
            generatedAt: '2026-11-07T01:00:00.000Z',
        });
        const { apply, close } = await startApp(guildId);
        try {
            assert.equal((await apply(previewId)).status, 409);
            // 性格がプレビュー時点の内容に戻れば、同じプレビューで再試行が通る。
            // （旧実装は 409 の時点でトークンを消費していたため再試行は 400 になった。）
            await applyGuildAIPersona(guildId, personaA);
            const retry = await apply(previewId);
            assert.equal(retry.status, 200);
            const body = await retry.json() as any;
            assert.equal(body.personality.persona.name, 'ルナ');
            // 成功した適用はワンタイム消費される。
            assert.equal((await apply(previewId)).status, 400);
        } finally { await close(); }
    });
});

test('適用時の再認可が維持される（権限レベル1では 403 で、プレビューも消費されない）', async () => {
    await withMockDatabase(async () => {
        const guildId = '323456789012345678';
        await applyGuildAIPersona(guildId, personaA);
        const previewId = await issuePreview(guildId, draftB);
        const { apply, close } = await startApp(guildId);
        try {
            assert.equal((await apply(previewId, 'tok-low')).status, 403);
            const res = await apply(previewId, 'tok-admin');
            assert.equal(res.status, 200);
        } finally { await close(); }
    });
});

test('Content-Type が無いと body が届かず適用できない（2026-11-07 障害の再現・対照）', async () => {
    await withMockDatabase(async () => {
        const guildId = '423456789012345678';
        await applyGuildAIPersona(guildId, personaA);
        const previewId = await issuePreview(guildId, draftB);
        const { apply, close } = await startApp(guildId);
        try {
            // 障害時のクライアント形状: 文字列 body のみ（fetch 既定の text/plain）。
            // express.json() は body を読まないため previewId が届かず 400 になる。
            assert.equal((await apply(previewId, 'tok-admin', false)).status, 400);
            // previewId 自体が届いていないのでプレビューは消費されておらず、
            // 正しい形状で送り直せば同じプレビューが適用できる。
            const res = await apply(previewId, 'tok-admin', true);
            assert.equal(res.status, 200);
            const body = await res.json() as any;
            assert.equal(body.personality.persona.name, 'ルナ');
        } finally { await close(); }
    });
});

test('WebUI の readJson は body 付きリクエストに application/json を既定で付ける', async () => {
    const source = await readFile(new URL('../src/web/client/src/pages/Staff/StaffAI.tsx', import.meta.url), 'utf8');
    const readJsonSource = source.slice(source.indexOf('async function readJson'), source.indexOf('const PersonaDetails'));
    // 障害の根本原因（Content-Type 欠落）の再発防止: body がある場合は JSON を既定にする。
    assert.match(readJsonSource, /headers\.set\('Content-Type', 'application\/json'\)/);
    // プレビューは direction を、適用は previewId を body で送る形が維持されている。
    assert.ok(source.includes('body: JSON.stringify({ direction: personaDirection })'));
    assert.ok(source.includes('body: JSON.stringify({ previewId: personaPreview.previewId })'));
});
