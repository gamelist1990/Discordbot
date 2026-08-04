import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype, { type Font } from 'opentype.js';
import {
    createCanvas,
    loadImage,
    registerFont,
    type CanvasRenderingContext2D,
    type Image,
} from 'canvas';

const WIDTH = 1200;
const HEIGHT = 675;
const FONT_FAMILY = 'QuoteCardNotoSansJP';
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const FONT_FILE = path.resolve(
    currentDirectory,
    '../../../assets/fonts/NotoSansJP[wght].ttf',
);
const QUOTE_FONT_FILE = path.resolve(
    currentDirectory,
    '../../../assets/fonts/YujiSyuku-Regular.ttf',
);

let fontRegistered = false;
let quoteFont: Font | undefined;

function ensureFont(): void {
    if (!fontRegistered && existsSync(FONT_FILE)) {
        registerFont(FONT_FILE, { family: FONT_FAMILY });
        fontRegistered = true;
    }

    if (!quoteFont && existsSync(QUOTE_FONT_FILE)) {
        const fontBuffer = readFileSync(QUOTE_FONT_FILE);
        const arrayBuffer = fontBuffer.buffer.slice(
            fontBuffer.byteOffset,
            fontBuffer.byteOffset + fontBuffer.byteLength,
        );
        quoteFont = opentype.parse(arrayBuffer);
    }
}

export type QuoteCardStyle =
    | 'midnight'
    | 'editorial'
    | 'aurora'
    | 'mono'
    | 'sunset'
    | 'random';

export interface QuoteCardOptions {
    quote: string;
    authorName: string;
    authorHandle: string;
    avatarUrl?: string;
    contentImageUrl?: string;
    style?: QuoteCardStyle;
    seed?: string;
}

interface Palette {
    backgroundA: string;
    backgroundB: string;
    foreground: string;
    muted: string;
    accent: string;
    panel: string;
}

const STYLE_ORDER: Exclude<QuoteCardStyle, 'random'>[] = [
    'midnight',
    'editorial',
    'aurora',
    'mono',
    'sunset',
];

const PALETTES: Record<Exclude<QuoteCardStyle, 'random'>, Palette> = {
    midnight: {
        backgroundA: '#090b16',
        backgroundB: '#161a31',
        foreground: '#f7f7fb',
        muted: '#999fb7',
        accent: '#8b7cff',
        panel: 'rgba(255,255,255,0.055)',
    },
    editorial: {
        backgroundA: '#f2eee5',
        backgroundB: '#d8d0c0',
        foreground: '#161616',
        muted: '#706b63',
        accent: '#b43a32',
        panel: 'rgba(255,255,255,0.45)',
    },
    aurora: {
        backgroundA: '#071c22',
        backgroundB: '#17323d',
        foreground: '#efffff',
        muted: '#9bc1c2',
        accent: '#63f3c6',
        panel: 'rgba(3,18,23,0.42)',
    },
    mono: {
        backgroundA: '#050505',
        backgroundB: '#202020',
        foreground: '#ffffff',
        muted: '#999999',
        accent: '#ffffff',
        panel: 'rgba(255,255,255,0.06)',
    },
    sunset: {
        backgroundA: '#24131f',
        backgroundB: '#5a2830',
        foreground: '#fff8ee',
        muted: '#e1b9ad',
        accent: '#ffb35c',
        panel: 'rgba(31,10,18,0.33)',
    },
};

function hash(value: string): number {
    let result = 2166136261;
    for (const character of value) {
        result ^= character.charCodeAt(0);
        result = Math.imul(result, 16777619);
    }
    return result >>> 0;
}

function resolveStyle(style: QuoteCardStyle, seed: string): Exclude<QuoteCardStyle, 'random'> {
    if (style !== 'random') return style;
    return STYLE_ORDER[hash(seed) % STYLE_ORDER.length];
}

function setFont(ctx: CanvasRenderingContext2D, size: number, weight = 500): void {
    const family = fontRegistered ? `"${FONT_FAMILY}"` : 'sans-serif';
    ctx.font = `${weight} ${size}px ${family}`;
}

function measureQuoteText(
    ctx: CanvasRenderingContext2D,
    text: string,
    size: number,
): number {
    if (quoteFont) return quoteFont.getAdvanceWidth(text, size);
    setFont(ctx, size, 500);
    return ctx.measureText(text).width;
}

function drawQuoteText(
    ctx: CanvasRenderingContext2D,
    text: string,
    centerX: number,
    baselineY: number,
    size: number,
): void {
    if (!quoteFont) {
        setFont(ctx, size, 500);
        ctx.fillText(text, centerX, baselineY);
        return;
    }

    const width = quoteFont.getAdvanceWidth(text, size);
    const glyphPath = quoteFont.getPath(text, centerX - width / 2, baselineY, size);
    glyphPath.fill = '#ffffff';
    // opentype.jsはブラウザー標準Canvasの型を要求するが、node-canvasの
    // 実行時APIは描画に必要なメソッドを備えているため、期待される型へ橋渡しする。
    glyphPath.draw(ctx as unknown as Parameters<typeof glyphPath.draw>[0]);
}

function splitLongToken(
    token: string,
    maxWidth: number,
    measureText: (text: string) => number,
): string[] {
    const pieces: string[] = [];
    let current = '';

    for (const character of token) {
        const candidate = current + character;
        if (current && measureText(candidate) > maxWidth) {
            pieces.push(current);
            current = character;
        } else {
            current = candidate;
        }
    }

    if (current) pieces.push(current);
    return pieces;
}

function wrapText(
    text: string,
    maxWidth: number,
    measureText: (text: string) => number,
): string[] {
    const lines: string[] = [];
    for (const paragraph of text.replace(/\r/g, '').split('\n')) {
        if (!paragraph) {
            lines.push('');
            continue;
        }

        const tokens = paragraph.includes(' ')
            ? paragraph.split(/(\s+)/u).filter(Boolean)
            : [...paragraph];

        let line = '';
        for (const token of tokens) {
            const candidate = line + token;
            if (!line || measureText(candidate) <= maxWidth) {
                line = candidate;
                continue;
            }

            lines.push(line.trimEnd());
            if (measureText(token) <= maxWidth) {
                line = token.trimStart();
            } else {
                const pieces = splitLongToken(token, maxWidth, measureText);
                lines.push(...pieces.slice(0, -1));
                line = pieces.at(-1) ?? '';
            }
        }
        if (line) lines.push(line.trimEnd());
    }
    return lines;
}

function fitQuote(
    ctx: CanvasRenderingContext2D,
    quote: string,
    maxWidth: number,
    maxHeight: number,
): { lines: string[]; size: number; lineHeight: number } {
    for (let size = 62; size >= 30; size -= 2) {
        const measureText = (text: string): number => measureQuoteText(ctx, text, size);
        const lines = wrapText(quote, maxWidth, measureText);
        const lineHeight = Math.round(size * 1.38);
        if (lines.length * lineHeight <= maxHeight) return { lines, size, lineHeight };
    }

    const measureText = (text: string): number => measureQuoteText(ctx, text, 30);
    const lines = wrapText(quote, maxWidth, measureText).slice(0, 8);
    if (lines.length === 8) {
        let last = lines[7];
        while (last && measureText(`${last}…`) > maxWidth) last = last.slice(0, -1);
        lines[7] = `${last}…`;
    }
    return { lines, size: 30, lineHeight: 42 };
}

function drawBackground(
    ctx: CanvasRenderingContext2D,
    palette: Palette,
    style: Exclude<QuoteCardStyle, 'random'>,
    seed: number,
): void {
    const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, palette.backgroundA);
    gradient.addColorStop(1, palette.backgroundB);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    if (style === 'editorial') {
        ctx.fillStyle = 'rgba(0,0,0,0.035)';
        for (let y = 0; y < HEIGHT; y += 8) ctx.fillRect(0, y, WIDTH, 1);
        ctx.fillStyle = palette.accent;
        ctx.fillRect(0, 0, 18, HEIGHT);
        return;
    }

    if (style === 'mono') {
        const glow = ctx.createRadialGradient(170, 140, 10, 170, 140, 430);
        glow.addColorStop(0, 'rgba(255,255,255,0.16)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        return;
    }

    const positions = [
        [130 + seed % 180, 90 + seed % 130, 360],
        [920 - seed % 140, 520 - seed % 90, 440],
    ];

    for (const [x, y, radius] of positions) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, `${palette.accent}55`);
        glow.addColorStop(1, `${palette.accent}00`);
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
}

function drawCoverImage(
    ctx: CanvasRenderingContext2D,
    image: Image,
    x: number,
    y: number,
    width: number,
    height: number,
): void {
    const scale = Math.max(width / image.width, height / image.height);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sourceX = (image.width - sourceWidth) / 2;
    const sourceY = (image.height - sourceHeight) / 2;
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawContainedImage(
    ctx: CanvasRenderingContext2D,
    image: Image,
    x: number,
    y: number,
    width: number,
    height: number,
): void {
    const scale = Math.min(width / image.width, height / image.height);
    const targetWidth = image.width * scale;
    const targetHeight = image.height * scale;
    const targetX = x + (width - targetWidth) / 2;
    const targetY = y + (height - targetHeight) / 2;

    ctx.drawImage(image, targetX, targetY, targetWidth, targetHeight);
}

export async function renderQuoteCard(options: QuoteCardOptions): Promise<Buffer> {
    ensureFont();

    const seedText = options.seed ?? `${options.authorHandle}:${options.quote}`;
    const seed = hash(seedText);
    const style = resolveStyle(options.style ?? 'random', seedText);
    const palette = PALETTES[style];
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const imageWidth = 570;
    // 左側は常に投稿者のアイコンを表示する。
    if (options.avatarUrl) {
        try {
            const avatar = await loadImage(options.avatarUrl);
            drawCoverImage(ctx, avatar, 0, 0, imageWidth, HEIGHT);

            const monochrome = ctx.getImageData(0, 0, imageWidth, HEIGHT);
            for (let index = 0; index < monochrome.data.length; index += 4) {
                const gray = Math.round(
                    monochrome.data[index] * 0.299 +
                    monochrome.data[index + 1] * 0.587 +
                    monochrome.data[index + 2] * 0.114,
                );
                monochrome.data[index] = gray;
                monochrome.data[index + 1] = gray;
                monochrome.data[index + 2] = gray;
            }
            ctx.putImageData(monochrome, 0, 0);
        } catch {
            drawBackground(ctx, palette, style, seed);
        }
    } else {
        drawBackground(ctx, palette, style, seed);
    }

    const fade = ctx.createLinearGradient(250, 0, 650, 0);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.72, 'rgba(0,0,0,0.88)');
    fade.addColorStop(1, '#000000');
    ctx.fillStyle = fade;
    ctx.fillRect(250, 0, 400, HEIGHT);

    let contentImage: Image | undefined;
    if (options.contentImageUrl) {
        try {
            contentImage = await loadImage(options.contentImageUrl);
        } catch {
            // 添付画像を読み込めない場合でも、本文だけのカード生成は継続する。
        }
    }

    if (contentImage) {
        // 画像付きメッセージでは、横長の添付画像を上部へ配置し、
        // その下に本文を表示する。画像の縦横比は変更しない。
        const panelWidth = 520;
        const panelX = 620;
        const panelY = 32;
        const maximumPanelHeight = 270;
        const minimumPanelHeight = 120;
        const nativePanelHeight =
            panelWidth * (contentImage.height / contentImage.width);
        const panelHeight = Math.max(
            minimumPanelHeight,
            Math.min(maximumPanelHeight, nativePanelHeight),
        );
        const radius = 16;

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(panelX, panelY, panelWidth, panelHeight, radius);
        ctx.clip();

        // 余白にはブラー画像を敷かず、カード背景をそのまま使用する。
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(panelX, panelY, panelWidth, panelHeight);

        drawContainedImage(
            ctx,
            contentImage,
            panelX,
            panelY,
            panelWidth,
            panelHeight,
        );
        ctx.restore();

        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(panelX, panelY, panelWidth, panelHeight, radius);
        ctx.stroke();

        // 本文との間に控えめな余白を確保する。
        const separatorY = panelY + panelHeight + 14;
        const separator = ctx.createLinearGradient(
            panelX,
            0,
            panelX + panelWidth,
            0,
        );
        separator.addColorStop(0, 'rgba(255,255,255,0)');
        separator.addColorStop(0.15, 'rgba(255,255,255,0.12)');
        separator.addColorStop(0.85, 'rgba(255,255,255,0.12)');
        separator.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = separator;
        ctx.fillRect(panelX, separatorY, panelWidth, 1);
    }

    const sanitizedQuote = options.quote.trim().slice(0, 850);
    const quoteCenterX = 875;
    const contentImageHeight = contentImage
        ? Math.max(
              120,
              Math.min(270, 520 * (contentImage.height / contentImage.width)),
          )
        : 0;
    const quoteTop = contentImage ? 32 + contentImageHeight + 30 : 115;
    const quoteMaxHeight = contentImage
        ? Math.max(110, 470 - quoteTop)
        : 330;
    const quoteMaxWidth = 500;
    const fitted = fitQuote(ctx, sanitizedQuote, quoteMaxWidth, quoteMaxHeight);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';

    const totalHeight = fitted.lines.length * fitted.lineHeight;
    let y =
        quoteTop +
        Math.max(0, (quoteMaxHeight - totalHeight) / 2) +
        fitted.size;
    for (const line of fitted.lines) {
        drawQuoteText(ctx, line, quoteCenterX, y, fitted.size);
        y += fitted.lineHeight;
    }

    ctx.fillStyle = '#ffffff';
    setFont(ctx, 26, 600);
    ctx.fillText(`- ${options.authorName.slice(0, 40)}`, 875, 500);

    ctx.fillStyle = '#777777';
    setFont(ctx, 19, 500);
    ctx.fillText(`@${options.authorHandle.slice(0, 32)}`, 875, 534);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#666666';
    setFont(ctx, 16, 500);
    ctx.fillText('Make by pexserver.com', WIDTH - 32, HEIGHT - 25);

    return canvas.toBuffer('image/png');
}