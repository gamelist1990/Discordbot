import { User, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, Client, Message, Interaction, AttachmentBuilder } from "discord.js";
import sharp from 'sharp';
import { PREFIX, registerCommand } from "../../..";
import { Command } from "../../../types/command";



//AI アルゴリズム (Gemini)

enum CellState { Empty = 0, Black = 1, White = 2 }
type AIDifficulty = 'easy' | 'hard' | 'superhard' | 'pro' | 'god';

interface ReversiGameState {
    board: CellState[][];
    currentPlayer: CellState;
    playerBlack: User | 'AI' | null;
    playerWhite: User | 'AI' | null;
    gameOver: boolean;
    winner: CellState | null;
    channelId: string;
    messageId?: string;
    showValidMoves: boolean;
    isAIGame: boolean;
    aiDifficulty: AIDifficulty;
    lastMoveSkipped: boolean;
    lastThinkTime?: number;
}

interface Position { row: number; col: number; }
interface ScoredPosition extends Position { score: number; }

interface AlphaBetaResult {
    score: number;
    move: Position | null;
}

const EMOJI_BLACK = '⚫';
const EMOJI_WHITE = '⚪';
const EMOJI_VALID_BUTTON = '🔵';
const EMOJI_VALID_HINT_IMG = 'rgba(0, 0, 255, 0.4)';
const EMOJI_VALID_HINT_TEXT = '🔹';
const BOARD_SIZE = 8;
const COLUMN_LABELS_WIDE = ['Ａ', 'Ｂ', 'Ｃ', 'Ｄ', 'Ｅ', 'Ｆ', 'Ｇ', 'Ｈ'];
const ROW_LABELS_WIDE = ['１', '２', '３', '４', '５', '６', '７', '８'];
const DIRECTIONS = [{ dr: -1, dc: -1 }, { dr: -1, dc: 0 }, { dr: -1, dc: 1 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }, { dr: 1, dc: -1 }, { dr: 1, dc: 0 }, { dr: 1, dc: 1 },];
const CORNERS: Position[] = [{ row: 0, col: 0 }, { row: 0, col: 7 }, { row: 7, col: 0 }, { row: 7, col: 7 }];
const IMG_BOARD_PX = 400; const IMG_CELL_PX = IMG_BOARD_PX / BOARD_SIZE; const IMG_STONE_MARGIN_RATIO = 0.1; const IMG_STONE_SIZE_PX = IMG_CELL_PX * (1 - IMG_STONE_MARGIN_RATIO * 2); const IMG_HINT_SIZE_PX = IMG_CELL_PX * 0.5; const IMG_BOARD_COLOR = '#008000'; const IMG_LINE_COLOR = '#000000';

const AI_DEPTH: Record<AIDifficulty, number> = {
    easy: 0,
    hard: 0,
    superhard: 0,
    pro: 4,
    god: 7
};
const MAX_SCORE = 1000000;
const MIN_SCORE = -1000000;

const ongoingGames = new Map<string, ReversiGameState>();

function isOnBoard(row: number, col: number): boolean { return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE; }
function checkDirection(board: CellState[][], row: number, col: number, player: CellState, dr: number, dc: number): Position[] {
    const opponent = player === CellState.Black ? CellState.White : CellState.Black;
    const flipped: Position[] = [];
    let r = row + dr, c = col + dc;
    if (!isOnBoard(r, c) || board[r][c] !== opponent) return [];
    flipped.push({ row: r, col: c });
    while (true) {
        r += dr; c += dc;
        if (!isOnBoard(r, c) || board[r][c] === CellState.Empty) return [];
        if (board[r][c] === player) return flipped;
        flipped.push({ row: r, col: c });
    }
}
function isValidMove(board: CellState[][], row: number, col: number, player: CellState): boolean {
    if (!isOnBoard(row, col) || board[row][col] !== CellState.Empty) return false;
    for (const dir of DIRECTIONS) {
        if (checkDirection(board, row, col, player, dir.dr, dir.dc).length > 0) return true;
    }
    return false;
}
function getValidMoves(board: CellState[][], player: CellState): Position[] {
    const moves: Position[] = [];
    for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) if (isValidMove(board, r, c, player)) moves.push({ row: r, col: c });
    return moves;
}
function flipStones(board: CellState[][], row: number, col: number, player: CellState): CellState[][] {
    const newBoard = board.map(rowArray => rowArray.slice());
    newBoard[row][col] = player;
    for (const dir of DIRECTIONS) {
        const stonesToFlip = checkDirection(board, row, col, player, dir.dr, dir.dc);
        for (const pos of stonesToFlip) {
            newBoard[pos.row][pos.col] = player;
        }
    }
    return newBoard;
}
function countStones(board: CellState[][]): { black: number; white: number; empty: number } {
    let black = 0, white = 0, empty = 0;
    for (let r = 0; r < BOARD_SIZE; ++r) {
        for (let c = 0; c < BOARD_SIZE; ++c) {
            if (board[r][c] === CellState.Black) black++;
            else if (board[r][c] === CellState.White) white++;
            else empty++;
        }
    }
    return { black, white, empty };
}
function checkGameOver(board: CellState[][]): { gameOver: boolean; winner: CellState | null } {
    const blackMoves = getValidMoves(board, CellState.Black).length;
    const whiteMoves = getValidMoves(board, CellState.White).length;
    if ((blackMoves === 0 && whiteMoves === 0) || !board.flat().some(cell => cell === CellState.Empty)) {
        const { black, white } = countStones(board);
        return { gameOver: true, winner: black === white ? null : (black > white ? CellState.Black : CellState.White) };
    }
    return { gameOver: false, winner: null };
}
const isCorner = (r: number, c: number) => (r === 0 || r === BOARD_SIZE - 1) && (c === 0 || c === BOARD_SIZE - 1);
const isEdge = (r: number, c: number) => !isCorner(r, c) && (r === 0 || r === BOARD_SIZE - 1 || c === 0 || c === BOARD_SIZE - 1);

function evaluateBoardState(board: CellState[][], player: CellState): number {
    const opponent = player === CellState.Black ? CellState.White : CellState.Black;
    const { black, white } = countStones(board);
    const stoneDiff = player === CellState.Black ? black - white : white - black;

    let score = 0;

    let playerCorners = 0;
    let opponentCorners = 0;
    for (const corner of CORNERS) {
        if (board[corner.row][corner.col] === player) playerCorners++;
        else if (board[corner.row][corner.col] === opponent) opponentCorners++;
    }
    score += (playerCorners - opponentCorners) * 100;

    let playerPotentialMoves = 0;
    let opponentPotentialMoves = 0;
    for (let r = 0; r < BOARD_SIZE; ++r) {
        for (let c = 0; c < BOARD_SIZE; ++c) {
            if (board[r][c] === CellState.Empty) {
                let playerAdj = false;
                let oppAdj = false;
                for (const dir of DIRECTIONS) {
                    const nr = r + dir.dr;
                    const nc = c + dir.dc;
                    if (isOnBoard(nr, nc)) {
                        if (board[nr][nc] === player) playerAdj = true;
                        else if (board[nr][nc] === opponent) oppAdj = true;
                    }
                }
                if (playerAdj) playerPotentialMoves++;
                if (oppAdj) opponentPotentialMoves++;
            }
        }
    }
    score += (playerPotentialMoves - opponentPotentialMoves) * 5;

    const totalStones = black + white;
    const endgameWeight = Math.max(0, (totalStones - 40)) / 24;
    score += stoneDiff * (1 + endgameWeight * 5);

    let dangerPenalty = 0;
    for (const corner of CORNERS) {
        if (board[corner.row][corner.col] === CellState.Empty) {
            for (const dir of DIRECTIONS) {
                const nr = corner.row + dir.dr;
                const nc = corner.col + dir.dc;
                if (isOnBoard(nr, nc) && board[nr][nc] === opponent) {
                    dangerPenalty -= 25;
                    break;
                }
            }
        }
    }
    score += dangerPenalty;

    const { gameOver, winner } = checkGameOver(board);
    if (gameOver) {
        if (winner === player) return MAX_SCORE;
        if (winner === opponent) return MIN_SCORE;
        return 0;
    }

    return score;
}

function alphaBetaSearch(board: CellState[][], depth: number, alpha: number, beta: number, maximizingPlayer: boolean, player: CellState): AlphaBetaResult {
    const { gameOver } = checkGameOver(board);
    if (depth === 0 || gameOver) {
        return { score: evaluateBoardState(board, player), move: null };
    }

    const currentPlayer = maximizingPlayer ? player : (player === CellState.Black ? CellState.White : CellState.Black);
    const validMoves = getValidMoves(board, currentPlayer);

    if (validMoves.length === 0) {
        return alphaBetaSearch(board, depth, alpha, beta, !maximizingPlayer, player);
    }

    let bestScore = maximizingPlayer ? MIN_SCORE : MAX_SCORE;
    let bestMoveForThisNode: Position | null = null;

    for (const move of validMoves) {
        const nextBoard = flipStones(board, move.row, move.col, currentPlayer);
        const result = alphaBetaSearch(nextBoard, depth - 1, alpha, beta, !maximizingPlayer, player);

        if (maximizingPlayer) {
            if (result.score > bestScore) {
                bestScore = result.score;
                bestMoveForThisNode = move;
            }
            alpha = Math.max(alpha, bestScore);
            if (beta <= alpha) {
                break;
            }
        } else {
            if (result.score < bestScore) {
                bestScore = result.score;
                bestMoveForThisNode = move;
            }
            beta = Math.min(beta, bestScore);
            if (beta <= alpha) {
                break;
            }
        }
    }

    return { score: bestScore, move: bestMoveForThisNode };
}

function findBestMoveAI(gameState: ReversiGameState): Position | null {
    const { board, currentPlayer, aiDifficulty } = gameState;
    const validMoves = getValidMoves(board, currentPlayer);
    if (validMoves.length === 0) return null;

    const depth = AI_DEPTH[aiDifficulty];
    const startTime = Date.now();

    if (depth > 0) {
        let bestScore = MIN_SCORE;
        let bestMove: Position | null = null;
        let alpha = MIN_SCORE;
        let beta = MAX_SCORE;

        for (const move of validMoves) {
            const nextBoard = flipStones(board, move.row, move.col, currentPlayer);
            const result = alphaBetaSearch(nextBoard, depth - 1, alpha, beta, false, currentPlayer);

            if (result.score > bestScore) {
                bestScore = result.score;
                bestMove = move;
            }
            alpha = Math.max(alpha, bestScore);
        }

        gameState.lastThinkTime = Date.now() - startTime;
        return bestMove ?? validMoves[Math.floor(Math.random() * validMoves.length)];
    }

    let evaluateFunc: (board: CellState[][], r: number, c: number, player: CellState) => number;
    switch (aiDifficulty) {
        case 'easy':
            let easyBestMove: Position | null = null;
            let maxFlipped = -1;
            for (const move of validMoves) {
                let currentFlipped = 0;
                for (const dir of DIRECTIONS) currentFlipped += checkDirection(board, move.row, move.col, currentPlayer, dir.dr, dir.dc).length;
                if (currentFlipped > maxFlipped) { maxFlipped = currentFlipped; easyBestMove = move; }
            }
            gameState.lastThinkTime = Date.now() - startTime;
            return easyBestMove ?? validMoves[Math.floor(Math.random() * validMoves.length)];
        default: evaluateFunc = (b, r, c, p) => evaluateBoardState(flipStones(b, r, c, p), p);
            break;
    }

    if (aiDifficulty === 'hard' || aiDifficulty === 'superhard') {
        const evalMoveFunc = aiDifficulty === 'hard' ? evaluateMoveHard : evaluateMoveSuperHard;
        const scoredMoves: ScoredPosition[] = validMoves.map(move => ({
            ...move,
            score: evalMoveFunc(board, move.row, move.col, currentPlayer)
        }));
        scoredMoves.sort((a, b) => b.score - a.score);
        const bestScoreEval = scoredMoves[0].score;
        const bestMovesEval = scoredMoves.filter(m => m.score === bestScoreEval);
        gameState.lastThinkTime = Date.now() - startTime;
        return bestMovesEval[Math.floor(Math.random() * bestMovesEval.length)];
    }

    const scoredMoves: ScoredPosition[] = validMoves.map(move => ({
        ...move,
        score: evaluateFunc(board, move.row, move.col, currentPlayer)
    }));
    scoredMoves.sort((a, b) => b.score - a.score);
    const bestScore = scoredMoves[0].score;
    const bestMoves = scoredMoves.filter(m => m.score === bestScore);
    gameState.lastThinkTime = Date.now() - startTime;
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

async function createBoardImage(gameState: ReversiGameState): Promise<Buffer> {
    try {
        const { board, currentPlayer, showValidMoves, gameOver } = gameState;
        const validMoves = (showValidMoves && !gameOver) ? getValidMoves(board, currentPlayer) : [];

        let svg = `<svg width="${IMG_BOARD_PX}" height="${IMG_BOARD_PX}" xmlns="http://www.w3.org/2000/svg">`;
        svg += `<rect width="100%" height="100%" fill="${IMG_BOARD_COLOR}"/>`;
        for (let i = 1; i < BOARD_SIZE; i++) {
            svg += `<line x1="${i * IMG_CELL_PX}" y1="0" x2="${i * IMG_CELL_PX}" y2="${IMG_BOARD_PX}" stroke="${IMG_LINE_COLOR}" stroke-width="1"/>`;
            svg += `<line x1="0" y1="${i * IMG_CELL_PX}" x2="${IMG_BOARD_PX}" y2="${i * IMG_CELL_PX}" stroke="${IMG_LINE_COLOR}" stroke-width="1"/>`;
        }

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const cellX = c * IMG_CELL_PX;
                const cellY = r * IMG_CELL_PX;
                const stoneCenterX = cellX + IMG_CELL_PX / 2;
                const stoneCenterY = cellY + IMG_CELL_PX / 2;

                switch (board[r][c]) {
                    case CellState.Black:
                        svg += `<circle cx="${stoneCenterX}" cy="${stoneCenterY}" r="${IMG_STONE_SIZE_PX / 2}" fill="black"/>`;
                        break;
                    case CellState.White:
                        svg += `<circle cx="${stoneCenterX}" cy="${stoneCenterY}" r="${IMG_STONE_SIZE_PX / 2}" fill="white" stroke="black" stroke-width="0.5"/>`;
                        break;
                    case CellState.Empty:
                        const isPossibleMove = showValidMoves && !gameOver && validMoves.some(m => m.row === r && m.col === c);
                        if (isPossibleMove) {
                            svg += `<circle cx="${stoneCenterX}" cy="${stoneCenterY}" r="${IMG_HINT_SIZE_PX / 2}" fill="${EMOJI_VALID_HINT_IMG}" />`;
                        }
                        break;
                }
            }
        }
        svg += `</svg>`;

        return await sharp(Buffer.from(svg)).png().toBuffer();

    } catch (error) {
        const errorSvg = `<svg width="100" height="30"><text x="5" y="20" font-size="12" fill="red">Board Error</text></svg>`;
        return await sharp(Buffer.from(errorSvg)).png().toBuffer();
    }
}

function createGameInfoEmbed(gameState: ReversiGameState): EmbedBuilder {
    const embed = new EmbedBuilder();
    const { black, white } = countStones(gameState.board);
    const { aiDifficulty } = gameState;

    embed.setTitle('⚪⚫ リバーシゲーム ⚫⚪');
    embed.setColor(gameState.gameOver ? 0xFFFF00 :
        gameState.currentPlayer === CellState.Black ? 0x000001 : 0xFFFFFF);

    const getPlayerDisplayName = (player: User | 'AI' | null, isBlack: boolean): string => {
        if (player === 'AI') {
            return `AI (${aiDifficulty})`;
        } else if (player) {
            return player.username;
        } else {
            return isBlack ? 'プレイヤー1' : 'プレイヤー2';
        }
    };
    const playerBlackName = getPlayerDisplayName(gameState.playerBlack, true);
    const playerWhiteName = getPlayerDisplayName(gameState.playerWhite, false);

    embed.addFields(
        { name: 'スコア', value: `${EMOJI_BLACK} ${black} - ${white} ${EMOJI_WHITE}`, inline: true }
    );

    let statusText = '';
    if (!gameState.gameOver) {
        const currentPlayerName = gameState.currentPlayer === CellState.Black ? playerBlackName : playerWhiteName;
        const currentPlayerEmoji = gameState.currentPlayer === CellState.Black ? EMOJI_BLACK : EMOJI_WHITE;
        const validMovesCount = getValidMoves(gameState.board, gameState.currentPlayer).length;

        statusText = `${currentPlayerEmoji} **${currentPlayerName}** の手番`;

        if (validMovesCount === 0) {
            statusText += ' (パス)';
        } else if (gameState.lastMoveSkipped) {
            const skippedPlayerEmoji = currentPlayerEmoji === EMOJI_BLACK ? EMOJI_WHITE : EMOJI_BLACK;
            statusText += ` (${skippedPlayerEmoji} パス済)`;
        }

        const currentPlayerIsUser = (gameState.currentPlayer === CellState.Black && gameState.playerBlack !== 'AI') ||
            (gameState.currentPlayer === CellState.White && gameState.playerWhite !== 'AI');

        if (currentPlayerIsUser) {
            if (validMovesCount > 0 && validMovesCount <= 25) {
                statusText += `\n(下のボタン ${EMOJI_VALID_BUTTON} でマスを選択)`;
            } else if (validMovesCount > 25) {
                statusText += `\n(有効手${validMovesCount}個 - ボタン省略)`;
                statusText += `\n(\`${PREFIX}reversi put <座標>\` で入力)`;
            }
        }
        statusText += `\n(\`${PREFIX}reversi put <座標>\` も利用可能)`;

        if (gameState.showValidMoves && validMovesCount > 0) {
            statusText += `\n(盤面画像の ${EMOJI_VALID_HINT_TEXT} 風の印が置けるマス)`;
        }

    } else {
        if (gameState.winner === CellState.Black) {
            statusText = `**${EMOJI_BLACK} ${playerBlackName} の勝ち！**`;
        } else if (gameState.winner === CellState.White) {
            statusText = `**${EMOJI_WHITE} ${playerWhiteName} の勝ち！**`;
        } else {
            statusText = '**引き分け！**';
        }
    }
    embed.addFields({ name: '状態', value: statusText, inline: true });

    const rowLabels = ROW_LABELS_WIDE.join('');
    const colLabels = COLUMN_LABELS_WIDE.join(' ');
    embed.setDescription(`縦: **${rowLabels}** / 横: **${colLabels}**\n*画像が表示されない場合は再読み込みしてみてください*`);

    embed.setFooter({ text: `黒: ${playerBlackName} vs 白: ${playerWhiteName} ${gameState.showValidMoves ? '[ヒント表示中]' : ''}` });
    embed.setTimestamp();
    return embed;
}

function createActionRows(gameState: ReversiGameState): ActionRowBuilder<ButtonBuilder>[] {
    const actionRows: ActionRowBuilder<ButtonBuilder>[] = [];
    if (gameState.gameOver) return actionRows;

    const currentPlayerIsUser = (gameState.currentPlayer === CellState.Black && gameState.playerBlack !== 'AI') ||
        (gameState.currentPlayer === CellState.White && gameState.playerWhite !== 'AI');

    if (currentPlayerIsUser) {
        const validMoves = getValidMoves(gameState.board, gameState.currentPlayer);

        if (validMoves.length > 0 && validMoves.length <= 25) {
            validMoves.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));

            let currentRow = new ActionRowBuilder<ButtonBuilder>();
            validMoves.forEach(({ row, col }) => {
                if (currentRow.components.length === 5) {
                    actionRows.push(currentRow);
                    currentRow = new ActionRowBuilder<ButtonBuilder>();
                }
                currentRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`reversi_put_${row}_${col}`)
                        .setLabel(`${COLUMN_LABELS_WIDE[col]}${ROW_LABELS_WIDE[row]}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji(EMOJI_VALID_BUTTON)
                );
            });
            if (currentRow.components.length > 0) {
                actionRows.push(currentRow);
            }
        }
    }
    return actionRows;
}

async function updateGameMessage(gameState: ReversiGameState, channel: TextChannel, content?: string) {
    const embed = createGameInfoEmbed(gameState);
    const components = createActionRows(gameState);
    let files: AttachmentBuilder[] = [];

    try {
        const boardImageBuffer = await createBoardImage(gameState);
        const attachment = new AttachmentBuilder(boardImageBuffer, { name: 'reversi-board.png' });
        files.push(attachment);
        embed.setImage('attachment://reversi-board.png');
    } catch (imgError) {
        embed.addFields({ name: "盤面エラー", value: "⚠️ 盤面画像の生成に失敗しました。", inline: false });
    }

    const messageOptions = {
        content: (content && content.trim().length > 0) ? content.trim() : undefined,
        embeds: [embed],
        components: components,
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
        gameState.messageId = undefined;
        try {
            await channel.send("⚠️ ゲーム表示の更新に失敗しました。`" + PREFIX + "reversi board` を試してください。");
        } catch (sendError) {
            console.error("Message sending fallback failed:", sendError);
        }
    }
}

async function nextTurn(gameState: ReversiGameState, channel: TextChannel) {
    await handlePlayerTurn(gameState, channel);
}

async function handlePlayerTurn(gameState: ReversiGameState, channel: TextChannel) {
    if (gameState.gameOver) return;

    const validMoves = getValidMoves(gameState.board, gameState.currentPlayer);
    let messageContent: string | undefined = undefined;

    if (validMoves.length === 0) {
        const skippedPlayer = gameState.currentPlayer;
        const playerEmoji = skippedPlayer === CellState.Black ? EMOJI_BLACK : EMOJI_WHITE;

        const getPlayerName = (p: User | 'AI' | null, color: CellState, diff: AIDifficulty) => {
            if (p === 'AI') return `AI (${diff})`;
            if (p) return p.username;
            return color === CellState.Black ? 'プレイヤー1' : 'プレイヤー2';
        };
        const playerName = getPlayerName(
            skippedPlayer === CellState.Black ? gameState.playerBlack : gameState.playerWhite,
            skippedPlayer,
            gameState.aiDifficulty
        );

        if (gameState.lastMoveSkipped) {
            const { winner } = checkGameOver(gameState.board);
            gameState.gameOver = true;
            gameState.winner = winner;
            messageContent = `${playerEmoji} ${playerName} もパス。両者置けないためゲーム終了！`;
            await updateGameMessage(gameState, channel, messageContent);
            cleanupGame(gameState.channelId);
            return;
        } else {
            gameState.lastMoveSkipped = true;
            gameState.currentPlayer = skippedPlayer === CellState.Black ? CellState.White : CellState.Black;
            messageContent = `${playerEmoji} ${playerName} はパスしました。`;
            await updateGameMessage(gameState, channel, messageContent);
            await nextTurn(gameState, channel);
            return;
        }
    }

    gameState.lastMoveSkipped = false;
    await updateGameMessage(gameState, channel);

    const currentPlayerIsAI = (gameState.currentPlayer === CellState.Black && gameState.playerBlack === 'AI') ||
        (gameState.currentPlayer === CellState.White && gameState.playerWhite === 'AI');

    if (currentPlayerIsAI && !gameState.gameOver) {
        setTimeout(async () => {
            if (ongoingGames.get(channel.id) === gameState && !gameState.gameOver) {
                await handleAITurn(gameState, channel);
            }
        }, 800);
    }
}

async function handleAITurn(gameState: ReversiGameState, channel: TextChannel) {
    if (gameState.gameOver) return;
    const aiPlayer = gameState.currentPlayer;
    const aiEmoji = aiPlayer === CellState.Black ? EMOJI_BLACK : EMOJI_WHITE;
    const difficulty = gameState.aiDifficulty;

    const thinkingMsg = await channel.send(`🧠 ${aiEmoji} AI (${difficulty}${AI_DEPTH[difficulty] > 0 ? ` Depth ${AI_DEPTH[difficulty]}` : ''}) 考え中...`);

    try {
        const bestMove = findBestMoveAI(gameState);

        if (bestMove) {
            const { row, col } = bestMove;
            gameState.board = flipStones(gameState.board, row, col, aiPlayer);
            gameState.currentPlayer = aiPlayer === CellState.Black ? CellState.White : CellState.Black;
            const { gameOver, winner } = checkGameOver(gameState.board);
            gameState.gameOver = gameOver;
            gameState.winner = winner;

            const coordinate = `${COLUMN_LABELS_WIDE[col]}${ROW_LABELS_WIDE[row]}`;
            const thinkTimeSuffix = gameState.lastThinkTime ? ` (${(gameState.lastThinkTime / 1000).toFixed(1)}s)` : '';
            const msgContent = `${aiEmoji} AI (${difficulty}) が ${coordinate} に置きました。${thinkTimeSuffix}`;
            await updateGameMessage(gameState, channel, msgContent);

            if (gameOver) cleanupGame(gameState.channelId);
            else await nextTurn(gameState, channel);

        } else {
            gameState.lastMoveSkipped = true;
            gameState.currentPlayer = aiPlayer === CellState.Black ? CellState.White : CellState.Black;
            await nextTurn(gameState, channel);
        }
    } catch (error) {
        await channel.send(`⚠️ AI (${difficulty}) の思考中にエラーが発生しました。`);
        gameState.lastMoveSkipped = true;
        gameState.currentPlayer = aiPlayer === CellState.Black ? CellState.White : CellState.Black;
        await nextTurn(gameState, channel);

    } finally {
        try { await thinkingMsg.delete(); } catch { }
    }
}

function cleanupGame(channelId: string) {
    if (ongoingGames.has(channelId)) {
        ongoingGames.delete(channelId);
    }
}

function createDifficultySelectionRow(starterUserId: string, showHints: boolean): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();
    const difficulties: AIDifficulty[] = ['easy', 'hard', 'superhard', 'pro', 'god'];

    difficulties.forEach(diff => {
        const customId = `reversi_select_${diff}_${starterUserId}_${showHints ? '1' : '0'}`;
        const label = diff === 'god' ? `${diff} (実験的)` : diff;
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel(label.toUpperCase())
                .setStyle(ButtonStyle.Primary)
        );
    });
    return row;
}


const reversiCommand: Command = {
    name: 'reversi',
    description: 'リバーシ(オセロ)ゲーム。Alpha-Beta探索AI搭載。',
    usage: `reversi start [@ユーザー | ai [--mode]] [--show-hints] | board | put <座標> | end | surrender | help`,
    execute: async (_client: Client, message: Message, args: string[]) => {
        const subCommand = args[0]?.toLowerCase();
        const guildId = message.guild?.id;
        const channel = message.channel as TextChannel;
        const channelId = channel.id;
        const author = message.author;

        if (!guildId) { await message.reply({ content: 'サーバー内でのみ実行できます。' }); return; }

        if (!subCommand || subCommand === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setTitle("⚪⚫ リバーシ コマンドヘルプ ⚫⚪")
                .setColor(0x00DD00)
                .setDescription(`\`${PREFIX}reversi <サブコマンド> [引数]\` で操作します。\n盤面は画像表示、操作はボタンが基本です。`)
                .addFields(
                    { name: `\`start @ユーザー\``, value: "指定ユーザーと対戦開始 (あなたが黒/先手)", inline: false },
                    { name: `\`start ai\``, value: "AI(easy)と対戦開始 (あなたが黒/先手)", inline: false },
                    { name: `\`start ai --mode\``, value: "難易度選択ボタンを表示し、AIの強さを選んで対戦開始", inline: false },
                    { name: `\`start ... [--show-hints]\``, value: "置けるマスを盤面画像上にマーカー表示します", inline: false },
                    { name: `\`board\``, value: "現在の盤面を再表示します", inline: false },
                    { name: `\`put <座標>\``, value: "座標 (例: C4) を指定して石を置きます", inline: false },
                    { name: `\`end\``, value: "進行中のゲームを強制終了します (誰でも可)", inline: false },
                    { name: `\`surrender\``, value: "現在のゲームを投了します (参加者のみ)", inline: false },
                )
                .setFooter({ text: `座標例: A1, H8 | 利用可能なAI難易度: easy, hard, superhard, pro, god (実験的)` });
            await message.reply({ embeds: [helpEmbed] });
            return;
        }

        if (subCommand === 'start') {
            if (ongoingGames.has(channelId)) {
                await message.reply({ content: '❌ このチャンネルでは既にゲームが進行中です。\n終了するには `' + PREFIX + 'reversi end`' });
                return;
            }

            const useModeSelection = args.includes('--mode');
            const showHints = args.includes('--show-hints');

            const opponentArg = args.find(arg =>
                arg.toLowerCase() !== 'start' &&
                arg !== '--mode' &&
                arg !== '--show-hints' &&
                !arg.startsWith('<@')
            )?.toLowerCase();
            const mentionedUser = message.mentions.users.first();

            let opponent: User | 'AI' | null = null;
            let startGameImmediately = true;
            let defaultDifficulty: AIDifficulty = 'easy';

            if (mentionedUser) {
                if (mentionedUser.bot) { await message.reply('❌ ボットとは対戦できません。`ai` を指定してください。'); return; }
                if (mentionedUser.id === author.id) { await message.reply('❌ 自分自身とは対戦できません。'); return; }
                if (useModeSelection) { await message.reply('⚠️ `--mode` オプションは AI 対戦時のみ有効です。'); return; }
                opponent = mentionedUser;
                startGameImmediately = true;
            } else if (opponentArg === 'ai') {
                opponent = 'AI';
                if (useModeSelection) {
                    startGameImmediately = false;
                } else {
                    startGameImmediately = true;
                    defaultDifficulty = 'easy';
                }
            } else {
                await message.reply(`対戦相手を指定してください。\n例: \`${PREFIX}reversi start @ユーザー\` または \`${PREFIX}reversi start ai [--mode]\``);
                return;
            }

            if (useModeSelection && opponent !== 'AI') {
                await message.reply(`⚠️ \`--mode\` オプションは \`ai\` と一緒に指定した場合のみ有効です。`);
                return;
            }

            if (!startGameImmediately) {
                const selectionRow = createDifficultySelectionRow(author.id, showHints);
                await message.reply({
                    content: `対戦するAIの難易度を選択してください:`,
                    components: [selectionRow]
                });
                return;
            }

            const board: CellState[][] = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(CellState.Empty));
            board[3][3] = CellState.White; board[3][4] = CellState.Black;
            board[4][3] = CellState.Black; board[4][4] = CellState.White;

            const newGame: ReversiGameState = {
                board,
                currentPlayer: CellState.Black,
                playerBlack: author,
                playerWhite: opponent,
                gameOver: false,
                winner: null,
                channelId,
                showValidMoves: showHints,
                isAIGame: opponent === 'AI',
                aiDifficulty: opponent === 'AI' ? defaultDifficulty : 'easy',
                lastMoveSkipped: false,
                messageId: undefined,
            };
            ongoingGames.set(channelId, newGame);

            const opponentName = opponent === 'AI' ? `AI (${newGame.aiDifficulty})` : opponent.username;
            let startMessage = `⚪⚫ ${author.username} が ${opponent === 'AI' ? '' : opponentName + 'さんとの'}リバーシ対戦を開始！ ⚫⚪`;
            if (showHints) startMessage += ` [ヒント表示有効]`;
            startMessage += `\n${EMOJI_BLACK} **${author.username}** (先手) vs ${EMOJI_WHITE} **${opponentName}** (後手)`;
            await channel.send({ content: startMessage });

            await handlePlayerTurn(newGame, channel);
            return;
        }

        const currentGame = ongoingGames.get(channelId);
        if (!currentGame) {
            if (['board', 'put', 'end', 'surrender'].includes(subCommand)) {
                await message.reply(`現在このチャンネルで進行中のリバーシゲームはありません。\n開始するには \`${PREFIX}reversi start\``);
            } else {
                await message.reply(`不明なサブコマンド \`${subCommand}\` です。\n\`${PREFIX}reversi help\` でコマンドを確認してください。`);
            }
            return;
        }

        if (subCommand === 'board') {
            await updateGameMessage(currentGame, channel, "現在の盤面:");
            try { await message.delete(); } catch { }
            return;
        }

        if (subCommand === 'put') {
            if (currentGame.gameOver) {
                await message.reply('ゲームは既に終了しています。');
                return;
            }

            const expectedPlayerUser = currentGame.currentPlayer === CellState.Black ? currentGame.playerBlack : currentGame.playerWhite;
            if (expectedPlayerUser === 'AI' || typeof expectedPlayerUser === 'string' || !expectedPlayerUser || expectedPlayerUser.id !== author.id) {
                await message.reply({ content: '⚠️ あなたのターンではありません。' });
                return;
            }

            const coordinate = args[1]?.toUpperCase();
            if (!coordinate || !/^[A-H][1-8]$/.test(coordinate)) {
                await message.reply(`座標の形式が無効です (例: C4)。\`${PREFIX}reversi help\` 参照`);
                return;
            }
            const col = coordinate.charCodeAt(0) - 'A'.charCodeAt(0);
            const row = parseInt(coordinate.substring(1)) - 1;

            if (!isValidMove(currentGame.board, row, col, currentGame.currentPlayer)) {
                let hintText = '';
                if (currentGame.showValidMoves) {
                    hintText = `(盤面画像の ${EMOJI_VALID_HINT_TEXT} 風の印があるマスに置いてください)`;
                } else {
                    hintText = '(置けるマスを確認してください)';
                }
                await message.reply(`❌ そのマス (${coordinate}) には置けません。 ${hintText}`);
                return;
            }

            currentGame.board = flipStones(currentGame.board, row, col, currentGame.currentPlayer);
            const playerWhoMoved = currentGame.currentPlayer;
            currentGame.currentPlayer = playerWhoMoved === CellState.Black ? CellState.White : CellState.Black;

            const { gameOver, winner } = checkGameOver(currentGame.board);
            currentGame.gameOver = gameOver;
            currentGame.winner = winner;

            try { await message.delete(); } catch { }
            const placedEmoji = playerWhoMoved === CellState.Black ? EMOJI_BLACK : EMOJI_WHITE;
            const msgContent = `${placedEmoji} ${author.username} が ${coordinate} に置きました (コマンド入力)`;

            if (gameOver) {
                await updateGameMessage(currentGame, channel, `${msgContent}\n**ゲーム終了！**`);
                cleanupGame(channelId);
            } else {
                await nextTurn(currentGame, channel);
            }
            return;
        }

        if (subCommand === 'end' || subCommand === 'surrender') {
            const isParticipant = currentGame.playerBlack === author || currentGame.playerWhite === author;

            if (subCommand === 'surrender') {
                if (currentGame.gameOver) { await message.reply('ゲームは既に終了しています。'); return; }
                if (!isParticipant) { await message.reply('⚠️ ゲーム参加者のみ投了できます。'); return; }

                currentGame.gameOver = true;
                const surrenderColor = currentGame.playerBlack === author ? CellState.Black : CellState.White;
                currentGame.winner = surrenderColor === CellState.Black ? CellState.White : CellState.Black;
                const winnerEmoji = currentGame.winner === CellState.Black ? EMOJI_BLACK : EMOJI_WHITE;
                const loserEmoji = surrenderColor === CellState.Black ? EMOJI_BLACK : EMOJI_WHITE;
                const winnerName = currentGame.winner === CellState.Black ?
                    (currentGame.playerBlack === 'AI' ? `AI (${currentGame.aiDifficulty})` : currentGame.playerBlack?.username) :
                    (currentGame.playerWhite === 'AI' ? `AI (${currentGame.aiDifficulty})` : currentGame.playerWhite?.username);

                const endMsg = `${loserEmoji} ${author.username} が投了しました！ ${winnerEmoji} ${winnerName ?? ''} の勝ちです。`;
                await updateGameMessage(currentGame, channel, endMsg);
            } else {
                const endMsg = `🛑 ${author.username} によってゲームが強制終了されました。`;
                if (currentGame.messageId && !currentGame.gameOver) {
                    channel.messages.fetch(currentGame.messageId)
                        .then(m => m.edit({ components: [] }).catch(() => { }))
                        .catch(() => { });
                }
                await message.reply(endMsg);
                currentGame.gameOver = true;
            }
            cleanupGame(channelId);
            return;
        }

        await message.reply(`不明なサブコマンド \`${subCommand}\` です。\n\`${PREFIX}reversi help\` でコマンドを確認してください。`);
    },

    handleInteraction: async (interaction: Interaction) => {
        if (!interaction.isButton()) return;

        const customId = interaction.customId;
        const channel = interaction.channel as TextChannel;
        if (!channel) {
            return;
        }
        const channelId = channel.id;
        const user = interaction.user;

        if (customId.startsWith('reversi_select_')) {
            const parts = customId.split('_');
            if (parts.length !== 5) {
                await interaction.reply({ content: '内部エラー: ボタンID解析失敗', ephemeral: true }); return;
            }
            const difficulty = parts[2] as AIDifficulty;
            const starterUserId = parts[3];
            const showHints = parts[4] === '1';

            if (user.id !== starterUserId) {
                await interaction.reply({ content: '⚠️ ゲームを開始した本人のみが難易度を選択できます。', ephemeral: true });
                return;
            }

            if (ongoingGames.has(channelId)) {
                await interaction.reply({ content: '❌ このチャンネルでは既にゲームが進行中です。', ephemeral: true });
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

            const board: CellState[][] = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(CellState.Empty));
            board[3][3] = CellState.White; board[3][4] = CellState.Black;
            board[4][3] = CellState.Black; board[4][4] = CellState.White;

            const newGame: ReversiGameState = {
                board, currentPlayer: CellState.Black, playerBlack: starterUser, playerWhite: 'AI',
                gameOver: false, winner: null, channelId, showValidMoves: showHints,
                isAIGame: true,
                aiDifficulty: difficulty,
                lastMoveSkipped: false, messageId: undefined,
            };
            ongoingGames.set(channelId, newGame);

            let startMessage = `⚪⚫ ${starterUser.username} が AI (${newGame.aiDifficulty}) とのリバーシ対戦を開始！ ⚫⚪`;
            if (showHints) startMessage += ` [ヒント表示有効]`;
            startMessage += `\n${EMOJI_BLACK} **${starterUser.username}** (先手) vs ${EMOJI_WHITE} **AI (${newGame.aiDifficulty})** (後手)`;
            if (newGame.aiDifficulty === 'god') {
                startMessage += `\n*警告: God モードは実験的な機能の為 確実な勝利を取るというわけではありませんが多分相当強いと思うよ*`;
            }
            await channel.send({ content: startMessage });

            await handlePlayerTurn(newGame, channel);
            return;
        }

        const gameState = ongoingGames.get(channelId);

        if (!gameState) {
            await interaction.reply({ content: '👻 このゲームセッションは既に終了しているか、見つかりません。', ephemeral: true });
            try { if (interaction.message.components.length > 0) await interaction.message.edit({ components: [] }); } catch { }
            return;
        }

        if (gameState.gameOver) {
            await interaction.reply({ content: '🏁 ゲームは既に終了しています。', ephemeral: true });
            try { if (interaction.message.components.length > 0) await interaction.message.edit({ components: [] }); } catch { }
            return;
        }

        if (customId.startsWith('reversi_put_')) {
            const expectedPlayerUser = gameState.currentPlayer === CellState.Black ? gameState.playerBlack : gameState.playerWhite;
            if (expectedPlayerUser === 'AI' || typeof expectedPlayerUser === 'string' || !expectedPlayerUser || expectedPlayerUser.id !== user.id) {
                await interaction.reply({ content: "⏳ あなたのターンではありません！", ephemeral: true });
                return;
            }

            const parts = customId.split('_');
            if (parts.length !== 4) {
                await interaction.reply({ content: '内部エラー: ボタンID不正', ephemeral: true }); return;
            }
            const row = parseInt(parts[2]);
            const col = parseInt(parts[3]);

            if (isNaN(row) || isNaN(col)) {
                await interaction.reply({ content: '内部エラー: 座標変換失敗', ephemeral: true }); return;
            }

            if (!isValidMove(gameState.board, row, col, gameState.currentPlayer)) {
                await interaction.reply({ content: "🤔 その手は現在無効です。盤面が更新されたか、他の有効な手を選んでください。", ephemeral: true });
                await updateGameMessage(gameState, channel);
                return;
            }

            await interaction.deferUpdate();

            gameState.board = flipStones(gameState.board, row, col, gameState.currentPlayer);
            const playerWhoMoved = gameState.currentPlayer;
            gameState.currentPlayer = playerWhoMoved === CellState.Black ? CellState.White : CellState.Black;

            const { gameOver, winner } = checkGameOver(gameState.board);
            gameState.gameOver = gameOver;
            gameState.winner = winner;

            const placedEmoji = playerWhoMoved === CellState.Black ? EMOJI_BLACK : EMOJI_WHITE;
            const coordinate = `${COLUMN_LABELS_WIDE[col]}${ROW_LABELS_WIDE[row]}`;
            const msgContent = `${placedEmoji} ${user.username} が ${coordinate} に置きました。`;

            if (gameOver) {
                await updateGameMessage(gameState, channel, `${msgContent}\n**ゲーム終了！**`);
                cleanupGame(channelId);
            } else {
                await nextTurn(gameState, channel);
            }
            return;
        }

        await interaction.reply({ content: "未対応のボタンです。", ephemeral: true });
    }
};

registerCommand(reversiCommand);

function isDangerousCornerNeighbor(board: CellState[][], r: number, c: number): boolean {
    for (const corner of CORNERS) {
        if (board[corner.row][corner.col] === CellState.Empty &&
            Math.abs(r - corner.row) <= 1 && Math.abs(c - corner.col) <= 1 &&
            !(r === corner.row && c === corner.col)
        ) {
            return true;
        }
    }
    return false;
}
function evaluateMoveHard(originalBoard: CellState[][], row: number, col: number, player: CellState): number {
    const opponent = player === CellState.Black ? CellState.White : CellState.Black;
    const board = flipStones(originalBoard, row, col, player);
    let score = 0;

    if (isCorner(row, col)) score += 100;

    if (isDangerousCornerNeighbor(originalBoard, row, col)) score -= 50;

    if (isEdge(row, col)) {
        let isBadEdge = false;
        if ((row === 0 || row === 7) && (col === 1 || col === 6)) isBadEdge = true;
        if ((col === 0 || col === 7) && (row === 1 || row === 6)) isBadEdge = true;
        score += isBadEdge ? -20 : 20;
    }

    let flippedCount = 0;
    for (const dir of DIRECTIONS) {
        flippedCount += checkDirection(originalBoard, row, col, player, dir.dr, dir.dc).length;
    }
    score += flippedCount;

    const opponentValidMoves = getValidMoves(board, opponent);
    score -= opponentValidMoves.length * 2;

    return score;
}
function evaluateMoveSuperHard(originalBoard: CellState[][], row: number, col: number, player: CellState): number {
    let score = evaluateMoveHard(originalBoard, row, col, player);
    const boardAfterMove = flipStones(originalBoard, row, col, player);

    let frontier = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (boardAfterMove[r][c] === player) {
                for (const dir of DIRECTIONS) {
                    const nr = r + dir.dr;
                    const nc = c + dir.dc;
                    if (isOnBoard(nr, nc) && boardAfterMove[nr][nc] === CellState.Empty) {
                        frontier++;
                        break;
                    }
                }
            }
        }
    }
    score -= frontier;

    return score;
}