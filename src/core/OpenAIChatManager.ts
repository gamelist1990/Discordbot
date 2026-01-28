// src/core/OpenAIChatManager.ts
import { config } from '../config';
import {
    OpenAIChatCompletionMessage,
    OpenAIChatCompletionRequest,
    OpenAIChatCompletionResponse,
    OpenAIChatCompletionChunk,
    OpenAITool,
    ToolHandler
} from '../types/openai';

interface ChatOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    stream?: boolean;
    // optional overrides for endpoint/key to support fallbacks (e.g., OpenAI-compatible proxies)
    apiEndpoint?: string;
    apiKey?: string;
}

export class OpenAIChatManager {
    private apiKey: string;
    private apiEndpoint: string;
    private defaultModel: string;
    private tools: Map<string, { definition: OpenAITool; handler: ToolHandler }> = new Map();
    private toolContext: any = null;

    constructor() {
        if (!config.openai || !config.openai.apiKey || !config.openai.apiEndpoint || !config.openai.defaultModel) {
            throw new Error('OpenAI configuration is missing in config.ts');
        }
        this.apiKey = config.openai.apiKey;
        this.apiEndpoint = config.openai.apiEndpoint;
        this.defaultModel = config.openai.defaultModel;
    }

    /**
     * ツールを登録します
     * @param definition ツール定義（OpenAI形式）
     * @param handler ツール実行ハンドラ
     */
    public registerTool(definition: OpenAITool, handler: ToolHandler): void {
        this.tools.set(definition.function.name, { definition, handler });
    }

    /**
     * ツール実行時のコンテキストを設定します（例: interaction オブジェクト）
     * @param context コンテキストオブジェクト
     */
    public setToolContext(context: any): void {
        this.toolContext = context;
    }

    /**
     * 登録されたツールをクリアします
     */
    public clearTools(): void {
        this.tools.clear();
        this.toolContext = null;
    }

    /**
     * 標準のチャット補完を送信します。
     * @param messages 会話メッセージの配列
     * @param options オプション（モデル、温度など）
     * @returns チャット補完のレスポンス
     */
    public async sendMessage(
        messages: OpenAIChatCompletionMessage[],
        options?: ChatOptions
    ): Promise<OpenAIChatCompletionResponse> {
        const payload: OpenAIChatCompletionRequest = {
            model: options?.model || this.defaultModel,
            messages: messages,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? 1024,
            top_p: options?.topP ?? 1,
            stream: false, // ストリーミングではない
        };

        try {
            const endpoint = options?.apiEndpoint || this.apiEndpoint;
            const key = options?.apiKey || this.apiKey;
            const response = await fetch(`${endpoint}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('OpenAI API Error:', errorData);
                throw new Error(`OpenAI API request failed: ${response.statusText} - ${JSON.stringify(errorData)}`);
            }

            return (await response.json()) as OpenAIChatCompletionResponse;

        } catch (error) {
            console.error('Error sending message to OpenAI:', error);
            throw error;
        }
    }

    /**
     * ストリーミング形式でチャット補完を送信します。
     * @param messages 会話メッセージの配列
     * @param onChunkReceive チャンクデータを受信するコールバック関数
     * @param options オプション（モデル、温度など）
     */
    public async streamMessage(
        messages: OpenAIChatCompletionMessage[],
        onChunkReceive: (chunk: OpenAIChatCompletionChunk) => void,
        options?: ChatOptions
    ): Promise<void> {
        const toolDefinitions = Array.from(this.tools.values()).map(t => t.definition);
        
        const payload: OpenAIChatCompletionRequest = {
            model: options?.model || this.defaultModel,
            messages: messages,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? 1024,
            top_p: options?.topP ?? 1,
            stream: true, // ストリーミングを有効化
            ...(toolDefinitions.length > 0 && { tools: toolDefinitions, tool_choice: 'auto' })
        };

        try {
            const endpoint = options?.apiEndpoint || this.apiEndpoint;
            const key = options?.apiKey || this.apiKey;
            const response = await fetch(`${endpoint}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('OpenAI Stream API Error:', errorData);
                throw new Error(`OpenAI Stream API request failed: ${response.statusText} - ${JSON.stringify(errorData)}`);
            }

            if (!response.body) {
                throw new Error('Response body is empty for streaming.');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            const toolCallsBuffer: Map<number, { id?: string; name?: string; arguments: string }> = new Map();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // 最後の不完全な行をバッファに残す

                for (const line of lines) {
                    if (line.trim().length === 0) continue;
                    if (line.startsWith('data:')) {
                        const jsonStr = line.substring(5).trim();
                        if (jsonStr === '[DONE]') {
                            // ツール呼び出しがある場合は実行
                            if (toolCallsBuffer.size > 0) {
                                await this.handleToolCalls(toolCallsBuffer, messages, onChunkReceive, options);
                            }
                            return; // ストリームの終了
                        }
                        try {
                            const chunk: OpenAIChatCompletionChunk = JSON.parse(jsonStr);
                            
                            // ツール呼び出しのバッファリング
                            if (chunk.choices[0]?.delta?.tool_calls) {
                                for (const toolCall of chunk.choices[0].delta.tool_calls) {
                                    const existing = toolCallsBuffer.get(toolCall.index) || { arguments: '' };
                                    if (toolCall.id) existing.id = toolCall.id;
                                    if (toolCall.function?.name) existing.name = toolCall.function.name;
                                    if (toolCall.function?.arguments) existing.arguments += toolCall.function.arguments;
                                    toolCallsBuffer.set(toolCall.index, existing);
                                }
                            }
                            
                            onChunkReceive(chunk);
                        } catch (parseError) {
                            console.error('Error parsing stream chunk:', parseError, 'Line:', jsonStr);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error streaming message to OpenAI:', error);
            throw error;
        }
    }

    /**
     * ツール呼び出しを処理し、結果を含めて再度AIに問い合わせます
     */
    private async handleToolCalls(
        toolCallsBuffer: Map<number, { id?: string; name?: string; arguments: string }>,
        originalMessages: OpenAIChatCompletionMessage[],
        onChunkReceive: (chunk: OpenAIChatCompletionChunk) => void,
        options?: ChatOptions
    ): Promise<void> {
        const toolCalls = Array.from(toolCallsBuffer.values())
            .filter(tc => tc.id && tc.name)
            .map(tc => ({
                id: tc.id!,
                type: 'function' as const,
                function: { name: tc.name!, arguments: tc.arguments }
            }));

        if (toolCalls.length === 0) return;

        // アシスタントのツール呼び出しメッセージを追加
        const assistantMessage: OpenAIChatCompletionMessage = {
            role: 'assistant',
            content: null,
            tool_calls: toolCalls
        };

        const newMessages = [...originalMessages, assistantMessage];

        // ツールを実行して結果メッセージを追加
        for (const toolCall of toolCalls) {
            const toolEntry = this.tools.get(toolCall.function.name);
            if (!toolEntry) {
                console.error(`Tool not found: ${toolCall.function.name}`);
                continue;
            }

            // presence/timer support: if toolContext contains a Discord interaction/client,
            // update bot presence to indicate the tool is being processed and show elapsed seconds.
            const discordClient = this.toolContext?.client;
            let restorePresence: any = null;
            let timerInterval: any = null;

            try {
                const args = JSON.parse(toolCall.function.arguments);

                // start presence timer if possible
                if (discordClient && discordClient.user && typeof discordClient.user.setPresence === 'function') {
                    try {
                        // save previous presence for restore
                        restorePresence = {
                            activities: discordClient.user.presence?.activities || [],
                            status: discordClient.user.presence?.status || 'online'
                        };
                    } catch (e) {
                        restorePresence = null;
                    }

                    let seconds = 0;
                    // initial set
                    try { discordClient.user.setPresence({ activities: [{ name: `考え中... (${toolCall.function.name}: ${seconds}s)` }], status: 'idle' }); } catch (e) { /* ignore */ }
                    timerInterval = setInterval(() => {
                        seconds++;
                        try { discordClient.user.setPresence({ activities: [{ name: `考え中... (${toolCall.function.name}: ${seconds}s)` }], status: 'idle' }); } catch (e) { /* ignore */ }
                    }, 1000);
                }

                const result = await toolEntry.handler(args, this.toolContext);
                const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

                newMessages.push({
                    role: 'tool',
                    content: resultStr,
                    tool_call_id: toolCall.id
                });
            } catch (error) {
                console.error(`Error executing tool ${toolCall.function.name}:`, error);
                newMessages.push({
                    role: 'tool',
                    content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    tool_call_id: toolCall.id
                });
            } finally {
                // clear timer and restore presence
                try {
                    if (timerInterval) clearInterval(timerInterval);
                    if (discordClient && discordClient.user && typeof discordClient.user.setPresence === 'function') {
                        if (restorePresence) {
                            try { discordClient.user.setPresence({ activities: restorePresence.activities, status: restorePresence.status }); } catch (e) { /* ignore */ }
                        } else {
                            try { discordClient.user.setPresence({ activities: [], status: 'online' }); } catch (e) { /* ignore */ }
                        }
                    }
                } catch (e) {
                    // ignore restore errors
                }
            }
        }

        // 結果を含めて再度ストリーミング呼び出し
        await this.streamMessage(newMessages, onChunkReceive, options);
    }
}