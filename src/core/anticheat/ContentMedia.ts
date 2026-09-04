import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { load } from 'cheerio';
import sharp from 'sharp';

// Only public IPv4 is used, pinned to the validated DNS answer for each hop.
export function isPublicAddress(address: string): boolean {
    if (isIP(address) !== 4) return false;
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
        || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
        || (a === 203 && b === 0 && c === 113));
}

export async function fetchPublicMedia(input: string, maxBytes = 8 * 1024 * 1024, timeoutMs = 8000,
    signal: AbortSignal = AbortSignal.timeout(timeoutMs), depth = 0): Promise<{ data: Buffer; type: string; url: string }> {
    signal.throwIfAborted();
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || (url.port && !['80', '443'].includes(url.port)) || depth > 3) throw new Error('Unsupported media URL');
    const addresses = await lookup(url.hostname, { all: true, family: 4 });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('Non-public media host');
    const result = await new Promise<{ data: Buffer; type: string; redirect?: string }>((resolve, reject) => {
        const req = (url.protocol === 'https:' ? https : http).get(url, {
            signal, agent: false, family: 4,
            lookup: ((_host: string, _opts: unknown, cb: Function) => cb(null, addresses[0].address, 4)) as any,
            headers: { Accept: 'image/*,text/html;q=0.8', 'User-Agent': 'PEXServer ContentSafety/1.0', 'Accept-Encoding': 'identity' }
        }, response => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
                resolve({ data: Buffer.alloc(0), type: '', redirect: response.headers.location });
                response.destroy();
                return;
            }
            if (response.statusCode !== 200 || Number(response.headers['content-length']) > maxBytes) {
                response.destroy(); reject(new Error('Media response rejected')); return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > maxBytes) { response.destroy(new Error('Media too large')); return; }
                chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () => resolve({ data: Buffer.concat(chunks), type: String(response.headers['content-type'] || '') }));
        });
        req.on('error', reject);
    });
    if (result.redirect) return fetchPublicMedia(new URL(result.redirect, url).href, maxBytes, timeoutMs, signal, depth + 1);
    return { ...result, url: url.href };
}

export async function resolveImage(input: string, maxBytes: number): Promise<{ data: Buffer; type: string; url: string }> {
    const signal = AbortSignal.timeout(12000);
    let result = await fetchPublicMedia(input, maxBytes, 12000, signal);
    if (result.type.includes('text/html')) {
        const $ = load(result.data.toString('utf8'));
        const image = $('meta[property="og:image"],meta[name="twitter:image"]').first().attr('content');
        if (!image) throw new Error('No preview image');
        result = await fetchPublicMedia(new URL(image, result.url).href, maxBytes, 12000, signal);
    }
    // Validate actual image bytes; never trust extension or Content-Type alone.
    const metadata = await sharp(result.data, { limitInputPixels: 25_000_000 }).metadata();
    if (!['jpeg', 'png', 'gif', 'webp', 'avif', 'heif'].includes(metadata.format || '')) throw new Error('Unsupported image');
    return { ...result, type: metadata.format || 'png' };
}

export async function sampleImageFrames(data: Buffer, maxFrames = 6, encoding: 'auto' | 'jpeg' = 'auto'): Promise<string[]> {
    const metadata = await sharp(data, { limitInputPixels: 25_000_000 }).metadata();
    const pages = metadata.pages || 1;
    if (pages > 500 || (metadata.width || 0) * (metadata.pageHeight || metadata.height || 0) * pages > 150_000_000) {
        throw new Error('Animation decode budget exceeded');
    }
    const count = Math.min(pages, Math.max(1, Math.min(12, Math.floor(maxFrames))));
    const frames: string[] = [];
    const lossless = encoding === 'auto' && (metadata.format === 'gif' || pages > 1);
    for (let i = 0; i < count; i++) {
        const page = count === 1 ? 0 : Math.round(i * (pages - 1) / (count - 1));
        const decoder = sharp(data, { page, pages: 1, limitInputPixels: 25_000_000 });
        const frame = lossless ? await decoder.png().toBuffer()
            : await decoder.rotate().resize(768, 768, { fit: 'inside', withoutEnlargement: true })
                .flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer();
        frames.push(`data:image/${lossless ? 'png' : 'jpeg'};base64,${frame.toString('base64')}`);
    }
    return frames;
}

export async function composeFrameSheet(frames: string[]): Promise<string> {
    if (!frames.length) throw new Error('No frames to compose');
    if (frames.length === 1) return frames[0];
    const tiles = frames.slice(0, 12);
    const columns = Math.min(3, tiles.length);
    const cell = 384;
    const sizes = await Promise.all(tiles.map(frame => sharp(Buffer.from(frame.split(',')[1], 'base64')).metadata()));
    const cellWidth = Math.round(cell * Math.max(.33, Math.min(1.5, Math.max(...sizes.map(size => (size.width || cell) / (size.height || cell))))));
    const labelHeight = 24;
    const composites: sharp.OverlayOptions[] = [];
    for (let i = 0; i < tiles.length; i++) {
        const left = (i % columns) * cellWidth;
        const top = Math.floor(i / columns) * (cell + labelHeight);
        const input = await sharp(Buffer.from(tiles[i].split(',')[1], 'base64'))
            .resize(cellWidth, cell, { fit: 'contain', background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
        composites.push({ input, left, top: top + labelHeight });
        composites.push({ input: Buffer.from(`<svg width="${cellWidth}" height="24"><rect width="${cellWidth}" height="24" fill="white"/><text x="8" y="18" font-size="16" fill="black">Frame ${i + 1}</text></svg>`), left, top });
    }
    const data = await sharp({ create: { width: columns * cellWidth, height: Math.ceil(tiles.length / columns) * (cell + labelHeight), channels: 3, background: '#ffffff' } })
        .composite(composites).jpeg({ quality: 85 }).toBuffer();
    return `data:image/jpeg;base64,${data.toString('base64')}`;
}
