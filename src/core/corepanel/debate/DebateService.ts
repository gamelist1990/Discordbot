import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
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
    DEBATE_CATEGORY_NAME,
    DEBATE_AI_VS_AI_COOLDOWN_MS,
    DEBATE_KING_ROLE_NAME,
    DEBATE_KING_SCORE_THRESHOLD,
    DEBATE_KING_WIN_THRESHOLD,
    DEBATE_TURN_LIMIT,
    INACTIVITY_TIMEOUT_MS,
    MAX_SESSION_HISTORY,
    MAX_TRANSCRIPT_ENTRIES
} from '../constants.js';
import { deleteRoom, ensureCategory, ensureRole } from '../guildUtils.js';
import {
    buildStanceLabel,
    clamp,
    createId,
    extractJsonObject,
    getOppositeStance,
    pickAiPersonaName,
    pickAiPersonaPair,
    sanitizeChannelName,
    summarizeTranscript,
    truncateText,
    validateDebateJudge,
    validateDebateReply
} from '../helpers.js';
import {
    CoreFeatureModelHooks,
    requestCoreFeatureModelText,
    requestCoreFeaturePersonaNames
} from '../model.js';
import {
    DebateJudgeResponse,
    DebateOpponentType,
    DebateParticipantType,
    DebateProfile,
    DebateReplyResponse,
    DebateSession,
    DebateStance
} from '../types.js';
import { Logger } from '../../../utils/Logger.js';

type DebateSide = 'creator' | 'opponent';

function getDebateSessionsKey(guildId: string): string {
    return `Guild/${guildId}/corefeature/debate/sessions`;
}

export class DebateService {
    private static readonly LONG_WAIT_NOTICE_THRESHOLD_MS = 2 * 60 * 1000;

    private client: Client | null = null;
    private readonly processing = new Set<string>();
    private readonly finalizing = new Set<string>();
    private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly terminatedSessions = new Set<string>();
    private readonly delayedReplyMentions = new Set<string>();
    private readonly rateLimitNoticeSent = new Set<string>();

    setClient(client: Client): void {
        this.client = client;
    }

    async createSession(
        guild: Guild,
        hostUserId: string,
        opponentType: DebateOpponentType,
        topic: string,
        creatorStance: DebateStance,
        spectatorRoleId: string | null
    ): Promise<DebateSession> {
        const sessions = await this.getSessions(guild.id);
        const activeSession = sessions.find((entry) => this.isSessionInProgress(entry) && this.isUserEngaged(entry, hostUserId));

        if (activeSession) {
            const existingChannel = await guild.channels.fetch(activeSession.channelId).catch(() => null);
            if (existingChannel) {
                throw new Error(`すでに進行中のレスバがあります: <#${activeSession.channelId}>`);
            }

            activeSession.status = 'closed';
            activeSession.updatedAt = new Date().toISOString();
            await this.persistSessions(guild.id, sessions);
        }

        const hostMember = await guild.members.fetch(hostUserId).catch(() => null);
        if (!hostMember) {
            throw new Error('作成者を取得できませんでした。');
        }

        if (opponentType === 'king' && !(await this.isDebateKing(hostMember))) {
            throw new Error('論破王とのレスバは、論破王のみ作成できます。');
        }

        const profile = await this.getProfile(hostUserId, guild.id);
        if (opponentType === 'ai_vs_ai' && profile.aiVsAiCooldownUntil) {
            const cooldownUntil = new Date(profile.aiVsAiCooldownUntil).getTime();
            if (Date.now() < cooldownUntil) {
                throw new Error(`AI vs AI は60分クールダウン中です。次回は ${new Date(profile.aiVsAiCooldownUntil).toLocaleString('ja-JP')} 以降に開始できます。`);
            }
        }

        const category = await ensureCategory(guild, DEBATE_CATEGORY_NAME);
        const creatorParticipantType: DebateParticipantType = opponentType === 'ai_vs_ai' ? 'ai' : 'user';
        const opponentParticipantType: DebateParticipantType = opponentType === 'king' ? 'user' : 'ai';
        const creatorId = creatorParticipantType === 'user' ? hostMember.id : null;
        const opponentId = null;
        const sessionId = createId('debate');
        const aiNameCount = [creatorParticipantType, opponentParticipantType].filter((entry) => entry === 'ai').length;
        const generatedAiNames = aiNameCount > 0
            ? await requestCoreFeaturePersonaNames(
                `レスバの担当AI名。モード: ${opponentType} / セッションID: ${sessionId} / お題: ${topic}`,
                aiNameCount
            )
            : [];
        const creatorAiName = creatorParticipantType === 'ai' ? (generatedAiNames.shift() || pickAiPersonaName(`${guild.id}:${sessionId}:debate`, 0)) : null;
        const opponentAiName = opponentParticipantType === 'ai'
            ? (generatedAiNames.shift() || pickAiPersonaName(
                `${guild.id}:${sessionId}:debate:opponent`,
                0,
                creatorAiName ? [creatorAiName] : []
            ))
            : null;

        const permissionOverwrites: any[] = [
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
            creatorParticipantType === 'user'
                ? {
                    id: hostMember.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                }
                : {
                    id: hostMember.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.ReadMessageHistory
                    ],
                    deny: [PermissionFlagsBits.SendMessages]
                }
        ];

        if (opponentType === 'king') {
            const existingKingRole = guild.roles.cache.find((role) => role.name === DEBATE_KING_ROLE_NAME) || null;
            const kingRole = await this.assignDebateKingRole(guild, hostMember.id)
                || existingKingRole
                || await ensureRole(guild, DEBATE_KING_ROLE_NAME, 'Core debate king role');
            if (!kingRole) {
                throw new Error('論破王ロールを用意できないため、論破王レスバを作成できません。');
            }

            permissionOverwrites.push({
                id: kingRole.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                deny: [PermissionFlagsBits.SendMessages]
            });
        }

        if (spectatorRoleId) {
            permissionOverwrites.push({
                id: spectatorRoleId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                deny: [PermissionFlagsBits.SendMessages]
            });
        }

        const channel = await guild.channels.create({
            name: sanitizeChannelName(`resba-${topic}`, 'resba'),
            type: ChannelType.GuildText,
            parent: category.id,
            topic: `Debate: ${topic}`,
            permissionOverwrites
        });

        const createdAt = new Date().toISOString();
        const session: DebateSession = {
            sessionId,
            guildId: guild.id,
            channelId: channel.id,
            categoryId: category.id,
            hostUserId,
            hostUserName: hostMember.user.username,
            hostDisplayName: hostMember.displayName,
            creatorId,
            creatorUserName: creatorParticipantType === 'user' ? hostMember.user.username : null,
            creatorDisplayName: creatorParticipantType === 'user' ? hostMember.displayName : null,
            opponentId,
            opponentUserName: null,
            opponentDisplayName: null,
            creatorAiName,
            opponentAiName,
            opponentType,
            creatorParticipantType,
            opponentParticipantType,
            spectatorRoleId,
            topic,
            creatorStance,
            opponentStance: getOppositeStance(creatorStance),
            status: opponentType === 'king' ? 'waiting_opponent' : 'active',
            currentTurn: 'creator',
            turnLimit: DEBATE_TURN_LIMIT,
            creatorTurns: 0,
            opponentTurns: 0,
            transcript: [{
                id: createId('transcript'),
                authorId: null,
                authorType: 'system',
                content: `お題: ${topic} / 先行側: ${buildStanceLabel(creatorStance)} / 後攻側: ${buildStanceLabel(getOppositeStance(creatorStance))}`,
                createdAt
            }],
            winner: null,
            judgementReason: null,
            createdAt,
            updatedAt: createdAt
        };

        sessions.push(session);
        await this.persistSessions(guild.id, sessions);

        if (opponentType === 'ai_vs_ai') {
            profile.aiVsAiCooldownUntil = new Date(Date.now() + DEBATE_AI_VS_AI_COOLDOWN_MS).toISOString();
            await this.saveProfile(profile);
        }

        const embed = new EmbedBuilder()
            .setTitle(
                opponentType === 'ai'
                    ? 'AIレスバを開始します'
                    : opponentType === 'king'
                        ? '論破王レスバの募集を開始します'
                        : 'AI vs AI レスバを開始します'
            )
            .setColor(
                opponentType === 'ai'
                    ? 0xd9534f
                    : opponentType === 'king'
                        ? 0xf0ad4e
                        : 0x5865f2
            )
            .setDescription([
                `お題: **${topic}**`,
                `先行側: ${this.buildSideSummary(session, 'creator')}`,
                `後攻側: ${this.buildSideSummary(session, 'opponent')}`,
                `ホスト: <@${hostMember.id}>`,
                spectatorRoleId ? `観戦ロール: <@&${spectatorRoleId}>` : '観戦ロール: 未設定'
            ].join('\n'))
            .addFields({
                name: 'ルール',
                value: opponentType === 'ai_vs_ai'
                    ? 'AI が各陣営6ターンずつ主張し、最後に AI 審判が勝敗を決めます。展示マッチのため論破スコア加算はありません。'
                    : '各陣営6ターンずつ。論点への反論力・一貫性・説得力で AI が厳格に採点します。'
            })
            .setTimestamp();

        await (channel as TextChannel).send({ embeds: [embed] }).catch(() => null);

        if (opponentType === 'ai') {
            await (channel as TextChannel).send(
                this.formatAiTurnMessage(
                    session,
                    'opponent',
                    `今回の対戦は私、${session.opponentAiName}が担当します。${this.getSpeakerMention(session, 'creator')} は ${buildStanceLabel(session.creatorStance)} の立場で主張を始めてください。`
                )
            ).catch(() => null);
            await (channel as TextChannel).send(`まずは ${this.getSpeakerMention(session, 'creator')} の1ターン目です。立場を明確にして主張を送ってください。`).catch(() => null);
            this.scheduleInactivityTimeout(guild.id, session.sessionId);
        } else if (opponentType === 'king') {
            const joinRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`corefeature:${guild.id}:debate:join:${session.sessionId}`)
                    .setLabel('論破王として参加する')
                    .setStyle(ButtonStyle.Primary)
            );

            await (channel as TextChannel).send({ content: '別の論破王は上のボタンから参加してください。参加後、先行者の1ターン目から始まります。', components: [joinRow] }).catch(() => null);
            this.scheduleInactivityTimeout(guild.id, session.sessionId);
        } else {
            await (channel as TextChannel).send([
                'スタッフが作成した AI vs AI の展示マッチです。AI 同士で自動進行します。',
                `先行AI は ${session.creatorAiName}、後攻AI は ${session.opponentAiName} が担当します。`
            ].join('\n')).catch(() => null);
            void this.runAiVsAiDebate(guild, session.sessionId);
        }

        return session;
    }

    async joinKingDebate(interaction: { guild: Guild | null; user: { id: string }; reply: Function }, sessionId: string): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({ content: '❌ サーバー外では参加できません。', ephemeral: true });
            return;
        }

        const sessions = await this.getSessions(interaction.guild.id);
        const session = sessions.find((entry) => entry.sessionId === sessionId);
        if (!session || session.status !== 'waiting_opponent') {
            await interaction.reply({ content: '❌ このレスバ募集はすでに終了しています。', ephemeral: true });
            return;
        }

        if (session.creatorId === interaction.user.id || session.hostUserId === interaction.user.id) {
            await interaction.reply({ content: '❌ 自分の募集には参加できません。', ephemeral: true });
            return;
        }

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !(await this.isDebateKing(member))) {
            await interaction.reply({ content: '❌ 論破王のみ参加できます。', ephemeral: true });
            return;
        }

        const channel = await interaction.guild.channels.fetch(session.channelId).catch(() => null);
        if (!channel || !('permissionOverwrites' in channel)) {
            await interaction.reply({ content: '❌ 部屋が見つかりません。', ephemeral: true });
            return;
        }

        await (channel as any).permissionOverwrites.create(member.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
        }).catch(() => null);

        session.opponentId = member.id;
        session.opponentUserName = member.user.username;
        session.opponentDisplayName = member.displayName;
        session.status = 'active';
        session.updatedAt = new Date().toISOString();
        await this.persistSessions(interaction.guild.id, sessions);
        this.scheduleInactivityTimeout(interaction.guild.id, session.sessionId);

        await interaction.reply({ content: `✅ <#${session.channelId}> に参加しました。`, ephemeral: true });

        if ('send' in channel && typeof (channel as any).send === 'function') {
            await (channel as TextChannel).send([
                `⚔️ <@${member.id}> が論破王として参加しました。`,
                `先行側は ${this.buildSideSummary(session, 'creator')}、後攻側は ${this.buildSideSummary(session, 'opponent')} です。`,
                `それでは ${this.getSpeakerMention(session, 'creator')} の1ターン目から開始します。`
            ].join('\n')).catch(() => null);
        }
    }

    async onMessage(message: Message): Promise<boolean> {
        if (!message.guild || message.author.bot) {
            return false;
        }

        const session = await this.getSessionByChannel(message.guild.id, message.channel.id);
        if (!session) {
            return false;
        }

        await this.handleDebateMessage(message, session);
        return true;
    }

    private async handleDebateMessage(message: Message, session: DebateSession): Promise<void> {
        if (!message.content.trim()) {
            await message.reply('❌ テキストで主張を送ってください。').catch(() => null);
            return;
        }

        if (session.status === 'waiting_opponent') {
            if (message.author.id === session.creatorId || message.author.id === session.hostUserId) {
                this.scheduleInactivityTimeout(message.guild!.id, session.sessionId);
                await message.reply('論破王の参加待ちです。少し待ってください。').catch(() => null);
            } else {
                await message.delete().catch(() => null);
            }
            return;
        }

        const allowedUsers = this.getUserParticipants(session);
        if (!allowedUsers.includes(message.author.id)) {
            await message.delete().catch(() => null);
            return;
        }

        if (session.opponentType === 'ai_vs_ai') {
            await message.delete().catch(() => null);
            return;
        }

        if (session.opponentType === 'ai') {
            await this.handleAiDebateMessage(message, session);
            return;
        }

        await this.handlePvPDebateMessage(message, session);
    }

    private async handleAiDebateMessage(message: Message, session: DebateSession): Promise<void> {
        if (!session.creatorId || message.author.id !== session.creatorId) {
            await message.delete().catch(() => null);
            return;
        }

        if (session.currentTurn !== 'creator') {
            await message.reply('今は AI の手番です。少し待ってください。').catch(() => null);
            return;
        }

        if (this.processing.has(session.sessionId)) {
            await message.reply('前のターンを処理中です。少し待ってください。').catch(() => null);
            return;
        }

        this.processing.add(session.sessionId);

        try {
            const modelHooks = this.createModelHooks(message.channel as TextChannel, session);
            const sessions = await this.getSessions(message.guild!.id);
            const active = sessions.find((entry) => entry.sessionId === session.sessionId);
            if (!active) {
                return;
            }

            active.creatorTurns += 1;
            active.updatedAt = new Date().toISOString();
            active.transcript.push({
                id: createId('transcript'),
                authorId: message.author.id,
                authorType: 'creator',
                content: truncateText(message.content, 3500),
                createdAt: active.updatedAt
            });
            await this.persistSessions(message.guild!.id, sessions);

            if ('sendTyping' in message.channel && typeof message.channel.sendTyping === 'function') {
                await message.channel.sendTyping().catch(() => null);
            }

            const reply = await this.generateAiReply(active, 'opponent', modelHooks);
            const refreshedSessions = await this.getSessions(message.guild!.id);
            const refreshed = refreshedSessions.find((entry) => entry.sessionId === session.sessionId);
            if (!refreshed || refreshed.status !== 'active' || this.terminatedSessions.has(session.sessionId)) {
                return;
            }

            refreshed.opponentTurns += 1;
            refreshed.updatedAt = new Date().toISOString();
            refreshed.transcript.push({
                id: createId('transcript'),
                authorId: null,
                authorType: 'opponent',
                content: reply.reply,
                createdAt: refreshed.updatedAt
            });
            refreshed.currentTurn = 'creator';
            await this.persistSessions(message.guild!.id, refreshedSessions);

            await (message.channel as TextChannel).send(
                this.buildAiTurnReply(refreshed, 'opponent', reply.reply)
            ).catch(() => null);

            if (refreshed.creatorTurns >= refreshed.turnLimit && refreshed.opponentTurns >= refreshed.turnLimit) {
                await this.finalize(message.guild!, refreshed, modelHooks);
            } else {
                this.scheduleInactivityTimeout(message.guild!.id, refreshed.sessionId);
                await (message.channel as TextChannel).send(this.buildTurnPrompt(refreshed, 'creator')).catch(() => null);
            }
        } catch (error) {
            Logger.error('Failed to handle AI debate message:', error);
            await (message.channel as TextChannel).send('レスバ処理中にエラーが発生しました。').catch(() => null);
        } finally {
            this.processing.delete(session.sessionId);
        }
    }

    private async handlePvPDebateMessage(message: Message, session: DebateSession): Promise<void> {
        const expectedUserId = session.currentTurn === 'creator' ? session.creatorId : session.opponentId;
        if (!expectedUserId || expectedUserId !== message.author.id) {
            await message.reply(`今は ${this.getSpeakerMention(session, session.currentTurn)} の手番です。`).catch(() => null);
            return;
        }

        const sessions = await this.getSessions(message.guild!.id);
        const active = sessions.find((entry) => entry.sessionId === session.sessionId);
        if (!active) {
            return;
        }

        active.updatedAt = new Date().toISOString();
        active.transcript.push({
            id: createId('transcript'),
            authorId: message.author.id,
            authorType: active.currentTurn,
            content: truncateText(message.content, 3500),
            createdAt: active.updatedAt
        });

        if (active.currentTurn === 'creator') {
            active.creatorTurns += 1;
            active.currentTurn = 'opponent';
        } else {
            active.opponentTurns += 1;
            active.currentTurn = 'creator';
        }

        await this.persistSessions(message.guild!.id, sessions);

        if (active.creatorTurns >= active.turnLimit && active.opponentTurns >= active.turnLimit) {
            await this.finalize(message.guild!, active);
            return;
        }

        this.scheduleInactivityTimeout(message.guild!.id, active.sessionId);
        await (message.channel as TextChannel).send(this.buildTurnPrompt(active, active.currentTurn)).catch(() => null);
    }

    private async runAiVsAiDebate(guild: Guild, sessionId: string): Promise<void> {
        if (this.processing.has(sessionId)) {
            return;
        }

        this.processing.add(sessionId);

        try {
            const channel = await this.getTextChannel(guild, sessionId);
            for (;;) {
                const sessions = await this.getSessions(guild.id);
                const active = sessions.find((entry) => entry.sessionId === sessionId);
                if (!active || active.opponentType !== 'ai_vs_ai' || active.status !== 'active') {
                    return;
                }
                const modelHooks = channel ? this.createModelHooks(channel, active) : undefined;

                if (channel) {
                    await channel.sendTyping().catch(() => null);
                }

                const speaker = active.currentTurn;
                const reply = await this.generateAiReply(active, speaker, modelHooks);
                const refreshedSessions = await this.getSessions(guild.id);
                const refreshed = refreshedSessions.find((entry) => entry.sessionId === sessionId);
                if (!refreshed || refreshed.opponentType !== 'ai_vs_ai' || refreshed.status !== 'active' || this.terminatedSessions.has(sessionId)) {
                    return;
                }

                refreshed.updatedAt = new Date().toISOString();
                refreshed.transcript.push({
                    id: createId('transcript'),
                    authorId: null,
                    authorType: speaker,
                    content: reply.reply,
                    createdAt: refreshed.updatedAt
                });

                if (speaker === 'creator') {
                    refreshed.creatorTurns += 1;
                    refreshed.currentTurn = 'opponent';
                } else {
                    refreshed.opponentTurns += 1;
                    refreshed.currentTurn = 'creator';
                }

                await this.persistSessions(guild.id, refreshedSessions);

                if (channel) {
                    await channel.send(this.buildAiTurnReply(refreshed, speaker, reply.reply)).catch(() => null);
                }

                if (refreshed.creatorTurns >= refreshed.turnLimit && refreshed.opponentTurns >= refreshed.turnLimit) {
                    await this.finalize(guild, refreshed, modelHooks);
                    return;
                }

                if (channel) {
                    await channel.send(this.buildTurnPrompt(refreshed, refreshed.currentTurn)).catch(() => null);
                }
            }
        } catch (error) {
            Logger.error('Failed to run AI vs AI debate:', error);
            const channel = await this.getTextChannel(guild, sessionId);
            await channel?.send('AI vs AI の進行中にエラーが発生しました。').catch(() => null);
            await this.closeSession(guild.id, sessionId, 'AI vs AI の進行エラー').catch(() => null);
        } finally {
            this.processing.delete(sessionId);
        }
    }

    private async finalize(
        guild: Guild,
        session: DebateSession,
        hooks?: CoreFeatureModelHooks
    ): Promise<void> {
        if (this.finalizing.has(session.sessionId)) {
            return;
        }

        this.finalizing.add(session.sessionId);
        this.clearInactivityTimeout(guild.id, session.sessionId);

        try {
            const sessions = await this.getSessions(guild.id);
            const active = sessions.find((entry) => entry.sessionId === session.sessionId);
            if (!active) {
                return;
            }

            active.status = 'judging';
            active.updatedAt = new Date().toISOString();
            await this.persistSessions(guild.id, sessions);

            const judgement = await this.judge(active, hooks);
            const latestSessions = await this.getSessions(guild.id);
            const latest = latestSessions.find((entry) => entry.sessionId === session.sessionId);
            if (!latest || latest.status !== 'judging' || this.terminatedSessions.has(session.sessionId)) {
                return;
            }
            const scoreAwards = this.computeAwards(latest, judgement);

            latest.status = 'completed';
            latest.updatedAt = new Date().toISOString();
            latest.winner = judgement.winner;
            latest.judgementReason = judgement.reason;
            await this.persistSessions(guild.id, latestSessions);

            const awardMessages: string[] = [];
            let creatorProfile: DebateProfile | null = null;
            if (latest.creatorParticipantType === 'user' && latest.creatorId) {
                const creatorOutcome = judgement.winner === 'creator' ? 'win' : judgement.winner === 'draw' ? 'draw' : 'loss';
                creatorProfile = await this.applyResult(guild, latest.creatorId, latest, creatorOutcome, scoreAwards.creator, latest.opponentType === 'ai');
                awardMessages.push(`<@${latest.creatorId}>: ${scoreAwards.creator > 0 ? `+${scoreAwards.creator}` : '+0'} 点`);
            }

            let opponentProfile: DebateProfile | null = null;
            if (latest.opponentParticipantType === 'user' && latest.opponentId) {
                const opponentOutcome = judgement.winner === 'opponent' ? 'win' : judgement.winner === 'draw' ? 'draw' : 'loss';
                opponentProfile = await this.applyResult(guild, latest.opponentId, latest, opponentOutcome, scoreAwards.opponent, false);
                awardMessages.push(`<@${latest.opponentId}>: ${scoreAwards.opponent > 0 ? `+${scoreAwards.opponent}` : '+0'} 点`);
            }

            const channel = await guild.channels.fetch(latest.channelId).catch(() => null);
            if (channel && 'send' in channel) {
                const winnerLabel = judgement.winner === 'draw'
                    ? '引き分け'
                    : judgement.winner === 'creator'
                        ? `${this.getSpeakerMention(latest, 'creator')} の勝利`
                        : `${this.getSpeakerMention(latest, 'opponent')} の勝利`;

                const embed = new EmbedBuilder()
                    .setTitle('レスバ結果')
                    .setColor(judgement.winner === 'draw' ? 0x888888 : 0xff7043)
                    .setDescription([
                        `お題: **${latest.topic}**`,
                        `結果: **${winnerLabel}**`,
                        `採点: 先行側 ${judgement.creator_score} / 後攻側 ${judgement.opponent_score}`,
                        `論破スコア: ${awardMessages.length > 0 ? awardMessages.join(' / ') : '展示マッチのため加算なし'}`,
                        `終了理由: ${judgement.reason}`
                    ].join('\n'))
                    .setTimestamp();

                await (channel as TextChannel).send({
                    content: this.consumeDelayedMentionPrefix(latest) || undefined,
                    embeds: [embed]
                }).catch(() => null);

                if (
                    creatorProfile
                    && creatorProfile.kingAwardedAt
                    && creatorProfile.recentResults[0]?.sessionId === latest.sessionId
                    && creatorProfile.score >= DEBATE_KING_SCORE_THRESHOLD
                    && creatorProfile.wins >= DEBATE_KING_WIN_THRESHOLD
                ) {
                    await (channel as TextChannel).send(`<@${latest.creatorId}> は論破王に到達しました。`).catch(() => null);
                }

                if (
                    opponentProfile
                    && latest.opponentId
                    && opponentProfile.kingAwardedAt
                    && opponentProfile.recentResults[0]?.sessionId === latest.sessionId
                    && opponentProfile.score >= DEBATE_KING_SCORE_THRESHOLD
                    && opponentProfile.wins >= DEBATE_KING_WIN_THRESHOLD
                ) {
                    await (channel as TextChannel).send(`<@${latest.opponentId}> は論破王に到達しました。`).catch(() => null);
                }
            }

            this.scheduleCleanup(guild.id, latest.sessionId);
        } finally {
            this.finalizing.delete(session.sessionId);
        }
    }

    async closeSessions(guild: Guild, options: { channelId?: string; reason: string }): Promise<Array<{ sessionId: string; channelId: string; summary: string }>> {
        const targets = await this.getOpenSessions(guild, options.channelId);
        const results: Array<{ sessionId: string; channelId: string; summary: string }> = [];

        for (const target of targets) {
            await this.closeSession(guild.id, target.sessionId, options.reason);
            results.push({
                sessionId: target.sessionId,
                channelId: target.channelId,
                summary: `レスバ / ${truncateText(target.topic, 50)}`
            });
        }

        return results;
    }

    async resetUserData(guild: Guild, userId: string, reason: string): Promise<{ summary: string } | null> {
        const openSessions = await this.getOpenSessions(guild);
        const matchedSessions = openSessions.filter((entry) => this.isUserEngaged(entry, userId));
        for (const session of matchedSessions) {
            await this.closeSession(guild.id, session.sessionId, reason);
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        let removedKingRole = false;
        const kingRole = guild.roles.cache.find((role) => role.name === DEBATE_KING_ROLE_NAME) || null;
        if (member && kingRole && member.roles.cache.has(kingRole.id)) {
            await member.roles.remove(kingRole, 'Core debate reset').catch(() => null);
            removedKingRole = true;
        }

        const deletedProfile = await database.deleteUserGuildData(userId, guild.id, 'corefeature/debate-profile');
        if (!deletedProfile && !removedKingRole && matchedSessions.length === 0) {
            return null;
        }
        const summaryParts = ['れすばデータをリセット'];
        if (deletedProfile) {
            summaryParts.push('論破スコア初期化');
        }
        if (removedKingRole) {
            summaryParts.push('論破王ロール解除');
        }
        if (matchedSessions.length > 0) {
            summaryParts.push('進行中マッチを終了');
        }

        return {
            summary: summaryParts.join(' / ')
        };
    }

    private async generateAiReply(
        session: DebateSession,
        speaker: DebateSide,
        hooks?: CoreFeatureModelHooks
    ): Promise<DebateReplyResponse> {
        const myStance = speaker === 'creator' ? session.creatorStance : session.opponentStance;
        const opposingStance = speaker === 'creator' ? session.opponentStance : session.creatorStance;
        const turnNumber = (speaker === 'creator' ? session.creatorTurns : session.opponentTurns) + 1;
        const speakerLabel = this.getSpeakerLabel(session, speaker);
        const opponentLabel = this.getSpeakerLabel(session, speaker === 'creator' ? 'opponent' : 'creator');

        const systemPrompt = [
            'あなたは Discord のレスバ対戦 AI です。',
            `今回は ${speakerLabel} として話します。`,
            '感情的な罵倒ではなく、論点・反論・一貫性で戦ってください。',
            '相手の主張の穴を正確に突き、結論はぶらさないでください。',
            '長すぎる演説は禁止。1〜2段落、最大500文字程度。',
            '人間ユーザーが相手に含まれる場合は、その表示名やユーザー名を対戦相手として認識してください。',
            '出力は JSON のみで、キーは reply だけにしてください。'
        ].join('\n');

        const userPrompt = [
            `お題: ${session.topic}`,
            `あなたの陣営: ${buildStanceLabel(myStance)}`,
            `相手の陣営: ${buildStanceLabel(opposingStance)}`,
            `今回の話者: ${speakerLabel}`,
            `今回の話者の詳細: ${this.describeSideIdentity(session, speaker)}`,
            `相手の話者: ${opponentLabel}`,
            `相手の話者の詳細: ${this.describeSideIdentity(session, speaker === 'creator' ? 'opponent' : 'creator')}`,
            `現在のターン: ${turnNumber}/${session.turnLimit}`,
            `これまでのログ:\n${summarizeTranscript(session.transcript, 20)}`
        ].join('\n\n');

        const raw = await requestCoreFeatureModelText([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], 700, 0.5, hooks);

        const parsed = validateDebateReply(extractJsonObject(raw));
        if (parsed && parsed.reply) {
            return parsed;
        }

        return {
            reply: '今の主張は前提の説明が薄いです。あなたの結論が成立する条件を示せていませんし、反対側に生じる不利益への詰めも甘いです。そこを埋めない限り、説得力ではこちらが上です。'
        };
    }

    private async judge(
        session: DebateSession,
        hooks?: CoreFeatureModelHooks
    ): Promise<DebateJudgeResponse> {
        const creatorJudgeLabel = this.getJudgeSideLabel(session, 'creator');
        const opponentJudgeLabel = this.getJudgeSideLabel(session, 'opponent');
        const systemPrompt = [
            'あなたは Discord のレスバ審判 AI です。',
            '勝敗は感情ではなく、論理、相手への応答性、一貫性、論点の深さ、反論の有効性で決めてください。',
            'ふざけ、同じ主張の繰り返し、論点逸らし、短すぎる返答は減点してください。',
            'creator と opponent のどちらが勝ったか、または draw かを JSON で返してください。',
            `reason では creator / opponent のような機械的な呼び方を避け、必ず「${creatorJudgeLabel}」「${opponentJudgeLabel}」のように実名ベースで説明してください。`,
            '出力は JSON のみで、キーは winner, reason, creator_score, opponent_score です。'
        ].join('\n');

        const userPrompt = [
            `お題: ${session.topic}`,
            `creator (${creatorJudgeLabel}): ${this.buildSideSummary(session, 'creator')}`,
            `creator詳細: ${this.describeSideIdentity(session, 'creator')}`,
            `opponent (${opponentJudgeLabel}): ${this.buildSideSummary(session, 'opponent')}`,
            `opponent詳細: ${this.describeSideIdentity(session, 'opponent')}`,
            `ログ:\n${summarizeTranscript(session.transcript, 28)}`
        ].join('\n\n');

        const raw = await requestCoreFeatureModelText([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], 800, 0.2, hooks);

        const parsed = validateDebateJudge(extractJsonObject(raw));
        if (parsed) {
            return {
                ...parsed,
                reason: this.rewriteJudgementReason(session, parsed.reason)
            };
        }

        return {
            winner: 'draw',
            reason: 'モデルの審判出力が不安定だったため引き分け扱いにしました。',
            creator_score: 50,
            opponent_score: 50
        };
    }

    private computeAwards(session: DebateSession, judgement: DebateJudgeResponse): { creator: number; opponent: number } {
        if (session.opponentType === 'ai_vs_ai' || judgement.winner === 'draw') {
            return { creator: 0, opponent: 0 };
        }

        const margin = Math.abs(judgement.creator_score - judgement.opponent_score);
        const aiBase = clamp(22 + Math.floor(margin / 3), 18, 40);
        const kingBase = clamp(30 + Math.floor(margin / 2), 24, 55);

        if (session.opponentType === 'ai') {
            return judgement.winner === 'creator'
                ? { creator: aiBase, opponent: 0 }
                : { creator: 0, opponent: 0 };
        }

        return judgement.winner === 'creator'
            ? { creator: kingBase, opponent: 0 }
            : { creator: 0, opponent: kingBase };
    }

    private async applyResult(
        guild: Guild,
        userId: string,
        session: DebateSession,
        outcome: 'win' | 'loss' | 'draw',
        scoreDelta: number,
        isAiBattle: boolean
    ): Promise<DebateProfile> {
        const profile = await this.getProfile(userId, guild.id);
        profile.totalBattles += 1;
        profile.score = Math.max(0, profile.score + scoreDelta);

        if (outcome === 'win') {
            profile.wins += 1;
            if (isAiBattle) {
                profile.aiWins += 1;
            } else {
                profile.kingWins += 1;
            }
        } else if (outcome === 'loss') {
            profile.losses += 1;
        } else {
            profile.draws += 1;
        }

        profile.recentResults.unshift({
            sessionId: session.sessionId,
            topic: session.topic,
            opponentType: session.opponentType,
            result: outcome,
            scoreDelta,
            at: new Date().toISOString()
        });
        profile.recentResults = profile.recentResults.slice(0, 30);

        const qualifiesForKing = profile.score >= DEBATE_KING_SCORE_THRESHOLD && profile.wins >= DEBATE_KING_WIN_THRESHOLD;
        if (qualifiesForKing && !profile.kingAwardedAt) {
            profile.kingAwardedAt = new Date().toISOString();
            await this.assignDebateKingRole(guild, userId);
        } else if (qualifiesForKing) {
            await this.assignDebateKingRole(guild, userId);
        }

        await this.saveProfile(profile);
        return profile;
    }

    private async assignDebateKingRole(guild: Guild, userId: string): Promise<Role | null> {
        const me = guild.members.me;
        if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return null;
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            return null;
        }

        const role = await ensureRole(guild, DEBATE_KING_ROLE_NAME, 'Core debate king role');
        if (!role) {
            return null;
        }

        if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role, 'Reached debate king threshold').catch(() => null);
        }

        return role;
    }

    private async isDebateKing(member: GuildMember): Promise<boolean> {
        if (member.roles.cache.some((role) => role.name === DEBATE_KING_ROLE_NAME)) {
            return true;
        }

        const profile = await this.getProfile(member.id, member.guild.id);
        return profile.score >= DEBATE_KING_SCORE_THRESHOLD && profile.wins >= DEBATE_KING_WIN_THRESHOLD;
    }

    private scheduleCleanup(guildId: string, sessionId: string): void {
        const key = `${guildId}:${sessionId}`;
        const existing = this.cleanupTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.closeSession(guildId, sessionId, 'レスバ終了').catch((error) => {
                Logger.error('Failed to cleanup debate room:', error);
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
                Logger.error('Failed to timeout debate room:', error);
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
        if (!session || !this.isSessionInProgress(session)) {
            return;
        }

        const guild = this.client ? await this.client.guilds.fetch(guildId).catch(() => null) : null;
        const channel = guild ? await guild.channels.fetch(session.channelId).catch(() => null) : null;
        if (channel && 'send' in channel) {
            await (channel as TextChannel).send('⏱️ 5分無操作のため、このレスバは自動終了します。').catch(() => null);
        }

        await this.closeSession(guildId, sessionId, '5分無操作のため自動終了');
    }

    private async closeSession(guildId: string, sessionId: string, reason: string): Promise<void> {
        this.terminatedSessions.add(sessionId);
        this.clearCleanupTimer(guildId, sessionId);
        this.clearInactivityTimeout(guildId, sessionId);
        this.clearDelayedReplyState(sessionId);

        const sessions = await this.getSessions(guildId);
        const session = sessions.find((entry) => entry.sessionId === sessionId);
        if (!session) {
            return;
        }

        session.status = this.isSessionInProgress(session) ? 'closed' : session.status;
        session.updatedAt = new Date().toISOString();
        await this.persistSessions(guildId, sessions);
        await deleteRoom(this.client, session.guildId, session.channelId, session.categoryId, reason);
    }

    private async getSessions(guildId: string): Promise<DebateSession[]> {
        const stored = await database.get<DebateSession[]>(guildId, getDebateSessionsKey(guildId), []);
        return (Array.isArray(stored) ? stored : []).map((entry) => {
            const creatorParticipantType: DebateParticipantType = entry.creatorParticipantType === 'ai' ? 'ai' : 'user';
            const opponentParticipantType: DebateParticipantType = entry.opponentParticipantType === 'user'
                ? 'user'
                : entry.opponentType === 'king'
                    ? 'user'
                    : 'ai';
            const [fallbackCreatorAiName, fallbackOpponentAiName] = pickAiPersonaPair(`${guildId}:${entry.sessionId}:debate`);
            const creatorAiName = typeof entry.creatorAiName === 'string' ? entry.creatorAiName.trim() : '';
            const opponentAiName = typeof entry.opponentAiName === 'string' ? entry.opponentAiName.trim() : '';
            return {
                ...entry,
                hostUserId: typeof entry.hostUserId === 'string'
                    ? entry.hostUserId
                    : typeof entry.creatorId === 'string'
                        ? entry.creatorId
                        : '',
                hostUserName: typeof (entry as any).hostUserName === 'string' ? (entry as any).hostUserName : '',
                hostDisplayName: typeof (entry as any).hostDisplayName === 'string' ? (entry as any).hostDisplayName : '',
                creatorId: typeof entry.creatorId === 'string' ? entry.creatorId : null,
                creatorUserName: typeof (entry as any).creatorUserName === 'string' ? (entry as any).creatorUserName : null,
                creatorDisplayName: typeof (entry as any).creatorDisplayName === 'string' ? (entry as any).creatorDisplayName : null,
                opponentId: typeof entry.opponentId === 'string' && entry.opponentId !== 'AI' ? entry.opponentId : null,
                opponentUserName: typeof (entry as any).opponentUserName === 'string' ? (entry as any).opponentUserName : null,
                opponentDisplayName: typeof (entry as any).opponentDisplayName === 'string' ? (entry as any).opponentDisplayName : null,
                creatorParticipantType,
                opponentParticipantType,
                creatorAiName: creatorParticipantType === 'ai'
                    ? (creatorAiName
                        ? creatorAiName
                        : fallbackCreatorAiName)
                    : null,
                opponentAiName: opponentParticipantType === 'ai'
                    ? (opponentAiName
                        ? opponentAiName
                        : creatorParticipantType === 'ai'
                            ? fallbackOpponentAiName
                            : pickAiPersonaName(
                                `${guildId}:${entry.sessionId}:debate:opponent`,
                                0,
                                creatorAiName ? [creatorAiName] : []
                            ))
                    : null,
                transcript: Array.isArray(entry.transcript) ? entry.transcript : []
            };
        });
    }

    private async persistSessions(guildId: string, sessions: DebateSession[]): Promise<void> {
        const trimmed = sessions
            .slice()
            .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
            .slice(-MAX_SESSION_HISTORY)
            .map((entry) => ({
                ...entry,
                transcript: entry.transcript.slice(-MAX_TRANSCRIPT_ENTRIES)
            }));

        await database.set(guildId, getDebateSessionsKey(guildId), trimmed);
    }

    private async getProfile(userId: string, guildId: string): Promise<DebateProfile> {
        const stored = await database.getUserGuildData<DebateProfile>(userId, guildId, 'corefeature/debate-profile', null);
        if (stored) {
            return {
                ...stored,
                aiVsAiCooldownUntil: typeof stored.aiVsAiCooldownUntil === 'string' ? stored.aiVsAiCooldownUntil : null,
                recentResults: Array.isArray(stored.recentResults) ? stored.recentResults : []
            };
        }

        return {
            userId,
            guildId,
            score: 0,
            aiVsAiCooldownUntil: null,
            wins: 0,
            losses: 0,
            draws: 0,
            aiWins: 0,
            kingWins: 0,
            totalBattles: 0,
            kingAwardedAt: null,
            recentResults: []
        };
    }

    private async saveProfile(profile: DebateProfile): Promise<void> {
        await database.setUserGuildData(profile.userId, profile.guildId, 'corefeature/debate-profile', profile);
    }

    private async getSessionByChannel(guildId: string, channelId: string): Promise<DebateSession | null> {
        const sessions = await this.getSessions(guildId);
        return sessions.find((entry) => entry.channelId === channelId && this.isSessionInProgress(entry)) || null;
    }

    private async getTextChannel(guild: Guild, sessionId: string): Promise<TextChannel | null> {
        const sessions = await this.getSessions(guild.id);
        const session = sessions.find((entry) => entry.sessionId === sessionId);
        if (!session) {
            return null;
        }

        const channel = await guild.channels.fetch(session.channelId).catch(() => null);
        return channel?.isTextBased() ? channel as TextChannel : null;
    }

    private async getOpenSessions(guild: Guild, channelId?: string): Promise<DebateSession[]> {
        const sessions = await this.getSessions(guild.id);
        const candidates = sessions.filter((entry) => (
            entry.status !== 'closed'
            && (!channelId || entry.channelId === channelId)
        ));
        const openSessions: DebateSession[] = [];

        for (const entry of candidates) {
            const channel = await guild.channels.fetch(entry.channelId).catch(() => null);
            if (channel) {
                openSessions.push(entry);
            }
        }

        return openSessions;
    }

    private createModelHooks(channel: TextChannel, session: DebateSession): CoreFeatureModelHooks {
        return {
            requestLabel: `core-debate:${session.sessionId}`,
            onRateLimitWait: async (info) => {
                this.delayedReplyMentions.add(session.sessionId);
                if (info.waitMs < DebateService.LONG_WAIT_NOTICE_THRESHOLD_MS || this.rateLimitNoticeSent.has(session.sessionId)) {
                    return;
                }

                this.rateLimitNoticeSent.add(session.sessionId);
                const minutes = Math.max(1, Math.ceil(info.waitMs / 60_000));
                const mentionLine = this.buildDelayedMentionPrefix(session) || `<@${session.hostUserId}>`;
                await channel.send(
                    `${mentionLine}\nレート制限のため、あと ${minutes} 分ほど待ってから続けます。返答でき次第メンションします。`
                ).catch(() => null);
            }
        };
    }

    private clearDelayedReplyState(sessionId: string): void {
        this.delayedReplyMentions.delete(sessionId);
        this.rateLimitNoticeSent.delete(sessionId);
    }

    private buildDelayedMentionPrefix(session: DebateSession): string {
        const targets = new Set<string>();
        if (session.hostUserId) {
            targets.add(session.hostUserId);
        }
        for (const userId of this.getUserParticipants(session)) {
            targets.add(userId);
        }

        return Array.from(targets).map((userId) => `<@${userId}>`).join(' ');
    }

    private consumeDelayedMentionPrefix(session: DebateSession): string {
        if (!this.delayedReplyMentions.has(session.sessionId)) {
            return '';
        }

        this.delayedReplyMentions.delete(session.sessionId);
        return this.buildDelayedMentionPrefix(session);
    }

    private isSessionInProgress(session: DebateSession): boolean {
        return ['waiting_opponent', 'active', 'judging'].includes(session.status);
    }

    private isUserEngaged(session: DebateSession, userId: string): boolean {
        return [session.hostUserId, ...this.getUserParticipants(session)].filter(Boolean).includes(userId);
    }

    private getUserParticipants(session: DebateSession): string[] {
        return [session.creatorId, session.opponentId].filter((value): value is string => Boolean(value));
    }

    private getSpeakerLabel(session: DebateSession, side: DebateSide): string {
        const participantType = side === 'creator' ? session.creatorParticipantType : session.opponentParticipantType;
        if (participantType === 'ai') {
            const aiName = side === 'creator' ? session.creatorAiName : session.opponentAiName;
            if (session.opponentType === 'ai_vs_ai') {
                return `${side === 'creator' ? '先行AI' : '後攻AI'}${aiName ? ` (${aiName})` : ''}`;
            }
            return `AI${aiName ? ` (${aiName})` : ''}`;
        }

        return side === 'creator' ? '先行者' : '後攻者';
    }

    private getSpeakerMention(session: DebateSession, side: DebateSide): string {
        const userId = side === 'creator' ? session.creatorId : session.opponentId;
        const participantType = side === 'creator' ? session.creatorParticipantType : session.opponentParticipantType;

        if (participantType === 'user' && userId) {
            return `<@${userId}>`;
        }

        return this.getSpeakerLabel(session, side);
    }

    private describeSideIdentity(session: DebateSession, side: DebateSide): string {
        const participantType = side === 'creator' ? session.creatorParticipantType : session.opponentParticipantType;
        if (participantType === 'ai') {
            const aiName = side === 'creator' ? session.creatorAiName : session.opponentAiName;
            return aiName ? `AI名: ${aiName}` : 'AI';
        }

        const userId = side === 'creator' ? session.creatorId : session.opponentId;
        const userName = side === 'creator' ? session.creatorUserName : session.opponentUserName;
        const displayName = side === 'creator' ? session.creatorDisplayName : session.opponentDisplayName;
        return [
            displayName ? `表示名: ${displayName}` : null,
            userName ? `ユーザー名: ${userName}` : null,
            userId ? `ユーザーID: ${userId}` : null
        ].filter(Boolean).join(' / ') || '人間ユーザー';
    }

    private getJudgeSideLabel(session: DebateSession, side: DebateSide): string {
        const participantType = side === 'creator' ? session.creatorParticipantType : session.opponentParticipantType;
        if (participantType === 'ai') {
            const aiName = side === 'creator' ? session.creatorAiName : session.opponentAiName;
            return aiName ? `AI (${aiName})` : this.getSpeakerLabel(session, side);
        }

        const displayName = side === 'creator' ? session.creatorDisplayName : session.opponentDisplayName;
        const userName = side === 'creator' ? session.creatorUserName : session.opponentUserName;
        return displayName || (userName ? `@${userName}` : this.getSpeakerMention(session, side));
    }

    private rewriteJudgementReason(session: DebateSession, reason: string): string {
        const creatorLabel = this.getJudgeSideLabel(session, 'creator');
        const opponentLabel = this.getJudgeSideLabel(session, 'opponent');
        return reason
            .replace(/\bcreator\b/g, creatorLabel)
            .replace(/\bopponent\b/g, opponentLabel)
            .replace(/先行側/g, creatorLabel)
            .replace(/後攻側/g, opponentLabel);
    }

    private buildSideSummary(session: DebateSession, side: DebateSide): string {
        const mention = this.getSpeakerMention(session, side);
        const stance = side === 'creator' ? session.creatorStance : session.opponentStance;
        return `${mention} (${buildStanceLabel(stance)})`;
    }

    private buildTurnPrompt(session: DebateSession, nextSide: DebateSide): string {
        const currentTurnNumber = nextSide === 'creator' ? session.creatorTurns + 1 : session.opponentTurns + 1;
        return `次は ${this.getSpeakerMention(session, nextSide)} の ${currentTurnNumber}/${session.turnLimit} ターン目です。`;
    }

    private buildAiTurnReply(session: DebateSession, side: DebateSide, content: string): string {
        const prefix = this.consumeDelayedMentionPrefix(session);
        return prefix
            ? `${prefix}\n${this.formatAiTurnMessage(session, side, content)}`
            : this.formatAiTurnMessage(session, side, content);
    }

    private formatAiTurnMessage(session: DebateSession, side: DebateSide, content: string): string {
        return `**${this.getSpeakerLabel(session, side)}**\n${content.trim()}`;
    }
}
