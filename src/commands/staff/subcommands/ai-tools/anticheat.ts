import { ChatInputCommandInteraction } from 'discord.js';
import { OpenAITool, ToolHandler } from '../../../../types/openai';
import { antiCheatManager } from '../../../../core/anticheat/AntiCheatManager.js';
import { interviewRoomManager } from '../../../../core/interview/InterviewRoomManager.js';

function normalizeUserId(input: string): string {
    const normalized = (input || '').trim();
    const matched = normalized.match(/\d{5,}/);
    return matched?.[0] || normalized;
}

function getNextPunishmentSummary(currentScore: number, punishments: Array<{ threshold: number; actions: Array<{ type: string; durationSeconds?: number }> }>): string {
    const sorted = [...punishments].sort((left, right) => left.threshold - right.threshold);
    for (const punishment of sorted) {
        if (punishment.threshold <= currentScore) {
            continue;
        }

        const actions = punishment.actions
            .map((action) => action.type + (action.durationSeconds ? ` (${action.durationSeconds}s)` : ''))
            .join(', ');
        return `しきい値 ${punishment.threshold} まであと ${punishment.threshold - currentScore} / ${actions}`;
    }

    if (sorted.length === 0) {
        return '処罰ルールなし';
    }

    const highest = sorted[sorted.length - 1];
    return `最高しきい値 ${highest.threshold} に到達済み`;
}

export const antiCheatUserProfileDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'get_anticheat_user_profile',
        description: '指定ユーザーの AntiCheat 信頼スコア、履歴、直近の検知ログ、次の処罰見込みを取得します',
        parameters: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '対象のユーザーIDまたはメンション' },
                log_limit: { type: 'number', description: '取得する直近ログ数', default: 10 },
                history_limit: { type: 'number', description: '取得する信頼履歴数', default: 10 }
            },
            required: ['user_id']
        }
    }
};

export const antiCheatUserProfileHandler: ToolHandler = async (
    args: { user_id: string; log_limit?: number; history_limit?: number },
    context?: any
) => {
    try {
        if (!context?.guild) {
            return { error: 'このツールはギルド内でのみ利用できます' };
        }

        const interaction = context as ChatInputCommandInteraction;
        const guild = interaction.guild;
        if (!guild) {
            return { error: 'ギルド情報を取得できませんでした' };
        }

        const userId = normalizeUserId(args.user_id);
        if (!userId) {
            return { error: 'user_id が不正です' };
        }

        const trust = await antiCheatManager.getUserTrust(guild.id, userId);
        const logs = await antiCheatManager.getUserLogs(guild.id, userId, Math.max(1, Math.min(30, args.log_limit ?? 10)));
        const settings = await antiCheatManager.getSettings(guild.id);
        const member = await guild.members.fetch(userId).catch(() => null);
        const sessions = await interviewRoomManager.listSessions(guild.id, 20);
        const latestInterview = sessions.find((session) => session.userId === userId);
        const historyLimit = Math.max(1, Math.min(20, args.history_limit ?? 10));

        return {
            user_id: userId,
            username: member?.user.username || '不明',
            display_name: member?.displayName || '不明',
            current_score: trust.score,
            last_updated: trust.lastUpdated,
            next_punishment: getNextPunishmentSummary(trust.score, settings.punishments || []),
            trust_history: (trust.history || []).slice(-historyLimit).reverse(),
            recent_detection_logs: logs,
            latest_interview: latestInterview ? {
                session_id: latestInterview.sessionId,
                status: latestInterview.status,
                title: latestInterview.title,
                created_at: latestInterview.createdAt,
                updated_at: latestInterview.updatedAt,
                cooldown_until: latestInterview.cooldownUntil,
                decision: latestInterview.decision
            } : null
        };
    } catch (error) {
        console.error('antiCheatUserProfileHandler error:', error);
        return { error: 'AntiCheat プロファイルの取得に失敗しました' };
    }
};

export const createAntiCheatInterviewDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'create_anticheat_interview_room',
        description: '信頼スコアの再審査用に、対象ユーザーとの AntiCheat 面接室を作成します。24時間クールダウンがあります。',
        parameters: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '対象のユーザーIDまたはメンション' },
                title: { type: 'string', description: '部屋タイトル。省略時はユーザー名から自動生成' }
            },
            required: ['user_id']
        }
    }
};

export const createAntiCheatInterviewHandler: ToolHandler = async (
    args: { user_id: string; title?: string },
    context?: any
) => {
    try {
        if (!context?.guild) {
            return { error: 'このツールはギルド内でのみ利用できます' };
        }

        const interaction = context as ChatInputCommandInteraction;
        const guild = interaction.guild;
        if (!guild) {
            return { error: 'ギルド情報を取得できませんでした' };
        }

        const userId = normalizeUserId(args.user_id);
        if (!userId) {
            return { error: 'user_id が不正です' };
        }

        const session = await interviewRoomManager.createInterviewRoom(guild, userId, interaction.user.id, args.title);
        return {
            success: true,
            session_id: session.sessionId,
            title: session.title,
            status: session.status,
            channel_id: session.channelId,
            channel_url: `https://discord.com/channels/${guild.id}/${session.channelId}`,
            cooldown_until: session.cooldownUntil,
            warnings: session.warnings
        };
    } catch (error) {
        console.error('createAntiCheatInterviewHandler error:', error);
        return {
            error: error instanceof Error ? error.message : '面接室の作成に失敗しました'
        };
    }
};
