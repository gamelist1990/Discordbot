import { createCanvas } from 'canvas';
import GIFEncoder from 'gif-encoder-2';
import { OthelloBoard, OthelloDisc, getValidMoves } from './OthelloEngine.js';

const BOARD_SIZE = 720;
const PADDING = 40;
const CELL_SIZE = 80;

export function renderOthelloBoard(
    board: OthelloBoard,
    turn: OthelloDisc,
    lastMove: number | null = null
): Buffer {
    return renderOthelloCanvas(board, turn, lastMove).toBuffer('image/png');
}

export function renderOthelloReplay(
    boards: OthelloBoard[],
    finalTurn: OthelloDisc,
    lastMove: number | null = null
): Buffer {
    const frames = boards.length > 0 ? boards : [Array.from({ length: 64 }, () => null)];
    const encoder = new GIFEncoder(BOARD_SIZE, BOARD_SIZE + 96, 'neuquant', true);
    encoder.start();
    encoder.setRepeat(0);
    encoder.setQuality(10);

    for (let index = 0; index < frames.length; index += 1) {
        encoder.setDelay(index === frames.length - 1 ? 2200 : 550);
        const frame = renderOthelloCanvas(
            frames[index],
            index === frames.length - 1 ? finalTurn : index % 2 === 0 ? 'black' : 'white',
            index === frames.length - 1 ? lastMove : null
        );
        encoder.addFrame(frame.getContext('2d'));
    }

    encoder.finish();
    return encoder.out.getData();
}

function renderOthelloCanvas(
    board: OthelloBoard,
    turn: OthelloDisc,
    lastMove: number | null = null
) {
    const canvas = createCanvas(BOARD_SIZE, BOARD_SIZE + 96);
    const context = canvas.getContext('2d');
    const validMoves = new Set(getValidMoves(board, turn).map((move) => move.index));

    const background = context.createLinearGradient(0, 0, BOARD_SIZE, BOARD_SIZE + 96);
    background.addColorStop(0, '#102b22');
    background.addColorStop(1, '#071813');
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = '#f3fff9';
    context.font = '700 28px sans-serif';
    context.fillText(`オセロ  ${turn === 'black' ? '黒' : '白'}のターン`, PADDING, 34);

    for (let row = 0; row < 8; row += 1) {
        for (let column = 0; column < 8; column += 1) {
            const index = row * 8 + column;
            const x = PADDING + column * CELL_SIZE;
            const y = 56 + row * CELL_SIZE;

            const cellGradient = context.createLinearGradient(x, y, x + CELL_SIZE, y + CELL_SIZE);
            cellGradient.addColorStop(0, '#35ae77');
            cellGradient.addColorStop(1, '#21885c');
            context.fillStyle = cellGradient;
            context.fillRect(x, y, CELL_SIZE, CELL_SIZE);

            context.strokeStyle = 'rgba(4, 61, 40, 0.8)';
            context.lineWidth = 2;
            context.strokeRect(x, y, CELL_SIZE, CELL_SIZE);

            if (lastMove === index) {
                context.strokeStyle = '#ffe16a';
                context.lineWidth = 5;
                context.strokeRect(x + 3, y + 3, CELL_SIZE - 6, CELL_SIZE - 6);
            }

            context.fillStyle = 'rgba(255, 255, 255, 0.78)';
            context.font = '700 14px sans-serif';
            context.fillText(String(index + 1), x + 7, y + 18);

            const cell = board[index];
            if (cell) {
                drawDisc(context, x + CELL_SIZE / 2, y + CELL_SIZE / 2 + 4, 27, cell);
            } else if (validMoves.has(index)) {
                context.beginPath();
                context.arc(x + CELL_SIZE / 2, y + CELL_SIZE / 2 + 5, 8, 0, Math.PI * 2);
                context.fillStyle = 'rgba(224, 255, 239, 0.64)';
                context.fill();
                context.strokeStyle = 'rgba(255, 255, 255, 0.42)';
                context.lineWidth = 5;
                context.stroke();
            }
        }
    }

    const black = board.filter((cell) => cell === 'black').length;
    const white = board.filter((cell) => cell === 'white').length;
    context.fillStyle = '#f3fff9';
    context.font = '700 25px sans-serif';
    context.fillText(`黒 ${black}`, PADDING, BOARD_SIZE + 62);
    context.fillText(`白 ${white}`, PADDING + 145, BOARD_SIZE + 62);

    context.fillStyle = '#acd8c5';
    context.font = '500 18px sans-serif';
    context.fillText('操作ボタンの番号と盤面の番号が対応しています', PADDING + 290, BOARD_SIZE + 62);

    return canvas;
}

function drawDisc(
    context: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
    centerX: number,
    centerY: number,
    radius: number,
    disc: OthelloDisc
): void {
    const gradient = context.createRadialGradient(
        centerX - radius * 0.35,
        centerY - radius * 0.35,
        radius * 0.1,
        centerX,
        centerY,
        radius
    );

    if (disc === 'black') {
        gradient.addColorStop(0, '#565b58');
        gradient.addColorStop(0.55, '#171b19');
        gradient.addColorStop(1, '#050706');
    } else {
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(0.65, '#e6ebe8');
        gradient.addColorStop(1, '#bcc6c1');
    }

    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fillStyle = gradient;
    context.shadowColor = 'rgba(0, 0, 0, 0.4)';
    context.shadowBlur = 8;
    context.shadowOffsetY = 4;
    context.fill();
    context.shadowColor = 'transparent';
}