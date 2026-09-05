// Diagnostic comparison with Google's recommended Gemma 4 sampling settings.
// Sends only the explicitly supplied image; does not alter production settings.
import fs from 'node:fs/promises';
import { sampleImageFrames } from '../src/core/anticheat/ContentMedia.js';
import { classifyContent, CONTENT_CATEGORIES, matchingContentCategories } from '../src/core/anticheat/detectors/ContentSafetyDetector.js';

const frames = await sampleImageFrames(await fs.readFile(process.argv[2]));
const original = globalThis.fetch;
globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    Object.assign(body, { temperature: 1, top_p: .95, top_k: 64 });
    return original(url, { ...options, body: JSON.stringify(body) });
};
try {
    const verdict = await classifyContent('', frames, 180000, false, { maxPoints: 10, categories: [...CONTENT_CATEGORIES] });
    console.log(JSON.stringify({ verdict, matches: matchingContentCategories(verdict, true) }, null, 2));
} finally { globalThis.fetch = original; }
