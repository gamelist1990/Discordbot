// src/core/ai/ChatGPTClient.ts
import OpenAI from 'openai';
import { config } from '../../config.js';
import { ChatGPTModel } from './ChatGPTModels.js';
import { Logger } from '../../utils/Logger.js';
import {
    OpenAIChatCompletionChunk,
    OpenAIChatCompletionMessage,
    OpenAIChatCompletionRequest,
    OpenAIChatCompletionResponse,
    OpenAITool,
    OpenAIToolCall,
    ToolHandler,
} from '../../types/openai.js';

export interface ChatOptions {
    model?: ModelSelectionInput;
    strictModel?: boolean;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    stream?: boolean;
    apiEndpoint?: string;
    apiEndpoints?: string[];
    apiKey?: string;
    requestLabel?: string;
    onRateLimitWait?: (info: RateLimitWaitInfo) => void | Promise<void>;
}

export interface ChatGPTClientOptions {
    apiKey?: string;
    apiEndpoint?: string;
    defaultModel?: string;
    proxyEndpoints?: string[];
    rateLimitMaxWaitMs?: number;
}

export interface AvailableModel {
    id: string;
    count: number;
    created: number;
    ownedBy: string;
}

interface ModelCacheEntry {
    models: AvailableModel[];
    fetchedAt: number;
}

interface ToolCallBufferItem {
    id?: string;
    name?: string;
    arguments: string;
}

type ClientAuth = {
    apiEndpoint: string;
    apiKey: string;
};

export type ModelSelection = ChatGPTModel | string;
export type ModelSelectionInput = ModelSelection | ModelSelection[];

export interface RateLimitWaitInfo {
    requestLabel: string;
    apiEndpoint: string;
    model: string | null;
    waitMs: number;
    retryAt: string;
    status: number | null;
    requestId: string | null;
}

export interface ResponseApiStreamDelta {
    type: 'text' | 'thinking';
    text: string;
}

interface ResponseFunctionCallItem {
    id?: string;
    callId: string;
    name: string;
    arguments: string;
}

export class ChatGPTClient {
    public static readonly Model = ChatGPTModel;
    private static readonly DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

    private readonly apiKey: string;
    private readonly apiEndpoint: string;
    private readonly defaultModel: string;
    private readonly proxyEndpoints: string[];
    private readonly rateLimitMaxWaitMs: number;
    private readonly tools: Map<string, { definition: OpenAITool; handler: ToolHandler }> = new Map();
    private toolContext: any = null;
    private readonly modelCache: Map<string, ModelCacheEntry> = new Map();
    private readonly modelCacheTtlMs = 5 * 60 * 1000;
    private readonly maxToolRounds = 8;
    private readonly maxRateLimitWaitRounds = 2;

    constructor(options: ChatGPTClientOptions = {}) {
        const apiKey = options.apiKey || config.openai.apiKey;
        const apiEndpoint = this.normalizeEndpoint(options.apiEndpoint || config.openai.apiEndpoint);
        const defaultModel = options.defaultModel || config.openai.defaultModel || '';
        const proxyEndpoints = this.normalizeEndpointList(options.proxyEndpoints || config.openai.proxyEndpoints || []);
        const rateLimitMaxWaitMs = typeof options.rateLimitMaxWaitMs === 'number'
            ? options.rateLimitMaxWaitMs
            : config.openai.rateLimitMaxWaitMs || (3 * 60 * 1000);

        if (!apiKey || !apiEndpoint) {
            throw new Error('OpenAI configuration is missing in config.ts');
        }

        this.apiKey = apiKey;
        this.apiEndpoint = apiEndpoint;
        this.defaultModel = defaultModel;
        this.proxyEndpoints = proxyEndpoints.filter((entry) => entry !== this.apiEndpoint);
        this.rateLimitMaxWaitMs = Math.max(15_000, Math.round(rateLimitMaxWaitMs));
    }

    public registerTool(definition: OpenAITool, handler: ToolHandler): void {
        this.tools.set(definition.function.name, { definition, handler });
    }

    public setToolContext(context: any): void {
        this.toolContext = context;
    }

    public clearTools(): void {
        this.tools.clear();
        this.toolContext = null;
    }

    public async getAvailableModels(options?: { apiEndpoint?: string; apiKey?: string; forceRefresh?: boolean }): Promise<string[]> {
        const models = await this.getAvailableModelCatalog(options);
        return models.map(model => model.id);
    }

    public async getAvailableModelCatalog(options?: { apiEndpoint?: string; apiKey?: string; forceRefresh?: boolean }): Promise<AvailableModel[]> {
        const auth = this.resolveAuth(options);
        const cacheKey = this.getCacheKey(auth);
        const cached = this.modelCache.get(cacheKey);

        if (!options?.forceRefresh && cached && Date.now() - cached.fetchedAt < this.modelCacheTtlMs) {
            return cached.models;
        }

        try {
            const client = this.createClient(auth);
            const response = await client.models.list();
            const models = this.groupModelEntries(response.data as Array<{ id?: string; created?: number; owned_by?: string; count?: number }>);

            this.modelCache.set(cacheKey, {
                models,
                fetchedAt: Date.now(),
            });

            return models;
        } catch (error) {
            console.error('Failed to load model list from OpenAI-compatible endpoint:', error);
            return cached?.models ?? [];
        }
    }

    public async resolveModel(options?: ChatOptions): Promise<string> {
        const [auth] = this.resolveAuthCandidates(options);
        const candidates = await this.resolveModelCandidates(options, auth);
        return candidates[0] || this.defaultModel;
    }

    public async resolveModelCandidates(options?: ChatOptions, authOverride?: ClientAuth): Promise<string[]> {
        const auth = authOverride || this.resolveAuth(options);
        const preferredModels = this.normalizeModelSelections(options?.model);
        const availableModels = await this.getAvailableModels(auth);
        const candidates: string[] = [];

        const pushCandidate = (model: string): void => {
            const normalized = this.normalizeModelSelection(model);
            if (!normalized || normalized === ChatGPTModel.Auto || candidates.includes(normalized)) {
                return;
            }
            candidates.push(normalized);
        };

        for (const preferredModel of preferredModels) {
            if (availableModels.length === 0 || availableModels.includes(preferredModel)) {
                pushCandidate(preferredModel);
            }
        }

        for (const preferredModel of preferredModels) {
            pushCandidate(preferredModel);
        }

        if (options?.strictModel) {
            if (candidates.length === 0 && this.defaultModel) {
                pushCandidate(this.defaultModel);
            }
            return candidates;
        }

        if (this.defaultModel && (availableModels.length === 0 || availableModels.includes(this.defaultModel) || candidates.length === 0)) {
            pushCandidate(this.defaultModel);
        }

        for (const availableModel of availableModels) {
            pushCandidate(availableModel);
        }

        if (candidates.length === 0 && this.defaultModel) {
            pushCandidate(this.defaultModel);
        }

        return candidates;
    }

    public async sendMessage(
        messages: OpenAIChatCompletionMessage[],
        options?: ChatOptions,
        toolRound = 0
    ): Promise<OpenAIChatCompletionResponse> {
        return this.sendMessageInternal(messages, options, toolRound, 0);
    }

    public async streamMessage(
        messages: OpenAIChatCompletionMessage[],
        onChunkReceive: (chunk: OpenAIChatCompletionChunk) => void,
        options?: ChatOptions,
        toolRound = 0
    ): Promise<void> {
        return this.streamMessageInternal(messages, onChunkReceive, options, toolRound, 0);
    }

    public async streamResponse(
        messages: OpenAIChatCompletionMessage[],
        onDeltaReceive: (delta: ResponseApiStreamDelta) => void,
        options?: ChatOptions,
        toolRound = 0
    ): Promise<void> {
        return this.streamResponseInternal(messages, onDeltaReceive, options, toolRound, 0);
    }

    private async sendMessageInternal(
        messages: OpenAIChatCompletionMessage[],
        options: ChatOptions | undefined,
        toolRound: number,
        rateLimitRound: number
    ): Promise<OpenAIChatCompletionResponse> {
        if (toolRound > this.maxToolRounds) {
            throw new Error('Tool call recursion limit reached.');
        }

        const authCandidates = this.resolveAuthCandidates(options);
        if (authCandidates.length === 0) {
            throw new Error('No compatible model could be resolved from the configured endpoint.');
        }

        let lastError: unknown = null;
        const rateLimitWaits: RateLimitWaitInfo[] = [];

        for (const auth of authCandidates) {
            const modelCandidates = await this.resolveModelCandidates(options, auth);
            if (modelCandidates.length === 0) {
                continue;
            }

            const client = this.createClient(auth);
            for (const model of modelCandidates) {
                try {
                    const payload = this.buildRequestPayload(messages, options, model, false);
                    const response = await client.chat.completions.create(payload as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
                    const typedResponse = response as unknown as OpenAIChatCompletionResponse;

                    const toolCalls = typedResponse.choices[0]?.message?.tool_calls ?? [];
                    if (toolCalls.length > 0) {
                        const nextMessages = await this.executeToolCalls(toolCalls, messages);
                        return this.sendMessageInternal(nextMessages, options, toolRound + 1, 0);
                    }

                    return typedResponse;
                } catch (error) {
                    lastError = error;
                    const rateLimitInfo = this.buildRateLimitWaitInfo(error, options, auth.apiEndpoint, model);
                    if (rateLimitInfo) {
                        rateLimitWaits.push(rateLimitInfo);
                    }
                }
            }
        }

        if (rateLimitWaits.length > 0 && rateLimitRound < this.maxRateLimitWaitRounds) {
            const nextWait = rateLimitWaits.reduce((best, current) => current.waitMs < best.waitMs ? current : best);
            await this.notifyRateLimitWait(options, nextWait, rateLimitRound + 1);
            await this.sleep(nextWait.waitMs);
            return this.sendMessageInternal(messages, options, toolRound, rateLimitRound + 1);
        }

        throw lastError instanceof Error
            ? lastError
            : new Error('No model candidate succeeded.');
    }

    private async streamMessageInternal(
        messages: OpenAIChatCompletionMessage[],
        onChunkReceive: (chunk: OpenAIChatCompletionChunk) => void,
        options: ChatOptions | undefined,
        toolRound: number,
        rateLimitRound: number
    ): Promise<void> {
        if (toolRound > this.maxToolRounds) {
            throw new Error('Tool call recursion limit reached.');
        }

        const authCandidates = this.resolveAuthCandidates(options);
        if (authCandidates.length === 0) {
            throw new Error('No compatible model could be resolved from the configured endpoint.');
        }

        const toolDefinitions = Array.from(this.tools.values()).map(tool => tool.definition);
        let lastError: unknown = null;
        const rateLimitWaits: RateLimitWaitInfo[] = [];

        for (const auth of authCandidates) {
            const modelCandidates = await this.resolveModelCandidates(options, auth);
            if (modelCandidates.length === 0) {
                continue;
            }

            const client = this.createClient(auth);
            for (const model of modelCandidates) {
                const toolCallsBuffer: Map<number, ToolCallBufferItem> = new Map();
                let emittedChunk = false;

                try {
                    const payload = this.buildRequestPayload(messages, options, model, true, toolDefinitions);
                    const stream = await client.chat.completions.create(payload as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

                    for await (const chunk of stream as AsyncIterable<unknown>) {
                        emittedChunk = true;

                        const typedChunk = chunk as OpenAIChatCompletionChunk;
                        const deltaToolCalls = typedChunk.choices[0]?.delta?.tool_calls;

                        if (deltaToolCalls) {
                            for (const toolCall of deltaToolCalls) {
                                const existing = toolCallsBuffer.get(toolCall.index) || { arguments: '' };
                                if (toolCall.id) existing.id = toolCall.id;
                                if (toolCall.function?.name) existing.name = toolCall.function.name;
                                if (toolCall.function?.arguments) existing.arguments += toolCall.function.arguments;
                                toolCallsBuffer.set(toolCall.index, existing);
                            }
                        }

                        onChunkReceive(typedChunk);
                    }

                    if (toolCallsBuffer.size > 0) {
                        const nextMessages = await this.executeToolCallsFromBuffer(toolCallsBuffer, messages);
                        await this.streamMessageInternal(nextMessages, onChunkReceive, options, toolRound + 1, 0);
                    }

                    return;
                } catch (error) {
                    lastError = error;
                    if (emittedChunk) {
                        break;
                    }

                    const rateLimitInfo = this.buildRateLimitWaitInfo(error, options, auth.apiEndpoint, model);
                    if (rateLimitInfo) {
                        rateLimitWaits.push(rateLimitInfo);
                    }
                }
            }
        }

        if (rateLimitWaits.length > 0 && rateLimitRound < this.maxRateLimitWaitRounds) {
            const nextWait = rateLimitWaits.reduce((best, current) => current.waitMs < best.waitMs ? current : best);
            await this.notifyRateLimitWait(options, nextWait, rateLimitRound + 1);
            await this.sleep(nextWait.waitMs);
            return this.streamMessageInternal(messages, onChunkReceive, options, toolRound, rateLimitRound + 1);
        }

        throw lastError instanceof Error
            ? lastError
            : new Error('No model candidate succeeded.');
    }

    private async streamResponseInternal(
        messages: OpenAIChatCompletionMessage[],
        onDeltaReceive: (delta: ResponseApiStreamDelta) => void,
        options: ChatOptions | undefined,
        toolRound: number,
        rateLimitRound: number,
        previousResponseId?: string,
        responseInput?: any[]
    ): Promise<void> {
        if (toolRound > this.maxToolRounds) {
            throw new Error('Response API tool call recursion limit reached.');
        }

        const authCandidates = this.resolveAuthCandidates(options);
        if (authCandidates.length === 0) {
            throw new Error('No compatible model could be resolved from the configured endpoint.');
        }

        const toolDefinitions = Array.from(this.tools.values()).map(tool => tool.definition);
        let lastError: unknown = null;
        const rateLimitWaits: RateLimitWaitInfo[] = [];

        for (const auth of authCandidates) {
            const modelCandidates = await this.resolveModelCandidates(options, auth);
            if (modelCandidates.length === 0) {
                continue;
            }

            for (const model of modelCandidates) {
                let emittedDelta = false;

                try {
                    const payload = this.buildResponseApiPayload(
                        responseInput ?? this.convertChatMessagesToResponseInput(messages),
                        options,
                        model,
                        toolDefinitions,
                        previousResponseId,
                    );
                    const result = await this.streamResponseApiPayload(auth, payload, (delta) => {
                        emittedDelta = true;
                        onDeltaReceive(delta);
                    });

                    if (result.functionCalls.length > 0) {
                        const toolOutputs = await this.executeResponseFunctionCalls(result.functionCalls);
                        if (toolOutputs.length > 0 && result.responseId) {
                            await this.streamResponseInternal(
                                messages,
                                onDeltaReceive,
                                options,
                                toolRound + 1,
                                0,
                                result.responseId,
                                toolOutputs,
                            );
                        }
                    }

                    return;
                } catch (error) {
                    lastError = error;
                    if (emittedDelta) {
                        break;
                    }

                    const rateLimitInfo = this.buildRateLimitWaitInfo(error, options, auth.apiEndpoint, model);
                    if (rateLimitInfo) {
                        rateLimitWaits.push(rateLimitInfo);
                    }
                }
            }
        }

        if (rateLimitWaits.length > 0 && rateLimitRound < this.maxRateLimitWaitRounds) {
            const nextWait = rateLimitWaits.reduce((best, current) => current.waitMs < best.waitMs ? current : best);
            await this.notifyRateLimitWait(options, nextWait, rateLimitRound + 1);
            await this.sleep(nextWait.waitMs);
            return this.streamResponseInternal(messages, onDeltaReceive, options, toolRound, rateLimitRound + 1, previousResponseId, responseInput);
        }

        throw lastError instanceof Error
            ? lastError
            : new Error('No Response API model candidate succeeded.');
    }

    private resolveAuth(options?: ChatOptions): ClientAuth {
        return {
            apiEndpoint: this.normalizeEndpoint(options?.apiEndpoint || this.apiEndpoint),
            apiKey: options?.apiKey || this.apiKey,
        };
    }

    private resolveAuthCandidates(options?: ChatOptions): ClientAuth[] {
        const apiKey = options?.apiKey || this.apiKey;
        const explicitEndpoint = typeof options?.apiEndpoint === 'string' && options.apiEndpoint.trim().length > 0
            ? [options.apiEndpoint]
            : [];
        const extraEndpoints = Array.isArray(options?.apiEndpoints) ? options.apiEndpoints : [];
        const endpoints = explicitEndpoint.length > 0
            ? explicitEndpoint
            : [this.apiEndpoint, ...this.proxyEndpoints, ...extraEndpoints];

        return this.normalizeEndpointList(endpoints).map((apiEndpoint) => ({
            apiEndpoint,
            apiKey,
        }));
    }

    private normalizeModelSelection(model?: ModelSelection): string {
        if (model === undefined || model === null) {
            return ChatGPTModel.Auto;
        }

        const normalized = String(model).trim();
        return normalized.length > 0 ? normalized : ChatGPTModel.Auto;
    }

    private normalizeModelSelections(model?: ModelSelectionInput): string[] {
        if (Array.isArray(model)) {
            return model
                .map(entry => this.normalizeModelSelection(entry))
                .filter(entry => entry !== ChatGPTModel.Auto);
        }

        const normalized = this.normalizeModelSelection(model);
        return normalized === ChatGPTModel.Auto ? [] : [normalized];
    }

    private getCacheKey(auth: ClientAuth): string {
        return `${auth.apiEndpoint}::${auth.apiKey}`;
    }

    private normalizeEndpoint(endpoint: string): string {
        return endpoint.replace(/\/+$/, '');
    }

    private normalizeEndpointList(endpoints: string[]): string[] {
        const normalized: string[] = [];
        const seen = new Set<string>();

        for (const endpoint of endpoints) {
            const cleaned = typeof endpoint === 'string' ? this.normalizeEndpoint(endpoint.trim()) : '';
            if (!cleaned || seen.has(cleaned)) {
                continue;
            }
            seen.add(cleaned);
            normalized.push(cleaned);
        }

        return normalized;
    }

    private createClient(auth: ClientAuth): OpenAI {
        return new OpenAI({ apiKey: auth.apiKey, baseURL: auth.apiEndpoint });
    }

    private buildResponseApiPayload(
        input: any[],
        options: ChatOptions | undefined,
        model: string,
        tools: OpenAITool[],
        previousResponseId?: string
    ): Record<string, unknown> {
        return {
            model,
            input,
            temperature: options?.temperature ?? 0.7,
            max_output_tokens: model === 'gemma4:e2b-it-qat'
                ? Math.max(options?.maxTokens ?? 2048, 512)
                : options?.maxTokens ?? 1024,
            top_p: options?.topP ?? 1,
            stream: true,
            ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
            ...(tools.length > 0 ? { tools: this.convertToolsToResponseTools(tools), tool_choice: 'auto' } : {}),
        };
    }

    private convertChatMessagesToResponseInput(messages: OpenAIChatCompletionMessage[]): any[] {
        return messages
            .filter(message => message.role !== 'tool')
            .map(message => {
                const role = message.role === 'function' ? 'user' : message.role;
                if (typeof message.content === 'string' || message.content === null) {
                    return {
                        role,
                        content: message.content ?? '',
                    };
                }

                return {
                    role,
                    content: message.content.map(part => {
                        if (part.type === 'image_url') {
                            return {
                                type: 'input_image',
                                image_url: part.image_url?.url ?? '',
                                detail: part.image_url?.detail ?? 'auto',
                            };
                        }

                        return {
                            type: 'input_text',
                            text: part.text ?? '',
                        };
                    }),
                };
            });
    }

    private convertToolsToResponseTools(tools: OpenAITool[]): any[] {
        return tools.map(tool => ({
            type: 'function',
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
        }));
    }

    private async streamResponseApiPayload(
        auth: ClientAuth,
        payload: Record<string, unknown>,
        onDeltaReceive: (delta: ResponseApiStreamDelta) => void
    ): Promise<{ responseId: string | null; functionCalls: ResponseFunctionCallItem[] }> {
        const response = await fetch(`${auth.apiEndpoint}/responses`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${auth.apiKey}`,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok || !response.body) {
            const errorText = await response.text().catch(() => '');
            const error = new Error(`Response API request failed: HTTP ${response.status} ${errorText}`);
            (error as any).status = response.status;
            (error as any).headers = response.headers;
            throw error;
        }

        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        let buffer = '';
        let responseId: string | null = null;
        const functionCallsByKey = new Map<string, ResponseFunctionCallItem>();
        const textDeltaItems = new Set<string>();
        const thinkingDeltaItems = new Set<string>();

        const handleEvent = (data: any): void => {
            responseId = this.extractResponseId(data) ?? responseId;

            const eventType = typeof data?.type === 'string' ? data.type : '';
            const textDelta = this.extractResponseTextDelta(data, eventType);
            if (textDelta) {
                textDeltaItems.add(String(data?.item_id ?? data?.output_index ?? 'default'));
                onDeltaReceive({ type: 'text', text: textDelta });
            }

            const thinkingDelta = this.extractResponseThinkingDelta(data, eventType);
            if (thinkingDelta) {
                thinkingDeltaItems.add(String(data?.item_id ?? data?.output_index ?? 'default'));
                onDeltaReceive({ type: 'thinking', text: thinkingDelta });
            }

            // PEXは実行によってdeltaを省略し、done/output_item.doneにだけ完成文を
            // 入れる場合がある。deltaを既に受信したitemでは全文を再送せず、
            // deltaが無かったitemだけdoneをフォールバックとして通知する。
            if (eventType === 'response.output_text.done' && typeof data?.text === 'string') {
                const itemKey = String(data?.item_id ?? data?.output_index ?? 'default');
                if (!textDeltaItems.has(itemKey)) {
                    textDeltaItems.add(itemKey);
                    onDeltaReceive({ type: 'text', text: data.text });
                }
            }

            if (eventType === 'response.reasoning_summary_text.done' && typeof data?.text === 'string') {
                const itemKey = String(data?.item_id ?? data?.output_index ?? 'default');
                if (!thinkingDeltaItems.has(itemKey)) {
                    thinkingDeltaItems.add(itemKey);
                    onDeltaReceive({ type: 'thinking', text: data.text });
                }
            }

            if (eventType === 'response.output_item.done' && data?.item?.type === 'reasoning') {
                const itemKey = String(data.item.id ?? data?.output_index ?? 'default');
                const summaryText = Array.isArray(data.item.summary)
                    ? data.item.summary
                        .map((entry: any) => typeof entry?.text === 'string' ? entry.text : '')
                        .filter(Boolean)
                        .join('\n')
                    : '';
                if (summaryText && !thinkingDeltaItems.has(itemKey)) {
                    thinkingDeltaItems.add(itemKey);
                    onDeltaReceive({ type: 'thinking', text: summaryText });
                }
            }

            this.collectResponseFunctionCall(data, eventType, functionCallsByKey);
        };

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                let separatorIndex = buffer.indexOf('\n\n');

                while (separatorIndex >= 0) {
                    const rawEvent = buffer.slice(0, separatorIndex);
                    buffer = buffer.slice(separatorIndex + 2);
                    separatorIndex = buffer.indexOf('\n\n');

                    const dataLines = rawEvent
                        .split(/\r?\n/)
                        .filter(line => line.startsWith('data:'))
                        .map(line => line.slice(5).trim());
                    const dataText = dataLines.join('\n');

                    if (!dataText || dataText === '[DONE]') {
                        continue;
                    }

                    try {
                        handleEvent(JSON.parse(dataText));
                    } catch (error) {
                        Logger.debug('[ChatGPTClient] Failed to parse Response API stream event:', error);
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        return {
            responseId,
            functionCalls: Array.from(functionCallsByKey.values())
                .filter(call => call.callId && call.name),
        };
    }

    private extractResponseId(data: any): string | null {
        const directId = typeof data?.id === 'string' && data.id.startsWith('resp_') ? data.id : null;
        const responseId = typeof data?.response?.id === 'string' ? data.response.id : null;
        return responseId || directId;
    }

    private extractResponseTextDelta(data: any, eventType: string): string {
        // PEX Responses API は delta の後に done（全文）も返す。
        // done.text まで通知すると「6」+「6です。」のように回答が二重化するため、
        // ストリーミング表示には delta イベントだけを使用する。
        return eventType === 'response.output_text.delta' && typeof data?.delta === 'string'
            ? data.delta
            : '';
    }

    private extractResponseThinkingDelta(data: any, eventType: string): string {
        // PEX は reasoning/thinking 系イベントを複数の名前で返し得る。
        // 実機確認済みの response.reasoning_summary_text.delta を含め、
        // reasoning または thinking を含み末尾が .delta のイベントだけを拾う。
        // .done は完成済み全文なので対象外にし、二重加算を防ぐ。
        const isThinkingDelta = (eventType.includes('reasoning') || eventType.includes('thinking'))
            && eventType.endsWith('.delta');
        return isThinkingDelta && typeof data?.delta === 'string'
            ? data.delta
            : '';
    }

    private collectResponseFunctionCall(
        data: any,
        eventType: string,
        functionCallsByKey: Map<string, ResponseFunctionCallItem>
    ): void {
        const item = data?.item;
        if ((eventType === 'response.output_item.added' || eventType === 'response.output_item.done') && item?.type === 'function_call') {
            const key = String(item.id ?? item.call_id ?? data.output_index ?? functionCallsByKey.size);
            const existing = functionCallsByKey.get(key) || {
                id: typeof item.id === 'string' ? item.id : undefined,
                callId: typeof item.call_id === 'string' ? item.call_id : '',
                name: typeof item.name === 'string' ? item.name : '',
                arguments: '',
            };
            existing.id = typeof item.id === 'string' ? item.id : existing.id;
            existing.callId = typeof item.call_id === 'string' ? item.call_id : existing.callId;
            existing.name = typeof item.name === 'string' ? item.name : existing.name;
            existing.arguments = typeof item.arguments === 'string' ? item.arguments : existing.arguments;
            functionCallsByKey.set(key, existing);
            return;
        }

        if (eventType === 'response.function_call_arguments.delta') {
            const key = String(data.item_id ?? data.output_index ?? '0');
            const existing = functionCallsByKey.get(key) || {
                id: typeof data.item_id === 'string' ? data.item_id : undefined,
                callId: '',
                name: '',
                arguments: '',
            };
            if (typeof data.delta === 'string') {
                existing.arguments += data.delta;
            }
            functionCallsByKey.set(key, existing);
        }
    }

    private async executeResponseFunctionCalls(functionCalls: ResponseFunctionCallItem[]): Promise<any[]> {
        const outputs: any[] = [];

        for (const functionCall of functionCalls) {
            const toolEntry = this.tools.get(functionCall.name);
            if (!toolEntry) {
                outputs.push({
                    type: 'function_call_output',
                    call_id: functionCall.callId,
                    name: functionCall.name,
                    output: `Error: Tool not found: ${functionCall.name}`,
                });
                continue;
            }

            try {
                const args = functionCall.arguments ? JSON.parse(functionCall.arguments) : {};
                const result = await toolEntry.handler(args, this.toolContext);
                outputs.push({
                    type: 'function_call_output',
                    call_id: functionCall.callId,
                    name: functionCall.name,
                    output: typeof result === 'string' ? result : JSON.stringify(result),
                });
            } catch (error) {
                outputs.push({
                    type: 'function_call_output',
                    call_id: functionCall.callId,
                    name: functionCall.name,
                    output: `Error: ${error instanceof Error ? error.message : String(error)}`,
                });
            }
        }

        return outputs;
    }

    private buildRateLimitWaitInfo(
        error: unknown,
        options: ChatOptions | undefined,
        apiEndpoint: string,
        model: string
    ): RateLimitWaitInfo | null {
        const status = this.extractErrorStatus(error);
        if (status !== 429 && !this.looksLikeRateLimitMessage(error)) {
            return null;
        }

        const waitMs = this.extractRetryWaitMs(error);
        return {
            requestLabel: options?.requestLabel || 'chatgpt-request',
            apiEndpoint,
            model,
            waitMs,
            retryAt: new Date(Date.now() + waitMs).toISOString(),
            status,
            requestId: this.extractHeader(error, 'x-request-id'),
        };
    }

    private async notifyRateLimitWait(
        options: ChatOptions | undefined,
        info: RateLimitWaitInfo,
        round: number
    ): Promise<void> {
        Logger.warn(
            `[ChatGPTClient] Rate limit detected for ${info.requestLabel} `
            + `(model=${info.model || 'unknown'} endpoint=${info.apiEndpoint} wait=${Math.ceil(info.waitMs / 1000)}s`
            + ` round=${round}${info.requestId ? ` requestId=${info.requestId}` : ''}).`
        );

        if (options?.onRateLimitWait) {
            await options.onRateLimitWait(info);
        }
    }

    private extractRetryWaitMs(error: unknown): number {
        const retryAfterMs = this.extractHeader(error, 'retry-after-ms');
        if (retryAfterMs) {
            const parsedMs = Number.parseInt(retryAfterMs, 10);
            if (Number.isFinite(parsedMs) && parsedMs > 0) {
                return Math.min(parsedMs, this.rateLimitMaxWaitMs);
            }
        }

        const retryAfter = this.extractHeader(error, 'retry-after');
        if (retryAfter) {
            const seconds = Number.parseFloat(retryAfter);
            if (Number.isFinite(seconds) && seconds > 0) {
                return Math.min(Math.round(seconds * 1000), this.rateLimitMaxWaitMs);
            }

            const retryAt = Date.parse(retryAfter);
            if (Number.isFinite(retryAt) && retryAt > Date.now()) {
                return Math.min(retryAt - Date.now(), this.rateLimitMaxWaitMs);
            }
        }

        const message = error instanceof Error ? error.message : String(error ?? '');
        const match = message.match(/(?:retry after|try again in)\s+(\d+)(ms|s|sec|seconds|m|min|minutes)?/i);
        if (match) {
            const amount = Number.parseInt(match[1], 10);
            const unit = (match[2] || 's').toLowerCase();
            if (Number.isFinite(amount) && amount > 0) {
                const multiplier = unit.startsWith('m')
                    ? 60_000
                    : unit === 'ms'
                        ? 1
                        : 1_000;
                return Math.min(amount * multiplier, this.rateLimitMaxWaitMs);
            }
        }

        return Math.min(ChatGPTClient.DEFAULT_RATE_LIMIT_WAIT_MS, this.rateLimitMaxWaitMs);
    }

    private extractHeader(error: unknown, headerName: string): string | null {
        const record = error as { headers?: Headers | Record<string, unknown> | null | undefined };
        const headers = record?.headers;
        const normalizedName = headerName.toLowerCase();

        if (!headers) {
            return null;
        }

        if (headers instanceof Headers) {
            return headers.get(normalizedName);
        }

        for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() !== normalizedName) {
                continue;
            }
            return typeof value === 'string' ? value : String(value);
        }

        return null;
    }

    private extractErrorStatus(error: unknown): number | null {
        const status = (error as { status?: unknown })?.status;
        return typeof status === 'number' && Number.isFinite(status) ? status : null;
    }

    private looksLikeRateLimitMessage(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error ?? '');
        return /rate limit|too many requests|429/i.test(message);
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, Math.max(0, ms));
            timer.unref?.();
        });
    }

    private groupModelEntries(models: Array<{ id?: string; created?: number; owned_by?: string; count?: number }>): AvailableModel[] {
        const grouped = new Map<string, AvailableModel>();

        for (const model of models) {
            const id = typeof model.id === 'string' ? model.id.trim() : '';
            if (!id) {
                continue;
            }

            const count = typeof model.count === 'number' && Number.isFinite(model.count) && model.count > 0 ? model.count : 1;
            const created = typeof model.created === 'number' && Number.isFinite(model.created) ? model.created : 0;
            const ownedBy = typeof model.owned_by === 'string' && model.owned_by.trim().length > 0 ? model.owned_by : 'unknown';

            const existing = grouped.get(id);
            if (existing) {
                existing.count += count;
                existing.created = Math.max(existing.created, created);
                if (existing.ownedBy === 'unknown' && ownedBy !== 'unknown') {
                    existing.ownedBy = ownedBy;
                }
                continue;
            }

            grouped.set(id, {
                id,
                count,
                created,
                ownedBy,
            });
        }

        return Array.from(grouped.values()).sort((a, b) => {
            if (b.count !== a.count) {
                return b.count - a.count;
            }

            if (b.created !== a.created) {
                return b.created - a.created;
            }

            return a.id.localeCompare(b.id);
        });
    }

    private buildRequestPayload(
        messages: OpenAIChatCompletionMessage[],
        options: ChatOptions | undefined,
        model: string,
        stream: boolean,
        tools: OpenAITool[] = []
    ): OpenAIChatCompletionRequest {
        return {
            model,
            messages,
            temperature: options?.temperature ?? 0.7,
            // gemma4:e2b-it-qat は reasoning も出力トークンを消費するため、
            // 小さすぎる上限では最終 content が空になる。最低 512 を確保する。
            max_tokens: model === 'gemma4:e2b-it-qat'
                ? Math.max(options?.maxTokens ?? 2048, 512)
                : options?.maxTokens ?? 1024,
            top_p: options?.topP ?? 1,
            stream,
            ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        };
    }

    private async executeToolCalls(
        toolCalls: OpenAIToolCall[],
        originalMessages: OpenAIChatCompletionMessage[]
    ): Promise<OpenAIChatCompletionMessage[]> {
        const assistantMessage: OpenAIChatCompletionMessage = {
            role: 'assistant',
            content: null,
            tool_calls: toolCalls,
        };

        const nextMessages = [...originalMessages, assistantMessage];
        return this.appendToolResults(nextMessages, toolCalls);
    }

    private async executeToolCallsFromBuffer(
        toolCallsBuffer: Map<number, ToolCallBufferItem>,
        originalMessages: OpenAIChatCompletionMessage[]
    ): Promise<OpenAIChatCompletionMessage[]> {
        const toolCalls = Array.from(toolCallsBuffer.values())
            .filter(call => call.id && call.name)
            .map(call => ({
                id: call.id!,
                type: 'function' as const,
                function: {
                    name: call.name!,
                    arguments: call.arguments,
                },
            }));

        if (toolCalls.length === 0) {
            return originalMessages;
        }

        return this.executeToolCalls(toolCalls, originalMessages);
    }

    private async appendToolResults(
        messages: OpenAIChatCompletionMessage[],
        toolCalls: OpenAIToolCall[]
    ): Promise<OpenAIChatCompletionMessage[]> {
        const nextMessages = [...messages];

        for (const toolCall of toolCalls) {
            const toolEntry = this.tools.get(toolCall.function.name);
            if (!toolEntry) {
                console.error(`Tool not found: ${toolCall.function.name}`);
                continue;
            }

            const discordClient = this.toolContext?.client;
            let restorePresence: { activities: any[]; status: string } | null = null;
            let timerInterval: ReturnType<typeof setInterval> | undefined;

            try {
                const args = JSON.parse(toolCall.function.arguments);

                if (discordClient?.user && typeof discordClient.user.setPresence === 'function') {
                    try {
                        restorePresence = {
                            activities: discordClient.user.presence?.activities || [],
                            status: discordClient.user.presence?.status || 'online',
                        };
                    } catch {
                        restorePresence = null;
                    }

                    let seconds = 0;
                    try {
                        discordClient.user.setPresence({ activities: [{ name: `考え中... (${toolCall.function.name}: ${seconds}s)` }], status: 'idle' });
                    } catch {
                        // ignore presence errors
                    }

                    timerInterval = setInterval(() => {
                        seconds++;
                        try {
                            discordClient.user.setPresence({ activities: [{ name: `考え中... (${toolCall.function.name}: ${seconds}s)` }], status: 'idle' });
                        } catch {
                            // ignore presence errors
                        }
                    }, 1000);
                }

                const result = await toolEntry.handler(args, this.toolContext);
                const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

                nextMessages.push({
                    role: 'tool',
                    content: resultStr,
                    tool_call_id: toolCall.id,
                });
            } catch (error) {
                console.error(`Error executing tool ${toolCall.function.name}:`, error);
                nextMessages.push({
                    role: 'tool',
                    content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    tool_call_id: toolCall.id,
                });
            } finally {
                try {
                    if (timerInterval) {
                        clearInterval(timerInterval);
                    }

                    if (discordClient?.user && typeof discordClient.user.setPresence === 'function') {
                        if (restorePresence) {
                            try {
                                discordClient.user.setPresence({ activities: restorePresence.activities, status: restorePresence.status });
                            } catch {
                                // ignore presence restore errors
                            }
                        } else {
                            try {
                                discordClient.user.setPresence({ activities: [], status: 'online' });
                            } catch {
                                // ignore presence restore errors
                            }
                        }
                    }
                } catch {
                    // ignore restore errors
                }
            }
        }

        return nextMessages;
    }
}
