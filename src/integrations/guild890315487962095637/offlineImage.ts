import { existsSync } from 'fs';
import { createCanvas, registerFont, type CanvasRenderingContext2D } from 'canvas';
import { Logger } from '../../utils/Logger.js';
import { OFFLINE_IMAGE_FONT_FAMILY, OFFLINE_IMAGE_FONT_FILE } from './constants.js';
import { formatTimestamp } from './formatters.js';

interface OfflineImageCopy {
    readonly monitorTitle: string;
    readonly offlineHeadline: string;
    readonly offlineDescription: string;
    readonly lastOnlineLabel: string;
    readonly checkedAtLabel: string;
    readonly noRecordLabel: string;
    readonly monitorTitleFontSize: number;
    readonly offlineHeadlineFontSize: number;
    readonly drawBoldOutline: boolean;
}

const JA_OFFLINE_IMAGE_COPY: OfflineImageCopy = {
    // Keep these labels ASCII-safe in source so editor encoding never reintroduces mojibake.
    monitorTitle: '\u30b5\u30fc\u30d0\u30fc\u30b9\u30c6\u30fc\u30bf\u30b9',
    offlineHeadline: '\u30b5\u30fc\u30d0\u30fc\u306f\u30aa\u30d5\u30e9\u30a4\u30f3\u3067\u3059',
    offlineDescription:
        '\u30b9\u30c6\u30fc\u30bf\u30b9\u753b\u50cf\u306e\u53d6\u5f97\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002',
    lastOnlineLabel: '\u6700\u7d42\u30aa\u30f3\u30e9\u30a4\u30f3',
    checkedAtLabel: '\u6700\u7d42\u78ba\u8a8d',
    noRecordLabel: '\u8a18\u9332\u306a\u3057',
    monitorTitleFontSize: 42,
    offlineHeadlineFontSize: 84,
    drawBoldOutline: true,
};

const EN_OFFLINE_IMAGE_COPY: OfflineImageCopy = {
    monitorTitle: 'STATUS MONITOR',
    offlineHeadline: 'Server is offline',
    offlineDescription: 'The image endpoint is currently unavailable.',
    lastOnlineLabel: 'Last online',
    checkedAtLabel: 'Checked at',
    noRecordLabel: 'No record',
    monitorTitleFontSize: 44,
    offlineHeadlineFontSize: 92,
    drawBoldOutline: false,
};

let didAttemptFontRegistration = false;
let hasJapaneseFont = false;

function ensureOfflineImageFont(): boolean {
    if (didAttemptFontRegistration) {
        return hasJapaneseFont;
    }

    didAttemptFontRegistration = true;

    if (!existsSync(OFFLINE_IMAGE_FONT_FILE)) {
        Logger.warn(
            `[Guild890315487962095637] Offline image font was not found at ${OFFLINE_IMAGE_FONT_FILE}; falling back to ASCII copy`,
        );
        return false;
    }

    try {
        registerFont(OFFLINE_IMAGE_FONT_FILE, {
            family: OFFLINE_IMAGE_FONT_FAMILY,
        });
        hasJapaneseFont = true;
    } catch (error) {
        Logger.warn('[Guild890315487962095637] Failed to register offline image font; falling back to ASCII copy:', error);
    }

    return hasJapaneseFont;
}

function resolveOfflineImageCopy(): OfflineImageCopy {
    return ensureOfflineImageFont() ? JA_OFFLINE_IMAGE_COPY : EN_OFFLINE_IMAGE_COPY;
}

function setFont(
    ctx: CanvasRenderingContext2D,
    size: number,
    weight: number,
    useJapaneseFont: boolean,
): void {
    if (useJapaneseFont) {
        ctx.font = `${size}px "${OFFLINE_IMAGE_FONT_FAMILY}"`;
        return;
    }

    ctx.font = `${weight} ${size}px sans-serif`;
}

function drawText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    size: number,
    weight: number,
    useJapaneseFont: boolean,
    outlineWidth = 0,
): void {
    setFont(ctx, size, weight, useJapaneseFont);

    if (outlineWidth > 0) {
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = outlineWidth;
        ctx.strokeStyle = String(ctx.fillStyle);
        ctx.strokeText(text, x, y);
        ctx.restore();
    }

    ctx.fillText(text, x, y);
}

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
    const copy = resolveOfflineImageCopy();
    const useJapaneseFont = copy === JA_OFFLINE_IMAGE_COPY;
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
    drawText(ctx, copy.monitorTitle, 148, 158, copy.monitorTitleFontSize, 700, useJapaneseFont, copy.drawBoldOutline ? 0.9 : 0);

    drawText(
        ctx,
        copy.offlineHeadline,
        88,
        278,
        copy.offlineHeadlineFontSize,
        700,
        useJapaneseFont,
        copy.drawBoldOutline ? 1.6 : 0,
    );

    ctx.fillStyle = '#ffd7de';
    drawText(ctx, copy.offlineDescription, 92, 348, 34, 500, useJapaneseFont, copy.drawBoldOutline ? 0.5 : 0);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
    drawRoundedRect(ctx, 84, 404, 1112, 180, 24);
    ctx.fill();

    ctx.fillStyle = '#ffedf0';
    drawText(ctx, copy.lastOnlineLabel, 120, 462, 28, 600, useJapaneseFont, copy.drawBoldOutline ? 0.5 : 0);
    drawText(
        ctx,
        formatTimestamp(lastOnlineAt, copy.noRecordLabel),
        120,
        525,
        48,
        700,
        useJapaneseFont,
        copy.drawBoldOutline ? 1.1 : 0,
    );

    ctx.fillStyle = '#ffd7de';
    drawText(
        ctx,
        `${copy.checkedAtLabel}: ${formatTimestamp(checkedAt, copy.noRecordLabel)}`,
        120,
        622,
        24,
        600,
        useJapaneseFont,
        copy.drawBoldOutline ? 0.4 : 0,
    );

    return canvas.toBuffer('image/png');
}
