import { createHash } from 'node:crypto';
import sharp from 'sharp';

export interface MediaAttachment {
    id: string;
    name: string;
    contentType: string;
    size: number;
    url: string;
}

export interface GifFlashAnalysis {
    animated: boolean;
    frameCount: number;
    sampledFrameCount: number;
    durationMs: number;
    transitionCount: number;
    reversalCount: number;
    maxLuminanceDelta: number;
    maxPixelDelta: number;
    maxFlashAreaRatio: number;
    flashScore: number;
    hazardous: boolean;
}

const ALLOWED_ATTACHMENT_HOSTS = [
    'cdn.discordapp.com',
    'media.discordapp.net',
    'images-ext-1.discordapp.net',
    'images-ext-2.discordapp.net'
];

function isAllowedAttachmentUrl(input: string): boolean {
    try {
        const url = new URL(input);
        return url.protocol === 'https:'
            && ALLOWED_ATTACHMENT_HOSTS.some((host) => url.hostname === host);
    } catch {
        return false;
    }
}

export function getMediaAttachments(message: { attachments?: unknown }): MediaAttachment[] {
    const values = Array.from((message.attachments as any)?.values?.() || []) as any[];

    return values
        .map((attachment): MediaAttachment => ({
            id: String(attachment.id || ''),
            name: String(attachment.name || ''),
            contentType: String(attachment.contentType || '').toLowerCase(),
            size: Number(attachment.size) || 0,
            url: String(attachment.url || attachment.proxyURL || '')
        }))
        .filter((attachment) => attachment.url.length > 0);
}

export function isImageAttachment(attachment: MediaAttachment): boolean {
    return attachment.contentType.startsWith('image/')
        || /\.(?:png|jpe?g|webp|gif|avif)$/i.test(attachment.name);
}

export function isGifAttachment(attachment: MediaAttachment): boolean {
    return attachment.contentType === 'image/gif' || /\.gif$/i.test(attachment.name);
}

export async function downloadAttachment(
    attachment: MediaAttachment,
    maxBytes: number,
    timeoutMs: number
): Promise<Buffer | null> {
    if (
        !isAllowedAttachmentUrl(attachment.url)
        || attachment.size < 0
        || attachment.size > maxBytes
    ) {
        return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(attachment.url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'PEXServer AntiCheat/1.0',
                'Accept': 'image/*'
            }
        });

        if (!response.ok || !response.body) {
            return null;
        }

        const contentLength = Number(response.headers.get('content-length')) || 0;
        if (contentLength > maxBytes) {
            await response.body.cancel();
            return null;
        }

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            receivedBytes += value.byteLength;
            if (receivedBytes > maxBytes) {
                await reader.cancel();
                return null;
            }

            chunks.push(value);
        }

        return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), receivedBytes);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function mean(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateFrameMetrics(raw: Buffer): { luminance: number; pixels: Uint8Array } {
    const luminanceValues: number[] = [];
    const pixels = new Uint8Array(raw.length / 3);

    for (let source = 0, target = 0; source < raw.length; source += 3, target += 1) {
        const luminance = (
            raw[source] * 0.2126
            + raw[source + 1] * 0.7152
            + raw[source + 2] * 0.0722
        );
        luminanceValues.push(luminance);
        pixels[target] = Math.round(luminance);
    }

    return {
        luminance: mean(luminanceValues),
        pixels
    };
}

function calculateTransitionMetrics(left: Uint8Array, right: Uint8Array, pixelThreshold: number): {
    averageDelta: number;
    flashAreaRatio: number;
    direction: -1 | 0 | 1;
} {
    const length = Math.min(left.length, right.length);
    if (length === 0) {
        return { averageDelta: 0, flashAreaRatio: 0, direction: 0 };
    }

    let total = 0;
    let changedPixels = 0;
    let signedChange = 0;
    for (let index = 0; index < length; index += 1) {
        const delta = right[index] - left[index];
        total += Math.abs(delta);
        if (Math.abs(delta) >= pixelThreshold) {
            changedPixels += 1;
            signedChange += delta;
        }
    }

    return {
        averageDelta: total / length,
        flashAreaRatio: changedPixels / length,
        direction: signedChange > 0 ? 1 : signedChange < 0 ? -1 : 0
    };
}

function selectSampledPages(frameCount: number, maxSampleFrames: number): number[] {
    if (frameCount <= maxSampleFrames) {
        return Array.from({ length: frameCount }, (_, index) => index);
    }

    const pairCount = Math.max(1, Math.floor(maxSampleFrames / 2));
    const pages = new Set<number>();
    for (let pair = 0; pair < pairCount; pair += 1) {
        const start = pairCount === 1
            ? 0
            : Math.round((pair * (frameCount - 2)) / (pairCount - 1));
        pages.add(start);
        pages.add(start + 1);
    }

    return [...pages].sort((left, right) => left - right);
}

export async function analyzeGifFlash(
    gifBuffer: Buffer,
    options: {
        maxSampleFrames?: number;
        luminanceDeltaThreshold?: number;
        pixelDeltaThreshold?: number;
        minimumTransitions?: number;
        minimumFlashScore?: number;
    } = {}
): Promise<GifFlashAnalysis> {
    const maxSampleFrames = Math.max(2, Math.min(20, options.maxSampleFrames ?? 12));
    const luminanceDeltaThreshold = options.luminanceDeltaThreshold ?? 80;
    const pixelDeltaThreshold = options.pixelDeltaThreshold ?? 70;
    const minimumTransitions = options.minimumTransitions ?? 2;
    const minimumFlashScore = options.minimumFlashScore ?? 0.55;
    const metadata = await sharp(gifBuffer, {
        animated: true,
        failOn: 'error',
        limitInputPixels: 25_000_000
    }).metadata();
    const frameCount = Math.max(1, metadata.pages || 1);
    const delays = Array.isArray(metadata.delay) ? metadata.delay : [];
    const durationMs = delays.reduce((sum, delay) => sum + Math.max(10, delay || 100), 0);
    const uniquePages = selectSampledPages(frameCount, maxSampleFrames);
    const frames = await Promise.all(uniquePages.map(async (page) => {
        const raw = await sharp(gifBuffer, {
            page,
            pages: 1,
            failOn: 'error',
            limitInputPixels: 25_000_000
        })
            .flatten({ background: '#000000' })
            .resize(32, 32, { fit: 'fill' })
            .removeAlpha()
            .raw()
            .toBuffer();

        return { page, ...calculateFrameMetrics(raw) };
    }));

    let transitionCount = 0;
    let reversalCount = 0;
    let maxLuminanceDelta = 0;
    let maxPixelDelta = 0;
    let maxFlashAreaRatio = 0;
    let previousDirection: -1 | 0 | 1 = 0;
    const transitionScores: number[] = [];

    for (let index = 1; index < frames.length; index += 1) {
        if (frames[index].page !== frames[index - 1].page + 1) {
            previousDirection = 0;
            continue;
        }

        const luminanceDelta = Math.abs(frames[index].luminance - frames[index - 1].luminance);
        const transition = calculateTransitionMetrics(
            frames[index - 1].pixels,
            frames[index].pixels,
            pixelDeltaThreshold
        );
        const pixelDelta = transition.averageDelta;
        maxLuminanceDelta = Math.max(maxLuminanceDelta, luminanceDelta);
        maxPixelDelta = Math.max(maxPixelDelta, pixelDelta);
        maxFlashAreaRatio = Math.max(maxFlashAreaRatio, transition.flashAreaRatio);

        const transitionScore = Math.min(
            1,
            Math.max(
                luminanceDelta / Math.max(1, luminanceDeltaThreshold),
                pixelDelta / Math.max(1, pixelDeltaThreshold),
                transition.flashAreaRatio / 0.1
            )
        );
        transitionScores.push(transitionScore);

        if (
            transition.flashAreaRatio >= 0.1
            && (luminanceDelta >= luminanceDeltaThreshold || pixelDelta >= pixelDeltaThreshold * 0.35)
        ) {
            transitionCount += 1;
            if (previousDirection !== 0 && transition.direction !== 0 && previousDirection !== transition.direction) {
                reversalCount += 1;
            }
            previousDirection = transition.direction;
        } else {
            previousDirection = 0;
        }
    }

    const analyzedTransitionCount = Math.max(1, transitionScores.length);
    const transitionRatio = transitionCount / analyzedTransitionCount;
    const averageTransitionScore = mean(transitionScores);
    const repetitionScore = Math.min(1, (transitionCount + reversalCount) / Math.max(1, minimumTransitions * 2));
    const flashScore = Math.min(
        1,
        transitionRatio * 0.45 + averageTransitionScore * 0.25 + repetitionScore * 0.3
    );
    const animated = frameCount > 1;

    return {
        animated,
        frameCount,
        sampledFrameCount: frames.length,
        durationMs,
        transitionCount,
        reversalCount,
        maxLuminanceDelta: Number(maxLuminanceDelta.toFixed(2)),
        maxPixelDelta: Number(maxPixelDelta.toFixed(2)),
        maxFlashAreaRatio: Number(maxFlashAreaRatio.toFixed(3)),
        flashScore: Number(flashScore.toFixed(3)),
        hazardous: animated
            && transitionCount >= minimumTransitions
            && flashScore >= minimumFlashScore
    };
}

export async function createImageFingerprint(imageBuffer: Buffer): Promise<{
    sha256: string;
    perceptualHash: string;
}> {
    const sha256 = createHash('sha256').update(imageBuffer).digest('hex');
    const raw = await sharp(imageBuffer, {
        animated: false,
        failOn: 'error',
        limitInputPixels: 25_000_000
    })
        .flatten({ background: '#000000' })
        .resize(9, 8, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer();

    let bits = '';
    for (let row = 0; row < 8; row += 1) {
        for (let column = 0; column < 8; column += 1) {
            const offset = row * 9 + column;
            bits += raw[offset] > raw[offset + 1] ? '1' : '0';
        }
    }

    let perceptualHash = '';
    for (let index = 0; index < bits.length; index += 4) {
        perceptualHash += Number.parseInt(bits.slice(index, index + 4), 2).toString(16);
    }

    return { sha256, perceptualHash };
}

export function calculateHashDistance(left: string, right: string): number {
    if (left.length !== right.length) {
        return Number.POSITIVE_INFINITY;
    }

    let distance = 0;
    for (let index = 0; index < left.length; index += 1) {
        const xor = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
        distance += xor.toString(2).replace(/0/g, '').length;
    }

    return distance;
}