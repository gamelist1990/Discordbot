import {
    ChannelType,
    Client,
    EmbedBuilder,
    Guild,
    GuildMember,
    Message,
    PermissionFlagsBits,
    Role,
    TextChannel
} from 'discord.js';
import { database } from '../../Database.js';
import {
    CLEANUP_DELAY_MS,
    INACTIVITY_TIMEOUT_MS,
    MAX_SESSION_HISTORY,
    MAX_TRANSCRIPT_ENTRIES,
    PERSONALITY_ARCHETYPES,
    PERSONALITY_CATEGORY_NAME,
    PERSONALITY_COOLDOWN_MS,
    PERSONALITY_MAX_USER_TURNS,
    PERSONALITY_MIN_USER_TURNS
} from '../constants.js';
import { deleteRoom, ensureCategory, ensureRole } from '../guildUtils.js';
import {
    clamp,
    createId,
    extractJsonObject,
    pickAiPersonaName,
    summarizeTranscript,
    truncateText,
    validatePersonalityEvaluation
} from '../helpers.js';
import {
    CoreFeatureModelHooks,
    requestCoreFeatureModelText,
    requestCoreFeatureConfidenceCalibration,
    requestCoreFeatureNaturalFollowUp,
    requestCoreFeaturePersonaNames
} from '../model.js';
import {
    PersonalityEvaluationResponse,
    PersonalityKey,
    PersonalityProfile,
    PersonalitySession,
    TranscriptEntry
} from '../types.js';
import { Logger } from '../../../utils/Logger.js';

function getPersonalitySessionsKey(guildId: string): string {
    return `Guild/${guildId}/corefeature/personality/sessions`;
}

export class PersonalityService {
    private static readonly MAX_REEVALUATION_PASSES = 4;
    private static readonly MERGED_USER_TURN_MAX_LENGTH = 4500;
    private static readonly TYPING_HEARTBEAT_MS = 8_000;
    private static readonly LONG_WAIT_NOTICE_THRESHOLD_MS = 2 * 60 * 1000;

    private client: Client | null = null;
    private readonly processing = new Set<string>();
    private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly terminatedSessions = new Set<string>();
    private readonly pendingUserAdditions = new Map<string, string[]>();
    private readonly typingTimers = new Map<string, ReturnType<typeof setInterval>>();
    private readonly delayedReplyMentions = new Set<string>();
    private readonly rateLimitNoticeSent = new Set<string>();

    setClient(client: Client): void {
        this.client = client;
    }

    async startSession(guild: Guild, userId: string): Promise<PersonalitySession> {
        const sessions = await this.getSessions(guild.id);
        const activeSession = sessions.find((entry) => entry.userId === userId && entry.status === 'active');
        if (activeSession) {
            const existingChannel = await guild.channels.fetch(activeSession.channelId).catch(() => null);
            if (existingChannel) {
                return activeSession;
            }

            activeSession.status = 'closed';
            activeSession.updatedAt = new Date().toISOString();
            await this.persistSessions(guild.id, sessions);
        }

        const profile = await this.getProfile(userId, guild.id);
        if (profile.cooldownUntil && Date.now() < new Date(profile.cooldownUntil).getTime()) {
            throw new Error(`性格診断は1週間に1回までです。次回は ${new Date(profile.cooldownUntil).toLocaleString('ja-JP')} 以降です。`);
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            throw new Error('対象メンバーを取得できませんでした。');
        }

        const category = await ensureCategory(guild, PERSONALITY_CATEGORY_NAME);
        const channel = await guild.channels.create({
            name: this.buildChannelName(member),
            type: ChannelType.GuildText,
            parent: category.id,
            topic: `Core personality interview for ${member.user.tag} (${member.id})`,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
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
                    id: member.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                }
            ]
        });

        const createdAt = new Date().toISOString();
        const sessionId = createId('personality');
        const [interviewerName] = await requestCoreFeaturePersonaNames(
            `性格診断の面談担当AI。セッションID: ${sessionId}`,
            1
        );
        const intro = [
            `今回の面談は私、${interviewerName}が担当します。`,
            'これから1対1で性格診断を行います。これは病名診断ではなく、コミュニティ内での行動傾向を測る面談です。',
            'できるだけ具体例を交えて答えてください。',
            'まず最初に、最近の発言や行動で「自分らしい」と思ったものを1つ、状況つきで説明してください。'
        ].join(' ');
        const session: PersonalitySession = {
            sessionId,
            guildId: guild.id,
            channelId: channel.id,
            categoryId: category.id,
            userId,
            interviewerName,
            status: 'active',
            createdAt,
            updatedAt: createdAt,
            cooldownUntil: new Date(Date.now() + PERSONALITY_COOLDOWN_MS).toISOString(),
            assignedKey: null,
            assignedRoleId: null,
            confidence: null,
            reason: null,
            traits: [],
            transcript: [{
                id: createId('transcript'),
                authorId: null,
                authorType: 'assistant',
                content: intro,
                createdAt
            }]
        };

        sessions.push(session);
        await this.persistSessions(guild.id, sessions);
        this.scheduleInactivityTimeout(guild.id, session.sessionId);

        const embed = new EmbedBuilder()
            .setTitle('性格診断を開始します')
            .setColor(0x4f8cff)
            .setDescription([
                `${member.toString()} 専用の診断部屋です。`,
                `担当AI: **${interviewerName}**`,
                `AI が数回質問して、${Object.keys(PERSONALITY_ARCHETYPES).length}種類の性格ロールから1つを判定します。`,
                '結果にはロール名だけでなく、観測した傾向タグも付きます。',
                `クールダウン: ${new Date(session.cooldownUntil).toLocaleString('ja-JP')} まで再挑戦不可`
            ].join('\n'))
            .setTimestamp();

        await (channel as TextChannel).send({ content: member.toString(), embeds: [embed] }).catch(() => null);
        await (channel as TextChannel).send(this.formatAssistantMessage(interviewerName, intro)).catch(() => null);
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

        if (message.author.id !== session.userId) {
            return true;
        }

        if (this.processing.has(session.sessionId)) {
            this.enqueuePendingUserAddition(session.sessionId, message.content || '');
            this.kickTypingHeartbeat(message.channel as TextChannel, session.sessionId);
            return true;
        }

        this.clearPendingUserAdditions(session.sessionId);
        this.processing.add(session.sessionId);
        this.kickTypingHeartbeat(message.channel as TextChannel, session.sessionId);
        const modelHooks = this.createModelHooks(message.channel as TextChannel, session);
        let releasedProcessing = false;

        try {
            await this.appendTranscript(message.guild.id, session.sessionId, {
                id: createId('transcript'),
                authorId: message.author.id,
                authorType: 'user',
                content: truncateText(message.content || '', 3500),
                createdAt: new Date().toISOString()
            });

            const refreshed = await this.getSessionByChannel(message.guild.id, message.channel.id);
            if (!refreshed) {
                return true;
            }

            if ('sendTyping' in message.channel && typeof message.channel.sendTyping === 'function') {
                await message.channel.sendTyping().catch(() => null);
            }

            const latest = await this.evaluateWithPendingAdditions(message.guild, refreshed, message.channel as TextChannel, modelHooks);
            if (!latest || latest.status !== 'active' || this.terminatedSessions.has(refreshed.sessionId)) {
                return true;
            }

            const evaluation = latest.evaluation;

            await this.appendTranscript(message.guild.id, latest.sessionId, {
                id: createId('transcript'),
                authorId: null,
                authorType: 'assistant',
                content: evaluation.reply,
                createdAt: new Date().toISOString()
            });

            await (message.channel as TextChannel).send(
                this.buildAssistantReply(latest, latest.interviewerName, evaluation.reply)
            ).catch(() => null);

            if (!evaluation.complete) {
                this.clearTypingHeartbeat(session.sessionId);
                this.processing.delete(session.sessionId);
                releasedProcessing = true;
            }

            if (evaluation.complete && evaluation.personality_key) {
                await this.finalize(message.guild, latest, evaluation, modelHooks);
            } else {
                this.scheduleInactivityTimeout(message.guild.id, latest.sessionId);
            }
        } catch (error) {
            Logger.error('Failed to handle personality message:', error);
            await (message.channel as TextChannel).send('診断処理でエラーが発生しました。少し時間を置いてやり直してください。').catch(() => null);
        } finally {
            if (!releasedProcessing) {
                this.clearPendingUserAdditions(session.sessionId);
                this.clearTypingHeartbeat(session.sessionId);
                this.clearDelayedReplyState(session.sessionId);
                this.processing.delete(session.sessionId);
            }
        }

        return true;
    }

    private buildChannelName(member: GuildMember): string {
        const base = `persona-${member.user.username}`;
        let normalized = base.trim().toLowerCase().replace(/\s+/g, '-');
        normalized = normalized.replace(/[^^\p{L}\p{N}\-_]/gu, '');
        if (!normalized) {
            normalized = `persona-${Date.now().toString(36).slice(-4)}`;
        }
        return normalized.slice(0, 90);
    }

    private async evaluate(
        session: PersonalitySession,
        hooks?: CoreFeatureModelHooks
    ): Promise<PersonalityEvaluationResponse> {
        const userTurns = session.transcript.filter((entry) => entry.authorType === 'user').length;
        const latestUserAnswer = [...session.transcript]
            .reverse()
            .find((entry) => entry.authorType === 'user')
            ?.content || '';
        const transcriptSummary = summarizeTranscript(session.transcript, 24);
        if (userTurns >= PERSONALITY_MAX_USER_TURNS) {
            return this.forceFinalize(session);
        }

        const archetypeSummary = Object.entries(PERSONALITY_ARCHETYPES)
            .map(([key, value]) => `- ${key}: ${value.label} / ${value.summary}`)
            .join('\n');

        const systemPrompt = [
            'あなたは Discord コミュニティ用の性格診断 AI です。',
            'これは病名や精神疾患を断定する診断ではありません。コミュニティ内の行動傾向ロールを選ぶ作業です。',
            `候補は ${Object.keys(PERSONALITY_ARCHETYPES).join(', ')} の ${Object.keys(PERSONALITY_ARCHETYPES).length}種類です。`,
            '実際の面接官のように、これまでの会話内容から次に聞くべき質問を自分で判断してください。',
            '1回の返答では質問は1つだけ、簡潔に行ってください。',
            '会話の具体性、誇張、責任転嫁、煽り癖、暴走傾向、混沌性、奇行性、衝動性、虚言傾向、虚飾性、支援性、創造性などを丁寧に見てください。',
            `ユーザー回答が ${PERSONALITY_MIN_USER_TURNS} 回に達するまでは、complete を false に固定し、必ず追加の質問を返してください。`,
            `ユーザー回答が ${PERSONALITY_MAX_USER_TURNS} 回に達したら、必ず最終判定してください。`,
            'complete が false のとき personality_key は null にしてください。',
            '質問は必ず具体例を引き出す形にし、曖昧な一般論で終わらせないでください。',
            'complete が false の返答では、必要なら短く受け止めてから、その流れに接続した質問を1つだけ返してください。',
            '直前の回答と無関係な話題へ急に飛ばさないでください。',
            'ユーザーの発言を長く引用しないでください。',
            '「今の話だと〜という点が印象に残りました」のような定型句は禁止です。',
            'コード側にある固定観点を順番に消化するのではなく、会話ログから不足している判断材料を自分で見つけてください。',
            '出力は JSON のみで、キーは reply, complete, personality_key, reason, confidence, traits です。',
            'traits には観測した短い傾向タグを2-4個入れてください。',
            'complete が true のときは personality_key に必ず候補のどれかを入れてください。'
        ].join('\n');

        const userPrompt = [
            `候補一覧:\n${archetypeSummary}`,
            `回答回数: ${userTurns}/${PERSONALITY_MAX_USER_TURNS}`,
            `直前のユーザー回答: ${latestUserAnswer || 'なし'}`,
            `面談ログ:\n${transcriptSummary}`
        ].join('\n\n');

        const raw = await requestCoreFeatureModelText([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], 900, 0.3, hooks);

        const parsed = validatePersonalityEvaluation(extractJsonObject(raw));

        if (userTurns < PERSONALITY_MIN_USER_TURNS) {
            return await this.buildContinuationResponse(parsed, latestUserAnswer, transcriptSummary, hooks);
        }

        if (parsed?.complete && parsed.personality_key) {
            return parsed;
        }

        if (userTurns < PERSONALITY_MAX_USER_TURNS) {
            return await this.buildContinuationResponse(parsed, latestUserAnswer, transcriptSummary, hooks);
        }

        return this.forceFinalize(session, hooks);
    }

    private async evaluateWithPendingAdditions(
        guild: Guild,
        session: PersonalitySession,
        channel: TextChannel,
        hooks?: CoreFeatureModelHooks
    ): Promise<(PersonalitySession & { evaluation: PersonalityEvaluationResponse }) | null> {
        let currentSession: PersonalitySession | null = session;

        for (let pass = 0; pass < PersonalityService.MAX_REEVALUATION_PASSES; pass += 1) {
            if (!currentSession) {
                return null;
            }

            const evaluation = await this.evaluate(currentSession, hooks);
            const pendingAddition = this.consumePendingUserAdditions(currentSession.sessionId);
            if (!pendingAddition) {
                return {
                    ...currentSession,
                    evaluation
                };
            }

            await this.mergePendingUserAddition(guild.id, currentSession.sessionId, pendingAddition);
            this.kickTypingHeartbeat(channel, currentSession.sessionId);
            currentSession = await this.getSessionById(guild.id, currentSession.sessionId);
            if (!currentSession || currentSession.status !== 'active' || this.terminatedSessions.has(currentSession.sessionId)) {
                return null;
            }
        }

        return currentSession
            ? {
                ...currentSession,
                evaluation: await this.evaluate(currentSession, hooks)
            }
            : null;
    }

    private async buildContinuationResponse(
        parsed: PersonalityEvaluationResponse | null,
        latestUserAnswer: string,
        transcriptSummary: string,
        hooks?: CoreFeatureModelHooks
    ): Promise<PersonalityEvaluationResponse> {
        const reply = parsed && !parsed.complete && this.looksLikeFollowUpQuestion(parsed.reply)
            ? parsed.reply
            : await requestCoreFeatureNaturalFollowUp(
                latestUserAnswer,
                transcriptSummary,
                parsed?.reason?.trim() || '',
                parsed?.traits ?? [],
                hooks
            );

        return {
            reply,
            complete: false,
            personality_key: null,
            reason: parsed?.reason?.trim() || '面談を継続して判断材料を集めています',
            confidence: parsed?.confidence ?? null,
            traits: parsed?.traits ?? []
        };
    }

    private looksLikeFollowUpQuestion(value: string): boolean {
        const normalized = value.trim();
        if (!normalized) {
            return false;
        }

        return (
            (/[\u3040-\u30ff\u4e00-\u9fff]/.test(normalized))
            && (/([？?]$|教えてください|聞かせてください|説明してください|ありますか|どうですか|どんな)/.test(normalized))
            && !/印象に残りました/.test(normalized)
        );
    }

    private async forceFinalize(
        session: PersonalitySession,
        hooks?: CoreFeatureModelHooks
    ): Promise<PersonalityEvaluationResponse> {
        const archetypeSummary = Object.entries(PERSONALITY_ARCHETYPES)
            .map(([key, value]) => `- ${key}: ${value.label} / ${value.summary}`)
            .join('\n');

        const systemPrompt = [
            'あなたは Discord コミュニティ用の性格ロール分類 AI です。',
            '病名断定は禁止です。コミュニティ内の行動傾向ロールを1つ選びます。',
            '追加質問はせず、そのまま判定を返します。',
            '出力は JSON のみで、キーは reply, complete, personality_key, reason, confidence, traits です。',
            'complete は必ず true にしてください。'
        ].join('\n');

        const userPrompt = [
            `候補一覧:\n${archetypeSummary}`,
            `面談ログ:\n${summarizeTranscript(session.transcript, 24)}`
        ].join('\n\n');

        const raw = await requestCoreFeatureModelText([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], 800, 0.2, hooks);

        const parsed = validatePersonalityEvaluation(extractJsonObject(raw));
        if (parsed && parsed.personality_key) {
            return {
                ...parsed,
                complete: true
            };
        }

        return {
            reply: '十分な傾向が見えたので、今回は「分析家」と判定します。状況を整理して考える姿勢が強く出ていました。',
            complete: true,
            personality_key: 'analyst',
            reason: 'モデル出力が不安定だったため、安全側の最終分類を適用',
            confidence: null,
            traits: ['整理志向', '慎重', '状況観察']
        };
    }

    private async resolveConfidence(
        session: PersonalitySession,
        evaluation: PersonalityEvaluationResponse,
        hooks?: CoreFeatureModelHooks
    ): Promise<number> {
        const heuristic = this.estimateConfidenceFromEvidence(session, evaluation);
        const userTurns = session.transcript.filter((entry) => entry.authorType === 'user').length;
        const calibration = evaluation.personality_key
            ? await requestCoreFeatureConfidenceCalibration(
                PERSONALITY_ARCHETYPES[evaluation.personality_key].label,
                evaluation.reason,
                evaluation.traits,
                userTurns,
                summarizeTranscript(session.transcript, 24),
                heuristic,
                hooks
            )
            : null;

        const weightedParts: Array<{ value: number; weight: number }> = [
            { value: heuristic, weight: 0.55 }
        ];

        if (typeof evaluation.confidence === 'number') {
            weightedParts.push({ value: evaluation.confidence, weight: 0.2 });
        }

        if (typeof calibration === 'number') {
            weightedParts.push({ value: calibration, weight: 0.25 });
        }

        const totalWeight = weightedParts.reduce((sum, entry) => sum + entry.weight, 0);
        const blended = totalWeight > 0
            ? weightedParts.reduce((sum, entry) => sum + (entry.value * entry.weight), 0) / totalWeight
            : heuristic;

        const evidenceCap = this.computeEvidenceCap(session);
        const disagreementPenalty = (
            typeof evaluation.confidence === 'number'
            && typeof calibration === 'number'
            && Math.abs(evaluation.confidence - calibration) >= 20
        ) ? 4 : 0;

        return clamp(Math.round(Math.min(blended, evidenceCap) - disagreementPenalty), 18, 96);
    }

    private estimateConfidenceFromEvidence(session: PersonalitySession, evaluation: PersonalityEvaluationResponse): number {
        const userAnswers = session.transcript
            .filter((entry) => entry.authorType === 'user')
            .map((entry) => entry.content.trim())
            .filter(Boolean);

        const userTurns = userAnswers.length;
        const specificityValues = userAnswers.map((answer) => this.measureAnswerSpecificity(answer));
        const specificityAverage = specificityValues.length > 0
            ? specificityValues.reduce((sum, value) => sum + value, 0) / specificityValues.length
            : 0;

        const turnScore = clamp(22 + (userTurns * 9), 22, 72);
        const detailScore = Math.round(specificityAverage * 18);
        const traitScore = Math.min(evaluation.traits.length, 4) * 2;
        const reasonScore = clamp(Math.round(Math.min((evaluation.reason || '').trim().length, 220) / 22), 0, 10);
        const shortAnswerPenalty = userAnswers.filter((answer) => answer.length < 18).length * 4;

        return clamp(turnScore + detailScore + traitScore + reasonScore - shortAnswerPenalty, 20, 94);
    }

    private computeEvidenceCap(session: PersonalitySession): number {
        const userAnswers = session.transcript
            .filter((entry) => entry.authorType === 'user')
            .map((entry) => entry.content.trim())
            .filter(Boolean);

        const userTurns = userAnswers.length;
        const specificityValues = userAnswers.map((answer) => this.measureAnswerSpecificity(answer));
        const specificityAverage = specificityValues.length > 0
            ? specificityValues.reduce((sum, value) => sum + value, 0) / specificityValues.length
            : 0;

        return clamp(
            42 + (userTurns * 7) + Math.round(specificityAverage * 14),
            48,
            94
        );
    }

    private measureAnswerSpecificity(answer: string): number {
        const normalized = answer.trim();
        if (!normalized) {
            return 0;
        }

        const lengthScore = Math.min(normalized.length / 120, 1);
        const contextSignals = (normalized.match(/(最近|今日|昨日|先週|学校|高校|課題|部活|仕事|友達|親|旅行|準備|失敗|意見|相手|周り|自分|実際|具体|ため|ので|から|とき|時)/g) || []).length;
        const structureSignals = (normalized.match(/(、|。|！|!|？|\?|たとえば|例えば|だから|しかし|でも|なので|結果)/g) || []).length;
        const signalScore = Math.min((contextSignals * 0.08) + (structureSignals * 0.05), 0.55);

        return clamp((lengthScore * 0.6) + signalScore, 0, 1);
    }

    private async finalize(
        guild: Guild,
        session: PersonalitySession,
        evaluation: PersonalityEvaluationResponse,
        hooks?: CoreFeatureModelHooks
    ): Promise<void> {
        const personalityKey = evaluation.personality_key;
        if (!personalityKey) {
            return;
        }

        this.clearInactivityTimeout(guild.id, session.sessionId);

        const sessions = await this.getSessions(guild.id);
        const active = sessions.find((entry) => entry.sessionId === session.sessionId);
        if (!active) {
            return;
        }

        active.status = 'completed';
        active.updatedAt = new Date().toISOString();
        active.assignedKey = personalityKey;
        const resolvedConfidence = await this.resolveConfidence(active, evaluation, hooks);
        active.confidence = resolvedConfidence;
        active.reason = evaluation.reason;
        active.traits = evaluation.traits;

        const profile = await this.getProfile(active.userId, guild.id);
        const member = await guild.members.fetch(active.userId).catch(() => null);
        const roleAssignment = await this.assignPersonalityRole(guild, member, personalityKey, profile.assignedRoleId);
        active.assignedRoleId = roleAssignment.roleId;
        await this.persistSessions(guild.id, sessions);

        profile.assignedKey = personalityKey;
        profile.assignedRoleId = roleAssignment.roleId;
        profile.assignedAt = active.updatedAt;
        profile.cooldownUntil = active.cooldownUntil;
        profile.lastSessionId = active.sessionId;
        profile.traits = evaluation.traits;
        await this.saveProfile(profile);

        const channel = await guild.channels.fetch(active.channelId).catch(() => null);
        if (channel && 'send' in channel) {
            const roleDisplay = roleAssignment.roleId ? `<@&${roleAssignment.roleId}>` : PERSONALITY_ARCHETYPES[personalityKey].label;
            const warnings = roleAssignment.warnings.length > 0 ? `\n\n注意:\n${roleAssignment.warnings.join('\n')}` : '';
            const traitText = evaluation.traits.length > 0 ? evaluation.traits.join(' / ') : '傾向タグなし';
            const embed = new EmbedBuilder()
                .setTitle('性格診断が完了しました')
                .setColor(0x2e8b57)
                .setDescription([
                    `判定: **${PERSONALITY_ARCHETYPES[personalityKey].label}**`,
                    `説明: ${PERSONALITY_ARCHETYPES[personalityKey].summary}`,
                    `付与ロール: ${roleDisplay}`,
                    `傾向タグ: ${traitText}`,
                    `信頼度: ${resolvedConfidence}%`,
                    `再挑戦可能: ${new Date(active.cooldownUntil).toLocaleString('ja-JP')}`
                ].join('\n') + warnings)
                .addFields({ name: '判定メモ', value: evaluation.reason || '十分な会話情報をもとに判定しました。' })
                .setTimestamp();

            await (channel as TextChannel).send({
                content: this.delayedReplyMentions.has(active.sessionId) ? `<@${active.userId}>` : undefined,
                embeds: [embed]
            }).catch(() => null);
            this.delayedReplyMentions.delete(active.sessionId);
        }

        this.scheduleCleanup(guild.id, active.sessionId);
    }

    async closeSessions(guild: Guild, options: { channelId?: string; reason: string }): Promise<Array<{ sessionId: string; channelId: string; summary: string }>> {
        const targets = await this.getOpenSessions(guild, options.channelId);
        const results: Array<{ sessionId: string; channelId: string; summary: string }> = [];

        for (const target of targets) {
            await this.closeSession(guild.id, target.sessionId, options.reason);
            results.push({
                sessionId: target.sessionId,
                channelId: target.channelId,
                summary: `性格診断 / <@${target.userId}>`
            });
        }

        return results;
    }

    async resetUserData(guild: Guild, userId: string, reason: string): Promise<{ summary: string } | null> {
        const openSessions = await this.getOpenSessions(guild);
        const matchedSessions = openSessions.filter((entry) => entry.userId === userId);
        for (const session of matchedSessions) {
            await this.closeSession(guild.id, session.sessionId, reason);
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        const removedRoles = await this.removePersonalityRoles(guild, member);
        const deletedProfile = await database.deleteUserGuildData(userId, guild.id, 'corefeature/personality-profile');

        if (!deletedProfile && removedRoles === 0 && matchedSessions.length === 0) {
            return null;
        }

        const summaryParts = ['性格診断データをリセット'];
        if (deletedProfile) {
            summaryParts.push('クールダウン解除');
        }
        if (removedRoles > 0) {
            summaryParts.push(`性格ロール ${removedRoles} 件解除`);
        }
        if (matchedSessions.length > 0) {
            summaryParts.push('進行中面談を終了');
        }

        return {
            summary: summaryParts.join(' / ')
        };
    }

    private async assignPersonalityRole(
        guild: Guild,
        member: GuildMember | null,
        personalityKey: PersonalityKey,
        previousRoleId: string | null
    ): Promise<{ roleId: string | null; warnings: string[] }> {
        const warnings: string[] = [];
        const me = guild.members.me;
        if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            warnings.push('Bot にロール管理権限がないため、性格ロールは付与できませんでした。');
            return { roleId: null, warnings };
        }

        const role = await ensureRole(guild, PERSONALITY_ARCHETYPES[personalityKey].roleName, 'Core personality role');
        if (!role) {
            warnings.push('性格ロールの作成に失敗しました。');
            return { roleId: null, warnings };
        }

        if (!member) {
            warnings.push('メンバー取得に失敗したため、ロール付与をスキップしました。');
            return { roleId: role.id, warnings };
        }

        if (previousRoleId && previousRoleId !== role.id && member.roles.cache.has(previousRoleId)) {
            const previousRole = guild.roles.cache.get(previousRoleId) || await guild.roles.fetch(previousRoleId).catch(() => null);
            if (previousRole) {
                await member.roles.remove(previousRole, 'Core personality role refresh').catch(() => null);
            }
        }

        const personalityRoles = await this.getPersonalityRoles(guild);
        for (const existingRole of personalityRoles) {
            if (existingRole.id !== role.id && member.roles.cache.has(existingRole.id)) {
                await member.roles.remove(existingRole, 'Core personality role refresh').catch(() => null);
            }
        }

        if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role, 'Core personality interview result').catch((error) => {
                Logger.warn('Failed to add personality role:', error);
                warnings.push('ロール付与に失敗しました。');
            });
        }

        return { roleId: role.id, warnings };
    }

    private async getPersonalityRoles(guild: Guild): Promise<Role[]> {
        return Object.values(PERSONALITY_ARCHETYPES)
            .map((entry) => guild.roles.cache.find((role) => role.name === entry.roleName))
            .filter((role): role is Role => Boolean(role));
    }

    private async removePersonalityRoles(guild: Guild, member: GuildMember | null): Promise<number> {
        if (!member) {
            return 0;
        }

        const personalityRoles = await this.getPersonalityRoles(guild);
        let removed = 0;
        for (const role of personalityRoles) {
            if (!member.roles.cache.has(role.id)) {
                continue;
            }

            await member.roles.remove(role, 'Core personality reset').catch(() => null);
            removed += 1;
        }

        return removed;
    }

    private scheduleCleanup(guildId: string, sessionId: string): void {
        const key = `${guildId}:${sessionId}`;
        const existing = this.cleanupTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.closeSession(guildId, sessionId).catch((error) => {
                Logger.error('Failed to cleanup personality room:', error);
            }).finally(() => {
                this.cleanupTimers.delete(key);
            });
        }, CLEANUP_DELAY_MS);

        timer.unref?.();
        this.cleanupTimers.set(key, timer);
    }

    private clearCleanupTimer(guildId: string, sessionId: string): void {
        const key = `${guildId}:${sessionId}`;
        const existing = this.cleanupTimers.get(key);
        if (existing) {
            clearTimeout(existing);
            this.cleanupTimers.delete(key);
        }
    }

    private scheduleInactivityTimeout(guildId: string, sessionId: string): void {
        const key = `${guildId}:${sessionId}`;
        const existing = this.timeoutTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.timeoutSession(guildId, sessionId).catch((error) => {
                Logger.error('Failed to timeout personality room:', error);
            }).finally(() => {
                this.timeoutTimers.delete(key);
            });
        }, INACTIVITY_TIMEOUT_MS);

        timer.unref?.();
        this.timeoutTimers.set(key, timer);
    }

    private clearInactivityTimeout(guildId: string, sessionId: string): void {
        const key = `${guildId}:${sessionId}`;
        const existing = this.timeoutTimers.get(key);
        if (existing) {
            clearTimeout(existing);
            this.timeoutTimers.delete(key);
        }
    }

    private async timeoutSession(guildId: string, sessionId: string): Promise<void> {
        const sessions = await this.getSessions(guildId);
        const session = sessions.find((entry) => entry.sessionId === sessionId);
        if (!session || session.status !== 'active') {
            return;
        }

        const guild = this.client ? await this.client.guilds.fetch(guildId).catch(() => null) : null;
        const channel = guild ? await guild.channels.fetch(session.channelId).catch(() => null) : null;
        if (channel && 'send' in channel) {
            await (channel as TextChannel).send('⏱️ 1時間無操作のため、この性格診断は自動終了します。').catch(() => null);
        }

        await this.closeSession(guildId, sessionId, '性格診断タイムアウト');
    }

    private async closeSession(guildId: string, sessionId: string, reason = '性格診断終了'): Promise<void> {
        this.terminatedSessions.add(sessionId);
        this.clearCleanupTimer(guildId, sessionId);
        this.clearInactivityTimeout(guildId, sessionId);
        this.clearPendingUserAdditions(sessionId);
        this.clearTypingHeartbeat(sessionId);
        this.clearDelayedReplyState(sessionId);

        const sessions = await this.getSessions(guildId);
        const session = sessions.find((entry) => entry.sessionId === sessionId);
        if (!session) {
            return;
        }

        session.status = session.status === 'active' ? 'closed' : session.status;
        session.updatedAt = new Date().toISOString();
        await this.persistSessions(guildId, sessions);
        await deleteRoom(this.client, session.guildId, session.channelId, session.categoryId, reason);
    }

    private async getSessions(guildId: string): Promise<PersonalitySession[]> {
        const stored = await database.get<PersonalitySession[]>(guildId, getPersonalitySessionsKey(guildId), []);
        return (Array.isArray(stored) ? stored : []).map((entry) => ({
            ...entry,
            interviewerName: typeof entry.interviewerName === 'string' && entry.interviewerName.trim()
                ? entry.interviewerName.trim()
                : pickAiPersonaName(`${guildId}:${entry.sessionId}:personality`),
            traits: Array.isArray(entry.traits) ? entry.traits : [],
            transcript: Array.isArray(entry.transcript) ? entry.transcript : []
        }));
    }

    private async persistSessions(guildId: string, sessions: PersonalitySession[]): Promise<void> {
        const trimmed = sessions
            .slice()
            .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
            .slice(-MAX_SESSION_HISTORY)
            .map((entry) => ({
                ...entry,
                traits: Array.isArray(entry.traits) ? entry.traits.slice(0, 6) : [],
                transcript: entry.transcript.slice(-MAX_TRANSCRIPT_ENTRIES)
            }));

        await database.set(guildId, getPersonalitySessionsKey(guildId), trimmed);
    }

    private async getProfile(userId: string, guildId: string): Promise<PersonalityProfile> {
        const stored = await database.getUserGuildData<PersonalityProfile>(userId, guildId, 'corefeature/personality-profile', null);
        if (stored) {
            return {
                ...stored,
                traits: Array.isArray(stored.traits) ? stored.traits : []
            };
        }

        return {
            userId,
            guildId,
            assignedKey: null,
            assignedRoleId: null,
            assignedAt: null,
            cooldownUntil: null,
            lastSessionId: null,
            traits: []
        };
    }

    private async saveProfile(profile: PersonalityProfile): Promise<void> {
        await database.setUserGuildData(profile.userId, profile.guildId, 'corefeature/personality-profile', profile);
    }

    private async getSessionById(guildId: string, sessionId: string): Promise<PersonalitySession | null> {
        const sessions = await this.getSessions(guildId);
        return sessions.find((entry) => entry.sessionId === sessionId) || null;
    }

    private async getSessionByChannel(guildId: string, channelId: string): Promise<PersonalitySession | null> {
        const sessions = await this.getSessions(guildId);
        return sessions.find((entry) => entry.channelId === channelId && entry.status === 'active') || null;
    }

    private async getOpenSessions(guild: Guild, channelId?: string): Promise<PersonalitySession[]> {
        const sessions = await this.getSessions(guild.id);
        const candidates = sessions.filter((entry) => (
            entry.status !== 'closed'
            && (!channelId || entry.channelId === channelId)
        ));
        const openSessions: PersonalitySession[] = [];

        for (const entry of candidates) {
            const channel = await guild.channels.fetch(entry.channelId).catch(() => null);
            if (channel) {
                openSessions.push(entry);
            }
        }

        return openSessions;
    }

    private async appendTranscript(guildId: string, sessionId: string, entry: TranscriptEntry): Promise<void> {
        const sessions = await this.getSessions(guildId);
        const next = sessions.map((session) => {
            if (session.sessionId !== sessionId) {
                return session;
            }
            return {
                ...session,
                updatedAt: entry.createdAt,
                transcript: [...session.transcript, entry]
            };
        });

        await this.persistSessions(guildId, next);
    }

    private createModelHooks(channel: TextChannel, session: PersonalitySession): CoreFeatureModelHooks {
        return {
            requestLabel: `core-personality:${session.sessionId}`,
            onRateLimitWait: async (info) => {
                this.delayedReplyMentions.add(session.sessionId);
                if (info.waitMs < PersonalityService.LONG_WAIT_NOTICE_THRESHOLD_MS || this.rateLimitNoticeSent.has(session.sessionId)) {
                    return;
                }

                this.rateLimitNoticeSent.add(session.sessionId);
                const minutes = Math.max(1, Math.ceil(info.waitMs / 60_000));
                await channel.send(
                    `<@${session.userId}> レート制限のため、あと ${minutes} 分ほど待ってから続けます。返答でき次第メンションします。`
                ).catch(() => null);
            }
        };
    }

    private enqueuePendingUserAddition(sessionId: string, content: string): void {
        const normalized = truncateText(content || '', 1600);
        if (!normalized) {
            return;
        }

        const existing = this.pendingUserAdditions.get(sessionId) ?? [];
        existing.push(normalized);
        this.pendingUserAdditions.set(sessionId, existing.slice(-6));
    }

    private consumePendingUserAdditions(sessionId: string): string {
        const existing = this.pendingUserAdditions.get(sessionId) ?? [];
        this.pendingUserAdditions.delete(sessionId);
        return truncateText(existing.join('\n'), 3000);
    }

    private clearPendingUserAdditions(sessionId: string): void {
        this.pendingUserAdditions.delete(sessionId);
    }

    private clearDelayedReplyState(sessionId: string): void {
        this.delayedReplyMentions.delete(sessionId);
        this.rateLimitNoticeSent.delete(sessionId);
    }

    private async mergePendingUserAddition(guildId: string, sessionId: string, extraContent: string): Promise<void> {
        const normalized = truncateText(extraContent, 3000);
        if (!normalized) {
            return;
        }

        const sessions = await this.getSessions(guildId);
        const mergedAt = new Date().toISOString();
        const next = sessions.map((session) => {
            if (session.sessionId !== sessionId) {
                return session;
            }

            const transcript = [...session.transcript];
            const lastEntry = transcript.at(-1);
            if (lastEntry?.authorType === 'user') {
                transcript[transcript.length - 1] = {
                    ...lastEntry,
                    content: truncateText(
                        `${lastEntry.content.trim()}\n${normalized}`.trim(),
                        PersonalityService.MERGED_USER_TURN_MAX_LENGTH
                    ),
                    createdAt: mergedAt
                };
            } else {
                transcript.push({
                    id: createId('transcript'),
                    authorId: session.userId,
                    authorType: 'user',
                    content: truncateText(normalized, PersonalityService.MERGED_USER_TURN_MAX_LENGTH),
                    createdAt: mergedAt
                });
            }

            return {
                ...session,
                updatedAt: mergedAt,
                transcript
            };
        });

        await this.persistSessions(guildId, next);
    }

    private kickTypingHeartbeat(channel: TextChannel, sessionId: string): void {
        if (!('sendTyping' in channel) || typeof channel.sendTyping !== 'function') {
            return;
        }

        channel.sendTyping().catch(() => null);
        if (this.typingTimers.has(sessionId)) {
            return;
        }

        const timer = setInterval(() => {
            channel.sendTyping().catch(() => null);
        }, PersonalityService.TYPING_HEARTBEAT_MS);

        timer.unref?.();
        this.typingTimers.set(sessionId, timer);
    }

    private clearTypingHeartbeat(sessionId: string): void {
        const timer = this.typingTimers.get(sessionId);
        if (!timer) {
            return;
        }

        clearInterval(timer);
        this.typingTimers.delete(sessionId);
    }

    private buildAssistantReply(session: PersonalitySession, interviewerName: string, content: string): string {
        const prefix = this.delayedReplyMentions.has(session.sessionId)
            ? `<@${session.userId}>\n`
            : '';
        this.delayedReplyMentions.delete(session.sessionId);
        return `${prefix}${this.formatAssistantMessage(interviewerName, content)}`;
    }

    private formatAssistantMessage(interviewerName: string, content: string): string {
        return `**${interviewerName}**\n${content.trim()}`;
    }
}
