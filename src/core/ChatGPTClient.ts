// src/core/ChatGPTClient.ts
import OpenAI from 'openai';
import { config } from '../config.js';
import { ChatGPTModel } from './ChatGPTModels.js';
import {
    OpenAIChatCompletionChunk,
    OpenAIChatCompletionMessage,
    OpenAIChatCompletionRequest,
    OpenAIChatCompletionResponse,
    OpenAITool,
    OpenAIToolCall,
    ToolHandler,
} from '../types/openai.js';

interface ChatOptions {
    model?: ModelSelectionInput;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    stream?: boolean;
    apiEndpoint?: string;
    apiKey?: string;
}

interface ChatGPTClientOptions {
    apiKey?: string;
    apiEndpoint?: string;
    defaultModel?: string;
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

export class ChatGPTClient {
    public static readonly Model = ChatGPTModel;

    private readonly apiKey: string;
    private readonly apiEndpoint: string;
    private readonly defaultModel: string;
    private readonly tools: Map<string, { definition: OpenAITool; handler: ToolHandler }> = new Map();
    private toolContext: any = null;
    private readonly modelCache: Map<string, ModelCacheEntry> = new Map();
    private readonly modelCacheTtlMs = 5 * 60 * 1000;
    private readonly maxToolRounds = 8;

    constructor(options: ChatGPTClientOptions = {}) {
        const apiKey = options.apiKey || config.openai.apiKey;
        const apiEndpoint = this.normalizeEndpoint(options.apiEndpoint || config.openai.apiEndpoint);
        const defaultModel = options.defaultModel || config.openai.defaultModel || '';

        if (!apiKey || !apiEndpoint) {
            throw new Error('OpenAI configuration is missing in config.ts');
        }

        this.apiKey = apiKey;
        this.apiEndpoint = apiEndpoint;
        this.defaultModel = defaultModel;
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
        const candidates = await this.resolveModelCandidates(options);
        return candidates[0] || this.defaultModel;
    }

    public async resolveModelCandidates(options?: ChatOptions): Promise<string[]> {
        const auth = this.resolveAuth(options);
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
        if (toolRound > this.maxToolRounds) {
            throw new Error('Tool call recursion limit reached.');
        }

        const auth = this.resolveAuth(options);
        const modelCandidates = await this.resolveModelCandidates(options);
        if (modelCandidates.length === 0) {
            throw new Error('No compatible model could be resolved from the configured endpoint.');
        }

        const client = this.createClient(auth);
        let lastError: unknown = null;

        for (const model of modelCandidates) {
            try {
                const payload = this.buildRequestPayload(messages, options, model, false);
                const response = await client.chat.completions.create(payload as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
                const typedResponse = response as unknown as OpenAIChatCompletionResponse;

                const toolCalls = typedResponse.choices[0]?.message?.tool_calls ?? [];
                if (toolCalls.length > 0) {
                    const nextMessages = await this.executeToolCalls(toolCalls, messages);
                    return this.sendMessage(nextMessages, options, toolRound + 1);
                }

                return typedResponse;
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError instanceof Error
            ? lastError
            : new Error('No model candidate succeeded.');
    }

    public async streamMessage(
        messages: OpenAIChatCompletionMessage[],
        onChunkReceive: (chunk: OpenAIChatCompletionChunk) => void,
        options?: ChatOptions,
        toolRound = 0
    ): Promise<void> {
        if (toolRound > this.maxToolRounds) {
            throw new Error('Tool call recursion limit reached.');
        }

        const auth = this.resolveAuth(options);
        const modelCandidates = await this.resolveModelCandidates(options);
        if (modelCandidates.length === 0) {
            throw new Error('No compatible model could be resolved from the configured endpoint.');
        }
        const client = this.createClient(auth);
        const toolDefinitions = Array.from(this.tools.values()).map(tool => tool.definition);
        let lastError: unknown = null;

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
                    await this.streamMessage(nextMessages, onChunkReceive, options, toolRound + 1);
                }

                return;
            } catch (error) {
                lastError = error;
                if (emittedChunk) {
                    break;
                }
            }
        }

        throw lastError instanceof Error
            ? lastError
            : new Error('No model candidate succeeded.');
    }

    private resolveAuth(options?: ChatOptions): ClientAuth {
        return {
            apiEndpoint: this.normalizeEndpoint(options?.apiEndpoint || this.apiEndpoint),
            apiKey: options?.apiKey || this.apiKey,
        };
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

    private createClient(auth: ClientAuth): OpenAI {
        return new OpenAI({ apiKey: auth.apiKey, baseURL: auth.apiEndpoint });
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
            max_tokens: options?.maxTokens ?? 1024,
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
