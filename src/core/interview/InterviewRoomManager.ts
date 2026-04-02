import {
    CategoryChannel,
    ChannelType,
    Client,
    EmbedBuilder,
    Guild,
    GuildMember,
    Message,
    PermissionFlagsBits,
    TextChannel
} from 'discord.js';
import { OpenAIChatManager } from '../OpenAIChatManager.js';
import { database } from '../Database.js';
import { antiCheatManager } from '../anticheat/AntiCheatManager.js';
import { DetectionLog, UserTrustData } from '../anticheat/types.js';
import { Logger } from '../../utils/Logger.js';
import { config } from '../../config.js';

export type InterviewVerdict = 'continue' | 'approve_reset' | 'reject' | 'terminate';
export type InterviewStatus = 'active' | 'approved' | 'rejected' | 'terminated' | 'closed';
export type InterviewTranscriptAuthor = 'system' | 'assistant' | 'user' | 'staff';

export interface InterviewTranscriptEntry {
    id: string;
    authorId: string | null;
    authorType: InterviewTranscriptAuthor;
    content: string;
    createdAt: string;
}

export interface InterviewDecision {
    verdict: Exclude<InterviewStatus, 'active' | 'closed'>;
    reason: string;
    decidedAt: string;
    scoreBefore: number;
    scoreAfter: number;
}

export interface InterviewRoomSession {
    sessionId: string;
    guildId: string;
    channelId: string;
    categoryId: string;
    roleId: string | null;
    userId: string;
    staffId: string;
    title: string;
    status: InterviewStatus;
    createdAt: string;
    updatedAt: string;
    cooldownUntil: string;
    transcript: InterviewTranscriptEntry[];
    decision: InterviewDecision | null;
    warnings: string[];
}

type InterviewModelResponse = {
    reply: string;
    verdict: InterviewVerdict;
    reason: string;
    reset_score: boolean;
};

const INTERVIEW_CATEGORY_NAME = '面接室';
const INTERVIEW_ROLE_NAME = '面接室';
const INTERVIEW_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 200;
const MAX_TRANSCRIPT_ENTRIES = 60;
const CLEANUP_DELAY_MS = 60 * 60 * 1000;
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;

function getSessionsKey(guildId: string): string {
    return `Guild/${guildId}/interviews/sessions`;
}

function createId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeChannelName(input: string): string {
    let base = input.trim().toLowerCase().replace(/\s+/g, '-');
    base = base.replace(/[^^\p{L}\p{N}\-_]/gu, '');
    if (!base) {
        base = `interview-${Date.now().toString(36).slice(-4)}`;
    }
    return base.slice(0, 80);
}

function buildRoomTitle(userName: string, customTitle?: string): string {
    if (customTitle && customTitle.trim()) {
        return customTitle.trim();
    }
    return `appeal-${userName}`;
}

function summarizeTrustHistory(trust: UserTrustData, limit = 8): string {
    const history = Array.isArray(trust.history) ? trust.history.slice(-limit) : [];
    if (history.length === 0) {
        return '履歴なし';
    }

    return history.map((entry) => {
        const delta = entry.delta >= 0 ? `+${entry.delta}` : `${entry.delta}`;
        return `${new Date(entry.timestamp).toLocaleString('ja-JP')}: ${delta} / ${entry.reason}`;
    }).join('\n');
}

function summarizeDetectionLogs(logs: DetectionLog[]): string {
    if (logs.length === 0) {
        return 'ログなし';
    }

    return logs.map((log) => {
        const at = new Date(log.timestamp).toLocaleString('ja-JP');
        const details: string[] = [];

        if (log.metadata?.channelId) {
            details.push(`channel:${log.metadata.channelId}`);
        }

        if (typeof log.metadata?.deletedMessage === 'boolean') {
            details.push(log.metadata.deletedMessage ? 'deleted:true' : 'deleted:false');
        }

        if (typeof log.metadata?.contentPreview === 'string' && log.metadata.contentPreview.trim()) {
            details.push(`content:${log.metadata.contentPreview.trim()}`);
        }

        return `${at} / ${log.detector} / +${log.scoreDelta} / ${log.reason}${details.length > 0 ? ` / ${details.join(' / ')}` : ''}`;
    }).join('\n');
}

function summarizeTranscript(transcript: InterviewTranscriptEntry[], limit = 14): string {
    return transcript
        .slice(-limit)
        .map((entry) => {
            const label = entry.authorType === 'assistant'
                ? 'AI'
                : entry.authorType === 'staff'
                    ? 'STAFF'
                    : entry.authorType === 'system'
                        ? 'SYSTEM'
                        : 'USER';
            return `[${label}] ${entry.content}`;
        })
        .join('\n');
}

function formatCompactList(values: string[], limit = 8, emptyLabel = 'なし'): string {
    if (values.length === 0) {
        return emptyLabel;
    }

    const shown = values.slice(0, limit);
    const suffix = values.length > limit ? ` ...(+${values.length - limit})` : '';
    return `${shown.join(', ')}${suffix}`;
}

function summarizePositiveTrustHistory(trust: UserTrustData, limit = 8): string {
    const history = Array.isArray(trust.history)
        ? trust.history.filter((entry) => entry.delta > 0).slice(-limit)
        : [];

    if (history.length === 0) {
        return '上昇履歴なし';
    }

    return history.map((entry) => {
        const delta = entry.delta >= 0 ? `+${entry.delta}` : `${entry.delta}`;
        return `${new Date(entry.timestamp).toLocaleString('ja-JP')}: ${delta} / ${entry.reason}`;
    }).join('\n');
}

function summarizeMemberProfile(member: GuildMember | null): string {
    if (!member) {
        return 'ユーザー情報を取得できませんでした';
    }

    const roleNames = member.roles.cache
        .filter((role) => role.id !== member.guild.id)
        .sort((left, right) => right.position - left.position)
        .map((role) => `${role.name} (${role.id})`);

    const permissions = member.permissions.toArray();

    return [
        `ユーザー名: ${member.user.tag}`,
        `表示名: ${member.displayName}`,
        `ユーザーID: ${member.id}`,
        `ニックネーム: ${member.nickname || 'なし'}`,
        `参加日: ${member.joinedAt ? member.joinedAt.toLocaleString('ja-JP') : '不明'}`,
        `最上位ロール: ${member.roles.highest?.name || 'なし'}`,
        `ロール一覧: ${formatCompactList(roleNames, 6)}`,
        `権限: ${formatCompactList(permissions, 10)}`,
        `通信制限中: ${member.communicationDisabledUntil ? member.communicationDisabledUntil.toLocaleString('ja-JP') : 'いいえ'}`
    ].join('\n');
}

function extractJsonObject(raw: string): InterviewModelResponse | null {
    const trimmed = raw.trim();
    const candidates = [
        trimmed,
        trimmed.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
    ];

    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        candidates.push(objectMatch[0]);
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate) as Partial<InterviewModelResponse>;
            if (!parsed || typeof parsed.reply !== 'string' || typeof parsed.reason !== 'string' || typeof parsed.verdict !== 'string') {
                continue;
            }

            if (!['continue', 'approve_reset', 'reject', 'terminate'].includes(parsed.verdict)) {
                continue;
            }

            return {
                reply: parsed.reply.trim(),
                reason: parsed.reason.trim(),
                verdict: parsed.verdict as InterviewVerdict,
                reset_score: parsed.reset_score === true
            };
        } catch {
            continue;
        }
    }

    return null;
}

export class InterviewRoomManager {
    private client: Client | null = null;
    private readonly processingSessions = new Set<string>();
    private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();

    setClient(client: Client): void {
        this.client = client;
    }

    async getSessions(guildId: string): Promise<InterviewRoomSession[]> {
        const stored = await database.get<InterviewRoomSession[]>(guildId, getSessionsKey(guildId), []);
        return Array.isArray(stored) ? stored : [];
    }

    async listSessions(guildId: string, limit = 50): Promise<InterviewRoomSession[]> {
        const sessions = await this.getSessions(guildId);
        return sessions
            .slice()
            .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
            .slice(0, Math.max(1, Math.min(limit, 100)));
    }

    async getSessionByChannel(guildId: string, channelId: string): Promise<InterviewRoomSession | null> {
        const sessions = await this.getSessions(guildId);
        return sessions.find((session) => session.channelId === channelId && session.status === 'active') || null;
    }

    async createInterviewRoom(
        guild: Guild,
        userId: string,
        staffId: string,
        title?: string
    ): Promise<InterviewRoomSession> {
        const sessions = await this.getSessions(guild.id);
        const existingActive = sessions.find((session) => session.userId === userId && session.status === 'active');
        if (existingActive) {
            return existingActive;
        }

        const latestForUser = sessions
            .filter((session) => session.userId === userId)
            .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];

        if (latestForUser) {
            const createdAt = new Date(latestForUser.createdAt).getTime();
            const nextAvailableAt = createdAt + INTERVIEW_COOLDOWN_MS;
            if (Date.now() < nextAvailableAt) {
                throw new Error(`このユーザーの面接は24時間に1回までです。次回は ${new Date(nextAvailableAt).toLocaleString('ja-JP')} 以降に作成してください。`);
            }
        }

        const targetMember = await guild.members.fetch(userId).catch(() => null);
        const staffMember = await guild.members.fetch(staffId).catch(() => null);
        if (!targetMember) {
            throw new Error('対象ユーザーが見つかりません');
        }
        if (!staffMember) {
            throw new Error('作成者スタッフが見つかりません');
        }

        const category = await this.ensureCategory(guild);
        const roleResult = await this.ensureInterviewRole(guild, targetMember, staffMember);
        const roomTitle = buildRoomTitle(targetMember.user.username, title);
        const channel = await guild.channels.create({
            name: sanitizeChannelName(roomTitle),
            type: ChannelType.GuildText,
            parent: category.id,
            topic: `AntiCheat interview for ${targetMember.user.tag} (${targetMember.id})`,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: guild.members.me?.id || guild.client.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.ManageMessages
                    ]
                },
                {
                    id: targetMember.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                },
                {
                    id: staffMember.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageMessages
                    ]
                }
            ]
        });

        const createdAt = new Date().toISOString();
        const introMessage = [
            'これから AntiCheat の面接を開始します。',
            '私は感情ではなく、検知ログ・信頼履歴・役職・権限を照合して判断します。',
            'ふざけた回答、はぐらかし、責任転嫁、曖昧な弁明、ログと矛盾する説明はその場で不利になります。',
            'まず、自分が何をして信頼スコアが上がったのかを、検知された内容、時刻、チャンネル、役職や権限まで含めて具体的に説明してください。'
        ].join('\n');

        const session: InterviewRoomSession = {
            sessionId: createId('interview'),
            guildId: guild.id,
            channelId: channel.id,
            categoryId: category.id,
            roleId: roleResult.roleId,
            userId,
            staffId,
            title: roomTitle,
            status: 'active',
            createdAt,
            updatedAt: createdAt,
            cooldownUntil: new Date(Date.now() + INTERVIEW_COOLDOWN_MS).toISOString(),
            transcript: [
                {
                    id: createId('transcript'),
                    authorId: null,
                    authorType: 'assistant',
                    content: introMessage,
                    createdAt
                }
            ],
            decision: null,
            warnings: roleResult.warnings
        };

        sessions.push(session);
        await this.persistSessions(guild.id, sessions);
        this.scheduleInactivityTimeout(guild.id, session.sessionId);

        const embed = new EmbedBuilder()
            .setTitle('面接室を作成しました')
            .setColor(0xffb300)
            .setDescription([
                `${targetMember.toString()} の信頼スコア見直し面接です。`,
                '',
                'この面接は厳格に行われます。',
                '対象者は自分の行為、理由、再発防止策を具体的に説明してください。'
            ].join('\n'))
            .addFields(
                { name: '担当スタッフ', value: `<@${staffMember.id}>`, inline: true },
                { name: 'クールダウン', value: `次回作成可能: ${new Date(session.cooldownUntil).toLocaleString('ja-JP')}`, inline: false }
            )
            .setFooter({ text: 'ふざけた応答や不誠実な回答は即時終了です。' })
            .setTimestamp();

        await (channel as TextChannel).send({
            content: `${targetMember.toString()} <@${staffMember.id}>`,
            embeds: [embed]
        }).catch(() => null);

        await (channel as TextChannel).send(introMessage).catch(() => null);
        return session;
    }

    async onMessage(message: Message): Promise<boolean> {
        if (!message.guild || message.author.bot) {
            return false;
        }

        const session = await this.getSessionByChannel(message.guild.id, message.channel.id);
        if (!session) {
            return false;
        }

        if (message.author.id === session.staffId && message.author.id !== session.userId) {
            await this.touchSession(message.guild.id, session.sessionId);
            this.scheduleInactivityTimeout(message.guild.id, session.sessionId);
            return true;
        }

        if (message.author.id !== session.userId) {
            return true;
        }

        if (this.processingSessions.has(session.sessionId)) {
            await message.reply('前の回答を確認中です。少し待ってから続けてください。').catch(() => null);
            return true;
        }

        this.processingSessions.add(session.sessionId);

        try {
            await this.appendTranscript(message.guild.id, session.sessionId, {
                id: createId('transcript'),
                authorId: message.author.id,
                authorType: 'user',
                content: message.content.trim().slice(0, 4000),
                createdAt: new Date().toISOString()
            });

            if ('sendTyping' in message.channel && typeof message.channel.sendTyping === 'function') {
                await message.channel.sendTyping().catch(() => null);
            }

            const refreshed = await this.getSessionByChannel(message.guild.id, message.channel.id);
            if (!refreshed) {
                return true;
            }

            const modelResponse = await this.evaluateInterview(message.guild, refreshed, message.member);
            const replyText = modelResponse.reply || '回答を続けてください。';

            await this.appendTranscript(message.guild.id, refreshed.sessionId, {
                id: createId('transcript'),
                authorId: null,
                authorType: 'assistant',
                content: replyText,
                createdAt: new Date().toISOString()
            });

            if ('send' in message.channel && typeof message.channel.send === 'function') {
                await (message.channel as any).send(replyText).catch(() => null);
            }

            if (modelResponse.verdict === 'approve_reset' || modelResponse.reset_score) {
                await this.finalizeInterview(message.guild, refreshed, 'approved', modelResponse.reason, true);
            } else if (modelResponse.verdict === 'reject') {
                await this.finalizeInterview(message.guild, refreshed, 'rejected', modelResponse.reason, false);
            } else if (modelResponse.verdict === 'terminate') {
                await this.finalizeInterview(message.guild, refreshed, 'terminated', modelResponse.reason, false);
            } else {
                this.scheduleInactivityTimeout(message.guild.id, refreshed.sessionId);
            }
        } catch (error) {
            Logger.error('InterviewRoomManager.onMessage failed:', error);
            if ('send' in message.channel && typeof message.channel.send === 'function') {
                await (message.channel as any).send('面接の処理中にエラーが発生しました。スタッフが再作成してください。').catch(() => null);
            }
        } finally {
            this.processingSessions.delete(session.sessionId);
        }

        return true;
    }

    async closeInterviewRoom(guildId: string, sessionId: string, reason = 'スタッフにより終了'): Promise<boolean> {
        this.clearSessionRuntimeState(guildId, sessionId);

        const sessions = await this.getSessions(guildId);
        const index = sessions.findIndex((session) => session.sessionId === sessionId);
        if (index === -1) {
            return false;
        }

        const session = sessions[index];
        if (session.status === 'active') {
            session.status = 'closed';
            session.updatedAt = new Date().toISOString();
            session.decision = session.decision || {
                verdict: 'terminated',
                reason,
                decidedAt: new Date().toISOString(),
                scoreBefore: (await antiCheatManager.getUserTrust(guildId, session.userId)).score,
                scoreAfter: (await antiCheatManager.getUserTrust(guildId, session.userId)).score
            };
            sessions[index] = session;
            await this.persistSessions(guildId, sessions);
        }

        await this.deleteDiscordRoom(session, reason);
        await this.cleanupRoleAssignments(session);
        return true;
    }

    async deleteInterviewRoom(guildId: string, sessionId: string, reason = 'スタッフにより面接室を削除'): Promise<boolean> {
        this.clearSessionRuntimeState(guildId, sessionId);

        const sessions = await this.getSessions(guildId);
        const index = sessions.findIndex((session) => session.sessionId === sessionId);
        if (index === -1) {
            return false;
        }

        const session = sessions[index];
        const nextSessions = sessions.filter((_, currentIndex) => currentIndex !== index);
        await this.persistSessions(guildId, nextSessions);

        await this.deleteDiscordRoom(session, reason);
        await this.cleanupRoleAssignments(session);
        return true;
    }

    private async finalizeInterview(
        guild: Guild,
        session: InterviewRoomSession,
        status: Exclude<InterviewStatus, 'active' | 'closed'>,
        reason: string,
        resetTrust: boolean
    ): Promise<void> {
        this.clearInactivityTimeout(guild.id, session.sessionId);

        const beforeTrust = await antiCheatManager.getUserTrust(guild.id, session.userId);
        if (resetTrust) {
            await antiCheatManager.resetTrust(guild.id, session.userId);
        }
        const afterTrust = await antiCheatManager.getUserTrust(guild.id, session.userId);

        const sessions = await this.getSessions(guild.id);
        const nextSessions = sessions.map((entry) => {
            if (entry.sessionId !== session.sessionId) {
                return entry;
            }

            return {
                ...entry,
                status,
                updatedAt: new Date().toISOString(),
                decision: {
                    verdict: status,
                    reason,
                    decidedAt: new Date().toISOString(),
                    scoreBefore: beforeTrust.score,
                    scoreAfter: afterTrust.score
                }
            };
        });

        await this.persistSessions(guild.id, nextSessions);

        const channel = await guild.channels.fetch(session.channelId).catch(() => null);
        if (channel && 'send' in channel) {
            const embed = new EmbedBuilder()
                .setTitle(status === 'approved' ? '面接結果: 信頼スコアをリセットしました' : '面接結果: リセットは認められませんでした')
                .setColor(status === 'approved' ? 0x2e7d32 : 0xc62828)
                .setDescription(reason)
                .addFields(
                    { name: '判定前スコア', value: `${beforeTrust.score}`, inline: true },
                    { name: '判定後スコア', value: `${afterTrust.score}`, inline: true },
                    { name: '終了処理', value: 'この部屋は1時間後に自動で閉じます', inline: false }
                )
                .setTimestamp();

            await (channel as TextChannel).send({ embeds: [embed] }).catch(() => null);
        }

        this.scheduleCleanup(guild.id, session.sessionId);
    }

    private scheduleCleanup(guildId: string, sessionId: string): void {
        const cacheKey = `${guildId}:${sessionId}`;
        const existingTimer = this.cleanupTimers.get(cacheKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        const timer = setTimeout(() => {
            this.closeInterviewRoom(guildId, sessionId, 'AI面接終了').catch((error) => {
                Logger.error('Interview room cleanup failed:', error);
            }).finally(() => {
                this.cleanupTimers.delete(cacheKey);
            });
        }, CLEANUP_DELAY_MS);

        timer.unref?.();
        this.cleanupTimers.set(cacheKey, timer);
    }

    private scheduleInactivityTimeout(guildId: string, sessionId: string): void {
        const cacheKey = `${guildId}:${sessionId}`;
        const existingTimer = this.timeoutTimers.get(cacheKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        const timer = setTimeout(() => {
            this.timeoutInterview(guildId, sessionId).catch((error) => {
                Logger.error('Interview room timeout failed:', error);
            }).finally(() => {
                this.timeoutTimers.delete(cacheKey);
            });
        }, INACTIVITY_TIMEOUT_MS);

        timer.unref?.();
        this.timeoutTimers.set(cacheKey, timer);
    }

    private clearInactivityTimeout(guildId: string, sessionId: string): void {
        const cacheKey = `${guildId}:${sessionId}`;
        const existingTimer = this.timeoutTimers.get(cacheKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.timeoutTimers.delete(cacheKey);
        }
    }

    private async timeoutInterview(guildId: string, sessionId: string): Promise<void> {
        const sessions = await this.getSessions(guildId);
        const session = sessions.find((entry) => entry.sessionId === sessionId && entry.status === 'active');
        if (!session) {
            return;
        }

        if (this.client) {
            const guild = await this.client.guilds.fetch(guildId).catch(() => null);
            const channel = guild ? await guild.channels.fetch(session.channelId).catch(() => null) : null;
            if (channel && 'send' in channel) {
                await (channel as TextChannel).send('⏱️ 1時間無操作のため、この面接は自動終了します。').catch(() => null);
            }
        }

        await this.closeInterviewRoom(guildId, sessionId, '1時間無操作のため自動終了');
    }

    private async evaluateInterview(guild: Guild, session: InterviewRoomSession, member?: GuildMember | null): Promise<InterviewModelResponse> {
        const trust = await antiCheatManager.getUserTrust(guild.id, session.userId);
        const recentLogs = await antiCheatManager.getUserLogs(guild.id, session.userId, 10);
        const targetMember = member || await guild.members.fetch(session.userId).catch(() => null);
        const memberProfile = summarizeMemberProfile(targetMember);

        const systemPrompt = [
            'あなたは Discord サーバーの AntiCheat 面接官です。',
            '目的は、対象ユーザーの信頼スコアをリセットしてよいかを、公平かつ厳格に判断することです。',
            '情緒的な甘さは不要です。曖昧な同情、なんとなくの温情、雰囲気での許可は禁止です。',
            'ユーザーが意図的に重要情報を伏せている可能性を前提に、発言と検知ログ、信頼履歴、役職、権限、面接ログの矛盾を必ず確認してください。',
            'ユーザーの説明がログやプロフィールと食い違う場合は、どこが食い違うのかを具体的に指摘してください。',
            '次の基準を守ってください。',
            '- continue: まだ情報不足。短く鋭く質問を1つだけ返す。',
            '- approve_reset: 本人が具体的に事実を説明し、責任を認め、再発防止策が現実的で、ログ・役職・権限情報とも大きく矛盾しない。',
            '- reject: 説明不足、責任回避、矛盾、言い訳過多、再発防止策が弱い、または説明がログと食い違う。',
            '- terminate: ふざけ、挑発、荒らし、無意味な繰り返し、面接拒否、侮辱、露骨なはぐらかし。',
            '信頼スコアが上がった理由は、positive delta の信頼履歴と直近の検知ログを使って、何をしたのかを具体的に説明してください。',
            '出力はJSONのみで、キーは reply, verdict, reason, reset_score の4つだけにしてください。',
            'reply はユーザーに送る日本語1段落、reason は内部判定向けの短い理由です。'
        ].join('\n');

        const userPrompt = [
            `対象ユーザーID: ${session.userId}`,
            `対象ユーザーのプロフィール:\n${memberProfile}`,
            `現在スコア: ${trust.score}`,
            `信頼スコア上昇履歴:\n${summarizePositiveTrustHistory(trust)}`,
            `信頼スコア履歴:\n${summarizeTrustHistory(trust)}`,
            `直近の検知ログ:\n${summarizeDetectionLogs(recentLogs)}`,
            `これまでの面接ログ:\n${summarizeTranscript(session.transcript)}`,
            '公平に判定し、JSONのみを返してください。'
        ].join('\n\n');

        const manager = new OpenAIChatManager();
        const response = await manager.sendMessage([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], {
            model: config.openai.defaultModel || undefined,
            temperature: 0.2,
            maxTokens: 700
        });

        const content = response.choices[0]?.message?.content;
        const text = typeof content === 'string' ? content : '';
        const parsed = extractJsonObject(text);

        if (parsed) {
            return parsed;
        }

        Logger.warn(`Interview AI returned non-JSON response for session ${session.sessionId}: ${text}`);
        return {
            reply: '説明がまだ足りません。自分が何をしたのか、なぜそうしたのか、次にどう防ぐのかを具体的に書いてください。',
            verdict: 'continue',
            reason: 'モデル出力の解析に失敗したため継続',
            reset_score: false
        };
    }

    private async appendTranscript(
        guildId: string,
        sessionId: string,
        entry: InterviewTranscriptEntry
    ): Promise<void> {
        const sessions = await this.getSessions(guildId);
        const nextSessions = sessions.map((session) => {
            if (session.sessionId !== sessionId) {
                return session;
            }

            return {
                ...session,
                updatedAt: entry.createdAt,
                transcript: [...session.transcript, entry].slice(-MAX_TRANSCRIPT_ENTRIES)
            };
        });

        await this.persistSessions(guildId, nextSessions);
    }

    private async touchSession(guildId: string, sessionId: string): Promise<void> {
        const sessions = await this.getSessions(guildId);
        const touchedAt = new Date().toISOString();
        const nextSessions = sessions.map((session) => (
            session.sessionId === sessionId
                ? {
                    ...session,
                    updatedAt: touchedAt
                }
                : session
        ));

        await this.persistSessions(guildId, nextSessions);
    }

    private async persistSessions(guildId: string, sessions: InterviewRoomSession[]): Promise<void> {
        const trimmed = sessions
            .slice()
            .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
            .slice(-MAX_SESSIONS);
        await database.set(guildId, getSessionsKey(guildId), trimmed);
    }

    private clearSessionRuntimeState(guildId: string, sessionId: string): void {
        this.clearInactivityTimeout(guildId, sessionId);
        this.clearCleanupTimer(guildId, sessionId);
        this.processingSessions.delete(sessionId);
    }

    private clearCleanupTimer(guildId: string, sessionId: string): void {
        const cacheKey = `${guildId}:${sessionId}`;
        const existingTimer = this.cleanupTimers.get(cacheKey);
        if (!existingTimer) {
            return;
        }

        clearTimeout(existingTimer);
        this.cleanupTimers.delete(cacheKey);
    }

    private async ensureCategory(guild: Guild): Promise<CategoryChannel> {
        const existing = guild.channels.cache.find((channel) => (
            channel.type === ChannelType.GuildCategory && channel.name === INTERVIEW_CATEGORY_NAME
        )) as CategoryChannel | undefined;

        if (existing) {
            return existing;
        }

        return guild.channels.create({
            name: INTERVIEW_CATEGORY_NAME,
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: guild.members.me?.id || guild.client.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels]
                }
            ]
        });
    }

    private async ensureInterviewRole(
        guild: Guild,
        targetMember: GuildMember,
        staffMember: GuildMember
    ): Promise<{ roleId: string | null; warnings: string[] }> {
        const warnings: string[] = [];
        const me = guild.members.me;
        if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            warnings.push('Botにロール管理権限がないため、面接室ロールは付与できませんでした。');
            return { roleId: null, warnings };
        }

        let role = guild.roles.cache.find((entry) => entry.name === INTERVIEW_ROLE_NAME) || null;
        if (!role) {
            try {
                role = await guild.roles.create({
                    name: INTERVIEW_ROLE_NAME,
                    mentionable: false,
                    reason: 'AntiCheat interview room'
                });
            } catch (error) {
                Logger.warn('Failed to create interview role:', error);
                warnings.push('面接室ロールの作成に失敗しました。');
                return { roleId: null, warnings };
            }
        }

        try {
            if (!targetMember.roles.cache.has(role.id)) {
                await targetMember.roles.add(role, 'AntiCheat interview room');
            }
        } catch (error) {
            Logger.warn('Failed to assign interview role to target member:', error);
            warnings.push('対象ユーザーへの面接室ロール付与に失敗しました。');
        }

        try {
            if (!staffMember.roles.cache.has(role.id)) {
                await staffMember.roles.add(role, 'AntiCheat interview room');
            }
        } catch (error) {
            Logger.warn('Failed to assign interview role to staff member:', error);
            warnings.push('スタッフへの面接室ロール付与に失敗しました。');
        }

        return { roleId: role.id, warnings };
    }

    private async deleteDiscordRoom(session: InterviewRoomSession, reason: string): Promise<void> {
        if (!this.client) {
            return;
        }

        const guild = await this.client.guilds.fetch(session.guildId).catch(() => null);
        if (!guild) {
            return;
        }

        const channel = await guild.channels.fetch(session.channelId).catch(() => null);
        if (channel) {
            await channel.delete(reason).catch(() => null);
        }

        const category = await guild.channels.fetch(session.categoryId).catch(() => null);
        if (category && category.type === ChannelType.GuildCategory && (category as CategoryChannel).children.cache.size === 0) {
            await category.delete(reason).catch(() => null);
        }
    }

    private async cleanupRoleAssignments(session: InterviewRoomSession): Promise<void> {
        if (!this.client || !session.roleId) {
            return;
        }

        const guild = await this.client.guilds.fetch(session.guildId).catch(() => null);
        if (!guild) {
            return;
        }

        const sessions = await this.getSessions(session.guildId);
        const activeSessions = sessions.filter((entry) => entry.status === 'active');
        const role = await guild.roles.fetch(session.roleId).catch(() => null);
        if (!role) {
            return;
        }

        const shouldKeepForUser = activeSessions.some((entry) => entry.userId === session.userId || entry.staffId === session.userId);
        const shouldKeepForStaff = activeSessions.some((entry) => entry.userId === session.staffId || entry.staffId === session.staffId);

        const targetMember = await guild.members.fetch(session.userId).catch(() => null);
        const staffMember = await guild.members.fetch(session.staffId).catch(() => null);

        if (targetMember && !shouldKeepForUser && targetMember.roles.cache.has(role.id)) {
            await targetMember.roles.remove(role, 'AntiCheat interview room cleanup').catch(() => null);
        }

        if (staffMember && !shouldKeepForStaff && staffMember.roles.cache.has(role.id)) {
            await staffMember.roles.remove(role, 'AntiCheat interview room cleanup').catch(() => null);
        }

        if (activeSessions.length === 0) {
            await role.delete('AntiCheat interview room cleanup').catch(() => null);
        }
    }
}

const GLOBAL_KEY = '__interviewRoomManager_v1';
if (!(global as any)[GLOBAL_KEY]) {
    (global as any)[GLOBAL_KEY] = new InterviewRoomManager();
}

export const interviewRoomManager: InterviewRoomManager = (global as any)[GLOBAL_KEY];
