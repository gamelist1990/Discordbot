import sharp from 'sharp';

const ALLOWED_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 24_000_000;
type Source = { url: string; loading?: Promise<Buffer> };
const sources = new WeakMap<object, Source>();

export function isSafeDiscordDrawingSource(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' && ALLOWED_HOSTS.has(parsed.hostname)
            && !parsed.username && !parsed.password;
    } catch { return false; }
}

/** Only an actual Discord attachment supplied in this request (or its reply_to) is authorized. */
export function setDrawingSourceImage(context: object, url: string): boolean {
    if (!isSafeDiscordDrawingSource(url)) return false;
    sources.set(context, { url });
    return true;
}

export function hasDrawingSourceImage(context: object): boolean {
    return sources.has(context);
}

async function loadSource(context: object, fetchImage: typeof fetch): Promise<Buffer> {
    const state = sources.get(context);
    if (!state) throw new Error('編集元の画像がありません');
    if (!state.loading) {
        state.loading = (async () => {
            const response = await fetchImage(state.url, { signal: AbortSignal.timeout(12_000) });
            if (!response.ok) throw new Error('Discordの添付画像を取得できませんでした');
            if (Number(response.headers?.get('content-length') || 0) > MAX_IMAGE_BYTES) {
                throw new Error('元画像は12MB以内にしてください');
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) throw new Error('元画像が空か12MBを超えています');
            const metadata = await sharp(buffer, { animated: false, limitInputPixels: MAX_SOURCE_PIXELS }).metadata();
            if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_SOURCE_PIXELS
                || !['jpeg','png','webp','gif','avif','heif'].includes(metadata.format || '')) {
                throw new Error('対応画像形式はPNG/JPEG/WebP/GIF/AVIFです（最大24MP）');
            }
            return buffer;
        })();
    }
    try { return await state.loading; } catch (error) {
        state.loading = undefined;
        throw error;
    }
}

/** Vision receives actual pixels rather than relying on expiring attachment URLs. */
export async function drawingSourceVisionPart(context: object): Promise<{
    type: 'image_url'; image_url: { url: string; detail: 'auto' };
}> {
    const image = await loadSource(context, fetch);
    const jpeg = await sharp(image, { animated: false, limitInputPixels: MAX_SOURCE_PIXELS })
        .rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer();
    return { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, detail: 'auto' } };
}


/**
 * Native SVG composition: insert the user photo as a server-controlled <image>
 * under the AI's SVG decoration. The original SVG provided by the model cannot
 * contain image/href elements. Only server-generated inlined image data is used.
 */
export async function composeDrawingSourceSvg(
    context: object,
    overlaySvg: string,
    fit: 'cover' | 'contain' = 'cover',
    adjustments: { brightness?: number; saturation?: number } = {},
): Promise<string> {
    const bytes = await loadSource(context, fetch);
    const clamp = (value: unknown, min: number, max: number) =>
        typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 1;
    const brightness = clamp(adjustments.brightness, 0.6, 1.6);
    const saturation = clamp(adjustments.saturation, 0.5, 1.8);
    const normalizedPhoto = await sharp(bytes, { animated: false, limitInputPixels: MAX_SOURCE_PIXELS })
        .rotate().modulate({ brightness, saturation })
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const root = /^<svg\b[^>]*>/i.exec(overlaySvg)?.[0];
    const viewBox = root && /viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(root);
    if (!root || !viewBox) throw new Error('SVGのviewBoxを取得できませんでした');
    const width = Number(viewBox[1]), height = Number(viewBox[2]);
    const preserve = fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
    const background = fit === 'contain'
        ? '<rect width="' + width + '" height="' + height + '" fill="#182333"/>'
        : '';
    const inlinePhoto = '<image x="0" y="0" width="' + width + '" height="' + height
        + '" preserveAspectRatio="' + preserve + '" href="data:image/png;base64,'
        + normalizedPhoto.toString('base64') + '"/>';
    return overlaySvg.replace(root, root + background + inlinePhoto);
}

/** Compatibility helper; native SVG composition is used by the draw_image flow. */
export async function renderDecoratedPhoto(
    context: object,
    overlayPng: Buffer,
    width: number,
    height: number,
    fit: 'cover' | 'contain' = 'cover',
    fetchImage: typeof fetch = fetch,
): Promise<Buffer> {
    const bytes = await loadSource(context, fetchImage);
    const picture = sharp(bytes, { animated: false, limitInputPixels: MAX_SOURCE_PIXELS }).rotate();
    let background: Buffer;
    if (fit === 'contain') {
        const blurredBackground = await picture.clone().resize(width, height, {
            fit: 'cover', position: sharp.strategy.attention,
        }).blur(15).modulate({ brightness: 0.65 }).png().toBuffer();
        const visiblePhoto = await picture.clone().resize(width, height, {
            fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 },
        }).png().toBuffer();
        background = await sharp(blurredBackground).composite([{ input: visiblePhoto }]).png().toBuffer();
    } else {
        background = await picture.resize(width, height, {
            fit: 'cover', position: sharp.strategy.attention,
        }).png().toBuffer();
    }
    return sharp(background).composite([{ input: overlayPng, blend: 'over' }]).png().toBuffer();
}
