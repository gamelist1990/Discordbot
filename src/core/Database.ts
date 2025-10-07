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
     * @param guildId ギルドID
     * @param key データのキー（ファイル名として使用、サブディレクトリ対応）
     * @param data 保存するデータ（JSON シリアライズ可能）
     */
    async set<T = any>(guildId: string, key: string, data: T): Promise<void> {
        const fullKey = `${guildId}_${key}`;
        try {
            const filePath = this.getFilePath(fullKey);
            const dirPath = path.dirname(filePath);
            
            // サブディレクトリが存在しない場合は作成
            await fs.mkdir(dirPath, { recursive: true });
            
            const jsonData = JSON.stringify(data, null, 2);
            await fs.writeFile(filePath, jsonData, 'utf-8');
            this.cache.set(fullKey, data);
            console.log(`💾 データを保存: ${fullKey}`);
        } catch (error) {
            console.error(`データ保存エラー [${fullKey}]:`, error);
            throw error;
        }
    }

    /**
     * データを取得
     * @param guildId ギルドID
     * @param key データのキー（ファイル名）
     * @param defaultValue データが存在しない場合のデフォルト値
     * @returns 保存されているデータまたはデフォルト値
     */
    async get<T = any>(guildId: string, key: string, defaultValue: T | null = null): Promise<T | null> {
        const fullKey = `${guildId}_${key}`;
        try {
            // キャッシュから取得を試みる
            if (this.cache.has(fullKey)) {
                return this.cache.get(fullKey);
            }

            const filePath = this.getFilePath(fullKey);
            const data = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(data) as T;
            this.cache.set(fullKey, parsed);
            return parsed;
        } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code === 'ENOENT') {
                // ファイルが存在しない場合はデフォルト値を返す
                return defaultValue;
            }
            console.error(`データ読み込みエラー [${fullKey}]:`, error);
            throw error;
        }
    }

    /**
     * データが存在するかチェック
     * @param guildId ギルドID
     * @param key データのキー
     * @returns 存在する場合 true
     */
    async has(guildId: string, key: string): Promise<boolean> {
        const fullKey = `${guildId}_${key}`;
        try {
            const filePath = this.getFilePath(fullKey);
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * データを削除
     * @param guildId ギルドID
     * @param key データのキー
     */
    async delete(guildId: string, key: string): Promise<boolean> {
        const fullKey = `${guildId}_${key}`;
        try {
            const filePath = this.getFilePath(fullKey);
            await fs.unlink(filePath);
            this.cache.delete(fullKey);
            console.log(`🗑️ データを削除: ${fullKey}`);
            return true;
        } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code !== 'ENOENT') {
                console.error(`データ削除エラー [${fullKey}]:`, error);
                throw error;
            }
            return false;
        }
    }

    /**
     * ギルドの全データを取得
     * @param guildId ギルドID
     * @returns ギルドの全データ
     */
    async getAll(guildId: string): Promise<Record<string, any>> {
        try {
            const result: Record<string, any> = {};
            
            // 再帰的にファイルを検索
            const searchDir = async (dirPath: string, prefix: string = ''): Promise<void> => {
                const items = await fs.readdir(dirPath, { withFileTypes: true });
                
                for (const item of items) {
                    const itemPath = path.join(dirPath, item.name);
                    const relativePath = prefix ? `${prefix}/${item.name}` : item.name;
                    
                    if (item.isDirectory()) {
                        await searchDir(itemPath, relativePath);
                    } else if (item.isFile() && item.name.endsWith('.json')) {
                        const key = item.name.replace('.json', '');
                        if (key.startsWith(`${guildId}_`)) {
                            const dataKey = key.replace(`${guildId}_`, '');
                            const data = await this.get(guildId, dataKey);
                            if (data !== null) {
                                result[dataKey] = data;
                            }
                        }
                    }
                }
            };
            
            await searchDir(this.dataDir);
            return result;
        } catch (error) {
            console.error(`ギルド全データ取得エラー [${guildId}]:`, error);
            return {};
        }
    }

    /**
     * すべてのキーを取得
     * @returns 保存されているすべてのキー
     */
    async keys(): Promise<string[]> {
        try {
            const result: string[] = [];
            
            // 再帰的にファイルを検索
            const searchDir = async (dirPath: string): Promise<void> => {
                const items = await fs.readdir(dirPath, { withFileTypes: true });
                
                for (const item of items) {
                    const itemPath = path.join(dirPath, item.name);
                    
                    if (item.isDirectory()) {
                        await searchDir(itemPath);
                    } else if (item.isFile() && item.name.endsWith('.json')) {
                        const key = item.name.replace('.json', '');
                        result.push(key);
                    }
                }
            };
            
            await searchDir(this.dataDir);
            return result;
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
