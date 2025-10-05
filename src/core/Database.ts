import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * JSON ベースのデータベースシステム
 * Data/ フォルダに各種設定を JSON ファイルとして保存・読み込みします
 */
export class Database {
    private dataDir: string;
    private cache: Map<string, any>;

    constructor(dataDir?: string) {
        // プロジェクトルートの Data フォルダをデフォルトとして使用
        this.dataDir = dataDir || path.join(path.dirname(path.dirname(__dirname)), 'Data');
        this.cache = new Map();
    }

    /**
     * データベースを初期化（Data フォルダを作成）
     */
    async initialize(): Promise<void> {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            console.log(`📁 データベースディレクトリを初期化: ${this.dataDir}`);
        } catch (error) {
            console.error('データベースディレクトリの作成に失敗:', error);
            throw error;
        }
    }

    /**
     * データを保存
     * @param key データのキー（ファイル名として使用）
     * @param data 保存するデータ（JSON シリアライズ可能）
     */
    async set<T = any>(key: string, data: T): Promise<void> {
        try {
            const filePath = this.getFilePath(key);
            const jsonData = JSON.stringify(data, null, 2);
            await fs.writeFile(filePath, jsonData, 'utf-8');
            this.cache.set(key, data);
            console.log(`💾 データを保存: ${key}`);
        } catch (error) {
            console.error(`データ保存エラー [${key}]:`, error);
            throw error;
        }
    }

    /**
     * データを取得
     * @param key データのキー（ファイル名）
     * @param defaultValue データが存在しない場合のデフォルト値
     * @returns 保存されているデータまたはデフォルト値
     */
    async get<T = any>(key: string, defaultValue: T | null = null): Promise<T | null> {
        try {
            // キャッシュから取得を試みる
            if (this.cache.has(key)) {
                return this.cache.get(key);
            }

            const filePath = this.getFilePath(key);
            const data = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(data) as T;
            this.cache.set(key, parsed);
            return parsed;
        } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code === 'ENOENT') {
                // ファイルが存在しない場合はデフォルト値を返す
                return defaultValue;
            }
            console.error(`データ読み込みエラー [${key}]:`, error);
            throw error;
        }
    }

    /**
     * データが存在するかチェック
     * @param key データのキー
     * @returns 存在する場合 true
     */
    async has(key: string): Promise<boolean> {
        try {
            const filePath = this.getFilePath(key);
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * データを削除
     * @param key データのキー
     */
    async delete(key: string): Promise<void> {
        try {
            const filePath = this.getFilePath(key);
            await fs.unlink(filePath);
            this.cache.delete(key);
            console.log(`🗑️ データを削除: ${key}`);
        } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code !== 'ENOENT') {
                console.error(`データ削除エラー [${key}]:`, error);
                throw error;
            }
        }
    }

    /**
     * すべてのキーを取得
     * @returns 保存されているすべてのキー
     */
    async keys(): Promise<string[]> {
        try {
            const files = await fs.readdir(this.dataDir);
            return files
                .filter(file => file.endsWith('.json'))
                .map(file => file.replace('.json', ''));
        } catch (error) {
            console.error('キー一覧の取得エラー:', error);
            return [];
        }
    }

    /**
     * キャッシュをクリア
     */
    clearCache(): void {
        this.cache.clear();
        console.log('🧹 キャッシュをクリアしました');
    }

    /**
     * ファイルパスを取得
     * @param key データのキー
     * @returns 完全なファイルパス
     */
    private getFilePath(key: string): string {
        return path.join(this.dataDir, `${key}.json`);
    }

    /**
     * データベースディレクトリのパスを取得
     * @returns データベースディレクトリの絶対パス
     */
    getDataDir(): string {
        return this.dataDir;
    }
}

// シングルトンインスタンス
export const database = new Database();
