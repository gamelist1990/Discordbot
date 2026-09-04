// Sends only explicitly provided text/file to the configured PEX moderation model. Never logs credentials.
import fs from 'node:fs/promises';
import { config } from '../src/config.js';
import { classifyContent, matchingContentCategories } from '../src/core/anticheat/detectors/ContentSafetyDetector.js';
import { sampleImageFrames } from '../src/core/anticheat/ContentMedia.js';

async function main() {
    const [mode, input] = process.argv.slice(2);
    if (mode === '--diagnose' || mode === '--diagnose-image') {
        const frames = mode === '--diagnose-image' ? await sampleImageFrames(await fs.readFile(input), 1) : [];
        const response = await fetch(`${config.pexAi.endpoint.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST', signal: AbortSignal.timeout(60000),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.pexAi.apiKey}` },
            body: JSON.stringify({ model: 'gemma4:e2b-it-qat', stream: false, max_tokens: 1024,
                messages: [{ role: 'user', content: frames.length ? [
                    { type: 'text', text: 'Briefly identify the non-explicit visual elements in this image: art style, hair color and background. Do not describe anatomy or sexual acts.' },
                    { type: 'image_url', image_url: { url: frames[0] } }
                ] : 'Return a JSON object with the key ok set to true. No explanation.' }] })
        });
        console.log(JSON.stringify({ status: response.status, type: response.headers.get('content-type'), body: (await response.text()).slice(0, 2500) }, null, 2));
        return;
    }
    if (!['--file', '--text'].includes(mode) || !input) throw new Error('Usage: npx tsx scripts/test-content-safety.ts --file <path> | --text <text> | --diagnose');
    const frames = mode === '--file' ? await sampleImageFrames(await fs.readFile(input), 6) : [];
    const start = Date.now();
    console.log(JSON.stringify({ sampledFrames: frames.length }));
    const verdict = await classifyContent(mode === '--text' ? input : '', frames, 180000);
    console.log(JSON.stringify({ verdict, matchedCategories: matchingContentCategories(verdict, frames.length > 0), latencyMs: Date.now() - start }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
