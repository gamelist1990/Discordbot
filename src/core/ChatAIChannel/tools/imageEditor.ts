import fs from 'fs/promises';
import path from 'path';
import sharp, { type OverlayOptions } from 'sharp';
import type { OpenAITool, ToolHandler } from '../../../types/openai.js';
import type { ChatAIToolContext, ChatAIToolRegistrar } from './types.js';

const MAX_CANVAS_SIDE = 4096;
const MAX_OPERATIONS = 32;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

const imageEditorDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'image_editor',
        description: '現在のユーザー添付画像や空のキャンバスを編集します。切り抜き、サイズ変更、回転・傾き、反転、文字、図形、素材合成、CSS風スタイル、AI背景透過、ぼかし、シャープ、グレースケール、色調整を組み合わせ、完成画像をsandbox/workへ保存してupload_image候補にします。画像を見て編集を依頼された場合に使用してください。',
        parameters: {
            type: 'object',
            properties: {
                source_image: { type: 'number', description: '土台にする現在の添付画像番号（1始まり）。空キャンバスなら省略。' },
                source_generated: { type: 'number', description: 'この応答中に作成済みの生成画像を土台にする番号（1始まり）。source_imageより優先。' },
                canvas: {
                    type: 'object',
                    description: '空キャンバス設定、または最終キャンバス設定。',
                    properties: {
                        width: { type: 'number', description: '幅（1～4096）' },
                        height: { type: 'number', description: '高さ（1～4096）' },
                        background: { type: 'string', description: '背景色。例 #ffffff、transparent' },
                    },
                },
                operations: {
                    type: 'array',
                    maxItems: MAX_OPERATIONS,
                    description: '上から順番に適用する編集操作。',
                    items: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: ['crop', 'resize', 'rotate', 'skew', 'flip', 'flop', 'blur', 'sharpen', 'grayscale', 'negate', 'tint', 'modulate', 'gamma', 'trim', 'text', 'shape', 'overlay', 'css', 'remove_background'] },
                            x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
                            angle: { type: 'number', description: '回転角度。正で時計回り。' },
                            skew_x: { type: 'number', description: '横方向の傾き（度、-80～80）。' },
                            skew_y: { type: 'number', description: '縦方向の傾き（度、-80～80）。' },
                            color: { type: 'string', description: '色（CSS色形式）' },
                            opacity: { type: 'number', description: '0～1' },
                            sigma: { type: 'number', description: 'ぼかし強度0.3～100' },
                            brightness: { type: 'number', description: '明るさ倍率0～10' },
                            saturation: { type: 'number', description: '彩度倍率0～10' },
                            hue: { type: 'number', description: '色相回転（度）' },
                            gamma: { type: 'number', description: 'ガンマ1～3' },
                            text: { type: 'string' }, font_size: { type: 'number' }, font_family: { type: 'string' }, font_weight: { type: 'number' },
                            shape: { type: 'string', enum: ['rectangle', 'rounded_rectangle', 'ellipse', 'line', 'triangle', 'polygon'] },
                            fill: { type: 'string' }, stroke: { type: 'string' }, stroke_width: { type: 'number' }, radius: { type: 'number' },
                            points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } },
                            image: { type: 'number', description: '素材にする現在の添付画像番号（1始まり）' },
                            generated_image: { type: 'number', description: '素材にする現在ターンの生成画像番号（1始まり）' },
                            fit: { type: 'string', enum: ['cover', 'contain', 'fill', 'inside', 'outside'] },
                            css: { type: 'string', description: '画像へ適用するCSS宣言。width/height/object-fit/opacity/background-color/transform/filterをサポート。例: width: 640px; filter: brightness(1.1) saturate(1.2) blur(2px); transform: rotate(5deg) scale(0.9);' },
                        },
                        required: ['type'],
                    },
                },
                output_name: { type: 'string', description: '拡張子を除く出力名。省略可。' },
                format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: '既定はpng。' },
                quality: { type: 'number', description: 'JPEG/WebP品質（1～100、既定90）。' },
                description: { type: 'string', description: '完成画像の短い説明。' },
            },
            required: ['operations'],
        },
    },
};

interface InputImage { index: number; author?: string; dataUrl: string }
type ImageFormat = 'png' | 'jpeg' | 'webp';

function clamp(value: unknown, min: number, max: number, fallback: number): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback;
}

function integer(value: unknown, min: number, max: number, fallback: number): number {
    return Math.round(clamp(value, min, max, fallback));
}

function safeColor(value: unknown, fallback = '#000000'): string {
    const color = String(value ?? '').trim();
    return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|transparent|black|white|red|green|blue|yellow|orange|purple|pink|gray|grey)$/i.test(color) ? color : fallback;
}

function escapeXml(value: unknown): string {
    return String(value ?? '').replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!);
}

function decodeDataUrl(dataUrl: string): Buffer | null {
    const match = /^data:image\/(?:png|jpe?g|webp|gif);base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
    if (!match) return null;
    const data = Buffer.from(match[1], 'base64');
    return data.length > 0 ? data : null;
}

function selectInput(images: InputImage[], index: unknown): Buffer | null {
    const selected = images.find(image => image.index === Math.trunc(Number(index)));
    return selected ? decodeDataUrl(selected.dataUrl) : null;
}

function selectGenerated(context: ChatAIToolContext | undefined, index: unknown): Buffer | null {
    const selected = context?.generatedImages?.[Math.trunc(Number(index)) - 1];
    return selected?.data ?? null;
}

function parseCssDeclarations(value: unknown): Map<string, string> {
    const css = String(value ?? '').replace(/\/\*[\s\S]*?\*\//g, '').slice(0, 8_000);
    const declarations = new Map<string, string>();
    for (const declaration of css.split(';')) {
        const separator = declaration.indexOf(':');
        if (separator < 1) continue;
        const property = declaration.slice(0, separator).trim().toLowerCase();
        const propertyValue = declaration.slice(separator + 1).trim().replace(/\s*!important\s*$/i, '');
        if (/^[a-z-]+$/.test(property) && propertyValue) declarations.set(property, propertyValue);
    }
    return declarations;
}

function cssNumber(value: string | undefined, fallback: number): number {
    const parsed = Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? parsed : fallback;
}

function cssRatio(value: string, fallback: number): number {
    const parsed = cssNumber(value, fallback);
    return value.trim().endsWith('%') ? parsed / 100 : parsed;
}

function cssFunctions(value: string | undefined): Array<{ name: string; value: string }> {
    if (!value) return [];
    return [...value.matchAll(/([a-z-]+)\(([^()]*)\)/gi)].map(match => ({ name: match[1].toLowerCase(), value: match[2].trim() }));
}

async function applyCss(pipeline: sharp.Sharp, css: unknown): Promise<sharp.Sharp> {
    const declarations = parseCssDeclarations(css);
    let metadata = await pipeline.metadata();
    const widthValue = declarations.get('width');
    const heightValue = declarations.get('height');
    if (widthValue || heightValue) {
        const width = integer(cssNumber(widthValue, metadata.width ?? 1), 1, MAX_CANVAS_SIDE, metadata.width ?? 1);
        const height = integer(cssNumber(heightValue, metadata.height ?? 1), 1, MAX_CANVAS_SIDE, metadata.height ?? 1);
        const fitValue = declarations.get('object-fit');
        const fit = ['cover', 'contain', 'fill', 'inside', 'outside'].includes(fitValue ?? '') ? fitValue as keyof sharp.FitEnum : 'fill';
        pipeline = pipeline.resize(width, height, { fit, background: safeColor(declarations.get('background-color'), 'transparent') });
        metadata = { ...metadata, width, height };
    }

    for (const transform of cssFunctions(declarations.get('transform'))) {
        if (transform.name === 'rotate') pipeline = pipeline.rotate(clamp(cssNumber(transform.value, 0), -3600, 3600, 0), { background: 'transparent' });
        if (transform.name === 'skewx') pipeline = pipeline.affine([[1, Math.tan(clamp(cssNumber(transform.value, 0), -80, 80, 0) * Math.PI / 180)], [0, 1]], { background: 'transparent' });
        if (transform.name === 'skewy') pipeline = pipeline.affine([[1, 0], [Math.tan(clamp(cssNumber(transform.value, 0), -80, 80, 0) * Math.PI / 180), 1]], { background: 'transparent' });
        if (transform.name === 'scale' || transform.name === 'scalex' || transform.name === 'scaley') {
            const values = transform.value.split(/[\s,]+/).map(item => cssNumber(item, 1));
            const scaleX = transform.name === 'scaley' ? 1 : clamp(values[0], 0.01, 10, 1);
            const scaleY = transform.name === 'scalex' ? 1 : clamp(values[1] ?? values[0], 0.01, 10, 1);
            const current = await pipeline.metadata();
            pipeline = pipeline.resize(integer((current.width ?? 1) * scaleX, 1, MAX_CANVAS_SIDE, 1), integer((current.height ?? 1) * scaleY, 1, MAX_CANVAS_SIDE, 1), { fit: 'fill' });
        }
    }

    for (const filter of cssFunctions(declarations.get('filter'))) {
        if (filter.name === 'blur') pipeline = pipeline.blur(clamp(cssNumber(filter.value, 0), 0.3, 100, 1));
        if (filter.name === 'brightness') pipeline = pipeline.modulate({ brightness: clamp(cssRatio(filter.value, 1), 0, 10, 1) });
        if (filter.name === 'saturate') pipeline = pipeline.modulate({ saturation: clamp(cssRatio(filter.value, 1), 0, 10, 1) });
        if (filter.name === 'hue-rotate') pipeline = pipeline.modulate({ hue: clamp(cssNumber(filter.value, 0), -3600, 3600, 0) });
        if (filter.name === 'grayscale' && cssRatio(filter.value, 1) > 0) pipeline = pipeline.grayscale();
        if (filter.name === 'invert' && cssRatio(filter.value, 1) > 0) pipeline = pipeline.negate();
    }

    const opacityValue = declarations.get('opacity');
    if (opacityValue) {
        const opacity = clamp(cssRatio(opacityValue, 1), 0, 1, 1);
        // rotate/affine/resizeは遅延評価されるため、ここで一度実画像化して
        // 変形後の正確な寸法に合わせたアルファマスクを作る。
        const rendered = await pipeline.png().toBuffer();
        const current = await sharp(rendered).metadata();
        const width = current.width ?? 1;
        const height = current.height ?? 1;
        const mask = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white" fill-opacity="${opacity}"/></svg>`);
        pipeline = sharp(rendered).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]);
    }
    return pipeline;
}

async function removeImageBackground(pipeline: sharp.Sharp): Promise<sharp.Sharp> {
    const input = await pipeline.png().toBuffer();
    const { removeBackground } = await import('@imgly/background-removal-node');
    const result = await removeBackground(new Uint8Array(input));
    return sharp(Buffer.from(await result.arrayBuffer()), { failOn: 'error', limitInputPixels: MAX_CANVAS_SIDE * MAX_CANVAS_SIDE });
}

async function svgOverlay(operation: any, canvasWidth: number, canvasHeight: number): Promise<OverlayOptions> {
    const x = integer(operation.x, -MAX_CANVAS_SIDE, MAX_CANVAS_SIDE, 0);
    const y = integer(operation.y, -MAX_CANVAS_SIDE, MAX_CANVAS_SIDE, 0);
    const opacity = clamp(operation.opacity, 0, 1, 1);
    if (operation.type === 'text') {
        const fontSize = integer(operation.font_size, 6, 512, 48);
        const weight = integer(operation.font_weight, 100, 900, 600);
        const family = escapeXml(String(operation.font_family ?? 'Noto Sans JP').slice(0, 80));
        const text = escapeXml(String(operation.text ?? '').slice(0, 2_000));
        const fill = safeColor(operation.color ?? operation.fill, '#ffffff');
        const stroke = safeColor(operation.stroke, 'transparent');
        const strokeWidth = clamp(operation.stroke_width, 0, 40, 0);
        const width = integer(operation.width, 1, MAX_CANVAS_SIDE, Math.max(1, canvasWidth - Math.max(0, x)));
        const height = integer(operation.height, 1, MAX_CANVAS_SIDE, Math.min(canvasHeight, Math.ceil(fontSize * 2.2)));
        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><text x="${strokeWidth + 2}" y="${Math.min(height - 2, fontSize * 1.25)}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeWidth}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}">${text}</text></svg>`;
        return { input: Buffer.from(svg), left: x, top: y };
    }

    const width = integer(operation.width, 1, MAX_CANVAS_SIDE, 100);
    const height = integer(operation.height, 1, MAX_CANVAS_SIDE, 100);
    const fill = safeColor(operation.fill ?? operation.color, 'transparent');
    const stroke = safeColor(operation.stroke, '#ffffff');
    const strokeWidth = clamp(operation.stroke_width, 0, 100, 0);
    const shape = String(operation.shape ?? 'rectangle');
    let element: string;
    if (shape === 'ellipse') {
        element = `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${Math.max(0, width / 2 - strokeWidth / 2)}" ry="${Math.max(0, height / 2 - strokeWidth / 2)}"/>`;
    } else if (shape === 'line') {
        element = `<line x1="0" y1="0" x2="${width}" y2="${height}"/>`;
    } else if (shape === 'triangle') {
        element = `<polygon points="${width / 2},0 ${width},${height} 0,${height}"/>`;
    } else if (shape === 'polygon' && Array.isArray(operation.points)) {
        const points = operation.points.slice(0, 64).map((point: any) => `${clamp(point.x, 0, width, 0)},${clamp(point.y, 0, height, 0)}`).join(' ');
        element = `<polygon points="${points}"/>`;
    } else {
        const radius = shape === 'rounded_rectangle' ? clamp(operation.radius, 0, Math.min(width, height) / 2, 16) : 0;
        element = `<rect x="${strokeWidth / 2}" y="${strokeWidth / 2}" width="${Math.max(0, width - strokeWidth)}" height="${Math.max(0, height - strokeWidth)}" rx="${radius}"/>`;
    }
    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><g fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="${strokeWidth}">${element}</g></svg>`;
    return { input: Buffer.from(svg), left: x, top: y };
}

export const imageEditorHandler: ToolHandler = async (args, context?: ChatAIToolContext) => {
    try {
        const images = Array.isArray(context?.images) ? context.images as InputImage[] : [];
        const canvas = args?.canvas && typeof args.canvas === 'object' ? args.canvas : {};
        let base = args?.source_generated != null
            ? selectGenerated(context, args.source_generated)
            : selectInput(images, args?.source_image);
        if (!base) {
            if (args?.source_generated != null) return 'IMAGE_EDITOR_ERROR: 指定された生成画像が見つかりません。現在の応答中の生成画像番号を指定してください。';
            if (args?.source_image != null) return 'IMAGE_EDITOR_ERROR: 指定された添付画像が見つかりません。現在のターンの画像番号を指定してください。';
            const width = integer(canvas.width, 1, MAX_CANVAS_SIDE, 1024);
            const height = integer(canvas.height, 1, MAX_CANVAS_SIDE, 1024);
            base = await sharp({ create: { width, height, channels: 4, background: safeColor(canvas.background, 'transparent') } }).png().toBuffer();
        }

        let pipeline = sharp(base, { failOn: 'error', limitInputPixels: MAX_CANVAS_SIDE * MAX_CANVAS_SIDE });
        const operations = Array.isArray(args?.operations) ? args.operations.slice(0, MAX_OPERATIONS) : [];
        for (const operation of operations) {
            const metadata = await pipeline.metadata();
            const currentWidth = metadata.width ?? 1;
            const currentHeight = metadata.height ?? 1;
            switch (operation?.type) {
                case 'crop': {
                    const left = integer(operation.x, 0, currentWidth - 1, 0);
                    const top = integer(operation.y, 0, currentHeight - 1, 0);
                    pipeline = pipeline.extract({
                        left,
                        top,
                        width: integer(operation.width, 1, currentWidth - left, currentWidth - left),
                        height: integer(operation.height, 1, currentHeight - top, currentHeight - top),
                    });
                    break;
                }
                case 'resize': pipeline = pipeline.resize(integer(operation.width, 1, MAX_CANVAS_SIDE, currentWidth), integer(operation.height, 1, MAX_CANVAS_SIDE, currentHeight), { fit: operation.fit ?? 'cover' }); break;
                case 'rotate': pipeline = pipeline.rotate(clamp(operation.angle, -3600, 3600, 0), { background: safeColor(operation.color, 'transparent') }); break;
                case 'skew': {
                    const skewX = Math.tan(clamp(operation.skew_x, -80, 80, 0) * Math.PI / 180);
                    const skewY = Math.tan(clamp(operation.skew_y, -80, 80, 0) * Math.PI / 180);
                    pipeline = pipeline.affine([[1, skewX], [skewY, 1]], { background: safeColor(operation.color, 'transparent') });
                    break;
                }
                case 'flip': pipeline = pipeline.flip(); break;
                case 'flop': pipeline = pipeline.flop(); break;
                case 'blur': pipeline = pipeline.blur(clamp(operation.sigma, 0.3, 100, 1)); break;
                case 'sharpen': pipeline = pipeline.sharpen({ sigma: clamp(operation.sigma, 0.000001, 1000, 1) }); break;
                case 'grayscale': pipeline = pipeline.grayscale(); break;
                case 'negate': pipeline = pipeline.negate(); break;
                case 'tint': pipeline = pipeline.tint(safeColor(operation.color, '#ffffff')); break;
                case 'modulate': pipeline = pipeline.modulate({
                    brightness: clamp(operation.brightness, 0, 10, 1),
                    saturation: clamp(operation.saturation, 0, 10, 1),
                    hue: clamp(operation.hue, -3600, 3600, 0),
                }); break;
                case 'gamma': pipeline = pipeline.gamma(clamp(operation.gamma, 1, 3, 1)); break;
                case 'trim': pipeline = pipeline.trim({ background: safeColor(operation.color, 'transparent') }); break;
                case 'text':
                case 'shape': pipeline = pipeline.composite([await svgOverlay(operation, currentWidth, currentHeight)]); break;
                case 'overlay': {
                    const material = operation.generated_image != null
                        ? selectGenerated(context, operation.generated_image)
                        : selectInput(images, operation.image);
                    if (!material) return operation.generated_image != null
                        ? `IMAGE_EDITOR_ERROR: 生成素材画像 ${operation.generated_image} が見つかりません。`
                        : `IMAGE_EDITOR_ERROR: 素材画像 ${operation.image} が見つかりません。`;
                    const width = integer(operation.width, 1, MAX_CANVAS_SIDE, currentWidth);
                    const height = integer(operation.height, 1, MAX_CANVAS_SIDE, currentHeight);
                    const prepared = await sharp(material).resize(width, height, { fit: operation.fit ?? 'contain' }).ensureAlpha(clamp(operation.opacity, 0, 1, 1)).png().toBuffer();
                    pipeline = pipeline.composite([{ input: prepared, left: integer(operation.x, -MAX_CANVAS_SIDE, MAX_CANVAS_SIDE, 0), top: integer(operation.y, -MAX_CANVAS_SIDE, MAX_CANVAS_SIDE, 0) }]);
                    break;
                }
                case 'css': pipeline = await applyCss(pipeline, operation.css); break;
                case 'remove_background': pipeline = await removeImageBackground(pipeline); break;
            }
        }

        if (canvas.width || canvas.height) {
            const metadata = await pipeline.metadata();
            pipeline = pipeline.resize(integer(canvas.width, 1, MAX_CANVAS_SIDE, metadata.width ?? 1024), integer(canvas.height, 1, MAX_CANVAS_SIDE, metadata.height ?? 1024), { fit: 'contain', background: safeColor(canvas.background, 'transparent') });
        }
        const format: ImageFormat = ['jpeg', 'webp'].includes(args?.format) ? args.format : 'png';
        const quality = integer(args?.quality, 1, 100, 90);
        const output = format === 'jpeg' ? await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality }).toBuffer() : format === 'webp' ? await pipeline.webp({ quality }).toBuffer() : await pipeline.png({ compressionLevel: 9 }).toBuffer();
        if (output.byteLength > MAX_OUTPUT_BYTES) return 'IMAGE_EDITOR_ERROR: 完成画像が10MiBを超えました。サイズを小さくするかjpeg/webpを使用してください。';

        const work = context?.sandbox?.work ?? context?.sandboxPaths?.work;
        if (typeof work !== 'string') return 'IMAGE_EDITOR_ERROR: Sandboxのwork領域を取得できません。';
        await fs.mkdir(work, { recursive: true });
        const requestedName = String(args?.output_name ?? 'edited-image').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'edited-image';
        const filename = `${requestedName}-${Date.now()}.${format === 'jpeg' ? 'jpg' : format}`;
        const outputPath = path.join(work, filename);
        await fs.writeFile(outputPath, output);

        const generatedImages = context?.generatedImages ?? [];
        generatedImages.push({ source: 'editor', data: output, mimeType: format === 'jpeg' ? 'image/jpeg' : `image/${format}`, filename, description: String(args?.description ?? 'AIで編集した画像').slice(0, 1_024), path: outputPath });
        if (context) context.generatedImages = generatedImages;
        return `IMAGE_EDITOR_SUCCESS: ${filename} をsandbox/workへ保存しました。アップロード候補の画像番号は ${generatedImages.length} です。ユーザーへ渡す場合はupload_imageを呼び出してください。`;
    } catch (error) {
        return `IMAGE_EDITOR_ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
};

export const registerImageEditorTool: ChatAIToolRegistrar = (manager) => {
    manager.registerTool(imageEditorDefinition, imageEditorHandler);
};
