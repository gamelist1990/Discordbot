// Explicit local sample only. Sends JPEG samples / native lossless PNG samples / all native frames to PEX.
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { sampleImageFrames } from '../src/core/anticheat/ContentMedia.js';
import { classifyContent, matchingContentCategories } from '../src/core/anticheat/detectors/ContentSafetyDetector.js';

const input = process.argv[2];
if (!input) throw new Error('Usage: npx tsx scripts/compare-native-gif.ts <gif>');
const data = await fs.readFile(input);
const meta = await sharp(data).metadata();
const pages = meta.pages || 1;
if (meta.format !== 'gif' || pages > 48 || (meta.width || 0) * (meta.pageHeight || meta.height || 0) * pages > 150_000_000) {
    throw new Error('Comparison requires a GIF with <=48 frames within the decode budget');
}
const native: string[] = [];
for (let page = 0; page < pages; page++) {
    const decoder = () => sharp(data, { page, pages: 1, limitInputPixels: 25_000_000 });
    // Preserve resolution, transparency and decoded pixels. No resize, rotation, flattening or JPEG encoding.
    const png = await decoder().png().toBuffer();
    const original = await decoder().ensureAlpha().raw().toBuffer();
    const decoded = await sharp(png).ensureAlpha().raw().toBuffer();
    if (!original.equals(decoded)) throw new Error(`Pixel mismatch at frame ${page}`);
    native.push(`data:image/png;base64,${png.toString('base64')}`);
}
const count = Math.min(6, pages);
const indices = Array.from({ length: count }, (_, i) => count === 1 ? 0 : Math.round(i * (pages - 1) / (count - 1)));
console.log(JSON.stringify({ input, width: meta.width, height: meta.pageHeight || meta.height, pages, sampledIndices: indices, allPngPixelsMatch: true }));
for (const [mode, frames] of [
    ['jpeg-sampled', await sampleImageFrames(data, 6, 'jpeg')],
    ['native-png-sampled', indices.map(index => native[index])],
    ['native-png-all', native]
] as const) {
    const start = Date.now();
    console.log(JSON.stringify({ mode, frames: frames.length, uniqueFrames: new Set(frames).size, dataUrlBytes: frames.reduce((sum, frame) => sum + Buffer.byteLength(frame), 0) }));
    try {
        const scores = await classifyContent('', [...frames], 90000);
        console.log(JSON.stringify({ mode, scores, matches: matchingContentCategories(scores, true), ms: Date.now() - start }));
    } catch (error) { console.log(JSON.stringify({ mode, error: String(error), ms: Date.now() - start })); process.exitCode = 1; }
}
