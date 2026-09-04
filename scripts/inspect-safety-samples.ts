import fs from 'node:fs/promises';
import sharp from 'sharp';
import { sampleImageFrames, composeFrameSheet } from '../src/core/anticheat/ContentMedia.js';
import { classifyContent, matchingContentCategories } from '../src/core/anticheat/detectors/ContentSafetyDetector.js';
await fs.mkdir('test-results/safety-samples', { recursive: true });
const compare = process.argv.includes('--compare');
for (const [index, input] of process.argv.slice(2).filter(arg => arg !== '--compare').entries()) {
    const data = await fs.readFile(input);
    const metadata = await sharp(data).metadata();
    const frames = await sampleImageFrames(data, 6);
    const sheet = await composeFrameSheet(frames);
    await fs.writeFile(`test-results/safety-samples/sample-${index + 1}.jpg`, Buffer.from(sheet.split(',')[1], 'base64'));
    console.log(JSON.stringify({ input, width: metadata.width, height: metadata.height, pages: metadata.pages, sampleFrames: frames.length }));
    const variants: Array<[string, string[]]> = compare ? [['separate', frames], ['sheet', [sheet]]] : [['separate', frames]];
    for (const [mode, images] of variants) {
        const start = Date.now();
        try {
            const scores = await classifyContent('', [...images], 120000);
            console.log(JSON.stringify({ input, mode, scores, matches: matchingContentCategories(scores, true), ms: Date.now() - start }));
        } catch (e) { console.log(JSON.stringify({ input, mode, error: String(e) })); }
    }
}
