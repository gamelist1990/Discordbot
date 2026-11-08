import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import {
    buildEpisodeLibrary,
    mondayOfWeek,
} from '../src/core/ai/EpisodeLibrary.ts';
import {
    EPISODE_STORE_KEY,
    saveGuildEpisodeStore,
    type GuildEpisode,
} from '../src/core/ai/GuildEpisodeMemory.ts';
import { database } from '../src/core/persistence/Database.ts';
import { createStaffAIRoutes } from '../src/web/routes/staff/ai.ts';
import type { SettingsSession } from '../src/web/types/index.ts';

// ---------------------------------------------------------------------------
// mondayOfWeek（週境界）
// ---------------------------------------------------------------------------

test('mondayOfWeek: 日曜はその週の月曜へ戻る', () => {
    assert.equal(mondayOfWeek('2026-11-08'), '2026-11-02'); // 日曜
    assert.equal(mondayOfWeek('2026-11-01'), '2026-10-26'); // 日曜（前月へ）
});

test('mondayOfWeek: 月曜はそのまま、週中も同じ月曜', () => {
    assert.equal(mondayOfWeek('2026-11-02'), '2026-11-02'); // 月曜
    assert.equal(mondayOfWeek('2026-11-05'), '2026-11-02'); // 木曜
    assert.equal(mondayOfWeek('2027-02-01'), '2027-02-01'); // 月初が月曜
});

test('mondayOfWeek: 年跨ぎの週は前年の月曜へ戻る', () => {
    assert.equal(mondayOfWeek('2027-01-01'), '2026-12-28'); // 金曜
    assert.equal(mondayOfWeek('2027-01-03'), '2026-12-28'); // 日曜
});

// ---------------------------------------------------------------------------
// buildEpisodeLibrary（年月→週のグルーピング）
// ---------------------------------------------------------------------------

const GUILD_ID = '987654321098765432';

function ep(overrides: Partial<GuildEpisode> = {}): GuildEpisode {
    return {
        id: '1568000000000000001',
        at: Date.UTC(2026, 10, 8, 10, 24), // 2026-11-08 19:24 JST
        date: '2026-11-08',
        channelId: '1482537395986501734',
        channelName: '💬｜vc組専用雑談',
        actor: '冷笑系熱血ゴミムシ',
        actorId: '1496700915862868090',
        summary: 'AIに対してやっぱりまだゴミだねと述べた。',
        messageIds: ['1568000000000000001'],
        source: 'observed',
        recordedAt: '2026-11-08T11:00:00.000Z',
        ...overrides,
    };
}

test('buildEpisodeLibrary: 同じ週の出来事は1つの月にまとまり、新しい順に並ぶ', () => {
    const library = buildEpisodeLibrary([
        ep({ id: '1', date: '2026-11-05', at: Date.UTC(2026, 10, 5, 3, 0), messageIds: ['1'] }),
        ep({ id: '2', date: '2026-11-08', at: Date.UTC(2026, 10, 8, 10, 24), messageIds: ['2'] }),
    ], { guildId: GUILD_ID });
    assert.equal(library.total, 2);
    assert.equal(library.matched, 2);
    assert.equal(library.months.length, 1);
    const month = library.months[0];
    assert.equal(month.key, '2026-11');
    assert.equal(month.label, '2026年11月');
    assert.equal(month.count, 2);
    assert.equal(month.weeks.length, 1);
    const week = month.weeks[0];
    assert.equal(week.key, '2026-11-02');
    assert.equal(week.label, '11月2日〜8日');
    assert.equal(week.startDate, '2026-11-02');
    assert.equal(week.endDate, '2026-11-08');
    assert.deepEqual(week.episodes.map(item => item.id), ['2', '1']);
    assert.equal(week.episodes[0].dateLabel, '11月8日');
    assert.equal(week.episodes[0].timeLabel, '19:24');
});

test('buildEpisodeLibrary: 月初の日曜は前月の最終週に入る（週を分割しない）', () => {
    const library = buildEpisodeLibrary([
        ep({ id: '1', date: '2026-11-01', at: Date.UTC(2026, 10, 1, 1, 0), messageIds: ['1'] }),
    ], { guildId: GUILD_ID });
    assert.equal(library.months.length, 1);
    const month = library.months[0];
    assert.equal(month.key, '2026-10');
    assert.equal(month.label, '2026年10月');
    const week = month.weeks[0];
    assert.equal(week.key, '2026-10-26');
    assert.equal(week.label, '10月26日〜11月1日');
    assert.equal(week.episodes[0].dateLabel, '11月1日');
});

test('buildEpisodeLibrary: 年跨ぎの週は月曜の属する年月に帰属する', () => {
    const library = buildEpisodeLibrary([
        ep({ id: '1', date: '2026-12-31', at: Date.UTC(2026, 11, 31, 3, 0), messageIds: ['1'] }),
        ep({ id: '2', date: '2027-01-01', at: Date.UTC(2027, 0, 1, 3, 0), messageIds: ['2'] }),
    ], { guildId: GUILD_ID });
    assert.equal(library.months.length, 1);
    const month = library.months[0];
    assert.equal(month.key, '2026-12');
    assert.equal(month.label, '2026年12月');
    const week = month.weeks[0];
    assert.equal(week.key, '2026-12-28');
    assert.equal(week.label, '2026年12月28日〜2027年1月3日');
    assert.equal(week.count, 2);
});

test('buildEpisodeLibrary: 月初が月曜の月はその日から週が始まる', () => {
    const library = buildEpisodeLibrary([
        ep({ id: '1', date: '2027-02-01', at: Date.UTC(2027, 1, 1, 3, 0), messageIds: ['1'] }),
    ], { guildId: GUILD_ID });
    const month = library.months[0];
    assert.equal(month.key, '2027-02');
    assert.equal(month.weeks[0].key, '2027-02-01');
    assert.equal(month.weeks[0].label, '2月1日〜7日');
});

test('buildEpisodeLibrary: 月も週も新しい順に並ぶ', () => {
    const library = buildEpisodeLibrary([
        ep({ id: 'sep', date: '2026-09-10', at: Date.UTC(2026, 8, 10, 3, 0), messageIds: ['sep'] }),
        ep({ id: 'nov-early', date: '2026-11-03', at: Date.UTC(2026, 10, 3, 3, 0), messageIds: ['nov-early'] }),
        ep({ id: 'oct', date: '2026-10-15', at: Date.UTC(2026, 9, 15, 3, 0), messageIds: ['oct'] }),
        ep({ id: 'nov-late', date: '2026-11-25', at: Date.UTC(2026, 10, 25, 3, 0), messageIds: ['nov-late'] }),
    ], { guildId: GUILD_ID });
    assert.deepEqual(library.months.map(month => month.key), ['2026-11', '2026-10', '2026-09']);
    assert.deepEqual(
        library.months[0].weeks.map(week => week.key),
        ['2026-11-23', '2026-11-02'],
    );
});

test('buildEpisodeLibrary: 空のストアでは月が無い', () => {
    const library = buildEpisodeLibrary([], { guildId: GUILD_ID });
    assert.equal(library.total, 0);
    assert.equal(library.matched, 0);
    assert.deepEqual(library.months, []);
});

test('buildEpisodeLibrary: ジャンプリンクは発言IDとチャンネルIDがある場合だけ付く', () => {
    const library = buildEpisodeLibrary([
        ep({ id: '1', messageIds: ['1568000000000000099'] }),
        ep({ id: '2', messageIds: [], date: '2026-11-07', at: Date.UTC(2026, 10, 7, 3, 0) }),
    ], { guildId: GUILD_ID });
    const items = library.months[0].weeks[0].episodes;
    const withLink = items.find(item => item.id === '1');
    const withoutLink = items.find(item => item.id === '2');
    assert.equal(
        withLink?.jumpUrl,
        `https://discord.com/channels/${GUILD_ID}/1482537395986501734/1568000000000000099`,
    );
    assert.equal(withoutLink?.jumpUrl, undefined);
});

// ---------------------------------------------------------------------------
// buildEpisodeLibrary（検索）
// ---------------------------------------------------------------------------

const searchFixtures: GuildEpisode[] = [
    ep({ id: '1', summary: 'AIに対してやっぱりまだゴミだねと述べた。', actor: '冷笑系熱血ゴミムシ' }),
    ep({ id: '2', summary: 'マイクラの新しい拠点を作り始めた。', actor: 'こう君@鯖主', date: '2026-11-06', at: Date.UTC(2026, 10, 6, 3, 0), messageIds: ['2'] }),
    ep({ id: '3', summary: 'カラオケ大会の日程が決まった。', actor: 'たろう', date: '2026-10-20', at: Date.UTC(2026, 9, 20, 3, 0), messageIds: ['3'], channelName: '🎤｜カラオケ募集' }),
];

test('buildEpisodeLibrary 検索: 要約の語で絞り込める', () => {
    const library = buildEpisodeLibrary(searchFixtures, { guildId: GUILD_ID, query: 'マイクラ' });
    assert.equal(library.total, 3);
    assert.equal(library.matched, 1);
    assert.equal(library.months[0].weeks[0].episodes[0].id, '2');
});

test('buildEpisodeLibrary 検索: 話者名・チャンネル名でも絞り込める', () => {
    const byActor = buildEpisodeLibrary(searchFixtures, { guildId: GUILD_ID, query: 'ゴミムシ' });
    assert.deepEqual(byActor.months.flatMap(m => m.weeks.flatMap(w => w.episodes.map(e => e.id))), ['1']);
    const byChannel = buildEpisodeLibrary(searchFixtures, { guildId: GUILD_ID, query: 'カラオケ募集' });
    assert.deepEqual(byChannel.months.flatMap(m => m.weeks.flatMap(w => w.episodes.map(e => e.id))), ['3']);
});

test('buildEpisodeLibrary 検索: 複数の語はANDで効く', () => {
    const hit = buildEpisodeLibrary(searchFixtures, { guildId: GUILD_ID, query: 'ゴミムシ ゴミ' });
    assert.equal(hit.matched, 1);
    const miss = buildEpisodeLibrary(searchFixtures, { guildId: GUILD_ID, query: 'ゴミムシ マイクラ' });
    assert.equal(miss.matched, 0);
    assert.deepEqual(miss.months, []);
});

// ---------------------------------------------------------------------------
// ルート（閲覧はレベル1以上）
// ---------------------------------------------------------------------------

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
    sessions.set('tok-level1', session({}));
    sessions.set('tok-other-guild', session({
        userId: '444444444444444444',
        guildId: '111111111111111111',
        guildIds: ['111111111111111111'],
        permissions: [{ guildId: '111111111111111111', level: 3 }],
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
    await saveGuildEpisodeStore(GUILD_ID, {
        version: 1,
        episodes: searchFixtures,
        backfill: { channels: {} },
    });
});

after(async () => {
    await database.delete(GUILD_ID, EPISODE_STORE_KEY);
    await new Promise<void>(resolve => server.close(() => resolve()));
});

async function call(path: string, token?: string) {
    const res = await fetch(`${baseUrl}${path}`, {
        headers: token ? { cookie: `sessionId=${token}` } : {},
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

test('GET episodes: 未認証は401', async () => {
    const { status } = await call(`/api/staff/ai/${GUILD_ID}/episodes`);
    assert.equal(status, 401);
});

test('GET episodes: 対象ギルドへアクセスできないセッションは403', async () => {
    const { status } = await call(`/api/staff/ai/${GUILD_ID}/episodes`, 'tok-other-guild');
    assert.equal(status, 403);
});

test('GET episodes: レベル1で階層データを取得できる', async () => {
    const { status, body } = await call(`/api/staff/ai/${GUILD_ID}/episodes`, 'tok-level1');
    assert.equal(status, 200);
    assert.equal(body.total, 3);
    assert.equal(body.matched, 3);
    assert.deepEqual(body.months.map((m: any) => m.key), ['2026-11', '2026-10']);
    const first = body.months[0].weeks[0].episodes[0];
    assert.equal(first.actor, '冷笑系熱血ゴミムシ');
    assert.match(first.jumpUrl, /^https:\/\/discord\.com\/channels\//);
});

test('GET episodes: q パラメータで絞り込める', async () => {
    const { status, body } = await call(
        `/api/staff/ai/${GUILD_ID}/episodes?q=${encodeURIComponent('カラオケ')}`,
        'tok-level1',
    );
    assert.equal(status, 200);
    assert.equal(body.total, 3);
    assert.equal(body.matched, 1);
    assert.equal(body.months[0].key, '2026-10');
});
