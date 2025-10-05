/**
 * @description GasDbApiClient の設定データの型定義。
 * APIキーはクライアントレベルでは不要になりました。
 */
export interface GasConfig {
    url: string;
    default_sheet_name?: string;
}

/**
 * @description APIからの共通レスポンスの型定義。
 * GAS側の応答形式 (success, data/error) に合わせます。
 * @template T - 成功時の data プロパティの型。
 */
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string; 
    status?: number; /** クライアント側で付加するHTTPステータスコード */
    originalErrorData?: any; /** クライアント側で、より詳細なエラー情報を保持する場合 */
}