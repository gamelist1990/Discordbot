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
const MATH_FONT_FAMILY = 'QuoteCardMathUnicode';
const FALLBACK_FONT_FAMILIES =
    `"${MATH_FONT_FAMILY}", "Cambria Math", "Segoe UI Symbol", ` +
    '"Segoe UI Emoji", "Noto Color Emoji", "Arial Unicode MS", sans-serif';
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const FONT_FILE = path.resolve(
    currentDirectory,
    '../../../assets/fonts/NotoSansJP[wght].ttf',
);
const QUOTE_FONT_FILE = path.resolve(
    currentDirectory,
    '../../../assets/fonts/YujiSyuku-Regular.ttf',
);
const WINDOWS_MATH_FONT_FILE = 'C:\\Windows\\Fonts\\cambria.ttc';

let fontRegistered = false;
let mathFontRegistered = false;
let quoteFont: Font | undefined;

function ensureFont(): void {
    if (!fontRegistered && existsSync(FONT_FILE)) {
        registerFont(FONT_FILE, { family: FONT_FAMILY });
        fontRegistered = true;
    }

    if (!mathFontRegistered && existsSync(WINDOWS_MATH_FONT_FILE)) {
        registerFont(WINDOWS_MATH_FONT_FILE, { family: MATH_FONT_FAMILY });
        mathFontRegistered = true;
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
    linkPreview?: {
        siteName: string;
        title?: string;
        description?: string;
    };
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
    const family = fontRegistered
        ? `"${FONT_FAMILY}", ${FALLBACK_FONT_FAMILIES}`
        : FALLBACK_FONT_FAMILIES;
    ctx.font = `${weight} ${size}px ${family}`;
}

function truncateUnicode(text: string, maximumCodePoints: number): string {
    return Array.from(text).slice(0, maximumCodePoints).join('');
}

function replaceRawUrls(text: string): string {
    return text.replace(/https?:\/\/[^\s<]+/giu, rawUrl => {
        try {
            const hostname = new URL(rawUrl).hostname.replace(/^www\./iu, '');
            return `${hostname}`;
        } catch {
            return 'Webリンク';
        }
    });
}

function hasQuoteFontGlyph(character: string): boolean {
    if (!quoteFont) return false;

    return Array.from(character).every((codePoint) => {
        // 結合文字・異体字セレクタ・ゼロ幅接合子は直前の文字と共に扱う。
        if (/^[\p{Mark}\u200d\ufe0e\ufe0f]$/u.test(codePoint)) return true;
        return quoteFont!.charToGlyph(codePoint).index !== 0;
    });
}

function measureQuoteText(
    ctx: CanvasRenderingContext2D,
    text: string,
    size: number,
): number {
    if (!quoteFont) {
        setFont(ctx, size, 500);
        return ctx.measureText(text).width;
    }

    let width = 0;
    for (const character of Array.from(text)) {
        if (hasQuoteFontGlyph(character)) {
            width += quoteFont.getAdvanceWidth(character, size);
        } else {
            setFont(ctx, size, 500);
            width += ctx.measureText(character).width;
        }
    }
    return width;
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

    const characters = Array.from(text);
    const widths = characters.map((character) => {
        if (hasQuoteFontGlyph(character)) {
            return quoteFont!.getAdvanceWidth(character, size);
        }
        setFont(ctx, size, 500);
        return ctx.measureText(character).width;
    });
    let x = centerX - widths.reduce((total, width) => total + width, 0) / 2;

    for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        const width = widths[index];

        if (hasQuoteFontGlyph(character)) {
            const glyphPath = quoteFont.getPath(character, x, baselineY, size);
            glyphPath.fill = '#ffffff';
            // opentype.jsはブラウザー標準Canvasの型を要求するが、node-canvasの
            // 実行時APIは描画に必要なメソッドを備えているため、期待される型へ橋渡しする。
            glyphPath.draw(ctx as unknown as Parameters<typeof glyphPath.draw>[0]);
        } else {
            setFont(ctx, size, 500);
            ctx.textAlign = 'left';
            ctx.fillText(character, x, baselineY);
        }

        x += width;
    }

    ctx.textAlign = 'center';
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
            if (measureText(candidate) <= maxWidth) {
                line = candidate;
                continue;
            }

            if (line) {
                lines.push(line.trimEnd());
            }

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

function drawLinkPreview(
    ctx: CanvasRenderingContext2D,
    preview: NonNullable<QuoteCardOptions['linkPreview']>,
): void {
    const x = 620;
    const y = 32;
    const width = 520;
    const height = 150;

    ctx.fillStyle = 'rgba(255,255,255,0.065)';
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#b9b9c2';
    setFont(ctx, 17, 600);
    ctx.fillText(`${truncateUnicode(preview.siteName, 50)}`, x + 22, y + 31, width - 44);

    if (preview.title) {
        ctx.fillStyle = '#ffffff';
        setFont(ctx, 23, 700);
        ctx.fillText(truncateUnicode(preview.title, 55), x + 22, y + 67, width - 44);
    }

    if (preview.description) {
        ctx.fillStyle = '#c3c3ca';
        setFont(ctx, 17, 500);
        const descriptionLines = wrapText(
            truncateUnicode(preview.description, 120),
            width - 44,
            text => ctx.measureText(text).width,
        ).slice(0, 2);
        descriptionLines.forEach((line, index) => {
            const suffix = index === 1 && descriptionLines.length > 1 ? '…' : '';
            ctx.fillText(`${line}${suffix}`, x + 22, y + 101 + index * 24, width - 44);
        });
    }

    ctx.textAlign = 'center';
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
    } else if (options.linkPreview) {
        drawLinkPreview(ctx, options.linkPreview);
    }

    // UTF-16の途中でサロゲートペアを切断すると特殊文字が�になるため、
    // Unicodeコードポイント単位で文字数を制限する。
    // 呼び出し元がURL変換を行っていない場合でも、生の長いURLを本文領域へ
    // 描画しない。これによりURLが左側のアイコン領域へ侵入するのを防ぐ。
    const sanitizedQuote = truncateUnicode(
        replaceRawUrls(options.quote.trim()),
        850,
    );
    const quoteCenterX = 875;
    const contentImageHeight = contentImage
        ? Math.max(
              120,
              Math.min(270, 520 * (contentImage.height / contentImage.width)),
          )
        : 0;
    const hasLinkPreview = Boolean(options.linkPreview && !contentImage);
    const quoteTop = contentImage
        ? 32 + contentImageHeight + 30
        : hasLinkPreview
          ? 202
          : 115;
    const quoteMaxHeight = contentImage || hasLinkPreview
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

    // フォントの字形や測定値に差があっても、本文が左側のアイコン領域や
    // キャンバス外へ描画されないよう、本文領域で最終的にクリップする。
    ctx.save();
    ctx.beginPath();
    ctx.rect(
        quoteCenterX - quoteMaxWidth / 2,
        quoteTop,
        quoteMaxWidth,
        quoteMaxHeight,
    );
    ctx.clip();

    for (const line of fitted.lines) {
        drawQuoteText(ctx, line, quoteCenterX, y, fitted.size);
        y += fitted.lineHeight;
    }
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = '#ffffff';
    setFont(ctx, 26, 600);
    ctx.fillText(
        `- ${truncateUnicode(options.authorName, 40)}`,
        875,
        500,
        500,
    );

    ctx.fillStyle = '#a8a8b0';
    setFont(ctx, 22, 600);
    ctx.fillText(
        `@${truncateUnicode(options.authorHandle, 32)}`,
        875,
        534,
        500,
    );

    ctx.textAlign = 'right';
    ctx.fillStyle = '#666666';
    setFont(ctx, 16, 500);
    ctx.fillText('Make by pexserver.com', WIDTH - 32, HEIGHT - 25);

    return canvas.toBuffer('image/png');
}