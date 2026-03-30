import { ChatGPTClient } from '../ChatGPTClient.js';
import { CORE_FEATURE_MODEL_FALLBACKS } from './constants.js';

export async function requestCoreFeatureModelText(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    maxTokens: number,
    temperature: number
): Promise<string> {
    const client = new ChatGPTClient();
    const response = await client.sendMessage(messages, {
        model: [...CORE_FEATURE_MODEL_FALLBACKS],
        maxTokens,
        temperature
    });

    const content = response.choices[0]?.message?.content;
    return typeof content === 'string' ? content : '';
}
