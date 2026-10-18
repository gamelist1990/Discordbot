import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection } from 'discord.js';
import { OthelloFeature } from '../src/core/corepanel/othello/OthelloFeature.ts';
import { createInitialBoard, applyMove, chooseBotMove, getValidMoves, isGameOver } from '../src/core/corepanel/othello/OthelloEngine.ts';
import { database } from '../src/core/persistence/Database.ts';
import { gameRankingManager } from '../src/core/ranking/GameRankingManager.ts';
import { CoreFeatureManager } from '../src/core/corepanel/CoreFeatureManager.ts';
import { buildCorePanelEmbed } from '../src/core/corepanel/panelMessage.ts';

const makeSession = (overrides = {}) => ({
    id: 'match-1', guildId: 'guild', channelId: 'room', categoryId: 'category', messageId: 'board',
    hostId: 'alice', opponentId: 'bob', mode: 'ranked', difficulty: null,
    board: createInitialBoard(), boardHistory: [createInitialBoard()], turn: 'black', blackId: 'alice', whiteId: 'bob',
    status: 'active', lastMove: null, resultRecorded: false, turnNumber: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...overrides
});
const makeInteraction = (userId = 'alice', overrides = {}) => ({
    guildId: 'guild', channelId: 'room', guild: { id: 'guild' }, user: { id: userId },
    reply: async () => {}, deferUpdate: async () => {}, editReply: async () => {},
    ...overrides
});

test('Othello fairness and durable room cleanup', async (t) => {
    const rows = new Map<string, any>();
    t.mock.method(database, 'get', async (_guild: string, key: string, fallback: unknown) => structuredClone(rows.get(key) ?? fallback));
    t.mock.method(database, 'set', async (_guild: string, key: string, data: unknown) => { rows.set(key, structuredClone(data)); });
    const setup = (overrides = {}) => {
        const feature = new OthelloFeature() as any;
        const session = makeSession(overrides);
        feature.sessions.set(session.id, session);
        feature.activeByUser.set('guild:alice', session.id);
        feature.activeByUser.set('guild:bob', session.id);
        feature.updateBoardMessage = async () => {};
        feature.publishBoard = async () => {};
        return { feature, session };
    };

    await t.test('close requests confirmation; only the owner can confirm; resign records a loss once', async () => {
        const { feature, session } = setup();
        let confirmation: any;
        const channel = { type: ChannelType.GuildText };
        await feature.handleButtonInteraction(makeInteraction('alice', { channel, reply: async (payload: any) => { confirmation = payload; } }), 'othello', 'close', [session.id]);
        assert.equal(session.status, 'active');
        assert.match(confirmation.content, /負け/);
        await assert.rejects(() => feature.handleButtonInteraction(makeInteraction('bob', { channel }), 'othello', 'resign', [session.id, 'alice']), /本人/);
        await feature.handleButtonInteraction(makeInteraction('alice', { channel }), 'othello', 'resign', [session.id, 'alice']);
        const before = await gameRankingManager.getProfile('guild', 'othello', 'alice');
        assert.equal(before.losses, 1);
        assert.equal(session.winner, 'white');
        assert.ok(session.deleteAt > Date.now());
        await feature.handleButtonInteraction(makeInteraction('alice', { channel }), 'othello', 'resign', [session.id, 'alice']);
        assert.deepEqual(await gameRankingManager.getProfile('guild', 'othello', 'alice'), before);
    });

    await t.test('spectators and cross-guild/channel controls cannot resign or move', async () => {
        const { feature, session } = setup();
        for (const interaction of [makeInteraction('outsider'), makeInteraction('alice', { guildId: 'other' }), makeInteraction('alice', { channelId: 'other' })]) {
            await assert.rejects(() => feature.handleButtonInteraction(interaction, 'othello', 'close', [session.id]), /権限/);
            await assert.rejects(() => feature.playMove(interaction, session.id, 19, 1));
        }
        assert.deepEqual(session.board, createInitialBoard());
    });

    await t.test('stale buttons, illegal moves and out-of-turn moves do not mutate the board', async () => {
        const { feature, session } = setup();
        await assert.rejects(() => feature.playMove(makeInteraction(), session.id, 19, 0), /古い盤面/);
        await assert.rejects(() => feature.playMove(makeInteraction(), session.id, 0, 1), /置けません/);
        await assert.rejects(() => feature.playMove(makeInteraction('bob'), session.id, 19, 1), /ターン/);
        assert.equal(session.turnNumber, 1);
    });

    await t.test('queued duplicate clicks apply one move only', async () => {
        const { feature, session } = setup();
        const outcomes = await Promise.allSettled([1, 2].map(() => feature.withSessionLock(session.id, () => feature.playMove(makeInteraction(), session.id, 19, 1))));
        assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
        assert.equal(session.turnNumber, 2);
    });

    await t.test('all legal moves remain available when there are more than twenty', () => {
        const { feature, session } = setup();
        const rows = feature.buildBoardControls(session, new Set(Array.from({ length: 33 }, (_, i) => i))).map((row: any) => row.toJSON());
        assert.ok(rows.length <= 5);
        const options = rows.flatMap((row: any) => row.components.flatMap((component: any) => component.options ?? []));
        assert.equal(options.length, 33);
        assert.equal(new Set(options.map((option: any) => option.value)).size, 33);
        assert.ok(rows.every((row: any) => row.components.every((component: any) => !component.options || component.options.length <= 25)));
    });

    await t.test('Bot continues taking turns after the human must pass', async () => {
        const board = [null,'black','white','white','white','white','white','black','black','black','white','black','white','white','white','black',null,'black','white','white','black','black','white','black','white','black','white','black','black','black','black','black','white','white','white','white','black','black','black','black','white','white','black','black','black','black','black','black','white',null,'white','white','white','white','white','black','white','white','white','white','white','white','white',null] as any;
        const { feature, session } = setup({ board, boardHistory: [board], mode: 'bot', opponentId: 'othello-bot', whiteId: 'othello-bot', difficulty: 'normal' });
        let expected = applyMove(board, 49, 'black'), botTurns = 0;
        while (!isGameOver(expected) && getValidMoves(expected, 'white').length) {
            expected = applyMove(expected, chooseBotMove(expected, 'white', 'normal')!.index, 'white');
            botTurns++;
            if (getValidMoves(expected, 'black').length) break;
        }
        feature.finishSession = async () => { session.status = 'completed'; };
        await feature.playMove(makeInteraction(), session.id, 49, 1);
        assert.equal(botTurns, 3);
        assert.deepEqual(session.board, expected);
        assert.ok(session.status === 'completed' || session.turn === 'black');
    });

    await t.test('cleanup failures stay queued and retry after a restart', async () => {
        const { feature, session } = setup({ status: 'closed', deleteAt: Date.now() - 1 });
        let attempts = 0;
        const guild = { id: 'guild', channels: { fetch: async () => ({ delete: async () => { if (++attempts === 1) throw new Error('temporary failure'); } }) } };
        await feature.persistSessions('guild');
        await feature.cleanupSession(guild, session);
        assert.ok(feature.sessions.has(session.id));
        const restored = new OthelloFeature() as any;
        await restored.restoreSessions({ guilds: { cache: new Collection([['guild', guild]]) } });
        assert.equal(attempts, 2);
        assert.equal(restored.sessions.size, 0);
        assert.deepEqual(rows.get('Guild/guild/corefeature/othello/sessions'), []);
    });

    await t.test('a busy game does not expire one hour after creation; inactivity counts from the latest move', async () => {
        const { feature, session } = setup({ createdAt: new Date(Date.now() - 7200000).toISOString() });
        const guild = { id: 'guild', channels: { fetch: async () => { throw new Error('should not fetch'); } } };
        await feature.maintainSessions({ guilds: { cache: new Collection([['guild', guild]]) } });
        assert.equal(session.status, 'active');
    });

    await t.test('inactivity forfeits the current player; matching expiration deletes without ranking', async () => {
        const { feature, session } = setup({ updatedAt: new Date(Date.now() - 3600001).toISOString(), turn: 'white' });
        let result: any;
        feature.finishSession = async (_channel: unknown, _session: unknown, winner: string, reason: string) => { result = { winner, reason }; };
        const guild = { id: 'guild', channels: { fetch: async () => ({ type: ChannelType.GuildText, delete: async () => {} }) } };
        const client = { guilds: { cache: new Collection([['guild', guild]]) } };
        await feature.maintainSessions(client);
        assert.equal(result.winner, 'black');
        assert.match(result.reason, /時間切れ/);
        session.status = 'waiting';
        await feature.maintainSessions(client);
        assert.equal(feature.sessions.size, 0);
    });

    await t.test('rank results are idempotent across retries', async () => {
        const input = { guildId: 'guild', gameKey: 'othello', playerA: 'carol', playerB: 'dave', result: 'playerA' as const, matchId: 'retry-match' };
        const first = await gameRankingManager.recordResult(input);
        assert.deepEqual(await gameRankingManager.recordResult(input), first);
        assert.equal((await gameRankingManager.getProfile('guild', 'othello', 'carol')).games, 1);
    });

    await t.test('restart retries an unconfirmed ranking write without double-counting a recorded match', async () => {
        const { feature, session } = setup({ id: 'crash-match', status: 'completed', winner: 'black', resultRecorded: false, blackId: 'eve', whiteId: 'frank', deleteAt: Date.now() + 300000 });
        await gameRankingManager.recordResult({ guildId: 'guild', gameKey: 'othello', playerA: 'eve', playerB: 'frank', result: 'playerA', matchId: session.id });
        await feature.persistSessions('guild');
        const restored = new OthelloFeature() as any;
        const guild = { id: 'guild', channels: { fetch: async () => null } };
        await restored.restoreSessions({ guilds: { cache: new Collection([['guild', guild]]) } });
        assert.equal(restored.sessions.get(session.id).resultRecorded, true);
        assert.equal((await gameRankingManager.getProfile('guild', 'othello', 'eve')).games, 1);
    });
});

test('removed debate has no registry, combined-panel or command entry points', () => {
    const manager = new CoreFeatureManager();
    assert.equal(manager.isRegisteredPanelKind('debate'), false);
    assert.ok(!manager.getFeatureDescriptors().some((feature) => feature.key === 'debate'));
    assert.doesNotMatch(JSON.stringify(manager.buildPanelRows('guild', 'combined')), /debate/);
    assert.doesNotMatch(JSON.stringify(buildCorePanelEmbed('combined', null)), /レスバ|論破王/);
});
