/**
 * キャッシュ管理ユーティリティ
 * API呼び出しの結果を一時的にキャッシュしてパフォーマンスを向上
 */

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number; // Time To Live in milliseconds
}

export class CacheManager {
    private static cache = new Map<string, CacheEntry<any>>();
    private static readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

    /**
     * キャッシュからデータを取得
     * @param key キャッシュキー
     * @returns キャッシュされたデータ、またはnull
     */
    static get<T>(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // TTLチェック
        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    /**
     * データをキャッシュに保存
     * @param key キャッシュキー
     * @param data 保存するデータ
     * @param ttl TTL（ミリ秒、デフォルト: 5分）
     */
    static set<T>(key: string, data: T, ttl: number = this.DEFAULT_TTL): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl
        });
    }

    /**
     * キャッシュからデータを削除
     * @param key キャッシュキー
     */
    static delete(key: string): void {
        this.cache.delete(key);
    }

    /**
     * キャッシュをクリア
     */
    static clear(): void {
        this.cache.clear();
    }

    /**
     * 期限切れのキャッシュエントリを削除
     */
    static cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > entry.ttl) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * キャッシュの統計情報を取得
     * @returns キャッシュの統計情報
     */
    static getStats(): { size: number; keys: string[] } {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }

    /**
     * キャッシュされた関数実行のラッパー
     * @param key キャッシュキー
     * @param fn 実行する関数
     * @param ttl TTL（ミリ秒）
     * @returns キャッシュされた結果または新規実行結果
     */
    static async cached<T>(
        key: string,
        fn: () => Promise<T>,
        ttl: number = this.DEFAULT_TTL
    ): Promise<T> {
        // キャッシュチェック
        const cached = this.get<T>(key);
        if (cached !== null) {
            return cached;
        }

        // 関数実行
        const result = await fn();

        // キャッシュ保存
        this.set(key, result, ttl);

        return result;
    }

    /**
     * ロール関連データのキャッシュキー生成
     * @param guildId ギルドID
     * @param type データタイプ
     * @returns キャッシュキー
     */
    static getRoleCacheKey(guildId: string, type: 'roles' | 'presets' | 'permissions'): string {
        return `guild:${guildId}:${type}`;
    }

    /**
     * ユーザー関連データのキャッシュキー生成
     * @param userId ユーザーID
     * @param type データタイプ
     * @returns キャッシュキー
     */
    static getUserCacheKey(userId: string, type: 'profile' | 'permissions' | 'guilds'): string {
        return `user:${userId}:${type}`;
    }
}

// 定期的なクリーンアップを設定
if (typeof globalThis !== 'undefined' && !globalThis._cacheCleanupInterval) {
    globalThis._cacheCleanupInterval = setInterval(() => {
        CacheManager.cleanup();
    }, 10 * 60 * 1000); // 10分ごとにクリーンアップ
}