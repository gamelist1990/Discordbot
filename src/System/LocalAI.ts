import fetch, { Response } from 'node-fetch';
import { TextDecoder } from 'util';

const DEFAULT_BACKEND_URL = "https://neuralai-jbwc.onrender.com";

interface StreamChunk {
    delta?: string;
    end_of_stream?: boolean;
    error?: any;
    status_code?: number;
    provider?: string;
    model?: string;
}

type OnChunkCallback = (chunk: StreamChunk) => void;

interface AIResponseJson {
    response: string;
}

interface ImageResponseJson {
    image_url?: string;
    image_b64?: string;
}

interface ErrorResponseJson {
    detail?: string | any;
}

interface ChatRequestPayload {
    provider_name?: string;
    model: string;
    message: string;
    stream: boolean;
    type?: 'chat' | 'image@url' | 'image@b64';
    api_key?: string;
}

interface ModelListRequestPayload {
    type: 'provider' | 'model';
    filter?: string;
}

class LocalAI {
    private backendUrl: string;
    private defaultProviderName: string | null = null;
    private defaultModelName: string;

    constructor(
        defaultProviderName: string | null | undefined,
        defaultModelName: string,
        backendUrl: string = DEFAULT_BACKEND_URL
    ) {
        this.defaultProviderName = defaultProviderName === undefined ? null : defaultProviderName;

        if (this.defaultProviderName === '') {
            console.warn(`デフォルトのProvider名が空文字です。Provider指定なしとして扱われます。リクエスト時に指定が必要です。`);
            this.defaultProviderName = null;
        }
        if (!defaultModelName || typeof defaultModelName !== 'string' || defaultModelName.trim() === '') {
            throw new Error("デフォルトのモデル名は必須であり、空でない文字列である必要があります。");
        }
        this.defaultModelName = defaultModelName.trim();
        this.backendUrl = backendUrl;

        console.log(`LocalAI initialized: DefaultProvider='${this.defaultProviderName ?? "Not set"}', DefaultModel='${this.defaultModelName}', Backend='${this.backendUrl}'`);
    }

    public async chat(
        prompt: string,
        options?: {
            providerName?: string | null;
            modelName?: string;
            apiKey?: string;
            onChunk?: OnChunkCallback;
        }
    ): Promise<string> {
        if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
            throw new Error("有効なプロンプトを入力してください。");
        }

        const { providerName: reqProviderName, modelName: reqModelName, apiKey, onChunk } = options ?? {};

        const providerName = reqProviderName !== undefined ? reqProviderName : this.defaultProviderName;
        const modelName = reqModelName?.trim() || this.defaultModelName;
        if (!modelName) {
            throw new Error("モデル名が指定されていません。コンストラクタまたは chat メソッドのオプションで指定してください。");
        }


        const isStreaming = onChunk !== undefined;
        const requestUrl = `${this.backendUrl}/chat`;

        const payload: ChatRequestPayload = {
            model: modelName,
            message: prompt.trim(),
            stream: isStreaming,
            type: 'chat',
        };

        if (providerName !== null) {
            if (providerName.trim() === '') {
                console.warn(`chatリクエストでProvider名が空文字です。Provider指定なしとして扱われます。`);
            } else {
                payload.provider_name = providerName;
            }
        }

        if (apiKey) {
            payload.api_key = apiKey;
        }

        console.log(`チャットリクエスト送信中: ${requestUrl} - Provider: ${payload.provider_name ?? 'Default'}, Model: ${payload.model}, Stream: ${isStreaming}`);

        try {
            const response: Response = await fetch(requestUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': isStreaming ? 'text/event-stream' : 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                await this._handleErrorResponse(response, 'チャットリクエスト');
                throw new Error("予期せぬエラーハンドリングフロー");
            }

            if (isStreaming && response.body && onChunk) {
                return this._handleStreamingResponse(response, onChunk);
            }

            const responseData = await response.json() as AIResponseJson;
            if (responseData?.response && typeof responseData.response === 'string') {
                console.log("チャット応答受信 (非ストリーミング)。");
                return responseData.response;
            } else {
                console.warn("バックエンドからの応答形式が無効でした(非ストリーミング)。", responseData);
                throw new Error("AIバックエンドからの応答形式が無効でした。");
            }

        } catch (error: any) {
            console.error("チャットリクエスト中にエラーが発生しました:", error);
            const causeMessage = error.cause ? ` (Cause: ${error.cause.code || error.cause.message || error.cause})` : '';
            throw new Error(`AIバックエンドリクエスト失敗: ${error.message}${causeMessage}`);
        }
    }

    public async generateImage(
        prompt: string,
        options?: {
            providerName?: string | null;
            modelName?: string;
            apiKey?: string;
            format?: 'url' | 'b64';
        }
    ): Promise<string> {
        if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
            throw new Error("有効なプロンプトを入力してください。");
        }

        const { providerName: reqProviderName, modelName: reqModelName, apiKey, format = 'url' } = options ?? {};

        const providerName = reqProviderName !== undefined ? reqProviderName : this.defaultProviderName;
        const modelName = reqModelName?.trim() || this.defaultModelName;
        if (!modelName) {
            throw new Error("モデル名が指定されていません。コンストラクタまたは generateImage メソッドのオプションで指定してください。");
        }

        const requestUrl = `${this.backendUrl}/chat`;
        const requestType = format === 'b64' ? 'image@b64' : 'image@url';

        const payload: ChatRequestPayload = {
            model: modelName,
            message: prompt.trim(),
            stream: false,
            type: requestType,
        };

        if (providerName !== null) {
            if (providerName.trim() === '') {
                console.warn(`画像生成リクエストでProvider名が空文字です。Provider指定なしとして扱われます。`);
            } else {
                payload.provider_name = providerName;
            }
        }
        if (apiKey) {
            payload.api_key = apiKey;
        }

        console.log(`画像生成リクエスト送信中: ${requestUrl} - Provider: ${payload.provider_name ?? 'Default'}, Model: ${payload.model}, Format: ${format}`);

        try {
            const response: Response = await fetch(requestUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                await this._handleErrorResponse(response, '画像生成リクエスト');
                throw new Error("予期せぬエラーハンドリングフロー");
            }

            const responseData = await response.json() as ImageResponseJson;

            if (format === 'url' && responseData?.image_url && typeof responseData.image_url === 'string') {
                console.log("画像URL受信完了。");
                return responseData.image_url;
            } else if (format === 'b64' && responseData?.image_b64 && typeof responseData.image_b64 === 'string') {
                console.log("画像Base64データ受信完了。");
                return responseData.image_b64;
            } else {
                console.warn(`バックエンドからの画像応答形式が無効でした (期待形式: ${format})。`, responseData);
                throw new Error(`AIバックエンドからの画像応答形式が期待した形式 (${format}) ではありませんでした。`);
            }

        } catch (error: any) {
            console.error("画像生成リクエスト中にエラーが発生しました:", error);
            const causeMessage = error.cause ? ` (Cause: ${error.cause.code || error.cause.message || error.cause})` : '';
            throw new Error(`AIバックエンドリクエスト失敗: ${error.message}${causeMessage}`);
        }
    }

    private async _handleErrorResponse(response: Response, requestType: string): Promise<never> {
        let errorDetail = `HTTPステータス: ${response.status} ${response.statusText}`;
        let responseBodyText = '';
        try {
            responseBodyText = await response.text();
            try {
                const errorJson = JSON.parse(responseBodyText) as ErrorResponseJson;
                if (errorJson?.detail) {
                    const detailString = typeof errorJson.detail === 'string' ? errorJson.detail : JSON.stringify(errorJson.detail);
                    errorDetail = `バックエンドエラー (${response.status}): ${detailString}`;
                } else if (responseBodyText) {
                    errorDetail = `バックエンドエラー (${response.status}): ${responseBodyText}`;
                }
            } catch (jsonError) {
                if (responseBodyText) {
                    errorDetail = `バックエンドエラー (${response.status}): ${responseBodyText}`;
                }
            }
        } catch (textError) {
            console.error("エラーレスポンスのテキスト読み取りにも失敗:", textError);
        }
        const errorMessage = `${requestType}が失敗しました。 ${errorDetail}`;
        console.error(errorMessage);
        throw new Error(`AIバックエンドとの通信に失敗しました。(${errorDetail})`, { cause: responseBodyText || undefined });
    }


    private async _handleStreamingResponse(response: Response, onChunk: OnChunkCallback): Promise<string> {
        if (!response.body) {
            throw new Error("Streaming response body is missing.");
        }
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let fullResponseText = '';
        let streamEndedNaturally = false;

        try {
            for await (const rawChunk of response.body) {
                if (!(rawChunk instanceof Uint8Array)) {
                    console.warn("Received chunk is not Uint8Array, attempting to convert.");
                    buffer += decoder.decode(Buffer.from(rawChunk), { stream: true });
                } else {
                    buffer += decoder.decode(rawChunk, { stream: true });
                }

                let parts = buffer.split('\n\n');
                buffer = parts.pop() || '';

                for (const part of parts) {
                    if (part.trim() === '') continue;

                    let eventType = 'message';
                    let data = '';
                    const lines = part.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            eventType = line.substring('event: '.length).trim();
                        } else if (line.startsWith('data: ')) {
                            data += line.substring('data: '.length);
                        }
                    }

                    if (data) {
                        try {
                            const chunkData: StreamChunk = JSON.parse(data);

                            if (eventType === 'error') {
                                console.error("ストリーミングエラー受信:", chunkData);
                                onChunk(chunkData);
                                throw new Error(`ストリーミングエラー受信: ${JSON.stringify(chunkData.error || chunkData)}`);
                            } else {
                                if (chunkData.delta) {
                                    fullResponseText += chunkData.delta;
                                }
                                onChunk(chunkData);
                                if (chunkData.end_of_stream) {
                                    console.log("ストリーム終了イベント受信。");
                                    streamEndedNaturally = true;
                                }
                            }
                        } catch (e: any) {
                            console.error("受信データのJSONパース失敗:", data, e);
                            const parseError = { error: { message: "Failed to parse chunk data", receivedData: data, cause: e.message } };
                            onChunk(parseError);
                            throw new Error(`受信データのJSONパース失敗: ${e.message}`);
                        }
                    }
                }
                await new Promise(resolve => setImmediate(resolve));
            }
            buffer += decoder.decode(undefined, { stream: false });
            if (buffer.trim()) {
                console.warn("ストリーム終了後、未処理のバッファが残っています:", buffer);
            }

            if (!streamEndedNaturally) {
                console.warn("ストリームが終了しましたが、end_of_stream イベントを受信しませんでした。接続が途中で切断された可能性があります。");
            }

            console.log("ストリーム読み取り完了。");
            return fullResponseText;

        } catch (streamError: any) {
            console.error("ストリーム読み取り中にエラー:", streamError);
            throw new Error(`ストリーム読み取りエラー: ${streamError.message || streamError}`);
        }
    }

    public async getAvailableProviders(filter?: string): Promise<string[]> {
        return this._fetchIdentifierList("provider", filter);
    }

    public async getAvailableModels(filter?: string): Promise<string[]> {
        return this._fetchIdentifierList("model", filter);
    }

    private async _fetchIdentifierList(identifierType: 'provider' | 'model', filter?: string): Promise<string[]> {
        const requestUrl = `${this.backendUrl}/models`;
        console.log(`利用可能な ${identifierType} リストを取得中${filter ? ` (Filter: '${filter}')` : ''}: ${requestUrl}`);

        const payload: ModelListRequestPayload = { type: identifierType };
        if (filter) {
            payload.filter = filter;
        }

        try {
            const response: Response = await fetch(requestUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                await this._handleErrorResponse(response, `${identifierType}リスト取得`).catch(_e => { });
                return [];
            }

            const identifiers = await response.json();

            if (Array.isArray(identifiers) && identifiers.every((item) => typeof item === 'string')) {
                console.log(`取得成功: ${identifierType} リスト (${identifiers.length}件)`);
                return identifiers as string[];
            } else {
                console.warn(`バックエンドから取得した ${identifierType} リストの形式が無効でした。`, identifiers);
                return [];
            }
        } catch (error: any) {
            console.error(`${identifierType}リストの取得中にネットワークエラー等が発生しました:`, error);
            return [];
        }
    }
}

export { LocalAI, OnChunkCallback, StreamChunk, ChatRequestPayload, ModelListRequestPayload };
