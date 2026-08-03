import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createCanvas,
    registerFont,
    type CanvasRenderingContext2D,
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

function roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
): void {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
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

function drawAvatarMark(
    ctx: CanvasRenderingContext2D,
    authorName: string,
    x: number,
    y: number,
    palette: Palette,
): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 32, 0, Math.PI * 2);
    ctx.fillStyle = palette.accent;
    ctx.fill();

    const initial = [...authorName.trim()][0]?.toUpperCase() ?? '?';
    ctx.fillStyle = palette.backgroundA;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    setFont(ctx, 26, 800);
    ctx.fillText(initial, x, y + 1);
    ctx.restore();
}

export function renderQuoteCard(options: QuoteCardOptions): Buffer {
    ensureFont();

    const seedText = options.seed ?? `${options.authorHandle}:${options.quote}`;
    const seed = hash(seedText);
    const style = resolveStyle(options.style ?? 'random', seedText);
    const palette = PALETTES[style];
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    drawBackground(ctx, palette, style, seed);

    ctx.fillStyle = palette.panel;
    roundedRect(ctx, 56, 52, WIDTH - 112, HEIGHT - 104, 34);
    ctx.fill();

    ctx.fillStyle = palette.accent;
    roundedRect(ctx, 88, 86, 72, 8, 4);
    ctx.fill();

    ctx.globalAlpha = style === 'editorial' ? 0.15 : 0.12;
    ctx.fillStyle = palette.foreground;
    setFont(ctx, 180, 800);
    ctx.fillText('“', 78, 225);
    ctx.globalAlpha = 1;

    const sanitizedQuote = options.quote.trim().slice(0, 850);
    const fitted = fitQuote(ctx, sanitizedQuote, 920, 350);
    setFont(ctx, fitted.size, style === 'editorial' ? 700 : 600);
    ctx.fillStyle = palette.foreground;
    ctx.textBaseline = 'alphabetic';

    const totalHeight = fitted.lines.length * fitted.lineHeight;
    let y = 160 + Math.max(0, (330 - totalHeight) / 2) + fitted.size;
    for (const line of fitted.lines) {
        ctx.fillText(line, 132, y);
        y += fitted.lineHeight;
    }

    ctx.fillStyle = palette.muted;
    ctx.fillRect(92, 536, WIDTH - 184, 1);

    drawAvatarMark(ctx, options.authorName, 126, 590, palette);

    ctx.fillStyle = palette.foreground;
    setFont(ctx, 25, 700);
    ctx.fillText(options.authorName.slice(0, 40), 176, 584);

    ctx.fillStyle = palette.muted;
    setFont(ctx, 18, 500);
    ctx.fillText(`@${options.authorHandle.slice(0, 32)}`, 176, 614);

    ctx.textAlign = 'right';
    ctx.fillStyle = palette.muted;
    setFont(ctx, 15, 600);
    ctx.fillText(`QUOTE / ${style.toUpperCase()}`, WIDTH - 92, 603);

    return canvas.toBuffer('image/png');
}