// Minimal real-API probe for Gemma 4 native tool calling. Never logs credentials.
import { config } from '../src/config.js';

const model = process.argv[2] || 'gemma4-e4b-it-qat';
const toolChoices: unknown[] = [
    'required',
    { type: 'function', function: { name: 'report_measurement' } },
    'auto',
];

for (const toolChoice of toolChoices) {
    const started = performance.now();
    try {
        const response = await fetch(`${config.pexAi.endpoint.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            signal: AbortSignal.timeout(180_000),
            headers: {
                'Content-Type': 'application/json',
                ...(config.pexAi.apiKey ? { Authorization: `Bearer ${config.pexAi.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model,
                stream: false,
                temperature: 0,
                max_tokens: 128,
                reasoning_effort: 'none',
                chat_template_kwargs: { enable_thinking: false },
                tools: [{
                    type: 'function',
                    function: {
                        name: 'report_measurement',
                        description: 'Report the measured integer.',
                        parameters: {
                            type: 'object',
                            properties: { value: { type: 'integer' } },
                            required: ['value'],
                            additionalProperties: false,
                        },
                    },
                }],
                tool_choice: toolChoice,
                messages: [{ role: 'user', content: 'Call report_measurement exactly once with value 42.' }],
            }),
        });
        const data = await response.json() as any;
        const call = data.choices?.[0]?.message?.tool_calls?.[0];
        console.log(JSON.stringify({
            model,
            toolChoice,
            status: response.status,
            latencyMs: Math.round(performance.now() - started),
            finishReason: data.choices?.[0]?.finish_reason,
            toolCall: call ? { type: call.type, name: call.function?.name, arguments: call.function?.arguments } : null,
            usage: data.usage,
            error: data.error?.message,
        }));
        if (response.ok && call?.function?.name === 'report_measurement') break;
    } catch (error) {
        console.log(JSON.stringify({ model, toolChoice, latencyMs: Math.round(performance.now() - started), error: String(error) }));
    }
}
