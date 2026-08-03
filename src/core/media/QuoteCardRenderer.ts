import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const FONT_FILE = path.resolve(currentDirectory, '../../../assets/fonts/NotoSansJP[wght].ttf');

let fontRegistered = false;

function ensureFont(): void {
    if (fontRegistered || !existsSync(FONT_FILE)) return;
    registerFont(FONT_FILE, { family: FONT_FAMILY });
    fontRegistered = true;
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

function splitLongToken(ctx: CanvasRenderingContext2D, token: string, maxWidth: number): string[] {
    const pieces: string[] = [];
    let current = '';

    for (const character of token) {
        const candidate = current + character;
        if (current && ctx.measureText(candidate).width > maxWidth) {
            pieces.push(current);
            current = character;
        } else {
            current = candidate;
        }
    }

    if (current) pieces.push(current);
    return pieces;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
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
            if (!line || ctx.measureText(candidate).width <= maxWidth) {
                line = candidate;
                continue;
            }

            lines.push(line.trimEnd());
            if (ctx.measureText(token).width <= maxWidth) {
                line = token.trimStart();
            } else {
                const pieces = splitLongToken(ctx, token, maxWidth);
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
        setFont(ctx, size, 600);
        const lines = wrapText(ctx, quote, maxWidth);
        const lineHeight = Math.round(size * 1.38);
        if (lines.length * lineHeight <= maxHeight) return { lines, size, lineHeight };
    }

    setFont(ctx, 30, 600);
    const lines = wrapText(ctx, quote, maxWidth).slice(0, 8);
    if (lines.length === 8) {
        let last = lines[7];
        while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
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

    const sanitizedQuote = options.quote.trim().slice(0, 850);
    const fitted = fitQuote(ctx, sanitizedQuote, 520, 330);
    setFont(ctx, fitted.size, 500);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';

    const totalHeight = fitted.lines.length * fitted.lineHeight;
    let y = 115 + Math.max(0, (330 - totalHeight) / 2) + fitted.size;
    for (const line of fitted.lines) {
        ctx.fillText(line, 875, y);
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