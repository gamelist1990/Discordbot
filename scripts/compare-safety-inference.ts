import fs from 'node:fs/promises';
import { sampleImageFrames } from '../src/core/anticheat/ContentMedia.js';
import { classifyContent } from '../src/core/anticheat/detectors/ContentSafetyDetector.js';
const frames = await sampleImageFrames(await fs.readFile(process.argv[2]), 6);
const original = globalThis.fetch;
for (const effort of ['none', 'low']) {
    globalThis.fetch = async (url, options) => {
        const body = JSON.parse(String(options?.body));
        body.reasoning_effort = effort;
        body.chat_template_kwargs.enable_thinking = effort !== 'none';
        body.max_tokens = effort === 'none' ? 512 : 2048;
        const response = await original(url, { ...options, body: JSON.stringify(body) });
        const data = await response.clone().json() as any;
        console.log(JSON.stringify({ effort, status: response.status, finish: data.choices?.[0]?.finish_reason,
            toolCount: data.choices?.[0]?.message?.tool_calls?.length || 0 }));
        return response;
    };
    const start = Date.now();
    try { console.log(JSON.stringify({ effort, frames: frames.length, verdict: await classifyContent('', frames), ms: Date.now() - start })); }
    catch (error) { console.log(String(error)); }
}
globalThis.fetch = original;
