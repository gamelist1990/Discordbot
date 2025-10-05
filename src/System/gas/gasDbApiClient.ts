// GasDbApiClient.ts

import { ApiResponse } from './types';

/**
 * Google Apps Script Web App (JSON DB API) と通信するためのクライアントクラス。
 * インスタンス生成はコンストラクタを直接使用します。
 */
export class GasDbApiClient {
    private readonly gasWebAppUrl: string;
    private readonly defaultSheetName: string;
    private readonly instanceAuthKey?: string;

    constructor(apiUrl: string, defaultSheet?: string, instanceAuth?: string) {
        if (!apiUrl || typeof apiUrl !== 'string' || apiUrl.trim() === "") {
            const errorMsg = `GasDbApiClient requires a non-empty apiUrl. Provided: "${apiUrl}"`;
            console.error("[GasDbApiClient FATAL]", errorMsg);
            throw new Error(errorMsg);
        }
        this.gasWebAppUrl = apiUrl;
        this.defaultSheetName = defaultSheet || "jsonDB_v4";
        this.instanceAuthKey = instanceAuth;
        let logUrl = this.gasWebAppUrl;
        if (logUrl.length > 60) logUrl = logUrl.substring(0, 57) + "...";
        console.log(`[GasDbApiClient] Instance created. URL: ${logUrl}, DefaultSheet: ${this.defaultSheetName}, InstanceAuthKey: ${this.instanceAuthKey ? "Provided" : "Not Provided"}`);
    }

    private async _fetchApi<T = any>(
        payload: {
            action: string;
            sheetName: string;
            id?: string;            /** getItemById, updateItemById, deleteItemById 用 */
            customId?: string;      /** addItem でカスタムIDを指定する場合用 */
            data?: any;
            query?: any;
            auth?: string;
        }
    ): Promise<ApiResponse<T>> {
        const fullPayload: any = { ...payload };
        fullPayload.sheetName = payload.sheetName || this.defaultSheetName;

        if (payload.auth && String(payload.auth).trim() !== "") {
            fullPayload.auth = String(payload.auth).trim();
        } else if (this.instanceAuthKey && String(this.instanceAuthKey).trim() !== "") {
            fullPayload.auth = String(this.instanceAuthKey).trim();
        } else {
            delete fullPayload.auth;
        }

        const requestUrl = this.gasWebAppUrl;
        const loggablePayload = { ...fullPayload };
        if (loggablePayload.auth) loggablePayload.auth = '***';
        console.log(`[GasDbApiClient] Action: ${fullPayload.action}, Sheet: ${fullPayload.sheetName}, Payload: ${JSON.stringify(loggablePayload)}`);

        let httpStatus = 500;
        try {
            const response = await fetch(requestUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fullPayload),
                redirect: 'follow',
                signal: AbortSignal.timeout(30000),
            });
            httpStatus = response.status;
            const contentType = response.headers.get("content-type");
            let responseData: any;
            if (contentType && contentType.includes("application/json")) {
                responseData = await response.json();
            } else {
                const textResponse = await response.text();
                console.warn(`[GasDbApiClient] Received non-JSON response (status: ${httpStatus}, type: ${contentType}). Action: ${payload.action}. Body: ${textResponse.substring(0, 200)}`);
                return { success: false, status: httpStatus, error: `Received non-JSON response from server. Status: ${httpStatus}. Action: ${payload.action}`, originalErrorData: { rawResponse: textResponse.substring(0, 500) } };
            }
            if (typeof responseData.success !== 'boolean') {
                console.warn("[GasDbApiClient] Received unexpected response format (missing 'success' field):", responseData);
                return { success: false, status: httpStatus, error: "Received unexpected format from server (missing 'success' field)", originalErrorData: responseData };
            }
            return { ...responseData, status: httpStatus };
        } catch (error: any) {
            console.error(`[GasDbApiClient] Network/Fetch error during POST request for action ${payload.action}:`, error);
            let errorMessage = `Client-side fetch error (POST): ${error.message || String(error)} for action ${payload.action}`;
            if (error.name === 'AbortError') {
                httpStatus = 408;
                errorMessage = `Client-side fetch error (POST): Request timed out after 30s for action ${payload.action}`;
            }
            return { success: false, status: httpStatus, error: errorMessage };
        }
    }

    /**
     * 新しいアイテムをデータベースに追加します。
     * @param dataToStore 保存するJSONオブジェクト。
     * @param itemSpecificAuthKey (任意) このアイテム専用の合言葉。指定されなければインスタンスの共通合言葉を使用。
     * @param sheetName (任意) 使用するシート名。
     * @param customItemId (任意) このアイテムに使用するカスタムID。指定されなければGAS側で数値IDが自動生成される。
     * @template T 期待されるレスポンスデータ型（通常は {id: string, data: object}）。
     * @returns APIからのレスポンス。
     */
    public async addItem<T = { id: string, data: object }>(
        dataToStore: object,
        itemSpecificAuthKey?: string,
        sheetName?: string,
        customItemId?: string // ★ customId パラメータを追加
    ): Promise<ApiResponse<T>> {
        return this._fetchApi<T>({
            action: 'addItem',
            data: dataToStore,
            auth: itemSpecificAuthKey,
            sheetName: sheetName || this.defaultSheetName,
            customId: customItemId // ★ ペイロードに customId を含める
        });
    }

    // ... (getItemById, updateItemById, getAllItems, deleteItemById, findItems, invalidateCache, invalidateAllCaches は変更なし) ...
    public async getAllItems<T = { id: string, data: object }[]>(accessAuthKey?: string, sheetName?: string): Promise<ApiResponse<T>> {
        return this._fetchApi<T>({
            action: 'getAllItems',
            auth: accessAuthKey,
            sheetName: sheetName || this.defaultSheetName
        });
    }

    public async getItemById<T = { id: string, data: object } | null>(itemId: string, itemSpecificAuthKey?: string, sheetName?: string): Promise<ApiResponse<T>> {
        if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
            return { success: false, status: 400, error: "Client validation: ID must be a non-empty string." };
        }
        return this._fetchApi<T>({
            action: 'getItemById',
            id: itemId.trim(),
            auth: itemSpecificAuthKey,
            sheetName: sheetName || this.defaultSheetName
        });
    }

    public async updateItemById<T = { id: string, data: object } | null>(itemId: string, dataToUpdate: object, itemSpecificAuthKey?: string, sheetName?: string): Promise<ApiResponse<T>> {
        if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
            return { success: false, status: 400, error: "Client validation: ID must be a non-empty string." };
        }
        if (typeof dataToUpdate !== 'object' || dataToUpdate === null) {
            return { success: false, status: 400, error: "Client validation: Data to update must be an object." };
        }
        return this._fetchApi<T>({
            action: 'updateItemById',
            id: itemId.trim(),
            data: dataToUpdate,
            auth: itemSpecificAuthKey,
            sheetName: sheetName || this.defaultSheetName
        });
    }
    public async deleteItemById<T = { deleted: boolean }>(itemId: string, itemSpecificAuthKey?: string, sheetName?: string): Promise<ApiResponse<T>> {
        if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
            return { success: false, status: 400, error: "Client validation: ID must be a non-empty string." };
        }
        return this._fetchApi<T>({
            action: 'deleteItemById',
            id: itemId.trim(),
            auth: itemSpecificAuthKey,
            sheetName: sheetName || this.defaultSheetName
        });
    }

    public async findItems<T = { id: string, data: object }[]>(queryToMatch: object, accessAuthKey?: string, sheetName?: string): Promise<ApiResponse<T>> {
        if (typeof queryToMatch !== 'object' || queryToMatch === null) {
            return { success: false, status: 400, error: "Client validation: Query must be an object." };
        }
        return this._fetchApi<T>({
            action: 'findItems',
            query: queryToMatch,
            auth: accessAuthKey,
            sheetName: sheetName || this.defaultSheetName
        });
    }

    public async invalidateCache(sheetNameToInvalidate?: string): Promise<ApiResponse<{ message: string }>> {
        return this._fetchApi({
            action: 'invalidateCache',
            sheetName: sheetNameToInvalidate || this.defaultSheetName,
        });
    }

    public async invalidateAllCaches(): Promise<ApiResponse<{ message: string }>> {
        return this._fetchApi({
            action: 'invalidateAllCaches',
            sheetName: this.defaultSheetName,
        });
    }
}