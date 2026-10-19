import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatGPTClient } from '../src/core/ai/ChatGPTClient.ts';
import { QWOPUS_MODEL } from '../src/config.ts';
import { requestPersonalityModelText, requestCoreFeatureNaturalFollowUp, requestCoreFeatureConfidenceCalibration } from '../src/core/corepanel/model.ts';
import { PersonalityService } from '../src/core/corepanel/personality/PersonalityService.ts';
import { extractJsonObject, validatePersonalityEvaluation } from '../src/core/corepanel/helpers.ts';
import { deleteRoom } from '../src/core/corepanel/guildUtils.ts';
import { database } from '../src/core/persistence/Database.ts';

const evaluation = { reply: '周囲を手伝った時の具体例を教えてください？', complete: false, personality_key: null, reason: '支援の仕方を確認', confidence: 55, traits: ['支援的'] };
const session = (turns: number) => ({
    sessionId: 'interview', guildId: 'guild', userId: 'alice', status: 'active',
    transcript: Array.from({ length: turns }, (_, i) => ({ authorType: 'user', content: `具体的な回答${i + 1}` }))
});
const service = () => {
    const instance = new PersonalityService() as any;
    instance.getProfile = async () => ({ history: [], assignedKey: null });
    return instance;
};
const response = (content: string) => ({ choices: [{ message: { content } }] }) as any;

test('personality uses Qwopus for evaluation, follow-up and confidence without silent model fallback', async (t) => {
    const calls: any[] = [];
    t.mock.method(ChatGPTClient.prototype, 'sendMessage', async (_messages: unknown, options: any) => {
        calls.push(options);
        return response(calls.length === 1 ? JSON.stringify(evaluation) : calls.length === 2 ? 'その場面ではどうしましたか？' : '{"confidence":64}');
    });
    await requestPersonalityModelText([{ role: 'user', content: 'test' }], 200, 0.2);
    await requestCoreFeatureNaturalFollowUp('回答', '履歴', '', []);
    assert.equal(await requestCoreFeatureConfidenceCalibration('支援者', '理由', [], 4, '履歴', 50), 64);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((options) => options.model === QWOPUS_MODEL && options.strictModel === true));
});

test('empty Qwopus responses are treated as errors', async (t) => {
    t.mock.method(ChatGPTClient.prototype, 'sendMessage', async () => response(''));
    await assert.rejects(() => requestPersonalityModelText([{ role: 'user', content: 'test' }], 200, 0.2), /有効な応答/);
});

test('Qwopus JSON extraction tolerates reasoning and prose but retains quoted braces', () => {
    const expected = { ...evaluation, reason: '例として {a} を挙げた' };
    assert.deepEqual(extractJsonObject('<think>{"private":"reasoning"}</think>\n結果\n```json\n' + JSON.stringify(expected) + '\n```\n補足 {not json}'), expected);
    const bounded = validatePersonalityEvaluation({ ...evaluation, reply: 'x'.repeat(3000), reason: 'x'.repeat(3000), traits: ['x'.repeat(1000)], confidence: Infinity })!;
    assert.equal(bounded.reply.length, 1500);
    assert.equal(bounded.reason.length, 1000);
    assert.equal(bounded.traits[0].length, 60);
    assert.equal(bounded.confidence, null);
    assert.equal(validatePersonalityEvaluation({ ...evaluation, reply: '' }), null);
});

test('malformed model JSON is retried and a valid result is returned', async (t) => {
    let calls = 0;
    t.mock.method(ChatGPTClient.prototype, 'sendMessage', async () => response(++calls === 1 ? '{broken' : JSON.stringify(evaluation)));
    const result = await service().evaluate(session(2));
    assert.equal(calls, 2);
    assert.equal(result.complete, false);
    assert.equal(result.reply, evaluation.reply);
});

test('minimum interview turns are enforced and real classification completes after four answers', async (t) => {
    const completed = { ...evaluation, reply: '具体的な支援行動が見えました。', complete: true, personality_key: 'supporter' };
    t.mock.method(ChatGPTClient.prototype, 'sendMessage', async () => response(JSON.stringify(completed)));
    const early = service();
    early.buildContinuationResponse = async () => evaluation;
    assert.equal((await early.evaluate(session(1))).complete, false);
    const final = await service().evaluate(session(4));
    assert.equal(final.complete, true);
    assert.equal(final.personality_key, 'supporter');
});

test('final evaluation preserves request hooks and never invents an analyst classification on failure', async (t) => {
    const calls: any[] = [];
    t.mock.method(ChatGPTClient.prototype, 'sendMessage', async (_messages: unknown, options: any) => { calls.push(options); return response('not JSON'); });
    await assert.rejects(() => service().evaluate(session(6), { requestLabel: 'interview:test' }), /判定結果を読み取れません/);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((options) => options.model === QWOPUS_MODEL && options.requestLabel === 'interview:test'));
});

test('a slow model does not cause the interview room to timeout while processing', async () => {
    const instance = service();
    instance.processing.add('interview');
    instance.getSessions = async () => [session(3)];
    let rescheduled = false;
    instance.scheduleInactivityTimeout = () => { rescheduled = true; };
    instance.closeSession = async () => { throw new Error('must not close a processing interview'); };
    await instance.timeoutSession('guild', 'interview');
    assert.equal(rescheduled, true);
});

test('personality recovers pending cleanup and inactivity deadlines after restart', async () => {
    const instance = service();
    instance.getSessions = async () => [
        { ...session(1), sessionId: 'active', updatedAt: new Date(Date.now() - 120000).toISOString() },
        { ...session(4), sessionId: 'complete', status: 'completed', updatedAt: new Date(Date.now() - 600000).toISOString() },
        { ...session(4), sessionId: 'deleted', status: 'completed', roomDeletedAt: new Date().toISOString() }
    ];
    const cleanups: any[] = [], timeouts: any[] = [];
    instance.scheduleCleanup = (...args: unknown[]) => cleanups.push(args);
    instance.scheduleInactivityTimeout = (...args: unknown[]) => timeouts.push(args);
    await instance.restoreTimers({ guilds: { cache: new Map([['guild', { id: 'guild' }]]) } });
    assert.deepEqual(cleanups, [['guild', 'complete', 0]]);
    assert.equal(timeouts[0][1], 'active');
    assert.ok(timeouts[0][2] > 170000 && timeouts[0][2] <= 180000);
});

test('room deletion propagates permission errors and only ignores already-deleted channels', async () => {
    const client = (fetch: () => Promise<unknown>) => ({ guilds: { fetch: async () => ({ channels: { fetch } }) } }) as any;
    await assert.rejects(() => deleteRoom(client(async () => ({ delete: async () => { throw Object.assign(new Error('permission denied'), { code: 50013 }); } })), 'guild', 'room', 'category', 'test'), /permission denied/);
    await deleteRoom(client(async () => { throw Object.assign(new Error('missing channel'), { code: 10003 }); }), 'guild', 'room', 'category', 'test');
});

test('concurrent entry requests do not create duplicate personality rooms', async () => {
    const instance = service();
    let calls = 0, running = 0;
    instance.createSession = async () => {
        assert.equal(running++, 0);
        await Promise.resolve();
        running--;
        calls++;
        return session(1);
    };
    await Promise.all([instance.startSession({ id: 'guild' }, 'alice'), instance.startSession({ id: 'guild' }, 'alice')]);
    assert.equal(calls, 2); // 2回目は実際のcreateSession内で既存の部屋を返す。配列更新は必ず直列。
    assert.equal(instance.sessionStarts.size, 0);
});

test('four user messages complete an interview and persist the actual Qwopus classification', async (t) => {
    const instance = service();
    let stored = [{ ...session(0), channelId: 'room', categoryId: 'category', interviewerName: 'ナギ', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cooldownUntil: new Date(Date.now() + 604800000).toISOString(), traits: [] }];
    t.mock.method(database, 'get', async () => structuredClone(stored));
    t.mock.method(database, 'set', async (_guild: unknown, _key: unknown, value: any) => { stored = structuredClone(value); });
    const sent: any[] = [];
    const channel = { id: 'room', sendTyping: async () => {}, send: async (payload: unknown) => { sent.push(payload); } };
    const guild = { id: 'guild', channels: { fetch: async () => channel }, members: { fetch: async () => ({ id: 'alice' }) } };
    let calls = 0, savedProfile: any;
    t.mock.method(ChatGPTClient.prototype, 'sendMessage', async () => response(JSON.stringify(++calls < 4 ? evaluation : { ...evaluation, complete: true, personality_key: 'supporter', reply: '支援者と判定します。' })));
    instance.resolveConfidence = async () => 70;
    instance.assignPersonalityRole = async () => ({ roleId: 'supporter-role', warnings: [] });
    instance.saveProfile = async (profile: unknown) => { savedProfile = profile; };
    t.after(() => {
        for (const timer of instance.cleanupTimers.values()) clearTimeout(timer);
        for (const timer of instance.timeoutTimers.values()) clearTimeout(timer);
        for (const timer of instance.typingTimers.values()) clearInterval(timer);
    });
    for (let answer = 1; answer <= 4; answer++) {
        assert.equal(await instance.onMessage({ guild, channel, author: { id: 'alice', bot: false }, content: `困っている友人を具体的に手伝った場面${answer}です。` }), true);
    }
    assert.equal(calls, 4);
    assert.equal(stored[0].status, 'completed');
    assert.equal(savedProfile.assignedKey, 'supporter');
    assert.equal(savedProfile.assignedRoleId, 'supporter-role');
    assert.equal(stored[0].transcript.filter((entry: any) => entry.authorType === 'user').length, 4);
    assert.ok(sent.some((payload) => payload?.embeds?.[0]?.data.title === '性格診断が完了しました'));
});
