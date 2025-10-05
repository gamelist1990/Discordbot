import {
    User,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    TextChannel,
    Client,
    Message,
    Interaction,
    AttachmentBuilder,
    ButtonInteraction
} from "discord.js";
import sharp from 'sharp';
import { PREFIX, registerCommand } from "../../..";
import { Command } from "../../../types/command";



//AIアルゴリズム (Gemini)

const BOARD_SIZE = 3;
const IMG_BOARD_PX = 240;
const IMG_CELL_PX = IMG_BOARD_PX / BOARD_SIZE;
const IMG_MARK_MARGIN_RATIO = 0.15;
const IMG_MARK_SIZE_PX = IMG_CELL_PX * (1 - IMG_MARK_MARGIN_RATIO * 2);
const IMG_BOARD_COLOR = '#DDDDDD';
const IMG_LINE_COLOR = '#333333';
const IMG_X_COLOR = '#FF0000';
const IMG_O_COLOR = '#0000FF';
const IMG_X_WIDTH = IMG_MARK_SIZE_PX * 0.15;
const IMG_O_WIDTH = IMG_MARK_SIZE_PX * 0.15;

const EMOJI_X = '❌';
const EMOJI_O = '⭕';
const EMOJI_EMPTY = '➖';

enum CellState { Empty = 0, X = 1, O = 2 }
type AIDifficulty = 'easy' | 'hard' | 'god';
interface Position { row: number; col: number; }

interface oxgameGameState {
    board: CellState[][];
    currentPlayer: CellState.X | CellState.O;
    playerX: User;
    playerO: User | 'AI';
    gameOver: boolean;
    winner: CellState.X | CellState.O | 'Draw' | null;
    channelId: string;
    messageId?: string;
    isAIGame: boolean;
    aiDifficulty?: AIDifficulty;
    aiPlayer?: CellState.X | CellState.O;
}

const ongoingoxgameGames = new Map<string, oxgameGameState>();

function isOnBoard(row: number, col: number): boolean {
    return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function checkWinner(board: CellState[][]): CellState.X | CellState.O | 'Draw' | null {
    for (let r = 0; r < BOARD_SIZE; r++) {
        if (board[r][0] !== CellState.Empty && board[r][0] === board[r][1] && board[r][0] === board[r][2]) {
            return board[r][0] === CellState.X ? CellState.X : CellState.O;
        }
    }
    for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[0][c] !== CellState.Empty && board[0][c] === board[1][c] && board[0][c] === board[2][c]) {
            return board[0][c] === CellState.X ? CellState.X : CellState.O;
        }
    }
    if (board[0][0] !== CellState.Empty && board[0][0] === board[1][1] && board[0][0] === board[2][2]) {
        return board[0][0];
    }
    if (board[0][2] !== CellState.Empty && board[0][2] === board[1][1] && board[0][2] === board[2][0]) {
        return board[0][2];
    }
    if (board.flat().every(cell => cell !== CellState.Empty)) {
        return 'Draw';
    }
    return null;
}

function getEmptyCells(board: CellState[][]): Position[] {
    const emptyCells: Position[] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (board[r][c] === CellState.Empty) {
                emptyCells.push({ row: r, col: c });
            }
        }
    }
    return emptyCells;
}

async function createBoardImage(board: CellState[][]): Promise<Buffer> {
    try {
        let svg = `<svg width="${IMG_BOARD_PX}" height="${IMG_BOARD_PX}" xmlns="http://www.w3.org/2000/svg">`;
        svg += `<rect width="100%" height="100%" fill="${IMG_BOARD_COLOR}"/>`;
        for (let i = 1; i < BOARD_SIZE; i++) {
            svg += `<line x1="${i * IMG_CELL_PX}" y1="0" x2="${i * IMG_CELL_PX}" y2="${IMG_BOARD_PX}" stroke="${IMG_LINE_COLOR}" stroke-width="2"/>`;
            svg += `<line x1="0" y1="${i * IMG_CELL_PX}" x2="${IMG_BOARD_PX}" y2="${i * IMG_CELL_PX}" stroke="${IMG_LINE_COLOR}" stroke-width="2"/>`;
        }
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const cellX = c * IMG_CELL_PX;
                const cellY = r * IMG_CELL_PX;
                const markX = cellX + IMG_CELL_PX * IMG_MARK_MARGIN_RATIO;
                const markY = cellY + IMG_CELL_PX * IMG_MARK_MARGIN_RATIO;
                const markEndX = cellX + IMG_CELL_PX * (1 - IMG_MARK_MARGIN_RATIO);
                const markEndY = cellY + IMG_CELL_PX * (1 - IMG_MARK_MARGIN_RATIO);
                const centerX = cellX + IMG_CELL_PX / 2;
                const centerY = cellY + IMG_CELL_PX / 2;
                const radius = IMG_MARK_SIZE_PX / 2;
                if (board[r][c] === CellState.X) {
                    svg += `<line x1="${markX}" y1="${markY}" x2="${markEndX}" y2="${markEndY}" stroke="${IMG_X_COLOR}" stroke-width="${IMG_X_WIDTH}" stroke-linecap="round"/>`;
                    svg += `<line x1="${markX}" y1="${markEndY}" x2="${markEndX}" y2="${markY}" stroke="${IMG_X_COLOR}" stroke-width="${IMG_X_WIDTH}" stroke-linecap="round"/>`;
                } else if (board[r][c] === CellState.O) {
                    svg += `<circle cx="${centerX}" cy="${centerY}" r="${radius}" stroke="${IMG_O_COLOR}" stroke-width="${IMG_O_WIDTH}" fill="none"/>`;
                }
            }
        }
        svg += `</svg>`;
        return await sharp(Buffer.from(svg)).png().toBuffer();
    } catch (error) {
        console.error("Error creating board image:", error);
        const errorSvg = `<svg width="150" height="30"><text x="5" y="20" font-size="12" fill="red">Board Image Error</text></svg>`;
        return await sharp(Buffer.from(errorSvg)).png().toBuffer();
    }
}

function createGameEmbed(gameState: oxgameGameState): EmbedBuilder {
    const embed = new EmbedBuilder();
    const { playerX, playerO, currentPlayer, gameOver, winner, aiDifficulty } = gameState;
    const playerOName = playerO === 'AI' ? `AI (${aiDifficulty ?? 'N/A'})` : playerO.username;
    embed.setTitle(`${EMOJI_X} OX Game ${EMOJI_O}`);
    embed.setColor(gameOver ? 0xAAAAAA : (currentPlayer === CellState.X ? 0xFF0000 : 0x0000FF));
    let description = `${EMOJI_X} ${playerX.username} vs ${EMOJI_O} ${playerOName}\n\n`;
    if (gameOver) {
        if (winner === 'Draw') {
            description += '**引き分け！**';
        } else {
            const winnerEmoji = winner === CellState.X ? EMOJI_X : EMOJI_O;
            const winnerName = winner === CellState.X ? playerX.username : playerOName;
            description += `**${winnerEmoji} ${winnerName} の勝ち！**`;
        }
        embed.setFooter({ text: "ゲーム終了" });
    } else {
        const currentPlayerUser = currentPlayer === CellState.X ? playerX : playerO;
        const currentPlayerName = currentPlayerUser === 'AI' ? `AI (${aiDifficulty ?? 'N/A'})` : currentPlayerUser.username;
        const currentPlayerEmoji = currentPlayer === CellState.X ? EMOJI_X : EMOJI_O;
        description += `次は ${currentPlayerEmoji} **${currentPlayerName}** の番です。`;
        embed.setFooter({ text: currentPlayerUser !== 'AI' ? "下のボタンを押してマスを選択" : "AI 考え中..." });
    }
    embed.setDescription(description);
    embed.setTimestamp();
    return embed;
}

function createActionRows(gameState: oxgameGameState): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    const { board, gameOver, currentPlayer, playerX, playerO } = gameState;
    const isHumanTurn = (currentPlayer === CellState.X && playerX instanceof User) || (currentPlayer === CellState.O && playerO instanceof User);
    for (let r = 0; r < BOARD_SIZE; r++) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cellState = board[r][c];
            const button = new ButtonBuilder()
                .setCustomId(`oxgame_${r}_${c}`)
                .setStyle(cellState === CellState.Empty ? ButtonStyle.Secondary : (cellState === CellState.X ? ButtonStyle.Danger : ButtonStyle.Primary))
                .setLabel(cellState === CellState.Empty ? EMOJI_EMPTY : (cellState === CellState.X ? EMOJI_X : EMOJI_O))
                .setDisabled(gameOver || cellState !== CellState.Empty || !isHumanTurn);
            row.addComponents(button);
        }
        rows.push(row);
    }
    return rows;
}

async function updateGameMessage(gameState: oxgameGameState, channel: TextChannel, content?: string) {
    const embed = createGameEmbed(gameState);
    const components = createActionRows(gameState);
    let files: AttachmentBuilder[] = [];
    try {
        const boardImageBuffer = await createBoardImage(gameState.board);
        const attachment = new AttachmentBuilder(boardImageBuffer, { name: 'oxgame-board.png' });
        files.push(attachment);
        embed.setImage('attachment://oxgame-board.png');
    } catch (imgError) {
        console.error("Failed to generate board image:", imgError);
        embed.addFields({ name: "盤面画像エラー", value: "⚠️ 画像の生成に失敗しました。", inline: false });
    }
    const messageOptions = {
        content: content || undefined,
        embeds: [embed],
        components: gameState.gameOver ? [] : components,
        files: files
    };
    try {
        if (gameState.messageId) {
            const message = await channel.messages.fetch(gameState.messageId).catch(() => null);
            if (message) {
                await message.edit(messageOptions);
                return;
            }
            gameState.messageId = undefined;
        }
        const sentMessage = await channel.send(messageOptions);
        gameState.messageId = sentMessage.id;
    } catch (error) {
        console.error("Failed to send or edit game message:", error);
        gameState.messageId = undefined;
        try {
            await channel.send("⚠️ ゲーム表示の更新に失敗しました。");
        } catch (sendError) {
            console.error("Message sending fallback failed:", sendError);
        }
    }
}

function evaluateBoard(board: CellState[][], aiPlayer: CellState.X | CellState.O): number {
    const winner = checkWinner(board);
    const humanPlayer = aiPlayer === CellState.X ? CellState.O : CellState.X;
    if (winner === aiPlayer) return 10;
    if (winner === humanPlayer) return -10;
    if (winner === 'Draw') return 0;
    return 0;
}

interface MinimaxResult { score: number; }
function minimax(board: CellState[][], depth: number, isMaximizing: boolean, aiPlayer: CellState.X | CellState.O, alpha: number, beta: number): MinimaxResult {
    const score = evaluateBoard(board, aiPlayer);

    if (score === 10) return { score: score - depth };
    if (score === -10) return { score: score + depth };
    const emptyCells = getEmptyCells(board);
    if (emptyCells.length === 0) return { score: 0 };

    const humanPlayer = aiPlayer === CellState.X ? CellState.O : CellState.X;
    const currentPlayer = isMaximizing ? aiPlayer : humanPlayer;
    let bestScore = isMaximizing ? -Infinity : Infinity;

    for (const move of emptyCells) {
        board[move.row][move.col] = currentPlayer;
        const result = minimax(board, depth + 1, !isMaximizing, aiPlayer, alpha, beta);
        board[move.row][move.col] = CellState.Empty;

        if (isMaximizing) {
            bestScore = Math.max(bestScore, result.score);
            alpha = Math.max(alpha, bestScore);
        } else {
            bestScore = Math.min(bestScore, result.score);
            beta = Math.min(beta, bestScore);
        }

        if (beta <= alpha) break;
    }
    return { score: bestScore };
}

function findBestMoveAI(gameState: oxgameGameState): Position | null {
    const { board, aiDifficulty, aiPlayer } = gameState;
    if (!aiPlayer || !aiDifficulty) return null;

    const emptyCells = getEmptyCells(board);
    if (emptyCells.length === 0) return null;

    if (aiDifficulty === 'easy') {
        return emptyCells[Math.floor(Math.random() * emptyCells.length)];
    }

    let bestScore = -Infinity;
    let bestMoves: Position[] = [];
    let alpha = -Infinity;
    let beta = Infinity;

    for (const move of emptyCells) {
        board[move.row][move.col] = aiPlayer;
        const result = minimax(board, 0, false, aiPlayer, alpha, beta);
        board[move.row][move.col] = CellState.Empty;

        if (result.score > bestScore) {
            bestScore = result.score;
            bestMoves = [move];
            alpha = Math.max(alpha, bestScore);
        } else if (result.score === bestScore) {
            bestMoves.push(move);
        }
    }

    if (bestMoves.length === 0) {
        return emptyCells[Math.floor(Math.random() * emptyCells.length)];
    } else if (bestMoves.length === 1) {
        return bestMoves[0];
    } else {
        if (aiDifficulty === 'god') {
            const center: Position = { row: 1, col: 1 };
            const corners: Position[] = [{ row: 0, col: 0 }, { row: 0, col: 2 }, { row: 2, col: 0 }, { row: 2, col: 2 }];

            const centerMove = bestMoves.find(m => m.row === center.row && m.col === center.col);
            if (centerMove) return centerMove;

            const cornerMoves = bestMoves.filter(m => corners.some(c => c.row === m.row && c.col === m.col));
            if (cornerMoves.length > 0) {
                return cornerMoves[Math.floor(Math.random() * cornerMoves.length)];
            }

            return bestMoves[Math.floor(Math.random() * bestMoves.length)];
        } else {
            return bestMoves[Math.floor(Math.random() * bestMoves.length)];
        }
    }
}

async function handleAITurn(gameState: oxgameGameState, channel: TextChannel) {
    if (gameState.gameOver || !gameState.isAIGame || !gameState.aiPlayer || !gameState.aiDifficulty) return;

    const aiEmoji = gameState.aiPlayer === CellState.X ? EMOJI_X : EMOJI_O;
    await updateGameMessage(gameState, channel);

    setTimeout(async () => {
        if (!ongoingoxgameGames.has(gameState.channelId) || gameState.gameOver) return;

        const bestMove = findBestMoveAI(gameState);

        if (bestMove) {
            gameState.board[bestMove.row][bestMove.col] = gameState.aiPlayer!;
            const winner = checkWinner(gameState.board);

            if (winner) {
                gameState.gameOver = true;
                gameState.winner = winner;
            } else {
                gameState.currentPlayer = gameState.aiPlayer === CellState.X ? CellState.O : CellState.X;
            }
            const moveNotation = `[${bestMove.row + 1}, ${bestMove.col + 1}]`;
            await updateGameMessage(gameState, channel, `${aiEmoji} AI (${gameState.aiDifficulty}) が ${moveNotation} に置きました。`);

            if (gameState.gameOver) {
                ongoingoxgameGames.delete(gameState.channelId);
            }
        } else {
            console.error("AI could not find a move, but there are empty cells.");
            gameState.currentPlayer = gameState.aiPlayer === CellState.X ? CellState.O : CellState.X;
            await updateGameMessage(gameState, channel, "⚠️ AIが手を見つけられませんでした。あなたの番です。");
        }

    }, 800 + Math.random() * 500);
}

async function handlePlayerMove(interaction: ButtonInteraction, gameState: oxgameGameState, row: number, col: number) {
    const { board, currentPlayer, playerX, playerO, channelId, isAIGame, aiPlayer } = gameState;
    const user = interaction.user;
    const channel = interaction.channel as TextChannel;

    const expectedPlayer = currentPlayer === CellState.X ? playerX : playerO;
    if (expectedPlayer === 'AI' || user.id !== expectedPlayer.id) {
        await interaction.reply({ content: "⏳ あなたの番ではありません！", flags: MessageFlags.Ephemeral });
        return;
    }
    if (!isOnBoard(row, col) || board[row][col] !== CellState.Empty) {
        await interaction.reply({ content: "🤔 そのマスには置けません。", flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferUpdate();

    gameState.board[row][col] = currentPlayer;

    const winner = checkWinner(gameState.board);
    if (winner) {
        gameState.gameOver = true;
        gameState.winner = winner;
        await updateGameMessage(gameState, channel);
        ongoingoxgameGames.delete(channelId);
    } else {
        gameState.currentPlayer = currentPlayer === CellState.X ? CellState.O : CellState.X;
        await updateGameMessage(gameState, channel);

        if (!gameState.gameOver && isAIGame && gameState.currentPlayer === aiPlayer) {
            await handleAITurn(gameState, channel);
        }
    }
}

function forceEndGame(channelId: string, username: string): string {
    const gameState = ongoingoxgameGames.get(channelId);
    if (!gameState) {
        return "このチャンネルで進行中のOX Gameゲームはありません。";
    }
    if (gameState.messageId && gameState.channelId) {
        gameState.gameOver = true;
        const channel = gameState.playerX.client.channels.cache.get(gameState.channelId) as TextChannel | undefined;
        if (channel) {
            channel.messages.fetch(gameState.messageId)
                .then(msg => msg.edit({ components: [] }).catch(() => {/*ignore*/ }))
                .catch(() => {/*ignore*/ });
        }
    }
    ongoingoxgameGames.delete(channelId);
    return `🛑 ${username} によってOX Gameゲームが強制終了されました。`;
}

function createDifficultySelectionRow(starterUserId: string): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();
    const difficulties: AIDifficulty[] = ['easy', 'hard', 'god'];

    difficulties.forEach(diff => {
        const customId = `oxgame_select_${diff}_${starterUserId}`;
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel(diff.toUpperCase())
                .setStyle(ButtonStyle.Primary)
        );
    });
    return row;
}

async function startGame(gameState: oxgameGameState, channel: TextChannel, startMessageContent: string) {
    ongoingoxgameGames.set(gameState.channelId, gameState);
    await updateGameMessage(gameState, channel, startMessageContent);

    if (gameState.isAIGame && gameState.currentPlayer === gameState.aiPlayer) {
        await handleAITurn(gameState, channel);
    }
}

const oxgameCommand: Command = {
    name: 'oxgame',
    description: '画像とボタンで遊ぶOX Gameゲーム (AI対戦可能)',
    usage: `oxgame start [@ユーザー | ai [--mode]] | end`,
    execute: async (_client: Client, message: Message, args: string[]) => {
        const subCommand = args[0]?.toLowerCase();
        const channel = message.channel as TextChannel;
        const channelId = channel.id;
        const author = message.author;

        if (!message.guild) {
            await message.reply({ content: 'サーバー内でのみ実行できます。' });
            return;
        }

        switch (subCommand) {
            case 'start': {
                if (ongoingoxgameGames.has(channelId)) {
                    await message.reply({ content: '❌ このチャンネルでは既にOX Gameゲームが進行中です。\n終了するには `' + PREFIX + 'oxgame end`' });
                    return;
                }

                const mentionedUser = message.mentions.users.first();
                const isAIMatch = args.includes('ai');
                const useModeSelection = args.includes('--mode');
                const defaultDifficulty: AIDifficulty = 'easy';

                let opponent: User | 'AI';
                let isAIGame = false;
                let aiDifficulty: AIDifficulty | undefined = undefined;
                let aiPlayer: CellState.X | CellState.O | undefined = undefined;

                if (mentionedUser) {
                    if (isAIMatch) {
                        await message.reply('⚠️ 対戦相手のメンションと `ai` は同時に指定できません。');
                        return;
                    }
                    if (useModeSelection) {
                        await message.reply('⚠️ `--mode` オプションは `ai` 対戦時のみ有効です。');
                        return;
                    }
                    if (mentionedUser.bot) { await message.reply('❌ ボットとは対戦できません。`ai` を指定してください。'); return; }
                    if (mentionedUser.id === author.id) { await message.reply('❌ 自分自身とは対戦できません。'); return; }
                    opponent = mentionedUser;
                    isAIGame = false;
                } else if (isAIMatch) {
                    opponent = 'AI';
                    isAIGame = true;
                    aiPlayer = CellState.O;

                    if (useModeSelection) {
                        const selectionRow = createDifficultySelectionRow(author.id);
                        await message.reply({
                            content: `${author.username} さん、対戦するAIの難易度を選択してください:`,
                            components: [selectionRow]
                        });
                        return;
                    } else {
                        aiDifficulty = defaultDifficulty;
                    }
                } else {
                    await message.reply(`対戦相手を指定してください。\n例: \`${PREFIX}oxgame start @ユーザー\` または \`${PREFIX}oxgame start ai [--mode]\``);
                    return;
                }

                if (isAIGame && !aiDifficulty) {
                    return;
                }

                const initialBoard: CellState[][] = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(CellState.Empty));
                const newGame: oxgameGameState = {
                    board: initialBoard,
                    currentPlayer: CellState.X,
                    playerX: author,
                    playerO: opponent,
                    gameOver: false,
                    winner: null,
                    channelId: channelId,
                    messageId: undefined,
                    isAIGame: isAIGame,
                    aiDifficulty: aiDifficulty,
                    aiPlayer: aiPlayer,
                };

                const playerOName = opponent === 'AI' ? `AI (${aiDifficulty})` : opponent.username;
                const startMessage = `${EMOJI_X} ${author.username} vs ${EMOJI_O} ${playerOName} のOX Game対戦を開始！`;
                await startGame(newGame, channel, startMessage);
                break;
            }
            case 'end': {
                const endMessage = forceEndGame(channelId, author.username);
                await message.reply(endMessage);
                break;
            }
            default:
                await message.reply(`不明なサブコマンドです。\n使い方: \`${PREFIX}${oxgameCommand.usage}\``);
        }
    },
    handleInteraction: async (interaction: Interaction) => {
        if (!interaction.isButton()) {
            console.warn("OX Game handleInteraction called with non-button interaction.");
            return;
        }

        const customId = interaction.customId;
        const channel = interaction.channel as TextChannel;
        if (!channel) return;

        const channelId = channel.id;
        const user = interaction.user;

        if (customId.startsWith('oxgame_select_')) {
            const parts = customId.split('_');
            if (parts.length !== 4) {
                await interaction.reply({ content: '内部エラー: ボタンID解析失敗', flags: MessageFlags.Ephemeral }); return;
            }
            const difficulty = parts[2] as AIDifficulty;
            const starterUserId = parts[3];

            if (user.id !== starterUserId) {
                await interaction.reply({ content: '⚠️ ゲームを開始した本人のみが難易度を選択できます。', flags: MessageFlags.Ephemeral });
                return;
            }

            if (ongoingoxgameGames.has(channelId)) {
                await interaction.reply({ content: '❌ このチャンネルでは既にゲームが進行中です。', flags: MessageFlags.Ephemeral });
                try { await interaction.message.delete(); } catch { }
                return;
            }

            await interaction.deferUpdate();
            try {
                await interaction.message.edit({ content: `${user.username} が AI (${difficulty}) を選択しました！ ゲームを開始します...`, components: [] });
            } catch (e) { }

            const starterUser = await interaction.client.users.fetch(starterUserId).catch(() => null);
            if (!starterUser) {
                await channel.send("❌ ゲーム開始ユーザー情報の取得に失敗したため、ゲームを開始できません。");
                return;
            }

            const initialBoard: CellState[][] = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(CellState.Empty));
            const newGame: oxgameGameState = {
                board: initialBoard,
                currentPlayer: CellState.X,
                playerX: starterUser,
                playerO: 'AI',
                gameOver: false,
                winner: null,
                channelId: channelId,
                messageId: undefined,
                isAIGame: true,
                aiDifficulty: difficulty,
                aiPlayer: CellState.O,
            };

            const startMessage = `${EMOJI_X} ${starterUser.username} vs ${EMOJI_O} AI (${difficulty}) のOX Game対戦を開始！`;
            await startGame(newGame, channel, startMessage);
            return;
        }

        const gameState = ongoingoxgameGames.get(channelId);

        if (!gameState) {
            await interaction.reply({ content: '👻 このゲームは既に終了しているか、見つかりません。', flags: MessageFlags.Ephemeral });
            try { if (interaction.message.components.length > 0) await interaction.message.edit({ components: [] }); } catch { }
            return;
        }
        if (gameState.gameOver) {
            await interaction.reply({ content: '🏁 ゲームは既に終了しています。', flags: MessageFlags.Ephemeral });
            try { if (interaction.message.components.length > 0) await interaction.message.edit({ components: [] }); } catch { }
            return;
        }

        const parts = customId.split('_');
        if (parts.length !== 3) {
            await interaction.reply({ content: '内部エラー: ボタンIDが不正です。', flags: MessageFlags.Ephemeral }); return;
        }
        const row = parseInt(parts[1]);
        const col = parseInt(parts[2]);
        if (isNaN(row) || isNaN(col)) {
            await interaction.reply({ content: '内部エラー: 座標の解析に失敗しました。', flags: MessageFlags.Ephemeral }); return;
        }

        await handlePlayerMove(interaction, gameState, row, col);
    }
};

registerCommand(oxgameCommand);