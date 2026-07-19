// src/core/ai/OpenAIChatManager.ts
import {
    AvailableModel,
    ChatGPTClient,
    ChatGPTClientOptions,
    ChatOptions,
} from './ChatGPTClient.js';
import { OpenAIChatCompletionMessage } from '../../types/openai.js';

export const PEX_AI_ENDPOINT = 'http://api.pexserver.com:9000/v1';
export const PEX_AI_MODEL = 'gemma4-agent';

export interface GenerateTextOptions extends Omit<ChatOptions, 'stream'> {}

export class OpenAIChatManager extends ChatGPTClient {
    constructor(options: ChatGPTClientOptions = {}) {
        super(options);
    }

    /** Chat Completions の通常応答から本文だけを返す簡易 API。 */
    public async generateText(
        messages: OpenAIChatCompletionMessage[],
        options?: GenerateTextOptions
    ): Promise<string> {
        const response = await this.sendMessage(messages, options);
        const content = response.choices[0]?.message?.content;
        return typeof content === 'string' ? content : '';
    }

    /** SSE のチャンク形式を隠し、追加テキストだけをコールバックへ渡す簡易 API。 */
    public async streamText(
        messages: OpenAIChatCompletionMessage[],
        onText: (text: string) => void,
        options?: GenerateTextOptions
    ): Promise<void> {
        await this.streamMessage(messages, (chunk) => {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                onText(content);
            }
        }, options);
    }

    /** GET /v1/models 相当のモデルカタログを返す。 */
    public async listModels(forceRefresh = false): Promise<AvailableModel[]> {
        return this.getAvailableModelCatalog({ forceRefresh });
    }

    /** GET /v1/models/{model} 相当として、指定 ID のモデル情報を返す。 */
    public async getModel(model: string, forceRefresh = false): Promise<AvailableModel | null> {
        const models = await this.listModels(forceRefresh);
        return models.find((entry) => entry.id === model) ?? null;
    }
}
