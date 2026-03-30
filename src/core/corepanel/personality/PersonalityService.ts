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
    createId,
    extractJsonObject,
    pickAiPersonaName,
    summarizeTranscript,
    truncateText,
    validatePersonalityEvaluation
} from '../helpers.js';
import { requestCoreFeatureModelText, requestCoreFeaturePersonaNames } from '../model.js';
import {
    PersonalityEvaluationResponse,
    PersonalityKey,
    PersonalityProfile,
    PersonalitySession,
    TranscriptEntry
} from '../types.js';
import { Logger } from '../../../utils/Logger.js';

interface PersonalityInterviewFocus {
    label: string;
    instruction: string;
    fallbackQuestion: string;
}

function getPersonalitySessionsKey(guildId: string): string {
    return `Guild/${guildId}/corefeature/personality/sessions`;
}

export class PersonalityService {
    private client: Client | null = null;
    private readonly processing = new Set<string>();
    private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly terminatedSessions = new Set<string>();

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
            await message.reply('前の質問を処理中です。少し待ってから続けてください。').catch(() => null);
            return true;
        }

        this.processing.add(session.sessionId);

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

            const evaluation = await this.evaluate(refreshed);
            const latest = await this.getSessionById(message.guild.id, refreshed.sessionId);
            if (!latest || latest.status !== 'active' || this.terminatedSessions.has(refreshed.sessionId)) {
                return true;
            }

            await this.appendTranscript(message.guild.id, latest.sessionId, {
                id: createId('transcript'),
                authorId: null,
                authorType: 'assistant',
                content: evaluation.reply,
                createdAt: new Date().toISOString()
            });

            await (message.channel as TextChannel).send(
                this.formatAssistantMessage(latest.interviewerName, evaluation.reply)
            ).catch(() => null);

            if (evaluation.complete && evaluation.personality_key) {
                await this.finalize(message.guild, latest, evaluation);
            } else {
                this.scheduleInactivityTimeout(message.guild.id, latest.sessionId);
            }
        } catch (error) {
            Logger.error('Failed to handle personality message:', error);
            await (message.channel as TextChannel).send('診断処理でエラーが発生しました。少し時間を置いてやり直してください。').catch(() => null);
        } finally {
            this.processing.delete(session.sessionId);
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

    private async evaluate(session: PersonalitySession): Promise<PersonalityEvaluationResponse> {
        const userTurns = session.transcript.filter((entry) => entry.authorType === 'user').length;
        const latestUserAnswer = [...session.transcript]
            .reverse()
            .find((entry) => entry.authorType === 'user')
            ?.content || '';
        if (userTurns >= PERSONALITY_MAX_USER_TURNS) {
            return this.forceFinalize(session);
        }

        const archetypeSummary = Object.entries(PERSONALITY_ARCHETYPES)
            .map(([key, value]) => `- ${key}: ${value.label} / ${value.summary}`)
            .join('\n');
        const focus = this.getInterviewFocus(userTurns);

        const systemPrompt = [
            'あなたは Discord コミュニティ用の性格診断 AI です。',
            'これは病名や精神疾患を断定する診断ではありません。コミュニティ内の行動傾向ロールを選ぶ作業です。',
            `候補は ${Object.keys(PERSONALITY_ARCHETYPES).join(', ')} の ${Object.keys(PERSONALITY_ARCHETYPES).length}種類です。`,
            '1回の返答では質問は1つだけ、簡潔に行ってください。',
            '会話の具体性、誇張、責任転嫁、煽り癖、暴走傾向、混沌性、奇行性、衝動性、虚言傾向、虚飾性、支援性、創造性などを丁寧に見てください。',
            `ユーザー回答が ${PERSONALITY_MIN_USER_TURNS} 回に達するまでは、complete を false に固定し、必ず追加の質問を返してください。`,
            `ユーザー回答が ${PERSONALITY_MAX_USER_TURNS} 回に達したら、必ず最終判定してください。`,
            'complete が false のとき personality_key は null にしてください。',
            '質問は必ず具体例を引き出す形にし、曖昧な一般論で終わらせないでください。',
            'complete が false の返答では、最初の1文で直前のユーザー回答を自然に受け止め、その流れに接続した質問を1つだけ返してください。',
            '直前の回答と無関係な話題へ急に飛ばさないでください。',
            '出力は JSON のみで、キーは reply, complete, personality_key, reason, confidence, traits です。',
            'traits には観測した短い傾向タグを2-4個入れてください。',
            'complete が true のときは personality_key に必ず候補のどれかを入れてください。'
        ].join('\n');

        const userPrompt = [
            `候補一覧:\n${archetypeSummary}`,
            `回答回数: ${userTurns}/${PERSONALITY_MAX_USER_TURNS}`,
            `今回優先して掘る観点: ${focus.label}`,
            `観点の指示: ${focus.instruction}`,
            `直前のユーザー回答: ${latestUserAnswer || 'なし'}`,
            `面談ログ:\n${summarizeTranscript(session.transcript, 20)}`
        ].join('\n\n');

        const raw = await requestCoreFeatureModelText([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], 900, 0.3);

        const parsed = validatePersonalityEvaluation(extractJsonObject(raw));

        if (userTurns < PERSONALITY_MIN_USER_TURNS) {
            return this.buildContinuationResponse(parsed, focus, latestUserAnswer);
        }

        if (parsed?.complete && parsed.personality_key) {
            return parsed;
        }

        if (userTurns < PERSONALITY_MAX_USER_TURNS) {
            return this.buildContinuationResponse(parsed, focus, latestUserAnswer);
        }

        return this.forceFinalize(session);
    }

    private getInterviewFocus(userTurns: number): PersonalityInterviewFocus {
        const stages: PersonalityInterviewFocus[] = [
            {
                label: '計画と不安への向き合い方',
                instruction: '予定や楽しみな出来事に対して、準備を詰めるか、勢いで進むか、不安をどう扱うかを具体的に掘ってください。',
                fallbackQuestion: 'そういう予定や楽しみがあるとき、あなたは事前にかなり準備する方ですか。それとも気分で動く方ですか。最近の具体例で教えてください。'
            },
            {
                label: '失敗と責任の取り方',
                instruction: '自分に不利な失敗やミスをしたとき、言い訳をするか、責任を負うか、話を盛るかを見てください。',
                fallbackQuestion: 'もしその予定や行動で自分のミスが出たとき、あなたは周りにどう説明してどう動きますか。かなり近い実例があればそれで教えてください。'
            },
            {
                label: '対立時の反応',
                instruction: '意見がぶつかった場面で、押し切るか、調整するか、煽るか、引くかを具体的に掘ってください。',
                fallbackQuestion: '誰かと意見が真っ向からぶつかった場面では、あなたは相手をどう動かしますか。最近の具体例を1つ、相手への言い方まで含めて教えてください。'
            },
            {
                label: '集団での立ち位置',
                instruction: '複数人の場で主導権を取るか、支えるか、混ぜ返すか、暴走するかを確認してください。',
                fallbackQuestion: '複数人で何かを決める場では、あなたはまとめ役、推進役、支援役、かき回し役のどれに近いですか。そう判断できる具体例を教えてください。'
            },
            {
                label: '感情と衝動の制御',
                instruction: 'イラついたときや熱が入ったときに、抑えるか、加速するか、煽るかを掘ってください。',
                fallbackQuestion: '腹が立ったときや熱くなったとき、あなたはどこでブレーキをかけますか。それとも勢いで押し切りますか。最近の具体例で教えてください。'
            },
            {
                label: '見せ方と誇張',
                instruction: '自分を強く見せるための盛り方、見栄、話の誇張の有無を確認してください。',
                fallbackQuestion: '自分をよく見せたい場面で、話を盛ったり演出したりすることはありますか。あるならどんな場面か、ないならどう見せるかを具体的に教えてください。'
            }
        ];

        return stages[Math.min(userTurns - 1, stages.length - 1)] || stages[0];
    }

    private buildContinuationResponse(
        parsed: PersonalityEvaluationResponse | null,
        focus: PersonalityInterviewFocus,
        latestUserAnswer: string
    ): PersonalityEvaluationResponse {
        const reply = parsed && !parsed.complete && this.looksLikeFollowUpQuestion(parsed.reply)
            ? parsed.reply
            : this.buildAnchoredFallbackQuestion(latestUserAnswer, focus);

        return {
            reply,
            complete: false,
            personality_key: null,
            reason: parsed?.reason?.trim() || `${focus.label}を追加確認中`,
            confidence: parsed?.confidence ?? 55,
            traits: parsed?.traits ?? []
        };
    }

    private looksLikeFollowUpQuestion(value: string): boolean {
        const normalized = value.trim();
        if (!normalized) {
            return false;
        }

        return /[？?]$/.test(normalized) || /(教えてください|聞かせてください|説明してください|ありますか)/.test(normalized);
    }

    private buildAnchoredFallbackQuestion(latestUserAnswer: string, focus: PersonalityInterviewFocus): string {
        const cue = latestUserAnswer.trim().replace(/\s+/g, ' ');
        const shortCue = cue.length > 42 ? `${cue.slice(0, 42)}...` : cue;
        if (!shortCue) {
            return focus.fallbackQuestion;
        }

        return `今の話だと「${shortCue}」という点が印象に残りました。${focus.fallbackQuestion}`;
    }

    private async forceFinalize(session: PersonalitySession): Promise<PersonalityEvaluationResponse> {
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
        ], 800, 0.2);

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
            confidence: 55,
            traits: ['整理志向', '慎重', '状況観察']
        };
    }

    private async finalize(guild: Guild, session: PersonalitySession, evaluation: PersonalityEvaluationResponse): Promise<void> {
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
        active.confidence = evaluation.confidence;
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
                    `信頼度: ${evaluation.confidence}%`,
                    `再挑戦可能: ${new Date(active.cooldownUntil).toLocaleString('ja-JP')}`
                ].join('\n') + warnings)
                .addFields({ name: '判定メモ', value: evaluation.reason || '十分な会話情報をもとに判定しました。' })
                .setTimestamp();

            await (channel as TextChannel).send({ embeds: [embed] }).catch(() => null);
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

    private formatAssistantMessage(interviewerName: string, content: string): string {
        return `**${interviewerName}**\n${content.trim()}`;
    }
}
