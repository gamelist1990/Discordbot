import { config } from '../src/config.js';
import { OpenAIChatManager } from '../src/core/ai/OpenAIChatManager.js';
import { registerStaffAITools } from '../src/commands/staff/subcommands/ai-tools/catalog.js';
import { STAFF_AI_SYSTEM_PROMPT } from '../src/commands/staff/subcommands/StaffAIStyle.js';

const model = config.pexAi.model;
const manager = new OpenAIChatManager();
const registered = registerStaffAITools(manager);
const started = Date.now();
let first = -1;
let response = '';
let firstKind = '';
await manager.streamResponseText([
    { role: 'system', content: STAFF_AI_SYSTEM_PROMPT },
    { role: 'user', content: 'こんにちは。10文字以内で短く日本語で挨拶して。ツールは不要。' },
], (delta) => {
    if ((delta.type === 'thinking' || delta.type === 'text') && delta.text?.trim()) {
        if (first < 0) {
            first = Date.now() - started;
            firstKind = delta.type;
            console.log('[TTFT] first_output_ms', first, 'kind', firstKind);
        }
        if (delta.type === 'text') response += delta.text;
    }
}, {
    model, strictModel: true,
    maxTokens: 96, reasoningEffort: 'low', includeUsage: true,
    requestLabel: 'staff-ai-qwen-ttft',
});
const total = Date.now() - started;
console.log('[TTFT] result', JSON.stringify({model, toolsRegistered:registered.size, firstOutputMs:first, totalMs:total, response:response.slice(0,120)}));
if (first < 0 || !response.trim()) process.exitCode = 1;
