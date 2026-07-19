// src/core/ai/OpenAIChatManager.ts
import {
    AvailableModel,
    ChatGPTClient,
    ChatGPTClientOptions,
    ChatOptions,
    ResponseApiStreamDelta,
} from './ChatGPTClient.js';
import { OpenAIChatCompletionMessage } from '../../types/openai.js';
import { config } from '../../config.js';

export const PEX_AI_ENDPOINT = config.pexAi.endpoint;
export const PEX_AI_MODEL = config.pexAi.model;
export const PEX_AI_FALLBACK_MODEL = config.pexAi.fallbackModel;

export interface GenerateTextOptions extends Omit<ChatOptions, 'stream'> {}

export class OpenAIChatManager extends ChatGPTClient {
    constructor(options: ChatGPTClientOptions = {}) {
        super({
            apiEndpoint: config.pexAi.endpoint,
            apiKey: config.pexAi.apiKey || undefined,
            defaultModel: config.pexAi.model,
            ...options,
        });
    }

    /** Chat Completions の通常応答から本文だけを返す簡易 API。 */
    public async generateText(
        messages: OpenAIChatCompletionMessage[],
        options?: GenerateTextOptions
    ): Promise<string> {
        const response = await this.sendMessage(messages, this.withPexModelFallback(options));
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
        }, this.withPexModelFallback(options));
    }

    /** Responses API のストリームを使い、通常出力と API レベルの thinking/reasoning を分けて返す。 */
    public async streamResponseText(
        messages: OpenAIChatCompletionMessage[],
        onDelta: (delta: ResponseApiStreamDelta) => void,
        options?: GenerateTextOptions
    ): Promise<void> {
        await this.streamResponse(messages, onDelta, this.withPexModelFallback(options));
    }

    private withPexModelFallback(options?: GenerateTextOptions): GenerateTextOptions {
        const requestedModels = Array.isArray(options?.model)
            ? options.model
            : options?.model
                ? [options.model]
                : [config.pexAi.model];
        const primaryRequested = requestedModels.length === 1
            && String(requestedModels[0]) === config.pexAi.model;

        // strictModelは「指定モデル以外を呼ばない」という呼び出し側の明示指定。
        // ここでfallbackModelを配列へ追加すると、ChatGPTClient側では両方が
        // 明示候補になり、Gemini失敗時に意図せずGemmaへ進んでしまう。
        if (options?.strictModel || !primaryRequested || !config.pexAi.fallbackModel) {
            return { ...options };
        }

        return {
            ...options,
            model: Array.from(new Set([
                config.pexAi.model,
                config.pexAi.fallbackModel,
            ])),
            fallbackOnLimitOnly: true,
        };
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
