import { createCanvas, type CanvasRenderingContext2D } from 'canvas';
import { formatTimestamp } from './formatters.js';

function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
): void {
    const effectiveRadius = Math.min(radius, width / 2, height / 2);

    ctx.beginPath();
    ctx.moveTo(x + effectiveRadius, y);
    ctx.lineTo(x + width - effectiveRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + effectiveRadius);
    ctx.lineTo(x + width, y + height - effectiveRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - effectiveRadius, y + height);
    ctx.lineTo(x + effectiveRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - effectiveRadius);
    ctx.lineTo(x, y + effectiveRadius);
    ctx.quadraticCurveTo(x, y, x + effectiveRadius, y);
    ctx.closePath();
}

export function buildOfflineStatusImage(lastOnlineAt: number | null, checkedAt: number): Buffer {
    const canvas = createCanvas(1280, 720);
    const ctx = canvas.getContext('2d');

    const background = ctx.createLinearGradient(0, 0, 1280, 720);
    background.addColorStop(0, '#14070d');
    background.addColorStop(0.55, '#2a1019');
    background.addColorStop(1, '#45111f');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    drawRoundedRect(ctx, 48, 48, 1184, 624, 30);
    ctx.fill();

    ctx.fillStyle = '#ff5d73';
    ctx.beginPath();
    ctx.arc(108, 144, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff5f7';
    ctx.font = '700 44px sans-serif';
    ctx.fillText('STATUS MONITOR', 148, 158);

    ctx.font = '700 92px sans-serif';
    ctx.fillText('Server is offline', 88, 278);

    ctx.fillStyle = '#ffd7de';
    ctx.font = '500 34px sans-serif';
    ctx.fillText('The image endpoint is currently unavailable.', 92, 348);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
    drawRoundedRect(ctx, 84, 404, 1112, 180, 24);
    ctx.fill();

    ctx.fillStyle = '#ffedf0';
    ctx.font = '600 28px sans-serif';
    ctx.fillText('Last online', 120, 462);
    ctx.font = '700 48px sans-serif';
    ctx.fillText(formatTimestamp(lastOnlineAt), 120, 525);

    ctx.fillStyle = '#ffd7de';
    ctx.font = '600 24px sans-serif';
    ctx.fillText(`Checked at: ${formatTimestamp(checkedAt)}`, 120, 622);

    return canvas.toBuffer('image/png');
}
