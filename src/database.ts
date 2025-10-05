// src/utils/JsonDB.ts
import { promises as fs } from 'fs';
import * as path from 'path';

// Json db 更新 各guild に対応版

interface GuildData {
    [key: string]: any;
}

interface DatabaseStructure {
    [guildId: string]: GuildData;
}

class JsonDB {
    private filePath: string;
    private dbDir: string;

    constructor(dbName: string, dbDirectory: string = './database') {
        this.dbDir = path.resolve(dbDirectory);
        this.filePath = path.join(this.dbDir, `${dbName}.json`);
        // 初期化時にディレクトリが存在するか確認・作成
        this.ensureDirectoryExists().catch(err => console.error("Failed to ensure database directory exists:", err));
    }

    private async ensureDirectoryExists(): Promise<void> {
        try {
            await fs.mkdir(this.dbDir, { recursive: true });
        } catch (error: any) {
            if (error.code !== 'EEXIST') {
                console.error(`Error creating directory ${this.dbDir}:`, error);
                throw error; // ディレクトリ作成に失敗した場合はエラーを投げる
            }
            // EEXISTの場合はディレクトリが既に存在するので問題なし
        }
    }

    private async readData(): Promise<DatabaseStructure> {
        await this.ensureDirectoryExists(); // 読み込み前にも確認
        try {
            const data = await fs.readFile(this.filePath, 'utf-8');
            // 空ファイルの場合、有効なJSONとして{}を返す
            return data.trim() === '' ? {} : JSON.parse(data) as DatabaseStructure;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                // ファイルが存在しない場合は空のデータベースとして扱う
                return {};
            }
            console.error(`Error reading or parsing database file ${this.filePath}:`, error);
            // パースエラーなどの場合はエラーを投げるか、回復を試みる（ここではエラーを投げる）
            throw error;
        }
    }

    private async writeData(data: DatabaseStructure): Promise<void> {
        await this.ensureDirectoryExists(); // 書き込み前にも確認
        try {
            await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (error) {
            console.error(`Error writing database file ${this.filePath}:`, error);
            throw error; // 書き込みエラーは重大なのでエラーを投げる
        }
    }

    async getAll(guildId: string): Promise<GuildData> {
        const allData = await this.readData();
        return allData[guildId] || {};
    }

    async get<T = any>(guildId: string, key: string): Promise<T | undefined> {
        const allData = await this.readData();
        if (allData[guildId] && allData[guildId].hasOwnProperty(key)) {
            return allData[guildId][key] as T;
        }
        return undefined;
    }

    async set<T = any>(guildId: string, key: string, value: T): Promise<void> {
        const allData = await this.readData();
        if (!allData[guildId]) {
            allData[guildId] = {};
        }
        allData[guildId][key] = value;
        await this.writeData(allData);
    }

    async delete(guildId: string, key: string): Promise<boolean> {
        const allData = await this.readData();
        if (allData[guildId] && allData[guildId].hasOwnProperty(key)) {
            delete allData[guildId][key];
            // もしguildIdのエントリが空になったら、guildId自体を削除する（任意）
            if (Object.keys(allData[guildId]).length === 0) {
                delete allData[guildId];
            }
            await this.writeData(allData);
            return true;
        }
        return false;
    }

    async has(guildId: string, key: string): Promise<boolean> {
        const allData = await this.readData();
        return !!allData[guildId] && allData[guildId].hasOwnProperty(key);
    }

    async clearGuild(guildId: string): Promise<void> {
        const allData = await this.readData();
        if (allData[guildId]) {
            delete allData[guildId]; // guildIdのエントリ自体を削除
            await this.writeData(allData);
        }
    }

    async clearAllGuilds(): Promise<void> {
        await this.writeData({});
    }

    async getRawData(): Promise<DatabaseStructure> {
        return await this.readData();
    }

    // --- Helper methods for specific data structures ---

    // Example: Get a nested map (like banned_users or muted_users)
    async getMap<V = any>(guildId: string, mapKey: string): Promise<{ [key: string]: V }> {
        return await this.get<{ [key: string]: V }>(guildId, mapKey) || {};
    }

    // Example: Set a value within a nested map
    async setMapValue<V = any>(guildId: string, mapKey: string, key: string, value: V): Promise<void> {
        const mapData = await this.getMap<V>(guildId, mapKey);
        mapData[key] = value;
        await this.set(guildId, mapKey, mapData);
    }

    // Example: Delete a value from a nested map
    async deleteMapValue(guildId: string, mapKey: string, key: string): Promise<boolean> {
        const mapData = await this.getMap(guildId, mapKey);
        if (mapData.hasOwnProperty(key)) {
            delete mapData[key];
            await this.set(guildId, mapKey, mapData);
            return true;
        }
        return false;
    }

    // Example: Get a list (like registered_users)
    async getList<T = any>(guildId: string, listKey: string): Promise<T[]> {
        return await this.get<T[]>(guildId, listKey) || [];
    }

    // Example: Add an item to a list (only if it doesn't exist)
    async addToList<T = any>(guildId: string, listKey: string, item: T): Promise<boolean> {
        const listData = await this.getList<T>(guildId, listKey);
        if (!listData.includes(item)) {
            listData.push(item);
            await this.set(guildId, listKey, listData);
            return true;
        }
        return false;
    }

    // Example: Remove an item from a list
    async removeFromList<T = any>(guildId: string, listKey: string, item: T): Promise<boolean> {
        const listData = await this.getList<T>(guildId, listKey);
        const index = listData.indexOf(item);
        if (index > -1) {
            listData.splice(index, 1);
            await this.set(guildId, listKey, listData);
            return true;
        }
        return false;
    }
}

export default JsonDB;