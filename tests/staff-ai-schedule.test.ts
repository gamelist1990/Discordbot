import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database, database } from '../src/core/persistence/Database.ts';
import { deliverDueStaffSchedules, loadStaffSchedules } from '../src/core/ai/StaffAIScheduler.ts';
import { parseScheduleTime, staffScheduleHandler } from '../src/commands/staff/subcommands/ai-tools/schedule.ts';
import { selectStaffToolNames } from '../src/commands/staff/subcommands/StaffAIToolRouting.ts';
import { executeStaffScheduledTask } from '../src/core/ai/StaffAIScheduledTask.ts';
import { Collection, ChannelType } from 'discord.js';

async function fixture(run: (f: ReturnType<typeof mocks> & { restart: () => void }) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), 'staff-ai-schedule-'));
    const originalGet = database.get, originalSet = database.set;
    const restart = () => {
        const store = new Database(directory);
        database.get = store.get.bind(store);
        database.set = store.set.bind(store);
    };
    restart();
    try { await run({ ...mocks(), restart }); }
    finally {
        database.get = originalGet; database.set = originalSet;
        await rm(directory, { recursive: true, force: true });
    }
}

function mocks() {
    const sent: any[] = [];
    let failure = false;
    const channels = new Collection<string, any>();
    const guild = { id: 'guild', members: { me: { id: 'bot' }, fetch: async (id: string) => ({ id }) },
        channels: { fetch: async () => channels } };
    const channel = {
        id: 'channel', name: '依頼元', type: ChannelType.GuildText, guild, guildId: 'guild', isSendable: () => true, isThread: () => false,
        permissionsFor: (_actor?: any) => ({ has: (_permission?: any) => true }),
        send: async (payload: any) => {
            if (failure) throw new Error('一時的な送信失敗');
            sent.push(payload);
        },
    };
    channels.set(channel.id, channel);
    const client = { guilds: { cache: new Map([['guild', guild]]) }, channels: { fetch: async (id: string) => channels.get(id) ?? null } } as any;
    const context = { guildId: 'guild', channelId: 'channel', user: { id: '123456789012345678' },
        guild, client };
    return { sent, client, context, channel, channels, fail: (value: boolean) => { failure = value; } };
}

const future = () => new Date(Date.now() + 3_600_000).toISOString();
const create = (context: any, runAt = future(), message = '起きる時間です！') =>
    staffScheduleHandler({ action: 'create', run_at: runAt, message }, context) as Promise<any>;

test('通知先をID・メンション・名前で指定し、復元後も指定先だけに通知する', async () => {
    await fixture(async ({ context, client, sent, channel, channels, restart }) => {
        const targetId = '234567890123456789';
        const received: any[] = [];
        const target = { ...channel, id: targetId, name: '通知', send: async (payload: any) => { received.push(payload); } };
        channels.set(targetId, target);
        const runAt = future();
        for (const destination of [targetId, `<#${targetId}>`, '#通知']) {
            const result: any = await staffScheduleHandler({ action: 'create', channel_id: destination,
                run_at: runAt, message: '指定先で通知' }, context);
            assert.equal(result.success, true);
            assert.equal(result.schedule.channelId, targetId);
        }
        assert.equal((await loadStaffSchedules('guild')).length, 1);
        restart();
        await deliverDueStaffSchedules(client, Date.parse(runAt));
        assert.equal(sent.length, 0);
        assert.equal(received.length, 1);
        assert.match(received[0].content, /^<@123456789012345678> ⏰ 指定先で通知/);
    });
});

test('AI処理の結果も指定先へ通知し、同内容でも通知先が違えば別予約になる', async () => {
    await fixture(async ({ context, client, sent, channel, channels }) => {
        const targetId = '234567890123456789';
        const received: any[] = [];
        channels.set(targetId, { ...channel, id: targetId, name: '調査結果', send: async (payload: any) => { received.push(payload); } });
        const runAt = future();
        const args = { action: 'create', mode: 'task', task: '最新ニュースを調べて', run_at: runAt };
        assert.equal((await staffScheduleHandler(args, context) as any).success, true);
        assert.equal((await staffScheduleHandler({ ...args, channel_id: targetId }, context) as any).success, true);
        assert.equal((await loadStaffSchedules('guild')).length, 2);
        await deliverDueStaffSchedules(client, Date.parse(runAt), async () => '調査結果です');
        assert.equal(sent.length, 1);
        assert.equal(received.length, 1);
        assert.match(received[0].content, /調査結果です/);
    });
});

test('他サーバー・DM・不明・同名チャンネルと本人やBotの権限不足を拒否する', async () => {
    await fixture(async ({ context, channel, channels }) => {
        const targetId = '234567890123456789';
        const args = { action: 'create', channel_id: targetId, run_at: future(), message: '通知' };
        const rejected = async () => assert.ok((await staffScheduleHandler(args, context) as any).error);
        await rejected();
        channels.set(targetId, { ...channel, id: targetId, guildId: 'other-guild' });
        await rejected();
        channels.set(targetId, { id: targetId, isSendable: () => true });
        await rejected();
        for (const deniedActor of [context.user.id, 'bot']) {
            channels.set(targetId, { ...channel, id: targetId,
                permissionsFor: (actor: any) => ({ has: () => actor.id !== deniedActor }) });
            await rejected();
        }
        channels.set(targetId, { ...channel, id: targetId, name: '通知' });
        channels.set('345678901234567890', { ...channel, id: '345678901234567890', name: '通知' });
        assert.match((await staffScheduleHandler({ ...args, channel_id: '#通知' }, context) as any).error, /複数/);
        assert.ok((await staffScheduleHandler({ ...args, channel_id: '#存在しない' }, context) as any).error);
        assert.equal((await loadStaffSchedules('guild')).length, 0);
    });
});

test('予約後に通知先の権限がなくなった場合は処理や投稿を実行しない', async () => {
    await fixture(async ({ context, client, sent, channel }) => {
        const runAt = future();
        const result: any = await staffScheduleHandler({ action: 'create', mode: 'task', task: '天気を調べて', run_at: runAt }, context);
        assert.equal(result.success, true);
        channel.permissionsFor = actor => ({ has: () => actor.id !== context.user.id });
        let executed = false;
        await deliverDueStaffSchedules(client, Date.parse(runAt), async () => { executed = true; return '結果'; });
        assert.equal(executed, false);
        assert.equal(sent.length, 0);
        assert.equal((await loadStaffSchedules('guild'))[0].attempts, 1);
    });
});

test('プライベートスレッドは管理権限がない場合に本人とBotの参加を確認する', async () => {
    await fixture(async ({ context, channel, channels }) => {
        const targetId = '234567890123456789';
        const participants = new Set<string>(['bot']);
        channels.set(targetId, { ...channel, id: targetId, type: ChannelType.PrivateThread,
            isThread: () => true,
            permissionsFor: () => ({ has: (permission: string) => permission !== 'ManageThreads' }),
            members: { fetch: async (id: string) => participants.has(id) ? { id } : null },
        });
        const args = { action: 'create', channel_id: targetId, run_at: future(), message: '通知' };
        assert.match((await staffScheduleHandler(args, context) as any).error, /本人.*参加/);
        participants.add(context.user.id);
        participants.delete('bot');
        assert.match((await staffScheduleHandler(args, context) as any).error, /Bot.*参加/);
        participants.add('bot');
        assert.equal((await staffScheduleHandler(args, context) as any).success, true);
    });
});

test('通知依頼、相対時刻、取消、挨拶付きでもスケジュールと時計を公開する', () => {
    for (const prompt of ['今日の3時に起こして', '10分後に休憩を教えて', 'おやすみ、明日7時に起こして',
        '通知予約の一覧', 'リマインダーを取り消して', '15時に知らせて', 'remind me in an hour',
        '今日の15時に最新ニュースを調べて', '明日7時に東京の天気を確認して', '午後3時に文章を作って']) {
        const names = selectStaffToolNames(prompt);
        assert.ok(names.has('manage_schedule'), prompt);
        assert.ok(names.has('get_time'), prompt);
    }
    assert.ok(selectStaffToolNames('それを取り消して', ['明日7時に起こして']).has('manage_schedule'));
    assert.ok(selectStaffToolNames('午後3時で', ['今日の3時に起こして']).has('manage_schedule'));
    assert.ok(selectStaffToolNames('キャンセルして', ['通知を予約しました']).has('manage_schedule'));
});

test('時刻になってから依頼文を実行し、再起動・通知再試行では保存した結果を使う', async () => {
    await fixture(async ({ context, client, sent, fail, restart }) => {
        const runAt = future();
        const task = '東京の実行時点の天気を調べて、出典付きで教えて';
        const created: any = await staffScheduleHandler({ action: 'create', mode: 'task', task, run_at: runAt }, context);
        assert.equal(created.success, true);
        assert.equal(created.schedule.task, task);
        let calls = 0;
        const run = async (schedule: any, now: number) => {
            calls++;
            assert.equal(schedule.task, task);
            assert.ok(now >= Date.parse(runAt));
            return '東京は晴れです。出典: https://www.jma.go.jp/';
        };
        restart();
        await deliverDueStaffSchedules(client, Date.parse(runAt) - 1, run);
        assert.equal(calls, 0);
        fail(true);
        await deliverDueStaffSchedules(client, Date.parse(runAt), run);
        assert.equal(calls, 1);
        assert.equal(sent.length, 0);
        assert.match((await loadStaffSchedules('guild'))[0].result!, /東京は晴れ/);
        restart();
        fail(false);
        await deliverDueStaffSchedules(client, Date.parse(runAt) + 60_000, run);
        assert.equal(calls, 1);
        assert.match(sent[0].content, /東京は晴れ/);
    });
});

test('実行中にも予約を取り消せて、処理結果を送信しない', async () => {
    await fixture(async ({ context, client, sent }) => {
        const runAt = future();
        const created: any = await staffScheduleHandler({ action: 'create', mode: 'task', task: 'ニュースを調べて', run_at: runAt }, context);
        let finish!: (value: string) => void;
        let started!: () => void;
        const ready = new Promise<void>(resolve => { started = resolve; });
        const result = new Promise<string>(resolve => { finish = resolve; });
        let calls = 0;
        const run = async () => { calls++; started(); return result; };
        const delivering = deliverDueStaffSchedules(client, Date.parse(runAt), run);
        await ready;
        await deliverDueStaffSchedules(client, Date.parse(runAt), run);
        assert.equal(calls, 1);
        const cancelled: any = await staffScheduleHandler({ action: 'cancel', id: created.schedule.id }, context);
        assert.equal(cancelled.success, true);
        finish('調査結果');
        await delivering;
        assert.equal(sent.length, 0);
        assert.equal((await loadStaffSchedules('guild')).length, 0);
    });
});

test('長い実行結果は全文をファイルで配信する', async () => {
    await fixture(async ({ context, client, sent }) => {
        const runAt = future();
        await staffScheduleHandler({ action: 'create', task: '長文を書いて', run_at: runAt }, context);
        const result = '結果の文章'.repeat(1000);
        await deliverDueStaffSchedules(client, Date.parse(runAt), async () => result);
        assert.ok(sent[0].content.length <= 2000);
        assert.equal(sent[0].files[0].attachment.toString('utf8'), result);
    });
});

test('予約処理には読み取りツールだけを渡し、実行日時と依頼文でAIを起動する', async () => {
    const tools = new Map<string, any>();
    const now = Date.parse('2026-10-21T06:00:00Z');
    const manager = {
        registerTool: (definition: any, handler: any) => { tools.set(definition.function.name, handler); },
        generateText: async (messages: any[], options: any) => {
            assert.equal(messages.at(-1).content, '最新ニュースを調べて');
            assert.match(messages[1].content, /2026-10-21T06:00:00.000Z/);
            assert.deepEqual(options.forceToolSequence, ['web_search']);
            assert.ok(options.signal instanceof AbortSignal);
            assert.deepEqual([...tools.keys()], ['web_search', 'fetch_url', 'get_weather', 'get_time', 'calculate_bash']);
            assert.ok((await tools.get('get_time')({ timezone: 'Asia/Tokyo' })).now);
            return '出典付きのニュース要約';
        },
    };
    const result = await executeStaffScheduledTask({ id: 'task', mode: 'task', task: '最新ニュースを調べて',
        guildId: 'guild', userId: 'user', channelId: 'channel', message: 'ニュース',
        runAt: new Date(now).toISOString(), createdAt: new Date(now - 1000).toISOString(), status: 'pending', attempts: 0,
    }, now, manager);
    assert.equal(result, '出典付きのニュース要約');
});

test('task予約は実行依頼が必須で、本文通知とは別の予約として保存する', async () => {
    await fixture(async ({ context }) => {
        const runAt = future();
        for (const task of ['', 'x'.repeat(4001)]) {
            assert.ok((await staffScheduleHandler({ action: 'create', mode: 'task', task, run_at: runAt }, context) as any).error);
        }
        await create(context, runAt, '天気');
        const task: any = await staffScheduleHandler({ action: 'create', mode: 'task', message: '天気', task: '東京の天気を調べて', run_at: runAt }, context);
        assert.equal(task.success, true);
        assert.equal((await loadStaffSchedules('guild')).length, 2);
    });
});

test('日本時間のISO日時を扱い、曖昧なタイムゾーンや不正な日時を拒否する', () => {
    assert.equal(parseScheduleTime('2026-10-20T15:00:00+09:00'), Date.parse('2026-10-20T06:00:00Z'));
    for (const invalid of ['2026-10-20T15:00:00', '2026-02-30T15:00:00+09:00',
        '2026-10-20T24:00:00Z', '2026-10-20T15:00:00+25:00', '今日3時', null]) {
        assert.equal(parseScheduleTime(invalid), null);
    }
});

test('予約は再読込後も残り、時刻前は送らず、指定時刻以降に本人だけを一回メンションする', async () => {
    await fixture(async ({ context, client, sent, restart }) => {
        const runAt = future();
        const result = await create(context, runAt, '起きて！ @everyone <@987654321098765432>');
        assert.equal(result.success, true);
        restart();
        assert.equal((await loadStaffSchedules('guild')).length, 1);
        await deliverDueStaffSchedules(client, Date.parse(runAt) - 1);
        assert.equal(sent.length, 0);
        await Promise.all([deliverDueStaffSchedules(client, Date.parse(runAt)), deliverDueStaffSchedules(client, Date.parse(runAt))]);
        assert.equal(sent.length, 1);
        assert.match(sent[0].content, /^<@123456789012345678> ⏰/);
        assert.deepEqual(sent[0].allowedMentions, { parse: [], users: [context.user.id], repliedUser: false });
        assert.equal(sent[0].enforceNonce, true);
        restart();
        await deliverDueStaffSchedules(client, Date.parse(runAt) + 10_000);
        assert.equal(sent.length, 1);
        assert.equal((await loadStaffSchedules('guild'))[0].status, 'sent');
    });
});

test('同時予約やAIの再試行で重複せず、他人の予約を閲覧・取消できない', async () => {
    await fixture(async ({ context }) => {
        const runAt = future();
        const [first, second] = await Promise.all([create(context, runAt), create(context, runAt)]);
        assert.equal(first.schedule.id, second.schedule.id);
        assert.equal((await loadStaffSchedules('guild')).length, 1);
        const other = { ...context, user: { id: '987654321098765432' } };
        const list: any = await staffScheduleHandler({ action: 'list' }, other);
        assert.deepEqual(list.schedules, []);
        assert.ok((await staffScheduleHandler({ action: 'cancel', id: first.schedule.id }, other) as any).error);
        assert.equal((await staffScheduleHandler({ action: 'cancel', id: first.schedule.id }, context) as any).success, true);
        assert.equal((await loadStaffSchedules('guild')).length, 0);
    });
});

test('過去時刻、権限不足、文脈なしの予約を保存しない', async () => {
    await fixture(async ({ context, channel }) => {
        assert.ok((await create(context, '2020-01-01T00:00:00Z')).error);
        assert.ok((await create(context, future(), 'x'.repeat(1501))).error);
        channel.permissionsFor = () => ({ has: () => false });
        assert.ok((await create(context)).error);
        assert.ok((await staffScheduleHandler({ action: 'create', run_at: future(), message: '通知' }) as any).error);
        assert.equal((await loadStaffSchedules('guild')).length, 0);
    });
});

test('送信失敗は待って再試行し、再起動で期限を過ぎた予約も配信する', async () => {
    await fixture(async ({ context, client, sent, fail, restart }) => {
        const runAt = future();
        await create(context, runAt);
        fail(true);
        await deliverDueStaffSchedules(client, Date.parse(runAt));
        const pending = (await loadStaffSchedules('guild'))[0];
        assert.equal(pending.status, 'pending');
        assert.equal(pending.attempts, 1);
        fail(false);
        restart();
        await deliverDueStaffSchedules(client, Date.parse(runAt) + 59_999);
        assert.equal(sent.length, 0);
        await deliverDueStaffSchedules(client, Date.parse(runAt) + 60_000);
        assert.equal(sent.length, 1);
    });
});
