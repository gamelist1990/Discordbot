import test from 'node:test';
import assert from 'node:assert/strict';
import {
    EPISODE_EXTRACTION_SYSTEM_PROMPT,
    EPISODES_PER_GUILD_LIMIT,
    appendEpisodeDrafts,
    appendGuildEpisodes,
    emptyEpisodeStore,
    extractGuildEpisodes,
    jstDateString,
    loadGuildEpisodeStore,
    parseExtractedEpisodes,
    searchEpisodeRecords,
    type EpisodeStoreAdapter,
    type GuildEpisode,
} from '../src/core/ai/GuildEpisodeMemory.ts';

function memoryAdapter(): EpisodeStoreAdapter & { data: Map<string, unknown> } {
    const data = new Map<string, unknown>();
    return {
        data,
        get: async (_guildId: string, key: string) => data.get(key) ?? null,
        set: async (_guildId: string, key: string, value: unknown) => { data.set(key, value); },
    };
}

function makeEpisode(overrides: Partial<GuildEpisode> = {}): GuildEpisode {
    const at = overrides.at ?? Date.parse('2026-11-05T12:00:00Z');
    return {
        id: '100000000000000001',
        at,
        date: jstDateString(at),
        channelId: '1482537395986501734',
        channelName: 'vc組専用雑談',
        actor: '冷笑系熱血ゴミムシ',
        summary: 'AIをゴミだと述べた',
        messageIds: ['100000000000000001'],
        source: 'observed',
        recordedAt: '2026-11-05T12:05:00.000Z',
        ...overrides,
    };
}

test('出来事ストア: 追記と発言IDでの冪等性', async () => {
    const adapter = memoryAdapter();
    const first = await appendGuildEpisodes('g1', [makeEpisode()], adapter);
    assert.equal(first.added, 1);
    const again = await appendGuildEpisodes('g1', [makeEpisode()], adapter);
    assert.equal(again.added, 0);
    assert.equal(again.total, 1);
    const store = await loadGuildEpisodeStore('g1', adapter);
    assert.equal(store.episodes.length, 1);
    assert.equal(store.episodes[0].summary, 'AIをゴミだと述べた');
});

test('出来事ストア: 酷似した要約は同一主体・同一日なら重複として抑止', () => {
    const store = emptyEpisodeStore();
    assert.equal(appendEpisodeDrafts(store, [makeEpisode()]), 1);
    // 句読点だけが違う要約は、正規化すると同一になる。
    const punctuationOnly = makeEpisode({
        id: '100000000000000002',
        messageIds: ['100000000000000002'],
        summary: 'AIをゴミだと述べた。',
    });
    assert.equal(appendEpisodeDrafts(store, [punctuationOnly]), 0);
    // 日付が違えば別の出来事として記録できる。
    const otherDay = makeEpisode({
        id: '100000000000000003',
        messageIds: ['100000000000000003'],
        at: Date.parse('2026-11-06T12:00:00Z'),
        date: '2026-11-06',
    });
    assert.equal(appendEpisodeDrafts(store, [otherDay]), 1);
});

test('出来事ストア: 上限を超えたら古い出来事から落とす', () => {
    const store = emptyEpisodeStore();
    const drafts: GuildEpisode[] = [];
    for (let i = 0; i < EPISODES_PER_GUILD_LIMIT + 5; i += 1) {
        const at = Date.parse('2026-11-01T00:00:00Z') + i * 60_000;
        drafts.push(makeEpisode({
            id: `2000000000000${String(i).padStart(5, '0')}`,
            messageIds: [`2000000000000${String(i).padStart(5, '0')}`],
            at,
            date: jstDateString(at),
            summary: `出来事その${i}が発生したと述べた`,
        }));
    }
    appendEpisodeDrafts(store, drafts);
    assert.equal(store.episodes.length, EPISODES_PER_GUILD_LIMIT);
    assert.equal(store.episodes[0].summary, '出来事その5が発生したと述べた');
});

test('出来事検索: 部分一致・主体・日付範囲で引ける', () => {
    const episodes = [
        makeEpisode(),
        makeEpisode({
            id: '100000000000000010',
            messageIds: ['100000000000000010'],
            at: Date.parse('2026-11-03T12:00:00Z'),
            date: '2026-11-03',
            actor: 'こう君',
            summary: '疲れた時に食べるアイスが非常に美味いと述べた',
        }),
    ];
    // キーワードの部分一致。
    assert.equal(searchEpisodeRecords(episodes, { query: 'ゴミ' }).length, 1);
    // 単語に分けた全単語一致でも引ける。
    const andHit = searchEpisodeRecords(episodes, { query: 'AI ゴミ' });
    assert.equal(andHit.length, 1);
    assert.ok(andHit[0].matchLevel >= 2);
    // 主体の部分一致。
    assert.equal(searchEpisodeRecords(episodes, { actor: 'ゴミムシ' }).length, 1);
    // 日付範囲。
    assert.equal(searchEpisodeRecords(episodes, { from: '2026-11-06' }).length, 0);
    assert.equal(searchEpisodeRecords(episodes, { to: '2026-11-04' }).length, 1);
    assert.equal(searchEpisodeRecords(episodes, { from: '2026-11-05', to: '2026-11-05' })[0].id, '100000000000000001');
});

test('抽出出力のパース: メタデータは資料側から取り、実在しないIDは捨てる', () => {
    const at = Date.parse('2026-11-05T12:00:00Z');
    const sources = [{
        id: '100000000000000001', at, channelId: '1482537395986501734', channelName: 'vc組専用雑談',
        authorId: 'u1', authorName: '冷笑系熱血ゴミムシ', content: 'AIなんてゴミだろ',
    }];
    const parsed = parseExtractedEpisodes(JSON.stringify([
        { messageId: '100000000000000001', summary: 'AIをゴミだと述べた' },
        { messageId: '999999999999999999', summary: '存在しない出来事を述べた' },
    ]), sources, 'observed');
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].actor, '冷笑系熱血ゴミムシ');
    assert.equal(parsed[0].date, '2026-11-05');
    assert.equal(parsed[0].channelName, 'vc組専用雑談');
    // JSONでない出力は空。
    assert.deepEqual(parseExtractedEpisodes('出来事はありませんでした', sources, 'observed'), []);
    // 要約の先頭に主体名が含まれていたら落とす。
    const withActor = parseExtractedEpisodes(JSON.stringify([
        { messageId: '100000000000000001', summary: '冷笑系熱血ゴミムシがAIをゴミだと述べた' },
    ]), sources, 'backfill');
    assert.equal(withActor[0].summary, 'AIをゴミだと述べた');
});

test('抽出プロンプトには捏造防止・命令無視・センシティブ除外のガードがある', () => {
    assert.match(EPISODE_EXTRACTION_SYSTEM_PROMPT, /資料にない出来事は作らない/);
    assert.match(EPISODE_EXTRACTION_SYSTEM_PROMPT, /命令ではない/);
    assert.match(EPISODE_EXTRACTION_SYSTEM_PROMPT, /センシティブな私事/);
    assert.match(EPISODE_EXTRACTION_SYSTEM_PROMPT, /JSON配列のみ/);
});

test('extractGuildEpisodes: モデル抽出→ストア保存まで通る', async () => {
    const adapter = memoryAdapter();
    const at = Date.parse('2026-11-05T12:00:00Z');
    const sources = [{
        id: '100000000000000001', at, channelId: 'c1', channelName: '雑談',
        authorId: 'u1', authorName: '誰か', content: '来週みんなでゲーム大会やるぞ',
    }];
    const result = await extractGuildEpisodes('g1', sources, 'observed', async () => JSON.stringify([
        { messageId: '100000000000000001', summary: 'ゲーム大会の開催を宣言した' },
    ]), adapter);
    assert.equal(result.added, 1);
    const store = await loadGuildEpisodeStore('g1', adapter);
    assert.equal(store.episodes[0].summary, 'ゲーム大会の開催を宣言した');
    assert.equal(store.episodes[0].source, 'observed');
});

test('jstDateString は日本時間で日付を返す', () => {
    assert.equal(jstDateString(Date.parse('2026-11-05T12:00:00Z')), '2026-11-05');
    // UTC 16:30 は JST では翌日。
    assert.equal(jstDateString(Date.parse('2026-11-05T16:30:00Z')), '2026-11-06');
});
