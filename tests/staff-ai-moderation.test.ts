import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import {
    resolveStaffModerationPermissions,
    clampTimeoutDuration,
    checkModerationTargetGuard,
    parseMessageReference,
    deleteMessageToolHandler,
    timeoutMemberToolHandler,
    punishmentScoreToolHandler,
    resetPunishmentScoreToolHandler,
    TIMEOUT_MIN_MS,
    TIMEOUT_MAX_MS,
} from '../src/commands/staff/subcommands/ai-tools/moderation.ts';
import { registerStaffAITools } from '../src/commands/staff/subcommands/ai-tools/catalog.ts';
import { antiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';

const MM = PermissionFlagsBits.ManageMessages;
const MOD = PermissionFlagsBits.ModerateMembers;
const MG = PermissionFlagsBits.ManageGuild;
const ADMIN = PermissionFlagsBits.Administrator;

function permSet(...flags: bigint[]) {
    const set = new Set(flags);
    return { has: (flag: bigint) => set.has(flag) || set.has(ADMIN) };
}

function member(id: string, position: number, opts: { admin?: boolean; moderatable?: boolean } = {}) {
    const timeoutCalls: Array<[number | null, string | undefined]> = [];
    return {
        id,
        permissions: {
            has: (flag: bigint) => flag === ADMIN ? !!opts.admin : true,
        },
        roles: { highest: { position } },
        moderatable: opts.moderatable ?? true,
        communicationDisabledUntil: null as Date | null,
        timeoutCalls,
        async timeout(ms: number | null, reason?: string) { timeoutCalls.push([ms, reason]); return this; },
    };
}

type MockMember = ReturnType<typeof member>;

function makeGuild(members: Record<string, MockMember>, bot: MockMember) {
    return {
        id: 'guild1',
        ownerId: 'owner1',
        members: {
            me: bot,
            fetch: async (id: string) => {
                const found = members[id];
                if (!found) throw new Error('Unknown Member');
                return found;
            },
        },
        channels: { fetch: async () => null },
    };
}

function makeContext(guild: any, actorId: string, perms: { has: (f: bigint) => boolean }, extra: any = {}) {
    return {
        guild,
        guildId: 'guild1',
        user: { id: actorId },
        memberPermissions: perms,
        channelId: 'chan1',
        channel: null,
        client: { user: { id: 'bot1' } },
        ...extra,
    } as any;
}

// ---------- 権限モデル / 提示制御 ----------

test('権限解決: 実権限ごとに提示可否が決まる', () => {
    const none = resolveStaffModerationPermissions({ memberPermissions: permSet(), user: { id: 'u' } });
    assert.deepEqual(none, {
        deleteMessage: false, timeoutMember: false,
        viewPunishmentScore: false, resetPunishmentScore: false,
    });
    const mm = resolveStaffModerationPermissions({ memberPermissions: permSet(MM), user: { id: 'u' } });
    assert.equal(mm.deleteMessage, true);
    assert.equal(mm.timeoutMember, false);
    assert.equal(mm.resetPunishmentScore, false);
    assert.equal(mm.viewPunishmentScore, true);
    const mod = resolveStaffModerationPermissions({ memberPermissions: permSet(MOD), user: { id: 'u' } });
    assert.equal(mod.timeoutMember, true);
    assert.equal(mod.deleteMessage, false);
    const mg = resolveStaffModerationPermissions({ memberPermissions: permSet(MG), user: { id: 'u' } });
    assert.equal(mg.resetPunishmentScore, true);
    assert.equal(mg.deleteMessage, false);
});

test('提示制御: 権限が無ければモデレーションツールは登録されない', () => {
    const collect = (moderation?: any): string[] => {
        const names: string[] = [];
        const manager = { registerTool: (def: any) => { names.push(def.function.name); } };
        registerStaffAITools(manager as any, moderation);
        return names;
    };
    const MODERATION = ['delete_message', 'timeout_member', 'get_punishment_score', 'reset_punishment_score'];
    // 引数なし（従来経路）: 17ツールのみ、モデレーションは一切なし
    const baseline = collect(undefined);
    assert.equal(baseline.length, 17);
    for (const name of MODERATION) assert.equal(baseline.includes(name), false, name);
    // 全権限 false でも提示されない
    const deniedAll = collect({ deleteMessage: false, timeoutMember: false, viewPunishmentScore: false, resetPunishmentScore: false });
    for (const name of MODERATION) assert.equal(deniedAll.includes(name), false, name);
    // 個別に許可したものだけ提示される
    const partial = collect({ deleteMessage: true, timeoutMember: false, viewPunishmentScore: true, resetPunishmentScore: false });
    assert.equal(partial.includes('delete_message'), true);
    assert.equal(partial.includes('get_punishment_score'), true);
    assert.equal(partial.includes('timeout_member'), false);
    assert.equal(partial.includes('reset_punishment_score'), false);
    const full = collect({ deleteMessage: true, timeoutMember: true, viewPunishmentScore: true, resetPunishmentScore: true });
    for (const name of MODERATION) assert.equal(full.includes(name), true, name);
    assert.equal(full.length, 21);
});

// ---------- 期間クランプ ----------

test('タイムアウト期間クランプ: 下限1分・上限28日・クランプ明示', () => {
    const below = clampTimeoutDuration(30_000);
    assert.equal(below.durationMs, TIMEOUT_MIN_MS);
    assert.equal(below.clamped, 'below_minimum');
    assert.match(below.note!, /クランプ/);
    const above = clampTimeoutDuration(TIMEOUT_MAX_MS + 1);
    assert.equal(above.durationMs, TIMEOUT_MAX_MS);
    assert.equal(above.clamped, 'above_maximum');
    assert.match(above.note!, /28日/);
    const within = clampTimeoutDuration(3_600_000);
    assert.equal(within.durationMs, 3_600_000);
    assert.equal(within.clamped, null);
    assert.equal(within.note, null);
    assert.equal(clampTimeoutDuration(TIMEOUT_MIN_MS).clamped, null);
    assert.equal(clampTimeoutDuration(TIMEOUT_MAX_MS).clamped, null);
});

// ---------- 階層ガード ----------

test('階層ガード: 本人・Bot・オーナー・管理者・同位以上・Bot同位以上を弾く', () => {
    const actor = member('actor1', 10);
    const base = { actor, guildOwnerId: 'owner1', botMemberId: 'bot1', botHighestPosition: 50 };
    assert.equal(checkModerationTargetGuard({ ...base, target: member('actor1', 1) }), '実行者本人を対象にはできません');
    assert.match(checkModerationTargetGuard({ ...base, target: member('bot1', 1) })!, /Bot自身/);
    assert.match(checkModerationTargetGuard({ ...base, target: member('owner1', 1) })!, /オーナー/);
    assert.match(checkModerationTargetGuard({ ...base, target: member('t', 1, { admin: true }) })!, /管理者権限/);
    assert.match(checkModerationTargetGuard({ ...base, target: member('t', 10) })!, /同位または上位/);
    assert.match(checkModerationTargetGuard({ ...base, target: member('t', 11) })!, /同位または上位/);
    // 実行者より下位でも Bot と同位以上なら Bot 側ガードで弾く
    const lowActor = member('actor2', 100);
    assert.match(
        checkModerationTargetGuard({ actor: lowActor, target: member('t', 50), guildOwnerId: 'owner1', botMemberId: 'bot1', botHighestPosition: 50 })!,
        /Botと同位または上位/,
    );
    // 正常系: 下位ロール・非管理者は通る
    assert.equal(checkModerationTargetGuard({ ...base, target: member('t', 5) }), null);
    // ギルドオーナーが実行者の場合はロール比較をスキップする
    const ownerActor = member('owner1', 0);
    assert.equal(checkModerationTargetGuard({
        actor: ownerActor, target: member('t', 5), guildOwnerId: 'owner1', botMemberId: 'bot1', botHighestPosition: 50,
    }), null);
});

test('メッセージ参照のパース: リンクと単体ID', () => {
    assert.deepEqual(
        parseMessageReference('https://discord.com/channels/11111/22222/33333'),
        { channelId: '22222', messageId: '33333' },
    );
    assert.deepEqual(parseMessageReference('99999', 'chan1'), { channelId: 'chan1', messageId: '99999' });
    assert.equal(parseMessageReference('not-a-message'), null);
});

// ---------- タイムアウト（discord.js モック） ----------

function timeoutSetup(opts: {
    actorPerms?: { has: (f: bigint) => boolean };
    targetPosition?: number;
    targetOpts?: { admin?: boolean; moderatable?: boolean };
    targetId?: string;
} = {}) {
    const actor = member('actor1', 10);
    const target = member(opts.targetId ?? 'target1', opts.targetPosition ?? 5, opts.targetOpts);
    const bot = member('bot1', 50);
    const guild = makeGuild({ actor1: actor, [target.id]: target, bot1: bot }, bot);
    const context = makeContext(guild, 'actor1', opts.actorPerms ?? permSet(MOD));
    return { actor, target, bot, guild, context };
}

test('タイムアウト: 権限なしでは実行できない（モックに届かない）', async () => {
    const { target, context } = timeoutSetup({ actorPerms: permSet() });
    const result: any = await timeoutMemberToolHandler(
        { user_id: 'target1', duration_minutes: 60, reason: '荒らし' }, context);
    assert.match(result.error, /ModerateMembers/);
    assert.equal(target.timeoutCalls.length, 0);
});

test('タイムアウト: 理由が空なら実行しない', async () => {
    const { target, context } = timeoutSetup();
    for (const reason of ['', '   ']) {
        const result: any = await timeoutMemberToolHandler(
            { user_id: 'target1', duration_minutes: 60, reason }, context);
        assert.match(result.error, /理由が必須/);
    }
    assert.equal(target.timeoutCalls.length, 0);
});

test('タイムアウト: 階層ガード（同位・管理者・本人・Bot・オーナー）', async () => {
    const cases: Array<{ setup: Parameters<typeof timeoutSetup>[0]; pattern: RegExp }> = [
        { setup: { targetPosition: 10 }, pattern: /同位または上位/ },
        { setup: { targetOpts: { admin: true } }, pattern: /管理者権限/ },
        { setup: { targetId: 'actor1' }, pattern: /本人/ },
        { setup: { targetId: 'bot1' }, pattern: /Bot自身/ },
        { setup: { targetId: 'owner1' }, pattern: /オーナー/ },
        { setup: { targetOpts: { moderatable: false } }, pattern: /タイムアウトできません/ },
    ];
    for (const { setup, pattern } of cases) {
        const { target, context } = timeoutSetup(setup);
        const result: any = await timeoutMemberToolHandler(
            { user_id: setup.targetId ?? 'target1', duration_minutes: 60, reason: 'テスト' }, context);
        assert.match(result.error ?? '', pattern, JSON.stringify(setup));
        assert.equal(target.timeoutCalls.length, 0, JSON.stringify(setup));
    }
});

test('タイムアウト: 正常実行は reason を渡し、クランプを結果に明示する', async () => {
    const ok = timeoutSetup();
    const result: any = await timeoutMemberToolHandler(
        { user_id: 'target1', duration_minutes: 60, reason: 'スパム行為' }, ok.context);
    assert.equal(result.success, true);
    assert.deepEqual(ok.target.timeoutCalls, [[3_600_000, 'スパム行為']]);
    assert.equal(result.clamped, false);

    const over = timeoutSetup();
    const overResult: any = await timeoutMemberToolHandler(
        { user_id: 'target1', duration_minutes: 50_000, reason: '長期' }, over.context);
    assert.equal(overResult.success, true);
    assert.equal(overResult.clamped, 'above_maximum');
    assert.match(overResult.clamp_note, /28日/);
    assert.deepEqual(over.target.timeoutCalls, [[TIMEOUT_MAX_MS, '長期']]);
    assert.equal(overResult.applied_duration_minutes, 40_320);

    const under = timeoutSetup();
    const underResult: any = await timeoutMemberToolHandler(
        { user_id: 'target1', duration_minutes: 0.5, reason: '短すぎ' }, under.context);
    assert.equal(underResult.success, true);
    assert.equal(underResult.clamped, 'below_minimum');
    assert.deepEqual(under.target.timeoutCalls, [[TIMEOUT_MIN_MS, '短すぎ']]);
});

// ---------- メッセージ削除（discord.js モック） ----------

function deleteSetup(opts: {
    actorPerms?: { has: (f: bigint) => boolean };
    authorId?: string;
    authorPosition?: number;
    authorOpts?: { admin?: boolean };
    deletable?: boolean;
} = {}) {
    const actor = member('actor1', 10);
    const author = member(opts.authorId ?? 'target1', opts.authorPosition ?? 5, opts.authorOpts);
    const bot = member('bot1', 50);
    const guild = makeGuild({ actor1: actor, [author.id]: author, bot1: bot }, bot);
    let deleteCalls = 0;
    const message = {
        id: '33333',
        author: { id: author.id },
        deletable: opts.deletable ?? true,
        async delete() { deleteCalls++; },
    };
    const channel = { messages: { fetch: async (id: string) => id === '33333' ? message : Promise.reject(new Error('Unknown')) } };
    const context = makeContext(guild, 'actor1', opts.actorPerms ?? permSet(MM), { channel });
    return { context, message, getDeleteCalls: () => deleteCalls };
}

test('メッセージ削除: 権限なしでは実行できない', async () => {
    const { context, getDeleteCalls } = deleteSetup({ actorPerms: permSet() });
    const result: any = await deleteMessageToolHandler({ message: '33333', reason: '違反' }, context);
    assert.match(result.error, /ManageMessages/);
    assert.equal(getDeleteCalls(), 0);
});

test('メッセージ削除: リンク指定で正常削除できる', async () => {
    const { context, getDeleteCalls } = deleteSetup();
    context.channelId = '22222';
    const result: any = await deleteMessageToolHandler(
        { message: 'https://discord.com/channels/11111/22222/33333', reason: '不適切な投稿' }, context);
    assert.equal(result.success, true);
    assert.equal(result.deleted_message_id, '33333');
    assert.equal(getDeleteCalls(), 1);
});

test('メッセージ削除: 本人・管理者の投稿・削除不可メッセージを弾く', async () => {
    const self = deleteSetup({ authorId: 'actor1' });
    const selfResult: any = await deleteMessageToolHandler({ message: '33333' }, self.context);
    assert.match(selfResult.error, /本人/);
    assert.equal(self.getDeleteCalls(), 0);

    const admin = deleteSetup({ authorOpts: { admin: true } });
    const adminResult: any = await deleteMessageToolHandler({ message: '33333' }, admin.context);
    assert.match(adminResult.error, /管理者権限/);
    assert.equal(admin.getDeleteCalls(), 0);

    const higher = deleteSetup({ authorPosition: 10 });
    const higherResult: any = await deleteMessageToolHandler({ message: '33333' }, higher.context);
    assert.match(higherResult.error, /同位または上位/);
    assert.equal(higher.getDeleteCalls(), 0);

    const locked = deleteSetup({ deletable: false });
    const lockedResult: any = await deleteMessageToolHandler({ message: '33333' }, locked.context);
    assert.match(lockedResult.error, /削除できません/);
    assert.equal(locked.getDeleteCalls(), 0);
});

// ---------- 罰則スコア確認 / リセット（保存層モック） ----------

test('罰則スコア確認とリセット: モック保存層で読み取りと初期化ができる', async () => {
    const originalGet = antiCheatManager.getUserTrust;
    const originalReset = antiCheatManager.resetTrust;
    const store = new Map<string, number>([['target1', 42]]);
    (antiCheatManager as any).getUserTrust = async (_guildId: string, userId: string) => ({
        score: store.get(userId) ?? 0,
        lastUpdated: '2026-11-07T00:00:00.000Z',
        history: [{ delta: 42, reason: 'test', timestamp: '2026-11-07T00:00:00.000Z' }],
    });
    (antiCheatManager as any).resetTrust = async (_guildId: string, userId: string) => {
        store.set(userId, 0);
    };
    try {
        const actor = member('actor1', 10);
        const bot = member('bot1', 50);
        const guild = makeGuild({ actor1: actor, target1: member('target1', 5), bot1: bot }, bot);

        // 確認: ManageMessages で読める
        const viewContext = makeContext(guild, 'actor1', permSet(MM));
        const view: any = await punishmentScoreToolHandler({ user_id: 'target1' }, viewContext);
        assert.equal(view.current_score, 42);

        // 確認: 権限なしでは読めない
        const noPermContext = makeContext(guild, 'actor1', permSet());
        const deniedView: any = await punishmentScoreToolHandler({ user_id: 'target1' }, noPermContext);
        assert.match(deniedView.error, /権限が無/);

        // リセット: ManageMessages だけでは不可（ManageGuild級が必要）
        const deniedReset: any = await resetPunishmentScoreToolHandler(
            { user_id: 'target1', reason: '誤検知のため' }, viewContext);
        assert.match(deniedReset.error, /ManageGuild/);
        assert.equal(store.get('target1'), 42);

        // リセット: 理由が空なら実行しない
        const mgContext = makeContext(guild, 'actor1', permSet(MG));
        const noReason: any = await resetPunishmentScoreToolHandler(
            { user_id: 'target1', reason: ' ' }, mgContext);
        assert.match(noReason.error, /理由が必須/);
        assert.equal(store.get('target1'), 42);

        // リセット: 正常系（初期化され、以前のスコアが返る）
        const reset: any = await resetPunishmentScoreToolHandler(
            { user_id: 'target1', reason: '誤検知のため' }, mgContext);
        assert.equal(reset.success, true);
        assert.equal(reset.previous_score, 42);
        assert.equal(reset.current_score, 0);
        assert.equal(store.get('target1'), 0);
    } finally {
        (antiCheatManager as any).getUserTrust = originalGet;
        (antiCheatManager as any).resetTrust = originalReset;
    }
});
