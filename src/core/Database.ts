import fs from 'fs/promises';
import path from 'path';

interface ResolvedKey {
    cacheKey: string;
    primaryRelativePath: string;
}

/**
 * JSON ベースのデータベースシステム
 * すべてのデータは Database/ 配下の新レイアウトへ保存します。
 */
export class Database {
    private dataDir: string;
    private legacyDataDir: string;
    private cache: Map<string, any>;

    constructor(dataDir?: string) {
        this.dataDir = dataDir || path.join(process.cwd(), 'Database');
        this.legacyDataDir = path.join(process.cwd(), 'Data');
        this.cache = new Map();
    }

    /**
     * データベースを初期化
     */
    async initialize(): Promise<void> {
        try {
            await Promise.all([
                fs.mkdir(this.dataDir, { recursive: true }),
                fs.mkdir(path.join(this.dataDir, 'guilds'), { recursive: true }),
                fs.mkdir(path.join(this.dataDir, 'users'), { recursive: true }),
                fs.mkdir(path.join(this.dataDir, 'shared'), { recursive: true }),
                fs.mkdir(path.join(this.dataDir, 'system'), { recursive: true }),
                fs.mkdir(path.join(this.dataDir, 'integrations'), { recursive: true })
            ]);
            await this.migrateLegacyDataIfNeeded();
            console.log(`📁 データベースディレクトリを初期化: ${this.dataDir}`);
        } catch (error) {
            console.error('データベースディレクトリの作成に失敗:', error);
            throw error;
        }
    }

    /**
     * データを保存
     */
    async set<T = any>(guildId: string, key: string, data: T): Promise<void> {
        const resolved = this.resolveKey(guildId, key);

        try {
            await this.writeJson(this.dataDir, resolved.primaryRelativePath, data);
            this.cache.set(resolved.cacheKey, data);
            console.log(`💾 データを保存: ${resolved.primaryRelativePath}`);
        } catch (error) {
            console.error(`データ保存エラー [${resolved.primaryRelativePath}]:`, error);
            throw error;
        }
    }

    /**
     * データを取得
     */
    async get<T = any>(guildId: string, key: string, defaultValue: T | null = null): Promise<T | null> {
        const resolved = this.resolveKey(guildId, key);

        try {
            if (this.cache.has(resolved.cacheKey)) {
                return this.cache.get(resolved.cacheKey);
            }

            const filePath = this.toFilePath(this.dataDir, resolved.primaryRelativePath);
            if (!(await this.fileExists(filePath))) {
                return defaultValue;
            }

            const parsed = await this.readJson<T>(filePath);
            this.cache.set(resolved.cacheKey, parsed);
            return parsed;
        } catch (error) {
            console.error(`データ読み込みエラー [${resolved.primaryRelativePath}]:`, error);
            throw error;
        }
    }

    /**
     * データが存在するかチェック
     */
    async has(guildId: string, key: string): Promise<boolean> {
        const resolved = this.resolveKey(guildId, key);
        return this.fileExists(this.toFilePath(this.dataDir, resolved.primaryRelativePath));
    }

    /**
     * データを削除
     */
    async delete(guildId: string, key: string): Promise<boolean> {
        const resolved = this.resolveKey(guildId, key);
        const filePath = this.toFilePath(this.dataDir, resolved.primaryRelativePath);

        try {
            await fs.unlink(filePath);
            this.cache.delete(resolved.cacheKey);
            return true;
        } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code === 'ENOENT') {
                this.cache.delete(resolved.cacheKey);
                return false;
            }

            console.error(`データ削除エラー [${filePath}]:`, error);
            throw error;
        }
    }

    /**
     * ギルドの全データを取得
     */
    async getAll(guildId: string): Promise<Record<string, any>> {
        const result: Record<string, any> = {};

        try {
            await this.collectCurrentGuildData(guildId, result);
            return result;
        } catch (error) {
            console.error(`ギルド全データ取得エラー [${guildId}]:`, error);
            return result;
        }
    }

    /**
     * すべてのキーを取得
     */
    async keys(): Promise<string[]> {
        try {
            const files = await this.listJsonFiles(this.dataDir);
            return files.map((file) => this.stripJsonExtension(file)).sort();
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
     * データベースディレクトリのパスを取得
     */
    getDataDir(): string {
        return this.dataDir;
    }

    /**
     * ユーザーごとのギルドデータを取得
     */
    async getUserGuildData<T = any>(
        userId: string,
        guildId: string,
        key: string,
        defaultValue: T | null = null
    ): Promise<T | null> {
        return this.get('', this.toUserGuildKey(userId, guildId, key), defaultValue);
    }

    /**
     * ユーザーごとのギルドデータを保存
     */
    async setUserGuildData<T = any>(userId: string, guildId: string, key: string, data: T): Promise<void> {
        await this.set('', this.toUserGuildKey(userId, guildId, key), data);
    }

    /**
     * ユーザーごとのギルドデータが存在するか確認
     */
    async hasUserGuildData(userId: string, guildId: string, key: string): Promise<boolean> {
        return this.has('', this.toUserGuildKey(userId, guildId, key));
    }

    /**
     * ユーザーごとのギルドデータを削除
     */
    async deleteUserGuildData(userId: string, guildId: string, key: string): Promise<boolean> {
        return this.delete('', this.toUserGuildKey(userId, guildId, key));
    }

    /**
     * ユーザーごとのギルドデータをすべて取得
     */
    async getAllUserGuildData(userId: string, guildId: string): Promise<Record<string, any>> {
        const safeUserId = this.normalizeSegment(userId);
        const safeGuildId = this.normalizeSegment(guildId);
        const userGuildRoot = path.join(this.dataDir, 'users', safeUserId, 'guilds', safeGuildId);
        const result: Record<string, any> = {};

        try {
            const files = await this.listJsonFiles(userGuildRoot);
            for (const relativeFile of files) {
                const logicalKey = this.stripJsonExtension(relativeFile).replace(/\\/g, '/');
                result[logicalKey] = await this.readJson(this.toFilePath(userGuildRoot, logicalKey));
            }
            return result;
        } catch (error) {
            console.error(`ユーザーギルドデータ取得エラー [${userId}/${guildId}]:`, error);
            return result;
        }
    }

    /**
     * 指定ギルド内のユーザーデータをキー単位で一覧取得
     */
    async getGuildUserDataMap<T = any>(guildId: string, key: string): Promise<Record<string, T>> {
        const safeGuildId = this.normalizeSegment(guildId);
        const safeKey = this.normalizeKey(key) || 'index';
        const usersRoot = path.join(this.dataDir, 'users');
        const result: Record<string, T> = {};

        try {
            if (!(await this.directoryExists(usersRoot))) {
                return result;
            }

            const userEntries = await fs.readdir(usersRoot, { withFileTypes: true });
            for (const userEntry of userEntries) {
                if (!userEntry.isDirectory()) {
                    continue;
                }

                const userGuildRoot = path.join(usersRoot, userEntry.name, 'guilds', safeGuildId);
                const filePath = this.toFilePath(userGuildRoot, safeKey);
                if (!(await this.fileExists(filePath))) {
                    continue;
                }

                result[userEntry.name] = await this.readJson<T>(filePath);
            }

            return result;
        } catch (error) {
            console.error(`ギルドユーザーデータ取得エラー [${guildId}/${safeKey}]:`, error);
            return result;
        }
    }

    private toUserGuildKey(userId: string, guildId: string, key: string): string {
        const safeUserId = this.normalizeSegment(userId);
        const safeGuildId = this.normalizeSegment(guildId);
        const normalizedKey = this.normalizeKey(key) || 'index';
        return `User/${safeUserId}/guilds/${safeGuildId}/${normalizedKey}`;
    }

    private resolveKey(guildId: string, key: string): ResolvedKey {
        const normalizedGuildId = this.normalizeValue(guildId);
        const normalizedKey = this.normalizeKey(key);

        return {
            cacheKey: `${normalizedGuildId || 'global'}::${normalizedKey || 'index'}`,
            primaryRelativePath: this.toPrimaryRelativePath(normalizedGuildId, normalizedKey)
        };
    }

    private normalizeKey(key: string): string {
        return key.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    }

    private normalizeValue(value: string): string {
        return value.replace(/[\\/]/g, '').trim();
    }

    private toPrimaryRelativePath(guildId: string, normalizedKey: string): string {
        if (!normalizedKey) {
            return guildId ? `guilds/${this.normalizeSegment(guildId)}/index` : 'shared/index';
        }

        if (normalizedKey === 'staff_private_chats') {
            return 'shared/staff/private-chats';
        }

        const segments = normalizedKey.split('/').filter(Boolean);

        if (segments[0] === 'Guild' && segments[1]) {
            return this.mapGuildPath(segments[1], segments.slice(2));
        }

        if (segments[0] === 'UserProfiles' && segments[1]) {
            return `users/${this.normalizeSegment(segments[1])}/profile`;
        }

        if (segments[0] === 'User' && segments[1]) {
            const userId = this.normalizeSegment(segments[1]);
            const rest = this.normalizeSegments(segments.slice(2)).join('/');
            return `users/${userId}/${rest || 'index'}`;
        }

        if (guildId) {
            return `guilds/${this.normalizeSegment(guildId)}/${this.normalizeSegments(segments).join('/')}`;
        }

        return `shared/${this.normalizeSegments(segments).join('/')}`;
    }

    private mapGuildPath(guildId: string, rest: string[]): string {
        const safeGuildId = this.normalizeSegment(guildId);

        if (rest[0] === 'User' && rest[1]) {
            const rawSubject = this.normalizeSegment(rest[1]);
            const userId = rawSubject.replace(/_timestamps$/, '');
            const scope = rawSubject.endsWith('_timestamps') ? 'message-timestamps' : 'stats';
            const trailing = this.normalizeSegments(rest.slice(2)).join('/');
            return `users/${userId}/guilds/${safeGuildId}/${scope}${trailing ? `/${trailing}` : ''}`;
        }

        const normalizedRest = this.normalizeSegments(rest).join('/');
        return `guilds/${safeGuildId}/${normalizedRest || 'index'}`;
    }

    private normalizeSegments(segments: string[]): string[] {
        return segments.map((segment) => this.normalizeSegment(segment));
    }

    private normalizeSegment(segment: string): string {
        const trimmed = segment.trim();
        if (!trimmed || trimmed === '.' || trimmed === '..') {
            throw new Error('Invalid database key segment');
        }

        const aliasMap: Record<string, string> = {
            role_presets: 'role-presets',
            role_changes: 'role-changes'
        };

        const aliased = aliasMap[trimmed] || trimmed;
        return aliased.replace(/[<>:"|?*]/g, '-');
    }

    private async collectCurrentGuildData(guildId: string, result: Record<string, any>): Promise<void> {
        const safeGuildId = this.normalizeSegment(guildId);
        const guildRoot = path.join(this.dataDir, 'guilds', safeGuildId);
        const guildFiles = await this.listJsonFiles(guildRoot);

        for (const relativeFile of guildFiles) {
            const logicalKey = this.stripJsonExtension(relativeFile).replace(/\\/g, '/');
            if (logicalKey in result) {
                continue;
            }

            result[logicalKey] = await this.readJson(this.toFilePath(guildRoot, logicalKey));
        }

        const usersRoot = path.join(this.dataDir, 'users');
        if (!(await this.directoryExists(usersRoot))) {
            return;
        }

        const userEntries = await fs.readdir(usersRoot, { withFileTypes: true });
        for (const userEntry of userEntries) {
            if (!userEntry.isDirectory()) {
                continue;
            }

            const userGuildRoot = path.join(usersRoot, userEntry.name, 'guilds', safeGuildId);
            const userGuildFiles = await this.listJsonFiles(userGuildRoot);

            for (const relativeFile of userGuildFiles) {
                const stripped = this.stripJsonExtension(relativeFile);
                const logicalKey = this.toLegacyGuildUserKey(userEntry.name, stripped);
                if (logicalKey in result) {
                    continue;
                }

                result[logicalKey] = await this.readJson(this.toFilePath(userGuildRoot, stripped));
            }
        }
    }

    private toLegacyGuildUserKey(userId: string, strippedPath: string): string {
        const normalized = strippedPath.replace(/\\/g, '/');
        if (normalized === 'stats') {
            return `User/${userId}`;
        }
        if (normalized === 'message-timestamps') {
            return `User/${userId}_timestamps`;
        }
        return `User/${userId}/${normalized}`;
    }

    private async readJson<T = any>(filePath: string): Promise<T> {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data) as T;
    }

    private async writeJson(root: string, relativePath: string, data: unknown): Promise<void> {
        const filePath = this.toFilePath(root, relativePath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    private async migrateLegacyDataIfNeeded(): Promise<void> {
        if (!(await this.directoryExists(this.legacyDataDir))) {
            return;
        }

        const legacyFiles = await this.listJsonFiles(this.legacyDataDir);
        if (legacyFiles.length === 0) {
            return;
        }

        let migrated = 0;
        let skipped = 0;

        for (const legacyRelativeFile of legacyFiles) {
            try {
                const legacyKey = this.legacyRelativePathToKey(legacyRelativeFile);
                if (!legacyKey) {
                    skipped += 1;
                    continue;
                }

                const resolved = this.resolveKey('', legacyKey);
                const targetPath = this.toFilePath(this.dataDir, resolved.primaryRelativePath);
                if (await this.fileExists(targetPath)) {
                    skipped += 1;
                    continue;
                }

                const sourcePath = this.toFilePath(this.legacyDataDir, this.stripJsonExtension(legacyRelativeFile));
                const data = await this.readJson(sourcePath);
                await this.writeJson(this.dataDir, resolved.primaryRelativePath, data);
                migrated += 1;
            } catch (error) {
                skipped += 1;
                console.warn(`⚠️ 旧Dataの移行をスキップ: ${legacyRelativeFile}`, error);
            }
        }

        if (migrated > 0) {
            console.log(`🔄 旧Dataフォルダから ${migrated} 件を Database へ移行しました（スキップ ${skipped} 件）`);
        }
    }

    private legacyRelativePathToKey(relativeFile: string): string | null {
        const stripped = this.stripJsonExtension(relativeFile).replace(/\\/g, '/');
        const segments = stripped.split('/').filter(Boolean);

        if (segments.length === 0) {
            return null;
        }

        if (stripped === 'staff_private_chats') {
            return 'staff_private_chats';
        }

        if (segments[0] === 'Guild' || segments[0] === 'User' || segments[0] === 'UserProfiles') {
            return stripped;
        }

        if (segments.length === 1) {
            const flatName = segments[0];

            const guildScoped = flatName.match(/^(\d{5,})_(.+)$/);
            if (guildScoped) {
                return `Guild/${guildScoped[1]}/${guildScoped[2]}`;
            }

            const bareGuild = flatName.match(/^(\d{5,})$/);
            if (bareGuild) {
                return `Guild/${bareGuild[1]}/index`;
            }
        }

        if (segments.length >= 2 && /^\d{5,}$/.test(segments[0])) {
            return `Guild/${segments[0]}/${segments.slice(1).join('/')}`;
        }

        return stripped;
    }

    private toFilePath(root: string, relativePath: string): string {
        const safeRelative = relativePath.replace(/^([A-Za-z]:)?[\\/]+/, '');
        const filePath = path.resolve(root, `${safeRelative}.json`);
        const resolvedRoot = path.resolve(root);

        if (!filePath.startsWith(`${resolvedRoot}${path.sep}`) && filePath !== resolvedRoot) {
            throw new Error('Invalid database key (path traversal attempt detected)');
        }

        return filePath;
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    private async directoryExists(dirPath: string): Promise<boolean> {
        try {
            const stat = await fs.stat(dirPath);
            return stat.isDirectory();
        } catch {
            return false;
        }
    }

    private async listJsonFiles(root: string): Promise<string[]> {
        if (!(await this.directoryExists(root))) {
            return [];
        }

        const results: string[] = [];

        const walk = async (currentDir: string, prefix = ''): Promise<void> => {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const entryPath = path.join(currentDir, entry.name);
                const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

                if (entry.isDirectory()) {
                    await walk(entryPath, relativePath);
                    continue;
                }

                if (entry.isFile() && entry.name.endsWith('.json')) {
                    results.push(relativePath.replace(/\\/g, '/'));
                }
            }
        };

        await walk(root);
        return results;
    }

    private stripJsonExtension(filePath: string): string {
        return filePath.replace(/\.json$/i, '');
    }
}

// シングルトンインスタンス
export const database = new Database();
