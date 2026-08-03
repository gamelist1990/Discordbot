export type OthelloDisc = 'black' | 'white';
export type OthelloCell = OthelloDisc | null;
export type OthelloBoard = OthelloCell[];
export type OthelloDifficulty = 'easy' | 'normal' | 'hard';

export interface OthelloMove {
    index: number;
    flips: number[];
}

const DIRECTIONS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
] as const;

export function opponentOf(player: OthelloDisc): OthelloDisc {
    return player === 'black' ? 'white' : 'black';
}

export function createInitialBoard(): OthelloBoard {
    const board: OthelloBoard = Array.from({ length: 64 }, () => null);
    board[27] = 'white';
    board[28] = 'black';
    board[35] = 'black';
    board[36] = 'white';
    return board;
}

export function getFlips(board: OthelloBoard, index: number, player: OthelloDisc): number[] {
    if (index < 0 || index >= 64 || board[index] !== null) {
        return [];
    }

    const row = Math.floor(index / 8);
    const column = index % 8;
    const opponent = opponentOf(player);
    const allFlips: number[] = [];

    for (const [rowStep, columnStep] of DIRECTIONS) {
        let nextRow = row + rowStep;
        let nextColumn = column + columnStep;
        const line: number[] = [];

        while (nextRow >= 0 && nextRow < 8 && nextColumn >= 0 && nextColumn < 8) {
            const nextIndex = nextRow * 8 + nextColumn;
            const cell = board[nextIndex];

            if (cell === opponent) {
                line.push(nextIndex);
            } else {
                if (cell === player && line.length > 0) {
                    allFlips.push(...line);
                }
                break;
            }

            nextRow += rowStep;
            nextColumn += columnStep;
        }
    }

    return allFlips;
}

export function getValidMoves(board: OthelloBoard, player: OthelloDisc): OthelloMove[] {
    const result: OthelloMove[] = [];
    for (let index = 0; index < 64; index += 1) {
        const flips = getFlips(board, index, player);
        if (flips.length > 0) {
            result.push({ index, flips });
        }
    }
    return result;
}

export function applyMove(board: OthelloBoard, index: number, player: OthelloDisc): OthelloBoard {
    const flips = getFlips(board, index, player);
    if (flips.length === 0) {
        throw new Error('そのマスには置けません。番号を確認してください。');
    }

    const next = board.slice();
    next[index] = player;
    for (const flipIndex of flips) {
        next[flipIndex] = player;
    }
    return next;
}

export function countDiscs(board: OthelloBoard): { black: number; white: number; empty: number } {
    return board.reduce(
        (counts, cell) => {
            if (cell === 'black') counts.black += 1;
            else if (cell === 'white') counts.white += 1;
            else counts.empty += 1;
            return counts;
        },
        { black: 0, white: 0, empty: 0 }
    );
}

export function isGameOver(board: OthelloBoard): boolean {
    return getValidMoves(board, 'black').length === 0 && getValidMoves(board, 'white').length === 0;
}

function positionalScore(index: number): number {
    const weights = [
        120, -25, 20, 5, 5, 20, -25, 120,
        -25, -45, -5, -5, -5, -5, -45, -25,
        20, -5, 15, 3, 3, 15, -5, 20,
        5, -5, 3, 3, 3, 3, -5, 5,
        5, -5, 3, 3, 3, 3, -5, 5,
        20, -5, 15, 3, 3, 15, -5, 20,
        -25, -45, -5, -5, -5, -5, -45, -25,
        120, -25, 20, 5, 5, 20, -25, 120
    ];
    return weights[index] || 0;
}

function evaluate(board: OthelloBoard, player: OthelloDisc): number {
    const opponent = opponentOf(player);
    const counts = countDiscs(board);
    const discDifference = player === 'black'
        ? counts.black - counts.white
        : counts.white - counts.black;
    const mobility = getValidMoves(board, player).length - getValidMoves(board, opponent).length;
    let positions = 0;

    for (let index = 0; index < board.length; index += 1) {
        if (board[index] === player) positions += positionalScore(index);
        if (board[index] === opponent) positions -= positionalScore(index);
    }

    return discDifference * 2 + mobility * 8 + positions;
}

function minimax(
    board: OthelloBoard,
    current: OthelloDisc,
    maximizingPlayer: OthelloDisc,
    depth: number,
    alpha: number,
    beta: number
): number {
    if (depth === 0 || isGameOver(board)) {
        return evaluate(board, maximizingPlayer);
    }

    const moves = getValidMoves(board, current);
    if (moves.length === 0) {
        return minimax(board, opponentOf(current), maximizingPlayer, depth - 1, alpha, beta);
    }

    if (current === maximizingPlayer) {
        let best = Number.NEGATIVE_INFINITY;
        for (const move of moves) {
            best = Math.max(
                best,
                minimax(applyMove(board, move.index, current), opponentOf(current), maximizingPlayer, depth - 1, alpha, beta)
            );
            alpha = Math.max(alpha, best);
            if (beta <= alpha) break;
        }
        return best;
    }

    let best = Number.POSITIVE_INFINITY;
    for (const move of moves) {
        best = Math.min(
            best,
            minimax(applyMove(board, move.index, current), opponentOf(current), maximizingPlayer, depth - 1, alpha, beta)
        );
        beta = Math.min(beta, best);
        if (beta <= alpha) break;
    }
    return best;
}

export function chooseBotMove(
    board: OthelloBoard,
    player: OthelloDisc,
    difficulty: OthelloDifficulty
): OthelloMove | null {
    const moves = getValidMoves(board, player);
    if (moves.length === 0) {
        return null;
    }

    if (difficulty === 'easy') {
        return moves[Math.floor(Math.random() * moves.length)];
    }

    if (difficulty === 'normal') {
        return [...moves].sort((left, right) =>
            right.flips.length + positionalScore(right.index)
            - left.flips.length - positionalScore(left.index)
        )[0];
    }

    const depth = countDiscs(board).empty <= 14 ? 5 : 3;
    return [...moves]
        .map((move) => ({
            move,
            score: minimax(
                applyMove(board, move.index, player),
                opponentOf(player),
                player,
                depth,
                Number.NEGATIVE_INFINITY,
                Number.POSITIVE_INFINITY
            )
        }))
        .sort((left, right) => right.score - left.score)[0].move;
}

export function cellNumber(index: number): string {
    return String(index + 1);
}