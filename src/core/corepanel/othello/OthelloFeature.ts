import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelType,
    Client,
    EmbedBuilder,
    Guild,
    MessageFlags,
    PermissionFlagsBits,
    TextChannel,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    Events
} from 'discord.js';
import { CoreFeatureModule } from '../registry.js';
import { CoreFeaturePanelKind } from '../types.js';
import {
    OthelloBoard,
    OthelloDifficulty,
    OthelloDisc,
    applyMove,
    chooseBotMove,
    countDiscs,
    createInitialBoard,
    getValidMoves,
    isGameOver,
    opponentOf
} from './OthelloEngine.js';
import { renderOthelloBoard, renderOthelloReplay } from './OthelloRenderer.js';
import {
    gameRankingManager,
    OTHELLO_RANK_TIERS
} from '../../ranking/GameRankingManager.js';
import { ensureCategory } from '../guildUtils.js';
import { database } from '../../persistence/Database.js';
import { Logger } from '../../../utils/Logger.js';
import { randomInt } from 'node:crypto';

type OthelloMode = 'bot' | 'ranked';
type OthelloStatus = 'waiting' | 'active' | 'completed' | 'closed';

interface OthelloSession {
    id: string;
    guildId: string;
    channelId: string;
    categoryId: string;
    messageId: string | null;
    hostId: string;
    opponentId: string | null;
    mode: OthelloMode;
    difficulty: OthelloDifficulty | null;
    board: OthelloBoard;
    boardHistory: OthelloBoard[];
    turn: OthelloDisc;
    blackId: string;
    whiteId: string;
    status: OthelloStatus;
    lastMove: number | null;
    resultRecorded: boolean;
    turnNumber: number;
    createdAt: string;
    updatedAt: string;
    deleteAt?: number;
    winner?: OthelloDisc | null;
    finishReason?: string;
}

const BOT_PLAYER_ID = 'othello-bot';
const SESSION_TTL_MS = 60 * 60 * 1000;
const MATCHING_TTL_MS = 5 * 60 * 1000;
const COMPLETED_CHANNEL_DELETE_DELAY_MS = 5 * 60 * 1000;
const OTHELLO_CATEGORY_NAME = 'オセロ対戦';

export class OthelloFeature implements CoreFeatureModule {
    readonly key = 'othello';
    readonly order = 30;
    readonly label = 'オセロ';
    readonly description = 'Easy・Normal・HardのBot戦と、人間同士のランクマッチを遊べます。';
    readonly category = 'game' as const;
    readonly emoji = '⚫';
    readonly color = 0x1b9b67;

    private readonly sessions = new Map<string, OthelloSession>();
    private readonly waitingByGuild = new Map<string, string>();
    private readonly activeByUser = new Map<string, string>();
    private readonly operationQueues = new Map<string, Promise<void>>();
    private readonly processingInteractions = new Set<string>();
    private maintenanceTimer?: ReturnType<typeof setInterval>;
    private maintenanceRunning = false;
    private ready: Promise<void> = Promise.resolve();

    setClient(client: Client): void {
        const start = () => {
            this.ready = this.restoreSessions(client);
            void this.ready.catch((error) => Logger.error('Othello recovery failed:', error));
            if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
            this.maintenanceTimer = setInterval(() => {
                void this.ready.then(() => this.maintainSessions(client)).catch((error) => Logger.error('Othello cleanup failed:', error));
            }, 30_000);
            this.maintenanceTimer.unref?.();
        };
        if (client.isReady()) start();
        else client.once(Events.ClientReady, start);
    }

    buildPanelButton(guildId: string, panelKind: CoreFeaturePanelKind): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(`corefeature:${guildId}:${panelKind}:${this.key}:entry`)
            .setLabel('オセロ')
            .setEmoji('⚫')
            .setStyle(ButtonStyle.Success);
    }

    async handleButtonInteraction(
        interaction: ButtonInteraction,
        panelKind: CoreFeaturePanelKind,
        action: string,
        parts: string[]
    ): Promise<boolean> {
        if (!interaction.guild) {
            return false;
        }
        await this.ready;

        if (action === 'entry') {
            await interaction.reply({
                content: '対戦形式を選択してください。Bot戦は練習用、ランクマッチは人間同士でレーティングが変動します。',
                components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`corefeature:${interaction.guild.id}:${panelKind}:othello:mode:bot`)
                        .setLabel('Bot戦')
                        .setEmoji('🤖')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`corefeature:${interaction.guild.id}:${panelKind}:othello:mode:ranked`)
                        .setLabel('ランクマッチ')
                        .setEmoji('🏆')
                        .setStyle(ButtonStyle.Success)
                )],
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (action === 'mode') {
            const mode = parts[0] as OthelloMode;
            if (mode === 'bot') {
                await interaction.update({
                    content: 'Botの難易度を選択してください。',
                    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                        this.difficultyButton(interaction.guild.id, panelKind, 'easy', 'Easy', ButtonStyle.Success),
                        this.difficultyButton(interaction.guild.id, panelKind, 'normal', 'Normal', ButtonStyle.Primary),
                        this.difficultyButton(interaction.guild.id, panelKind, 'hard', 'Hard', ButtonStyle.Danger)
                    )]
                });
                return true;
            }

            if (mode === 'ranked') {
                await this.withInteractionGuard(interaction, () =>
                    this.withSessionLock(`matching:${interaction.guild!.id}`, () => this.joinRankedQueue(interaction))
                );
                return true;
            }

            return false;
        }

        if (action === 'difficulty') {
            const difficulty = parts[0] as OthelloDifficulty;
            if (!['easy', 'normal', 'hard'].includes(difficulty)) {
                throw new Error('不明な難易度です。');
            }
            await this.withInteractionGuard(interaction, async () => {
                const userKey = this.userSessionKey(interaction.guild!.id, interaction.user.id);
                const existingSessionId = this.activeByUser.get(userKey);
                const existingSession = existingSessionId ? this.sessions.get(existingSessionId) : null;
                if (existingSession && ['waiting', 'active'].includes(existingSession.status)) {
                    await interaction.update({
                        content: `すでに進行中または待機中の対戦があります: <#${existingSession.channelId}>`,
                        components: []
                    });
                    return;
                }

                await interaction.deferUpdate();
                const session = await this.createSession(interaction.guild!, interaction.user.id, 'bot', difficulty);
                await interaction.editReply({
                    content: `✅ ${difficulty.toUpperCase()} のオセロ部屋を作成しました: <#${session.channelId}>`,
                    components: []
                });
            });
            return true;
        }

        if (action === 'move') {
            const sessionId = parts[0];
            const index = Number(parts[1]);
            await this.withInteractionGuard(interaction, () =>
                this.withSessionLock(sessionId, () => this.playMove(interaction, sessionId, index, Number(parts[2])))
            );
            return true;
        }

        if (action === 'leave') {
            const sessionId = parts[0];
            await this.withInteractionGuard(interaction, () =>
                this.withSessionLock(`matching:${interaction.guild!.id}`, () =>
                    this.leaveRankedQueue(interaction, sessionId)
                )
            );
            return true;
        }

        if (action === 'close' || action === 'resign') {
            const sessionId = parts[0];
            await this.withInteractionGuard(interaction, () =>
                this.withSessionLock(sessionId, async () => {
                    const session = this.sessions.get(sessionId);
                    if (!session || session.guildId !== interaction.guildId || session.channelId !== interaction.channelId || ![session.hostId, session.opponentId].includes(interaction.user.id)) {
                        throw new Error('この対戦を終了する権限がありません。');
                    }
                    if (session.status !== 'active') {
                        await interaction.reply({
                            content: 'この対戦はすでに終了しています。',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    if (action === 'close') {
                        await interaction.reply({
                            content: '投了するとあなたの負けになります。ランクマッチではレートも変動します。投了しますか？',
                            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
                                .setCustomId(`corefeature:${session.guildId}:othello:othello:resign:${session.id}:${interaction.user.id}`)
                                .setLabel('負けを認めて投了する').setStyle(ButtonStyle.Danger))],
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    if (parts[1] !== interaction.user.id) throw new Error('本人だけが投了を確定できます。');
                    await interaction.deferUpdate();
                    await this.finishSession(interaction.channel as TextChannel, session,
                        interaction.user.id === session.blackId ? 'white' : 'black', '投了');
                    await interaction.editReply({ content: '投了しました。結果を対戦チャンネルに表示しました。', components: [] });
                })
            );
            return true;
        }

        return false;
    }

    async closeSessions(guild: Guild, options: { channelId?: string; reason: string }) {
        await this.ready;
        const results: Array<{ sessionId: string; channelId: string; summary: string }> = [];
        for (const session of this.sessions.values()) {
            await this.withSessionLock(`matching:${guild.id}`, () => this.withSessionLock(session.id, async () => {
                if (session.guildId !== guild.id || !['active', 'waiting'].includes(session.status)) {
                    return;
                }
                if (options.channelId && session.channelId !== options.channelId) {
                    return;
                }
                session.status = 'closed';
                session.updatedAt = new Date().toISOString();
                this.releaseSession(session);
                this.markForCleanup(session);
                await this.persistSessions(guild.id);
                const channel = await guild.channels.fetch(session.channelId).catch(() => null);
                if (channel?.type === ChannelType.GuildText) {
                    await this.updateBoardMessage(channel, session, {
                        content: 'この対戦は管理操作により終了しました。',
                        title: '対戦終了',
                        description: options.reason,
                        color: 0x8c9a94,
                        controls: false
                    }).catch(() => undefined);
                }
                results.push({
                    sessionId: session.id,
                    channelId: session.channelId,
                    summary: `オセロ対戦 ${session.id} (<#${session.channelId}>)`
                });
            }));
        }
        return results.map((entry) => ({ featureKey: this.key, ...entry }));
    }

    async handleSelectMenuInteraction(interaction: StringSelectMenuInteraction, _panelKind: CoreFeaturePanelKind, action: string, parts: string[]): Promise<boolean> {
        if (action !== 'choose' || !interaction.guild) return false;
        await this.ready;
        await this.withInteractionGuard(interaction, () => this.withSessionLock(parts[0], () =>
            this.playMove(interaction, parts[0], Number(interaction.values[0]), Number(parts[1]))));
        return true;
    }

    async resetUserData(guild: Guild, userId: string) {
        const reset = await gameRankingManager.resetUser(guild.id, 'othello', userId);
        return reset
            ? { featureKey: this.key, summary: `<@${userId}> のオセロランクをリセットしました。` }
            : null;
    }

    private difficultyButton(
        guildId: string,
        panelKind: CoreFeaturePanelKind,
        difficulty: OthelloDifficulty,
        label: string,
        style: ButtonStyle
    ): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(`corefeature:${guildId}:${panelKind}:othello:difficulty:${difficulty}`)
            .setLabel(label)
            .setStyle(style);
    }

    private async joinRankedQueue(interaction: ButtonInteraction): Promise<void> {
        const userKey = this.userSessionKey(interaction.guild!.id, interaction.user.id);
        const existingSessionId = this.activeByUser.get(userKey);
        const existingSession = existingSessionId ? this.sessions.get(existingSessionId) : null;
        if (existingSession && ['waiting', 'active'].includes(existingSession.status)) {
            await interaction.update({
                content: `すでに進行中の対戦があります: <#${existingSession.channelId}>`,
                components: []
            });
            return;
        }
        const waitingId = this.waitingByGuild.get(interaction.guild!.id);
        const waiting = waitingId ? this.sessions.get(waitingId) : null;

        if (waiting && waiting.hostId !== interaction.user.id && waiting.status === 'waiting') {
            await interaction.deferUpdate();
            waiting.opponentId = interaction.user.id;
            const hostIsBlack = randomInt(2) === 0;
            waiting.blackId = hostIsBlack ? waiting.hostId : interaction.user.id;
            waiting.whiteId = hostIsBlack ? interaction.user.id : waiting.hostId;
            waiting.status = 'active';
            waiting.updatedAt = new Date().toISOString();
            this.waitingByGuild.delete(interaction.guild!.id);
            this.activeByUser.set(userKey, waiting.id);
            await this.persistSessions(waiting.guildId);
            try {
                await this.activateRankedSession(interaction.guild!, waiting);
            } catch (error) {
                waiting.status = 'closed';
                this.releaseSession(waiting);
                this.markForCleanup(waiting);
                await this.persistSessions(waiting.guildId);
                throw error;
            }
            await interaction.editReply({
                content: `✅ マッチングしました: <@${waiting.hostId}> vs <@${interaction.user.id}>\n対戦会場: <#${waiting.channelId}>`,
                components: []
            });
            return;
        }

        if (waiting?.hostId === interaction.user.id) {
            await interaction.update({
                content: 'すでにランクマッチの相手を待っています。',
                components: []
            });
            return;
        }

        await interaction.deferUpdate();
        const session = await this.createSession(interaction.guild!, interaction.user.id, 'ranked', null, true);
        this.waitingByGuild.set(interaction.guild!.id, session.id);
        await interaction.editReply({
            content: `🔎 対戦相手を待っています: <#${session.channelId}>\n他のプレイヤーがCoreパネルから「ランクマッチ」を選ぶと開始します。\n5分間マッチングしない場合は自動的に停止します。`,
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`corefeature:${interaction.guild!.id}:othello:othello:leave:${session.id}`)
                    .setLabel('マッチングから退出')
                    .setStyle(ButtonStyle.Danger)
            )]
        });
    }

    private async leaveRankedQueue(interaction: ButtonInteraction, sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session || session.status !== 'waiting') {
            await interaction.reply({
                content: 'このマッチング待機はすでに終了しています。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        if (session.hostId !== interaction.user.id) {
            await interaction.reply({
                content: 'このマッチング待機から退出できるのは募集した本人だけです。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        session.status = 'closed';
        session.updatedAt = new Date().toISOString();
        this.releaseSession(session);
        this.markForCleanup(session, 0);
        await this.persistSessions(session.guildId);
        await interaction.update({
            content: 'マッチングから退出しました。オセロ対戦チャンネルを削除します。',
            components: []
        });

        await this.cleanupSession(interaction.guild!, session);
    }

    private async createSession(
        guild: Guild,
        hostId: string,
        mode: OthelloMode,
        difficulty: OthelloDifficulty | null,
        waiting = false
    ): Promise<OthelloSession> {
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
        const category = await ensureCategory(guild, OTHELLO_CATEGORY_NAME);
        const initialBoard = createInitialBoard();
        const channel = await guild.channels.create({
            name: `othello-${id.slice(-6)}`,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                {
                    id: hostId,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                },
                {
                    id: guild.members.me?.id || guild.client.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ManageMessages,
                        PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                }
            ]
        });

        const now = new Date().toISOString();
        const session: OthelloSession = {
            id,
            guildId: guild.id,
            channelId: channel.id,
            categoryId: category.id,
            messageId: null,
            hostId,
            opponentId: mode === 'bot' ? BOT_PLAYER_ID : null,
            mode,
            difficulty,
            board: initialBoard,
            boardHistory: [initialBoard.slice()],
            turn: 'black',
            blackId: hostId,
            whiteId: mode === 'bot' ? BOT_PLAYER_ID : '',
            status: waiting ? 'waiting' : 'active',
            lastMove: null,
            resultRecorded: false,
            turnNumber: 1,
            createdAt: now,
            updatedAt: now
        };

        this.sessions.set(id, session);
        this.activeByUser.set(this.userSessionKey(guild.id, hostId), id);
        try {
            await this.persistSessions(guild.id);
            if (waiting) {
                const waitingMessage = await channel.send({
                    embeds: [new EmbedBuilder()
                        .setColor(0x1b9b67)
                        .setTitle('🏆 オセロ ランクマッチ')
                        .setDescription(`<@${hostId}> が対戦相手を待っています。\nCoreパネルからランクマッチへ参加してください。\n\n待機時間は5分です。`)
                        .setTimestamp()],
                    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`corefeature:${guild.id}:othello:othello:leave:${id}`)
                            .setLabel('マッチングから退出')
                            .setStyle(ButtonStyle.Danger)
                    )]
                });
                session.messageId = waitingMessage.id;

            } else {
                await this.publishBoard(channel, session);
            }

            await this.persistSessions(guild.id);
        } catch (error) {
            session.status = 'closed';
            this.releaseSession(session);
            this.markForCleanup(session, 0);
            await this.persistSessions(guild.id);
            await this.cleanupSession(guild, session);
            throw error;
        }
        return session;
    }

    private async activateRankedSession(guild: Guild, session: OthelloSession): Promise<void> {
        const channel = await guild.channels.fetch(session.channelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText || !session.opponentId) {
            throw new Error('オセロ部屋を開始できませんでした。');
        }

        await channel.permissionOverwrites.edit(session.opponentId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
        });

        if (session.messageId) {
            const waitingMessage = await channel.messages.fetch(session.messageId).catch(() => null);
            if (waitingMessage) {
                await waitingMessage.edit({
                    content: `🏆 <@${session.blackId}> vs <@${session.whiteId}>\nマッチング成立。対戦を開始します！`,
                    embeds: [],
                    components: [],
                    files: []
                });
            }
        }

        await this.publishBoard(channel, session);
    }

    private async playMove(interaction: ButtonInteraction | StringSelectMenuInteraction, sessionId: string, index: number, turnNumber: number): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session || session.status !== 'active') {
            throw new Error('この対戦は終了しているか、見つかりません。');
        }

        if (session.guildId !== interaction.guildId || session.channelId !== interaction.channelId) throw new Error('この対戦のチャンネルではありません。');
        if (turnNumber !== session.turnNumber) throw new Error('古い盤面の操作です。最新の盤面から選び直してください。');
        if (!getValidMoves(session.board, session.turn).some((move) => move.index === index)) throw new Error('そのマスには置けません。');

        const expectedUserId = session.turn === 'black' ? session.blackId : session.whiteId;
        if (expectedUserId !== interaction.user.id) {
            throw new Error('現在はあなたのターンではありません。');
        }

        if (!Number.isInteger(index) || index < 0 || index >= 64) {
            throw new Error('盤面番号が不正です。');
        }

        await interaction.deferUpdate();
        session.board = applyMove(session.board, index, session.turn);
        session.boardHistory.push(session.board.slice());
        session.lastMove = index;
        session.turnNumber += 1;
        session.turn = opponentOf(session.turn);
        session.updatedAt = new Date().toISOString();

        this.advancePasses(session);

        if (isGameOver(session.board)) {
            await this.finishSession(interaction.channel as TextChannel, session);
            return;
        }

        while (session.mode === 'bot' && session.turn === 'white' && !isGameOver(session.board)) {
            const botMove = chooseBotMove(session.board, 'white', session.difficulty || 'normal');
            if (botMove) {
                session.board = applyMove(session.board, botMove.index, 'white');
                session.boardHistory.push(session.board.slice());
                session.lastMove = botMove.index;
                session.turnNumber += 1;
            }
            session.turn = 'black';
            this.advancePasses(session);
        }

        if (isGameOver(session.board)) {
            await this.finishSession(interaction.channel as TextChannel, session);
            return;
        }

        await this.persistSessions(session.guildId);
        await this.publishBoard(interaction.channel as TextChannel, session);
    }

    private advancePasses(session: OthelloSession): void {
        if (getValidMoves(session.board, session.turn).length === 0) {
            session.turn = opponentOf(session.turn);
        }
    }

    private async finishSession(channel: TextChannel, session: OthelloSession, winnerOverride?: OthelloDisc, reason = '終局'): Promise<void> {
        session.status = 'completed';
        session.updatedAt = new Date().toISOString();
        this.releaseSession(session);
        const counts = countDiscs(session.board);
        this.markForCleanup(session);
        const winner = winnerOverride ?? (counts.black === counts.white ? null : counts.black > counts.white ? 'black' : 'white');
        session.winner = winner;
        session.finishReason = reason;
        await this.persistSessions(session.guildId);
        let rankingText = '';

        if (session.mode === 'ranked' && session.opponentId && !session.resultRecorded) {
            const result = await gameRankingManager.recordResult({
                guildId: session.guildId,
                gameKey: 'othello',
                playerA: session.blackId,
                playerB: session.whiteId,
                result: winner === null ? 'draw' : winner === 'black' ? 'playerA' : 'playerB',
                ranked: true,
                tiers: OTHELLO_RANK_TIERS,
                matchId: session.id
            });
            session.resultRecorded = true;
            await this.persistSessions(session.guildId);
            const leaderboard = await gameRankingManager.getLeaderboard(session.guildId, 'othello');
            const blackEntry = leaderboard.find((profile) => profile.userId === session.blackId);
            const whiteEntry = leaderboard.find((profile) => profile.userId === session.whiteId);
            rankingText = [
                '',
                '**レーティング変動**',
                `⚫ <@${session.blackId}>: Rate ${result.playerA.rating} (${formatDelta(result.playerADelta)}) / ${blackEntry?.tier.label || 'D'}帯${blackEntry ? ` / Rank #${blackEntry.position}` : ''}`,
                `⚪ <@${session.whiteId}>: Rate ${result.playerB.rating} (${formatDelta(result.playerBDelta)}) / ${whiteEntry?.tier.label || 'D'}帯${whiteEntry ? ` / Rank #${whiteEntry.position}` : ''}`
            ].join('\n');
        }

        const image = renderOthelloBoard(session.board, session.turn, session.lastMove);
        const replay = renderOthelloReplay(session.boardHistory, session.turn, session.lastMove);
        await this.updateBoardMessage(channel, session, {
            content: '対戦が終了しました。結果PNGと対局リプレイGIFをダウンロードできます。\nこのチャンネルは約5分後に自動削除されます。',
            title: winner ? `${winner === 'black' ? '黒' : '白'}の勝利` : '引き分け',
            description: `**${reason} — ${winner ? (winner === 'black' ? '黒' : '白') + 'の勝利' : '引き分け'}**\n⚫ 黒 ${counts.black} - ${counts.white} 白 ⚪\n全 ${session.turnNumber - 1} 手${rankingText}`,
            color: winner === 'black' ? 0x202421 : winner === 'white' ? 0xe8eeeb : 0x8c9a94,
            controls: false,
            image,
            imageName: 'othello-result.png',
            extraFiles: [new AttachmentBuilder(replay, { name: 'othello-replay.gif' })]
        });

    }

    private async publishBoard(channel: TextChannel, session: OthelloSession): Promise<void> {
        const image = renderOthelloBoard(session.board, session.turn, session.lastMove);
        const currentPlayer = session.turn === 'black' ? session.blackId : session.whiteId;
        const validMoves = new Set(getValidMoves(session.board, session.turn).map((move) => move.index));
        const playerSummary = await this.buildPlayerSummary(session);

        const payload = {
            content: [
                playerSummary,
                `**ターン ${session.turnNumber}** — ${session.turn === 'black' ? '⚫ 黒' : '⚪ 白'}`,
                currentPlayer === BOT_PLAYER_ID ? '🤖 Botが思考中です。' : `<@${currentPlayer}> のターンです。`,
                '画像と同じ番号のボタンを選んでください。置ける番号だけ有効です。'
            ].join('\n'),
            files: [new AttachmentBuilder(image, { name: 'othello-board.png' })],
            attachments: [],
            embeds: [],
            components: this.buildBoardControls(session, validMoves)
        };

        if (session.messageId) {
            const message = await channel.messages.fetch(session.messageId).catch(() => null);
            if (message) {
                await message.edit(payload);
                return;
            }
        }

        const message = await channel.send(payload);
        session.messageId = message.id;
        await this.persistSessions(session.guildId);
    }

    private async buildPlayerSummary(session: OthelloSession): Promise<string> {
        if (session.mode === 'bot') {
            return [
                `⚫ **黒**: <@${session.blackId}>（あなた）`,
                `⚪ **白**: 🤖 Bot（${session.difficulty?.toUpperCase() || 'NORMAL'}）`
            ].join('\n');
        }

        const [blackProfile, whiteProfile, leaderboard] = await Promise.all([
            gameRankingManager.getProfile(session.guildId, 'othello', session.blackId),
            gameRankingManager.getProfile(session.guildId, 'othello', session.whiteId),
            gameRankingManager.getLeaderboard(session.guildId, 'othello')
        ]);
        const blackPosition = leaderboard.find((profile) => profile.userId === session.blackId)?.position;
        const whitePosition = leaderboard.find((profile) => profile.userId === session.whiteId)?.position;
        const blackTier = gameRankingManager.getTier(OTHELLO_RANK_TIERS, blackProfile.rating);
        const whiteTier = gameRankingManager.getTier(OTHELLO_RANK_TIERS, whiteProfile.rating);

        return [
            `⚫ **黒**: <@${session.blackId}> — Rate ${blackProfile.rating} / ${blackTier.label}帯${blackPosition ? ` / Rank #${blackPosition}` : ' / 未ランク'}`,
            `⚪ **白**: <@${session.whiteId}> — Rate ${whiteProfile.rating} / ${whiteTier.label}帯${whitePosition ? ` / Rank #${whitePosition}` : ' / 未ランク'}`
        ].join('\n');
    }

    private buildBoardControls(
        session: OthelloSession,
        validMoves: Set<number>
    ): Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> {
        const moves = [...validMoves].sort((left, right) => left - right);
        const visible = moves.length > 20 ? [] : moves;
        const rows: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [];
        if (moves.length > 20) {
            for (let offset = 0; offset < moves.length; offset += 25) {
                rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
                    .setCustomId(`corefeature:${session.guildId}:othello:othello:choose:${session.id}:${session.turnNumber}:${offset}`)
                    .setPlaceholder(`置くマスを選択 (${offset + 1}〜${Math.min(offset + 25, moves.length)})`)
                    .addOptions(moves.slice(offset, offset + 25).map((index) => ({ label: String(index + 1), value: String(index) })))));
            }
        }

        for (let start = 0; start < visible.length; start += 5) {
            const row = new ActionRowBuilder<ButtonBuilder>();
            for (const index of visible.slice(start, start + 5)) {
                row.addComponents(new ButtonBuilder()
                    .setCustomId(`corefeature:${session.guildId}:othello:othello:move:${session.id}:${index}:${session.turnNumber}`)
                    .setLabel(String(index + 1))
                    .setStyle(ButtonStyle.Success));
            }
            rows.push(row);
        }

        if (rows.length < 5) {
            rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`corefeature:${session.guildId}:othello:othello:close:${session.id}`)
                    .setLabel('投了（自分の負け）')
                    .setStyle(ButtonStyle.Danger)
            ));
        }

        return rows.slice(0, 5);
    }

    private async updateBoardMessage(
        channel: TextChannel,
        session: OthelloSession,
        options: {
            content: string;
            title: string;
            description: string;
            color: number;
            controls: boolean;
            image?: Buffer;
            imageName?: string;
            extraFiles?: AttachmentBuilder[];
        }
    ): Promise<void> {
        const image = options.image || renderOthelloBoard(session.board, session.turn, session.lastMove);
        const imageName = options.imageName || 'othello-board.png';
        const payload = {
            content: `${options.content}\n${options.description}`,
            files: [
                new AttachmentBuilder(image, { name: imageName }),
                ...(options.extraFiles || [])
            ],
            attachments: [],
            embeds: [],
            components: options.controls
                ? this.buildBoardControls(
                    session,
                    new Set(getValidMoves(session.board, session.turn).map((move) => move.index))
                )
                : []
        };

        if (session.messageId) {
            const message = await channel.messages.fetch(session.messageId).catch(() => null);
            if (message) {
                await message.edit(payload);
                return;
            }
        }

        const message = await channel.send(payload);
        session.messageId = message.id;
    }

    private releaseSession(session: OthelloSession): void {
        if (this.waitingByGuild.get(session.guildId) === session.id) {
            this.waitingByGuild.delete(session.guildId);
        }
        for (const userId of [session.hostId, session.opponentId]) {
            if (!userId || userId === BOT_PLAYER_ID) continue;
            const key = this.userSessionKey(session.guildId, userId);
            if (this.activeByUser.get(key) === session.id) {
                this.activeByUser.delete(key);
            }
        }
    }

    private markForCleanup(session: OthelloSession, delay = COMPLETED_CHANNEL_DELETE_DELAY_MS): void {
        session.deleteAt = Date.now() + delay;
    }

    private async persistSessions(guildId: string): Promise<void> {
        await this.withSessionLock(`storage:${guildId}`, async () => {
            const snapshot = [...this.sessions.values()].filter((session) => session.guildId === guildId);
            await database.set(guildId, `Guild/${guildId}/corefeature/othello/sessions`, structuredClone(snapshot));
        });
    }

    private async restoreSessions(client: Client): Promise<void> {
        for (const guild of client.guilds.cache.values()) {
            const stored = await database.get<OthelloSession[]>(guild.id, `Guild/${guild.id}/corefeature/othello/sessions`, []);
            for (const session of Array.isArray(stored) ? stored : []) {
                if (session.guildId !== guild.id || !session.id || !session.channelId || session.board?.length !== 64) continue;
                this.sessions.set(session.id, session);
                if (session.status === 'active' || session.status === 'waiting') {
                    for (const userId of [session.hostId, session.opponentId]) {
                        if (userId && userId !== BOT_PLAYER_ID) this.activeByUser.set(this.userSessionKey(guild.id, userId), session.id);
                    }
                    if (session.status === 'waiting') this.waitingByGuild.set(guild.id, session.id);
                } else if (!session.deleteAt) this.markForCleanup(session);
            }
        }
        await this.maintainSessions(client);
    }

    private async cleanupSession(guild: Guild, session: OthelloSession): Promise<void> {
        try {
            const channel = await guild.channels.fetch(session.channelId);
            if (channel) await channel.delete('オセロの終了済みルームを清掃');
        } catch (error) {
            if ((error as { code?: number }).code !== 10003) {
                Logger.warn(`Othello room cleanup will retry: ${session.channelId}`, error);
                return;
            }
        }
        this.releaseSession(session);
        this.sessions.delete(session.id);
        await this.persistSessions(guild.id);
    }

    private async maintainSessions(client: Client): Promise<void> {
        if (this.maintenanceRunning) return;
        this.maintenanceRunning = true;
        try { await this.runMaintenance(client); }
        finally { this.maintenanceRunning = false; }
    }

    private async runMaintenance(client: Client): Promise<void> {
        for (const session of [...this.sessions.values()]) {
            try {
                await this.withSessionLock(`matching:${session.guildId}`, () => this.withSessionLock(session.id, async () => {
                    if (!this.sessions.has(session.id)) return;
                    const guild = client.guilds.cache.get(session.guildId);
                    if (!guild) return;
                    if (session.status === 'completed' && session.mode === 'ranked' && !session.resultRecorded && session.winner !== undefined) {
                        await gameRankingManager.recordResult({
                            guildId: session.guildId, gameKey: 'othello', playerA: session.blackId, playerB: session.whiteId,
                            result: session.winner === null ? 'draw' : session.winner === 'black' ? 'playerA' : 'playerB',
                            matchId: session.id, ranked: true, tiers: OTHELLO_RANK_TIERS
                        });
                        session.resultRecorded = true;
                        await this.persistSessions(session.guildId);
                    }
                    if (session.status === 'active' || session.status === 'waiting') {
                        const ttl = session.status === 'waiting' ? MATCHING_TTL_MS : SESSION_TTL_MS;
                        if (Date.now() - Date.parse(session.updatedAt) < ttl) return;
                        const channel = await guild.channels.fetch(session.channelId);
                        if (session.status === 'active' && channel?.type === ChannelType.GuildText) {
                            // 放置でレート変動を回避できないよう、手番側の時間切れ負けとする。
                            await this.finishSession(channel, session, opponentOf(session.turn), '1時間無操作による時間切れ');
                        } else {
                            session.status = 'closed';
                            this.releaseSession(session);
                            this.markForCleanup(session, 0);
                            await this.persistSessions(session.guildId);
                        }
                    }
                    if (session.deleteAt !== undefined && session.deleteAt <= Date.now()) await this.cleanupSession(guild, session);
                }));
            } catch (error) {
                if ((error as { code?: number }).code === 10003) await this.cleanupSession(client.guilds.cache.get(session.guildId)!, session);
                else Logger.warn(`Othello maintenance will retry: ${session.id}`, error);
            }
        }
    }

    private userSessionKey(guildId: string, userId: string): string {
        return `${guildId}:${userId}`;
    }

    private async withSessionLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.operationQueues.get(sessionId) || Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.then(() => current);
        this.operationQueues.set(sessionId, queued);
        await previous;
        try {
            return await operation();
        } finally {
            release();
            if (this.operationQueues.get(sessionId) === queued) {
                this.operationQueues.delete(sessionId);
            }
        }
    }

    private async withInteractionGuard(
        interaction: ButtonInteraction | StringSelectMenuInteraction,
        operation: () => Promise<void>
    ): Promise<void> {
        const key = `${interaction.guildId}:${interaction.user.id}`;
        if (this.processingInteractions.has(key)) {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '処理中です。ボタンを連打せず、そのままお待ちください。',
                    flags: MessageFlags.Ephemeral
                }).catch(() => undefined);
            }
            return;
        }

        this.processingInteractions.add(key);
        try {
            await operation();
        } finally {
            this.processingInteractions.delete(key);
        }
    }
}

function formatDelta(value: number): string {
    return value >= 0 ? `+${value}` : String(value);
}
