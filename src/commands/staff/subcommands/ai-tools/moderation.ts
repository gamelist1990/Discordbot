// src/commands/staff/subcommands/ai-tools/moderation.ts
/**
 * Staff AI モデレーションツール群（/staff ai の明示実行経路専用）。
 *
 * 安全設計:
 * - ツールの「提示」自体を実行者（/staff ai を叩いた人）の実権限でゲートする。
 *   権限が無ければ registerStaffAITools がツール自体を登録しない（モデルに見えない）。
 * - ハンドラー側でも実行時に同じ権限を再チェックする（二重防御）。
 * - 常駐 dot（StaffAIDotAmbient）や予約タスク（StaffAIScheduledTask）は
 *   registerStaffAITools を経由しないため、ここに登録されることは構造的に無い。
 * - 対象ガード: 本人 / Bot自身 / サーバーオーナー / 管理者 / 実行者と同位以上の
 *   ロール / Bot と同位以上のロールはすべて弾く。
 * - 全アクション（成功・拒否・失敗）を Logger に監査記録する。
 *   タイムアウトは Discord の audit log reason にも理由を渡す。
 *   ※単体メッセージ削除は Discord API 側に reason 引数・監査ログエントリが
 *     存在しないため、理由は内部監査ログにのみ記録する（設計メモ参照）。
 */
import { PermissionFlagsBits } from 'discord.js';
import type { OpenAITool, ToolHandler } from '../../../../types/openai';
import { isOwner } from '../../../../config.js';
import { Logger } from '../../../../utils/Logger.js';

export const TIMEOUT_MIN_MS = 60_000; // 1分
export const TIMEOUT_MAX_MS = 28 * 24 * 60 * 60 * 1000; // Discord上限 28日

export interface StaffModerationPermissions {
    deleteMessage: boolean;
    timeoutMember: boolean;
    viewPunishmentScore: boolean;
    resetPunishmentScore: boolean;
}

type PermissionHolder = {
    has?: (permission: bigint) => boolean;
} | null | undefined;

/** 実行者の実権限から、提示してよいモデレーションツールを決める。 */
export function resolveStaffModerationPermissions(source: {
    memberPermissions?: PermissionHolder;
    user?: { id?: string };
}): StaffModerationPermissions {
    const perms = source?.memberPermissions;
    const has = (flag: bigint): boolean => {
        try { return !!perms?.has?.(flag); } catch { return false; }
    };
    const administrator = has(PermissionFlagsBits.Administrator);
    const manageMessages = has(PermissionFlagsBits.ManageMessages);
    const moderateMembers = has(PermissionFlagsBits.ModerateMembers);
    const manageGuild = has(PermissionFlagsBits.ManageGuild);
    const botOwner = !!source?.user?.id && isOwner(source.user.id);
    return {
        // 削除・タイムアウトは実行者の Discord 実権限のみ（Bot管理者でも代替しない）。
        deleteMessage: manageMessages || administrator,
        timeoutMember: moderateMembers || administrator,
        viewPunishmentScore: manageMessages || moderateMembers || manageGuild || administrator || botOwner,
        // スコアリセットは ManageGuild / Administrator 級、または Bot管理者のみ。
        resetPunishmentScore: manageGuild || administrator || botOwner,
    };
}

/** タイムアウト期間を Discord の範囲 [1分, 28日] にクランプし、クランプした事実を返す。 */
export function clampTimeoutDuration(requestedMs: number): {
    durationMs: number;
    clamped: 'below_minimum' | 'above_maximum' | null;
    note: string | null;
} {
    if (requestedMs < TIMEOUT_MIN_MS) {
        return {
            durationMs: TIMEOUT_MIN_MS,
            clamped: 'below_minimum',
            note: `指定期間が下限（1分）未満だったため、1分にクランプしました（指定: ${requestedMs}ms）`,
        };
    }
    if (requestedMs > TIMEOUT_MAX_MS) {
        return {
            durationMs: TIMEOUT_MAX_MS,
            clamped: 'above_maximum',
            note: `指定期間が Discord の上限（28日）を超えたため、28日にクランプしました（指定: ${requestedMs}ms）`,
        };
    }
    return { durationMs: requestedMs, clamped: null, note: null };
}

export interface ModerationMemberLike {
    id: string;
    permissions: { has: (permission: bigint) => boolean };
    roles: { highest: { position: number } };
}

/**
 * ロール階層ガード。対象にできない理由（日本語）を返し、問題なければ null。
 * 判定は対象ロールの position と実行者/Bot の最高ロール position の比較で行う。
 */
export function checkModerationTargetGuard(params: {
    actor: ModerationMemberLike;
    target: ModerationMemberLike;
    guildOwnerId: string;
    botMemberId?: string | null;
    botHighestPosition?: number | null;
}): string | null {
    const { actor, target, guildOwnerId } = params;
    if (target.id === actor.id) return '実行者本人を対象にはできません';
    if (params.botMemberId && target.id === params.botMemberId) return 'Bot自身を対象にはできません';
    if (target.id === guildOwnerId) return 'サーバーオーナーを対象にはできません';
    if (target.permissions.has(PermissionFlagsBits.Administrator)) {
        return '管理者権限を持つメンバーを対象にはできません';
    }
    if (actor.id !== guildOwnerId && target.roles.highest.position >= actor.roles.highest.position) {
        return '実行者と同位または上位のロールを持つメンバーを対象にはできません';
    }
    if (typeof params.botHighestPosition === 'number'
        && target.roles.highest.position >= params.botHighestPosition) {
        return 'Botと同位または上位のロールを持つメンバーのため、Botに操作権限がありません';
    }
    return null;
}

/** メッセージリンク（.../channels/<guild>/<channel>/<message>）または単体IDを解釈する。 */
export function parseMessageReference(input: string, fallbackChannelId?: string | null): {
    channelId: string | null;
    messageId: string;
} | null {
    const text = (input || '').trim();
    const link = text.match(/channels\/\d{5,}\/(\d{5,})\/(\d{5,})/);
    if (link) return { channelId: link[1], messageId: link[2] };
    const bare = text.match(/^\d{5,}$/);
    if (bare) return { channelId: fallbackChannelId ?? null, messageId: bare[0] };
    return null;
}

function normalizeUserId(input: string): string {
    const normalized = (input || '').trim();
    const matched = normalized.match(/\d{5,}/);
    return matched?.[0] || normalized;
}

interface AuditEntry {
    action: 'delete_message' | 'timeout_member' | 'get_punishment_score' | 'reset_punishment_score';
    guildId: string;
    actorId: string;
    target: string;
    reason?: string | null;
    durationMs?: number | null;
    result: 'success' | 'denied' | 'error';
    detail?: string;
}

/** 監査ログ: 実行者・対象・種別・理由・期間を1行で記録する（Logger の流儀）。 */
export function auditModerationAction(entry: AuditEntry): void {
    Logger.info(
        `[StaffAI:moderation] action=${entry.action} guild=${entry.guildId} actor=${entry.actorId} `
        + `target=${entry.target} reason=${JSON.stringify(entry.reason ?? null)} `
        + `durationMs=${entry.durationMs ?? '-'} result=${entry.result}`
        + (entry.detail ? ` detail=${JSON.stringify(entry.detail)}` : ''),
    );
}

function denied(entry: Omit<AuditEntry, 'result'>, message: string): { error: string } {
    auditModerationAction({ ...entry, result: 'denied', detail: message });
    return { error: message };
}

async function fetchMember(guild: any, userId: string): Promise<any | null> {
    try { return await guild.members.fetch(userId); } catch { return null; }
}

// ---------------- メッセージ削除 ----------------

export const deleteMessageToolDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'delete_message',
        description: '指定したメッセージ1件を削除します（メッセージIDまたはメッセージリンク）。実行者にメッセージ管理権限がある場合のみ使えます。自分・Bot・管理者・上位ロールのメンバーの投稿は削除できません。',
        parameters: {
            type: 'object',
            properties: {
                message: { type: 'string', description: '対象メッセージのID、またはメッセージリンク' },
                reason: { type: 'string', description: '削除理由（監査ログに記録されます）' },
            },
            required: ['message'],
        },
    },
};

export const deleteMessageToolHandler: ToolHandler = async (
    args: { message: string; reason?: string },
    context?: any,
) => {
    const base: Omit<AuditEntry, 'result'> = {
        action: 'delete_message', guildId: context?.guild?.id ?? 'unknown',
        actorId: context?.user?.id ?? 'unknown', target: String(args?.message ?? ''),
        reason: args?.reason ?? null,
    };
    try {
        if (!context?.guild) return { error: 'このツールはギルド内でのみ利用できます' };
        // 実行時再チェック（提示制御と二重防御）
        if (!resolveStaffModerationPermissions(context).deleteMessage) {
            return denied(base, '実行者にメッセージ管理権限（ManageMessages）が無いため、メッセージ削除は実行できません。その旨をユーザーに伝えてください。');
        }
        const guild = context.guild;
        const reference = parseMessageReference(args.message, context.channelId);
        if (!reference || !reference.channelId) {
            return denied(base, 'メッセージIDまたはメッセージリンクを正しく解釈できませんでした');
        }
        base.target = `message:${reference.messageId}`;

        let channel: any = null;
        if (reference.channelId === context.channelId && context.channel && 'messages' in context.channel) {
            channel = context.channel;
        } else {
            channel = await guild.channels.fetch(reference.channelId).catch(() => null);
        }
        if (!channel || !('messages' in channel)) {
            return denied(base, '対象チャンネルを取得できませんでした（権限不足の可能性があります）');
        }
        const message = await channel.messages.fetch(reference.messageId).catch(() => null);
        if (!message) return denied(base, '対象メッセージを取得できませんでした（削除済み、または権限不足の可能性があります）');

        const authorId: string = message.author?.id ?? '';
        const botId: string | null = guild.members?.me?.id ?? context.client?.user?.id ?? null;
        if (authorId && authorId === context.user.id) {
            return denied(base, '実行者本人のメッセージはこのツールでは削除できません');
        }
        if (authorId && botId && authorId === botId) {
            return denied(base, 'Bot自身のメッセージはこのツールでは削除できません');
        }
        // 投稿者がギルドメンバーなら階層ガードを適用する（退出済み等は対象外）。
        const authorMember = authorId ? await fetchMember(guild, authorId) : null;
        if (authorMember) {
            const actorMember = await fetchMember(guild, context.user.id);
            if (!actorMember) return denied(base, '実行者のメンバー情報を取得できませんでした');
            const guard = checkModerationTargetGuard({
                actor: actorMember, target: authorMember, guildOwnerId: guild.ownerId,
                botMemberId: botId, botHighestPosition: guild.members?.me?.roles?.highest?.position ?? null,
            });
            if (guard) return denied(base, guard);
        }
        if (message.deletable === false) {
            return denied(base, 'このメッセージはBotの権限では削除できません（階層・権限を確認してください）');
        }
        // discord.js の Message.delete() には reason 引数が無い（Discord API の仕様）。
        // 理由は上の監査ログに記録する。
        await message.delete();
        auditModerationAction({ ...base, result: 'success' });
        return {
            success: true,
            deleted_message_id: reference.messageId,
            channel_id: reference.channelId,
            author_id: authorId || null,
            reason: args.reason ?? null,
            note: 'メッセージを削除し、監査ログに記録しました',
        };
    } catch (error) {
        console.error('deleteMessageToolHandler error:', error);
        auditModerationAction({ ...base, result: 'error', detail: error instanceof Error ? error.message : String(error) });
        return { error: 'メッセージの削除に失敗しました。権限や対象の状態を確認してください' };
    }
};

// ---------------- タイムアウト ----------------

export const timeoutMemberToolDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'timeout_member',
        description: 'メンバーをタイムアウトします。理由は必須です。期間は分単位で指定し、1分未満は1分に、28日超は28日にクランプされます（クランプ時は結果に明示されます）。実行者にメンバー管理（ModerateMembers）権限がある場合のみ使えます。自分・Bot・管理者・オーナー・同位以上のロールは対象にできません。',
        parameters: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '対象のユーザーIDまたはメンション' },
                duration_minutes: { type: 'number', description: 'タイムアウト期間（分）。例: 10分=10, 1時間=60, 1日=1440' },
                reason: { type: 'string', description: 'タイムアウトの理由（必須）' },
            },
            required: ['user_id', 'duration_minutes', 'reason'],
        },
    },
};

export const timeoutMemberToolHandler: ToolHandler = async (
    args: { user_id: string; duration_minutes: number; reason: string },
    context?: any,
) => {
    const targetId = normalizeUserId(args?.user_id ?? '');
    const base: Omit<AuditEntry, 'result'> = {
        action: 'timeout_member', guildId: context?.guild?.id ?? 'unknown',
        actorId: context?.user?.id ?? 'unknown', target: `user:${targetId}`,
        reason: args?.reason ?? null,
    };
    try {
        if (!context?.guild) return { error: 'このツールはギルド内でのみ利用できます' };
        if (!resolveStaffModerationPermissions(context).timeoutMember) {
            return denied(base, '実行者にメンバー管理権限（ModerateMembers）が無いため、タイムアウトは実行できません。その旨をユーザーに伝えてください。');
        }
        // 理由必須（入力検証）
        const reason = (args.reason ?? '').trim();
        if (!reason) return denied(base, 'タイムアウトには理由が必須です。理由を指定してください');
        if (!targetId) return denied(base, 'user_id が不正です');
        const requestedMinutes = Number(args.duration_minutes);
        if (!Number.isFinite(requestedMinutes) || requestedMinutes <= 0) {
            return denied(base, 'duration_minutes は正の数で指定してください');
        }
        const requestedMs = Math.round(requestedMinutes * 60_000);
        const { durationMs, clamped, note } = clampTimeoutDuration(requestedMs);
        base.durationMs = durationMs;

        const guild = context.guild;
        const target = await fetchMember(guild, targetId);
        if (!target) return denied(base, '指定されたユーザーはサーバーに存在しません');
        const actor = await fetchMember(guild, context.user.id);
        if (!actor) return denied(base, '実行者のメンバー情報を取得できませんでした');
        const botMember = guild.members?.me ?? null;
        if (!botMember?.permissions?.has?.(PermissionFlagsBits.ModerateMembers)) {
            return denied(base, 'Botにメンバー管理権限（ModerateMembers）が無いため実行できません');
        }
        const guard = checkModerationTargetGuard({
            actor, target, guildOwnerId: guild.ownerId,
            botMemberId: botMember.id, botHighestPosition: botMember.roles?.highest?.position ?? null,
        });
        if (guard) return denied(base, guard);
        if (target.moderatable === false) {
            return denied(base, 'このメンバーはBotの権限ではタイムアウトできません（ロール階層を確認してください）');
        }
        // Discord の audit log reason にも理由を渡す。
        await target.timeout(durationMs, reason);
        auditModerationAction({ ...base, result: 'success' });
        return {
            success: true,
            user_id: targetId,
            requested_duration_minutes: requestedMinutes,
            applied_duration_minutes: durationMs / 60_000,
            clamped: clamped ?? false,
            ...(note ? { clamp_note: note } : {}),
            reason,
            timeout_until: new Date(Date.now() + durationMs).toISOString(),
            note: 'タイムアウトを実行し、監査ログに記録しました',
        };
    } catch (error) {
        console.error('timeoutMemberToolHandler error:', error);
        auditModerationAction({ ...base, result: 'error', detail: error instanceof Error ? error.message : String(error) });
        return { error: 'タイムアウトの実行に失敗しました。権限や対象の状態を確認してください' };
    }
};

// ---------------- 罰則スコア確認 ----------------

export const punishmentScoreToolDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'get_punishment_score',
        description: '指定ユーザーの現在の AntiCheat 罰則スコア（信頼スコア）と状態を確認します（読み取り専用）。',
        parameters: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '対象のユーザーIDまたはメンション' },
            },
            required: ['user_id'],
        },
    },
};

export const punishmentScoreToolHandler: ToolHandler = async (
    args: { user_id: string },
    context?: any,
) => {
    try {
        if (!context?.guild) return { error: 'このツールはギルド内でのみ利用できます' };
        if (!resolveStaffModerationPermissions(context).viewPunishmentScore) {
            return { error: '実行者にモデレーション権限が無いため、罰則スコアの確認はできません。その旨をユーザーに伝えてください。' };
        }
        const userId = normalizeUserId(args.user_id);
        if (!userId) return { error: 'user_id が不正です' };
        const { antiCheatManager } = await import('../../../../core/anticheat/AntiCheatManager.js');
        const trust = await antiCheatManager.getUserTrust(context.guild.id, userId);
        const member = await fetchMember(context.guild, userId);
        auditModerationAction({
            action: 'get_punishment_score', guildId: context.guild.id, actorId: context.user.id,
            target: `user:${userId}`, result: 'success', detail: `score=${trust.score}`,
        });
        return {
            user_id: userId,
            current_score: trust.score,
            last_updated: trust.lastUpdated,
            history_entries: (trust.history || []).length,
            recent_history: (trust.history || []).slice(-5).reverse(),
            is_member: !!member,
            is_timed_out: member ? !!member.communicationDisabledUntil : null,
            timeout_until: member?.communicationDisabledUntil ? member.communicationDisabledUntil.toISOString() : null,
        };
    } catch (error) {
        console.error('punishmentScoreToolHandler error:', error);
        return { error: '罰則スコアの取得に失敗しました' };
    }
};

// ---------------- 罰則スコアのリセット ----------------

export const resetPunishmentScoreToolDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'reset_punishment_score',
        description: '指定ユーザーの AntiCheat 罰則スコア（信頼スコア）を0にリセットします。実行にはサーバー管理権限（ManageGuild/Administrator）またはBot管理者であることが必要です。理由は必須です。',
        parameters: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '対象のユーザーIDまたはメンション' },
                reason: { type: 'string', description: 'リセットの理由（必須、監査ログに記録されます）' },
            },
            required: ['user_id', 'reason'],
        },
    },
};

export const resetPunishmentScoreToolHandler: ToolHandler = async (
    args: { user_id: string; reason: string },
    context?: any,
) => {
    const targetId = normalizeUserId(args?.user_id ?? '');
    const base: Omit<AuditEntry, 'result'> = {
        action: 'reset_punishment_score', guildId: context?.guild?.id ?? 'unknown',
        actorId: context?.user?.id ?? 'unknown', target: `user:${targetId}`,
        reason: args?.reason ?? null,
    };
    try {
        if (!context?.guild) return { error: 'このツールはギルド内でのみ利用できます' };
        if (!resolveStaffModerationPermissions(context).resetPunishmentScore) {
            return denied(base, '実行者にサーバー管理権限（ManageGuild/Administrator）またはBot管理者権限が無いため、スコアリセットは実行できません。その旨をユーザーに伝えてください。');
        }
        const reason = (args.reason ?? '').trim();
        if (!reason) return denied(base, 'スコアリセットには理由が必須です。理由を指定してください');
        if (!targetId) return denied(base, 'user_id が不正です');
        if (targetId === context.user.id) return denied(base, '実行者本人のスコアはこのツールではリセットできません');
        const botId: string | null = context.guild.members?.me?.id ?? context.client?.user?.id ?? null;
        if (botId && targetId === botId) return denied(base, 'Bot自身のスコアはリセットできません');

        const { antiCheatManager } = await import('../../../../core/anticheat/AntiCheatManager.js');
        const before = await antiCheatManager.getUserTrust(context.guild.id, targetId);
        // 既存の trust リセット経路（AntiCheatManager.resetTrust: 保存初期化＋
        // anticheat のログチャンネルへのEmbed通知まで含む）を使う。
        await antiCheatManager.resetTrust(context.guild.id, targetId);
        const after = await antiCheatManager.getUserTrust(context.guild.id, targetId);
        auditModerationAction({ ...base, result: 'success', detail: `score ${before.score} -> ${after.score}` });
        return {
            success: true,
            user_id: targetId,
            previous_score: before.score,
            current_score: after.score,
            reason,
            note: '罰則スコアをリセットし、監査ログに記録しました',
        };
    } catch (error) {
        console.error('resetPunishmentScoreToolHandler error:', error);
        auditModerationAction({ ...base, result: 'error', detail: error instanceof Error ? error.message : String(error) });
        return { error: '罰則スコアのリセットに失敗しました' };
    }
};
