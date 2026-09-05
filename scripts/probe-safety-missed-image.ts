// Sends the explicitly supplied image to the configured moderation API; no Discord actions.
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { sampleImageFrames } from '../src/core/anticheat/ContentMedia.js';
import { classifyContent, CONTENT_SAFETY_PROMPT, matchingContentCategories } from '../src/core/anticheat/detectors/ContentSafetyDetector.js';

const data = await fs.readFile(process.argv[2]);
const frames = await sampleImageFrames(data);
const png = `data:image/png;base64,${(await sharp(data).png().toBuffer()).toString('base64')}`;
const control = `data:image/png;base64,${(await sharp({ create: { width: 339, height: 387, channels: 3, background: 'blue' } }).png().toBuffer()).toString('base64')}`;
const clarified = CONTENT_SAFETY_PROMPT.replace('単なる上半身裸、運動、水着だけでは該当させない。',
    '単なる上半身裸、運動、水着だけでは該当させない。ただし、露出した胸部を手で触る・押し上げるなど、胸部を性的に強調する仕草や構図はsuggestiveの対象。衣服を一部着用していても、この強調を除外しない。');
const original = globalThis.fetch;
for (const [name, images, prompt] of [
    ['original-png', [png], CONTENT_SAFETY_PROMPT],
    ['clarified-jpeg', frames, clarified],
    ['clarified-control', [control], clarified]
] as const) {
    globalThis.fetch = async (url, options) => {
        const body = JSON.parse(String(options?.body));
        body.messages[0].content = prompt;
        return original(url, { ...options, body: JSON.stringify(body) });
    };
    try {
        const verdict = await classifyContent('', [...images]);
        console.log(JSON.stringify({ name, verdict, matches: matchingContentCategories(verdict, true) }));
    } catch (error) { console.log(JSON.stringify({ name, error: error instanceof Error ? error.message : 'failed' })); }
    finally { globalThis.fetch = original; }
}
