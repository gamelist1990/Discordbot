import fs from 'fs/promises';
import path from 'path';

interface ResolvedKey {
    cacheKey: string;
    primaryRelativePath: string;
    legacyRelativePaths: string[];
}

interface LocatedFile {
    filePath: string;
    relativePath: string;
    root: string;
    isPrimary: boolean;
}

/**
 * JSON ベースのデータベースシステム
 * 書き込み先は Database/ 配下に統一し、旧 Data/ レイアウトも読み込み時に吸収します。
 */
export class Database {
    private dataDir: string;
    private legacyDirs: string[];
    private cache: Map<string, any>;

    constructor(dataDir?: string) {
        this.dataDir = dataDir || path.join(process.cwd(), 'Database');
        this.legacyDirs = dataDir ? [] : [path.join(process.cwd(), 'Data')];
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
                fs.mkdir(path.join(this.dataDir, 'shared'), { recursive: true })
            ]);
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

            const located = await this.findExistingFile(resolved);
            if (!located) {
                return defaultValue;
            }

            const parsed = await this.readJson<T>(located.filePath);
            this.cache.set(resolved.cacheKey, parsed);

            if (located.root !== this.dataDir || located.relativePath !== resolved.primaryRelativePath) {
                await this.writeJson(this.dataDir, resolved.primaryRelativePath, parsed).catch((migrationError) => {
                    console.warn(`Legacy data migration skipped for ${resolved.primaryRelativePath}:`, migrationError);
                });
            }

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
        return (await this.findExistingFile(resolved)) !== null;
    }

    /**
     * データを削除
     */
    async delete(guildId: string, key: string): Promise<boolean> {
        const resolved = this.resolveKey(guildId, key);
        const candidatePaths = new Map<string, string>();

        for (const root of [this.dataDir, ...this.legacyDirs]) {
            for (const relativePath of [resolved.primaryRelativePath, ...resolved.legacyRelativePaths]) {
                try {
                    candidatePaths.set(this.toFilePath(root, relativePath), relativePath);
                } catch {
                    // ignore invalid legacy paths
                }
            }
        }

        let deleted = false;

        for (const [filePath] of candidatePaths) {
            try {
                await fs.unlink(filePath);
                deleted = true;
            } catch (error) {
                const nodeError = error as NodeJS.ErrnoException;
                if (nodeError.code !== 'ENOENT') {
                    console.error(`データ削除エラー [${filePath}]:`, error);
                    throw error;
                }
            }
        }

        this.cache.delete(resolved.cacheKey);
        return deleted;
    }

    /**
     * ギルドの全データを取得
     */
    async getAll(guildId: string): Promise<Record<string, any>> {
        const result: Record<string, any> = {};

        try {
            await this.collectCurrentGuildData(guildId, result);

            for (const root of [this.dataDir, ...this.legacyDirs]) {
                await this.collectLegacyGuildData(root, guildId, result);
            }

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
        const keys = new Set<string>();

        try {
            for (const root of [this.dataDir, ...this.legacyDirs]) {
                const files = await this.listJsonFiles(root);
                for (const file of files) {
                    keys.add(this.stripJsonExtension(file));
                }
            }

            return Array.from(keys).sort();
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

    private resolveKey(guildId: string, key: string): ResolvedKey {
        const normalizedGuildId = this.normalizeValue(guildId);
        const normalizedKey = this.normalizeKey(key);

        return {
            cacheKey: `${normalizedGuildId || 'global'}::${normalizedKey || 'index'}`,
            primaryRelativePath: this.toPrimaryRelativePath(normalizedGuildId, normalizedKey),
            legacyRelativePaths: this.toLegacyRelativePaths(normalizedGuildId, normalizedKey)
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

    private toLegacyRelativePaths(guildId: string, normalizedKey: string): string[] {
        if (!normalizedKey) {
            return [];
        }

        const legacy = new Set<string>([normalizedKey]);
        if (!normalizedKey.includes('/') && guildId) {
            legacy.add(`${guildId}_${normalizedKey}`);
        }

        return Array.from(legacy);
    }

    private async findExistingFile(resolved: ResolvedKey): Promise<LocatedFile | null> {
        const currentCandidates = [resolved.primaryRelativePath, ...resolved.legacyRelativePaths];

        for (const relativePath of currentCandidates) {
            const filePath = this.toFilePath(this.dataDir, relativePath);
            if (await this.fileExists(filePath)) {
                return {
                    filePath,
                    relativePath,
                    root: this.dataDir,
                    isPrimary: relativePath === resolved.primaryRelativePath
                };
            }
        }

        for (const root of this.legacyDirs) {
            for (const relativePath of new Set([resolved.primaryRelativePath, ...resolved.legacyRelativePaths])) {
                const filePath = this.toFilePath(root, relativePath);
                if (await this.fileExists(filePath)) {
                    return {
                        filePath,
                        relativePath,
                        root,
                        isPrimary: false
                    };
                }
            }
        }

        return null;
    }

    private async collectCurrentGuildData(guildId: string, result: Record<string, any>): Promise<void> {
        const safeGuildId = this.normalizeSegment(guildId);
        const guildRoot = path.join(this.dataDir, 'guilds', safeGuildId);
        const guildFiles = await this.listJsonFiles(guildRoot);

        for (const relativeFile of guildFiles) {
            const logicalKey = this.stripJsonExtension(relativeFile);
            if (!(logicalKey in result)) {
                const filePath = this.toFilePath(guildRoot, logicalKey);
                result[logicalKey.replace(/\\/g, '/')] = await this.readJson(filePath);
            }
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
                if (!(logicalKey in result)) {
                    const filePath = this.toFilePath(userGuildRoot, stripped);
                    result[logicalKey] = await this.readJson(filePath);
                }
            }
        }
    }

    private async collectLegacyGuildData(
        root: string,
        guildId: string,
        result: Record<string, any>
    ): Promise<void> {
        const files = await this.listJsonFiles(root);
        for (const relativeFile of files) {
            const normalizedRelative = relativeFile.replace(/\\/g, '/');
            const withoutExtension = this.stripJsonExtension(normalizedRelative);

            if (withoutExtension.startsWith(`Guild/${guildId}/`)) {
                const logicalKey = withoutExtension.replace(`Guild/${guildId}/`, '');
                if (!(logicalKey in result)) {
                    result[logicalKey] = await this.readJson(this.toFilePath(root, withoutExtension));
                }
                continue;
            }

            const fileName = path.basename(withoutExtension);
            if (fileName.startsWith(`${guildId}_`)) {
                const logicalKey = fileName.replace(`${guildId}_`, '');
                if (!(logicalKey in result)) {
                    result[logicalKey] = await this.readJson(this.toFilePath(root, withoutExtension));
                }
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
