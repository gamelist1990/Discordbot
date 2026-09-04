// Sends only the named samples to PEX. Reports transport facts, never credentials or image bytes.
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { sampleImageFrames } from '../src/core/anticheat/ContentMedia.js';
import { classifyContent, matchingContentCategories } from '../src/core/anticheat/detectors/ContentSafetyDetector.js';

const original = globalThis.fetch;
globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    const parts = body.messages[1].content;
    const images = Array.isArray(parts) ? parts.filter(part => part.type === 'image_url') : [];
    const frames = await Promise.all(images.map(async part => {
        const bytes = Buffer.from(part.image_url.url.split(',')[1], 'base64');
        const meta = await sharp(bytes).metadata();
        return { format: meta.format, width: meta.width, height: meta.height, bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'), detail: part.image_url.detail };
    }));
    console.log(JSON.stringify({ request: { model: body.model, toolChoice: body.tool_choice, frames, payloadBytes: Buffer.byteLength(String(options?.body)) } }));
    const response = await original(url, options);
    const data = await response.clone().json();
    console.log(JSON.stringify({ response: { status: response.status, finishReason: data.choices?.[0]?.finish_reason,
        tools: data.choices?.[0]?.message?.tool_calls?.map((call: any) => ({ type: call.type, name: call.function?.name })),
        textLength: data.choices?.[0]?.message?.content?.length || 0, usage: data.usage } }));
    return response;
};
try {
    for (const input of process.argv.slice(2)) {
        const start = Date.now();
        try {
            const control = input === '--control';
            const frames = control ? [] : await sampleImageFrames(await fs.readFile(input), 6);
            const scores = await classifyContent(control ? 'こんにちは。今日は良い天気ですね。' : '', frames);
            console.log(JSON.stringify({ input, scores, matches: matchingContentCategories(scores, !control), ms: Date.now() - start }));
        } catch (error) { console.log(JSON.stringify({ input, error: String(error) })); process.exitCode = 1; }
    }
} finally { globalThis.fetch = original; }
