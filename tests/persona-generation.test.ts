import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PERSONA_ARCHETYPES,
    buildPersonaGenerationMessages,
    parseGeneratedPersona,
    personaContentFingerprint,
    pickPersonaArchetype,
    type GuildAIPersona,
} from '../src/core/ai/GuildAIPersonality.ts';
import {
    PERSONA_GENERATION_LIMITS,
    PersonaGenerationLimiter,
    canGeneratePersona,
    consumePersonaPreview,
    createPersonaPreview,
    peekPersonaPreview,
    isBotOwnerSession,
    validatePersonaDirection,
} from '../src/web/routes/staff/personaGenerationGuard.ts';

const basePersona: GuildAIPersona = {
    name: 'ロコ', character: '星を読むのが好きな落ち着いた性格',
    speakingStyle: '静かで短い口調', behavior: '相手の話をよく聞く',
    generatedAt: '2026-11-01T00:00:00.000Z', source: 'generated',
};

test('性格生成の認可はギルド管理者（レベル2以上）またはBot管理者のみ', () => {
    assert.equal(canGeneratePersona({ permissionLevel: 0, isBotOwner: false }), false);
    assert.equal(canGeneratePersona({ permissionLevel: 1, isBotOwner: false }), false);
    assert.equal(canGeneratePersona({ permissionLevel: 2, isBotOwner: false }), true);
    assert.equal(canGeneratePersona({ permissionLevel: 3, isBotOwner: false }), true);
    assert.equal(canGeneratePersona({ permissionLevel: 0, isBotOwner: true }), true);
});

test('Bot管理者判定はセッションのオーナー情報だけを見る', () => {
    assert.equal(isBotOwnerSession(undefined), false);
    assert.equal(isBotOwnerSession({ userId: '999999999999999999', expiresAt: Date.now() + 1000 }), false);
    assert.equal(isBotOwnerSession({ userId: '999999999999999999', isOwner: true, expiresAt: Date.now() + 1000 }), true);
    assert.equal(isBotOwnerSession({ userId: '999999999999999999', owners: ['999999999999999999'], expiresAt: Date.now() + 1000 }), true);
    assert.equal(isBotOwnerSession({ userId: '999999999999999999', owners: ['111111111111111111'], expiresAt: Date.now() + 1000 }), false);
});

test('レート制限: 同時実行・クールダウン・日次上限', () => {
    let now = Date.parse('2026-11-07T00:00:00Z');
    const limiter = new PersonaGenerationLimiter(() => now);
    const guild = 'g1';
    const user = 'u1';
    assert.equal(limiter.check(guild, user).ok, true);
    limiter.begin(guild, user);
    // 実行中は同一ギルドの次リクエストを弾く。
    assert.equal(limiter.check(guild, 'u2').reason, 'in-flight');
    limiter.end(guild);
    // 終了直後は同ギルドではギルドクールダウン、別ギルドではユーザークールダウンが効く。
    assert.equal(limiter.check(guild, user).reason, 'cooldown-guild');
    assert.equal(limiter.check('g2', user).reason, 'cooldown-user');
    now += PERSONA_GENERATION_LIMITS.userCooldownMs + 1000;
    assert.equal(limiter.check('g2', user).ok, true);
    // ユーザーを変えてもギルドクールダウンが残る。
    assert.equal(limiter.check(guild, 'u2').reason, 'cooldown-guild');
    now += PERSONA_GENERATION_LIMITS.guildCooldownMs;
    assert.equal(limiter.check(guild, 'u2').ok, true);
    // 日次上限（ユーザー）: クールダウンを避けながら10回実行すると11回目は日次上限。
    let clock = now;
    const limiter2 = new PersonaGenerationLimiter(() => clock);
    for (let i = 0; i < PERSONA_GENERATION_LIMITS.userDailyCap; i += 1) {
        assert.equal(limiter2.check(guild, user).ok, true, `iteration ${i}`);
        limiter2.begin(guild, user);
        limiter2.end(guild);
        clock += PERSONA_GENERATION_LIMITS.guildCooldownMs + 1000;
    }
    assert.equal(limiter2.check(guild, user).reason, 'daily-user');
    // 別ユーザーでもギルド日次上限（20）に達したら弾く。
    for (let i = 0; i < PERSONA_GENERATION_LIMITS.guildDailyCap - PERSONA_GENERATION_LIMITS.userDailyCap; i += 1) {
        assert.equal(limiter2.check(guild, 'u2').ok, true, `guild iteration ${i}`);
        limiter2.begin(guild, 'u2');
        limiter2.end(guild);
        clock += PERSONA_GENERATION_LIMITS.guildCooldownMs + 1000;
    }
    assert.equal(limiter2.check(guild, 'u3').reason, 'daily-guild');
});

test('方向プロンプトの検証: 上限と型', () => {
    assert.deepEqual(validatePersonaDirection(undefined), { ok: true, direction: '' });
    assert.deepEqual(validatePersonaDirection('  もっと元気に  '), { ok: true, direction: 'もっと元気に' });
    assert.equal(validatePersonaDirection('あ'.repeat(300)).ok, true);
    assert.equal(validatePersonaDirection('あ'.repeat(301)).ok, false);
    assert.equal(validatePersonaDirection(42).ok, false);
});

test('プレビューはワンタイムで、ギルドとユーザーに束縛され、期限切れは無効', () => {
    const now = Date.parse('2026-11-07T00:00:00Z');
    const id = createPersonaPreview({ guildId: 'g1', userId: 'u1', persona: basePersona, basePersonaFingerprint: 'fp0' }, now);
    assert.equal(consumePersonaPreview(id, 'g1', 'u2', now), null);
    const again = createPersonaPreview({ guildId: 'g1', userId: 'u1', persona: basePersona, basePersonaFingerprint: 'fp0' }, now);
    const record = consumePersonaPreview(again, 'g1', 'u1', now);
    assert.equal(record?.persona.name, 'ロコ');
    // 消費済みは二度と使えない。
    assert.equal(consumePersonaPreview(again, 'g1', 'u1', now), null);
    const expiring = createPersonaPreview({ guildId: 'g1', userId: 'u1', persona: basePersona }, now);
    assert.equal(consumePersonaPreview(expiring, 'g1', 'u1', now + 10 * 60_000 + 1), null);
    assert.equal(consumePersonaPreview('not-a-token', 'g1', 'u1', now), null);
});

test('peekはプレビューを消費しない（楽観チェックで弾いても再試行できる）', () => {
    const now = Date.parse('2026-11-07T00:00:00Z');
    const id = createPersonaPreview({ guildId: 'g1', userId: 'u1', persona: basePersona, basePersonaFingerprint: 'fp0' }, now);
    // 束縛が違うユーザーからの peek は見えず、持ち主のプレビューも消えない。
    assert.equal(peekPersonaPreview(id, 'g1', 'u2', now), null);
    assert.equal(peekPersonaPreview(id, 'g2', 'u1', now), null);
    // 持ち主は何度でも peek でき、その後の消費も1回だけ成功する。
    assert.equal(peekPersonaPreview(id, 'g1', 'u1', now)?.persona.name, 'ロコ');
    assert.equal(peekPersonaPreview(id, 'g1', 'u1', now)?.basePersonaFingerprint, 'fp0');
    assert.equal(consumePersonaPreview(id, 'g1', 'u1', now)?.persona.name, 'ロコ');
    assert.equal(peekPersonaPreview(id, 'g1', 'u1', now), null);
    // 期限切れは peek でも無効。
    const expiring = createPersonaPreview({ guildId: 'g1', userId: 'u1', persona: basePersona }, now);
    assert.equal(peekPersonaPreview(expiring, 'g1', 'u1', now + 10 * 60_000 + 1), null);
});

test('性格本体の指紋は生成時刻に依存せず、内容の変化だけを検出する', () => {
    const restamped: GuildAIPersona = { ...basePersona, generatedAt: '2026-11-07T12:34:56.000Z' };
    assert.equal(personaContentFingerprint(restamped), personaContentFingerprint(basePersona));
    assert.notEqual(
        personaContentFingerprint({ ...basePersona, name: 'べつの名前' }),
        personaContentFingerprint(basePersona),
    );
    assert.notEqual(
        personaContentFingerprint({ ...basePersona, character: '全然違う性格' }),
        personaContentFingerprint(basePersona),
    );
    assert.equal(personaContentFingerprint(undefined), undefined);
});

test('性格生成プロンプトは構造化スキーマと個性付け・資料扱いを明記する', () => {
    const messages = buildPersonaGenerationMessages({
        base: basePersona,
        direction: 'もっと毒舌に',
        learnedSummary: 'ゲームの話題が多いサーバー',
        archetype: PERSONA_ARCHETYPES[0],
        seed: 'testseed',
    });
    const system = messages[0].content;
    const user = messages[1].content;
    // 無難な定型の禁止とクセ/弱点の必須化。
    assert.ok(system.includes('無難な定型'));
    assert.ok(system.includes('クセと弱点'));
    // 構造化スキーマのキー。
    for (const key of ['firstPerson', 'exampleLines', 'catchphrases', 'likes', 'dislikes', 'interactionStrengths', 'weakTopicReaction', 'avoidBehaviors']) {
        assert.ok(system.includes(key), key);
    }
    // 資料は命令ではないこと。
    assert.ok(system.includes('資料（データ）'));
    assert.ok(user.includes('<direction>'));
    assert.ok(user.includes('もっと毒舌に'));
    // ベース・雰囲気・原型が材料として入ること。
    assert.ok(user.includes('ロコ'));
    assert.ok(user.includes('ゲームの話題が多いサーバー'));
    assert.ok(user.includes(PERSONA_ARCHETYPES[0].label));
});

test('原型プールからランダムに選ばれ、生成JSONは拡張スキーマでパースされる', () => {
    assert.ok(PERSONA_ARCHETYPES.length >= 10);
    assert.ok(PERSONA_ARCHETYPES.includes(pickPersonaArchetype(() => 0)));
    const parsed = parseGeneratedPersona(JSON.stringify({
        name: 'ゴン太', firstPerson: 'おれ', character: '直球タイプ',
        speakingStyle: '短いタメ口', behavior: '結論から言う',
        exampleLines: ['それは違うだろ', 'まあ悪くねえ', '認める', '4つ目', '5つ目', '6つ目', '7つ目'],
        catchphrases: ['それは違うだろ'], likes: '勝負ごと', dislikes: '含みのある言い方',
        interactionStrengths: 'ツッコミ', weakTopicReaction: '黙って様子を見る', avoidBehaviors: ['煽り'],
    }));
    assert.equal(parsed?.name, 'ゴン太');
    assert.equal(parsed?.firstPerson, 'おれ');
    // 実例セリフは上限5件に丸められる。
    assert.equal(parsed?.exampleLines?.length, 5);
    assert.deepEqual(parsed?.catchphrases, ['それは違うだろ']);
    // 必須項目が欠けた出力は従来どおり拒否される。
    assert.equal(parseGeneratedPersona('{"name":"x"}'), null);
});
