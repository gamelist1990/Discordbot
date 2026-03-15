import { createCanvas, type CanvasRenderingContext2D } from 'canvas';
import { formatTimestamp } from './formatters.js';

const OFFLINE_IMAGE_COPY = {
    // Keep these labels ASCII-safe in source so editor encoding never reintroduces mojibake.
    monitorTitle: '\u30b5\u30fc\u30d0\u30fc\u30b9\u30c6\u30fc\u30bf\u30b9',
    offlineHeadline: '\u30b5\u30fc\u30d0\u30fc\u306f\u30aa\u30d5\u30e9\u30a4\u30f3\u3067\u3059',
    offlineDescription:
        '\u30b9\u30c6\u30fc\u30bf\u30b9\u753b\u50cf\u306e\u53d6\u5f97\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002',
    lastOnlineLabel: '\u6700\u7d42\u30aa\u30f3\u30e9\u30a4\u30f3',
    checkedAtLabel: '\u6700\u7d42\u78ba\u8a8d',
} as const;

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
    ctx.font = '700 42px sans-serif';
    ctx.fillText(OFFLINE_IMAGE_COPY.monitorTitle, 148, 158);

    ctx.font = '700 84px sans-serif';
    ctx.fillText(OFFLINE_IMAGE_COPY.offlineHeadline, 88, 278);

    ctx.fillStyle = '#ffd7de';
    ctx.font = '500 34px sans-serif';
    ctx.fillText(OFFLINE_IMAGE_COPY.offlineDescription, 92, 348);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
    drawRoundedRect(ctx, 84, 404, 1112, 180, 24);
    ctx.fill();

    ctx.fillStyle = '#ffedf0';
    ctx.font = '600 28px sans-serif';
    ctx.fillText(OFFLINE_IMAGE_COPY.lastOnlineLabel, 120, 462);
    ctx.font = '700 48px sans-serif';
    ctx.fillText(formatTimestamp(lastOnlineAt), 120, 525);

    ctx.fillStyle = '#ffd7de';
    ctx.font = '600 24px sans-serif';
    ctx.fillText(`${OFFLINE_IMAGE_COPY.checkedAtLabel}: ${formatTimestamp(checkedAt)}`, 120, 622);

    return canvas.toBuffer('image/png');
}
