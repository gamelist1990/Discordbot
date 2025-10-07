import JsonDB from '../database.js';
import crypto from 'crypto';

/**
 * Todo Session データ構造
 */
export interface TodoSession {
    id: string;
    guildId: string;
    name: string;
    ownerId: string; // 作成者のユーザーID
    createdAt: number;
    updatedAt: number;
    // 共有設定
    viewers: string[]; // 閲覧のみ可能なユーザーID
    editors: string[]; // 編集可能なユーザーID
    // お気に入り（ユーザーIDの配列）
    favoritedBy: string[];
}

/**
 * Todo Item データ構造
 */
export interface TodoItem {
    id: string;
    sessionId: string;
    text: string;
    completed: boolean;
    priority: 'low' | 'medium' | 'high';
    dueDate?: number;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    tags: string[];
    description?: string;
}

/**
 * Todo Session Content (全てのTodoアイテム)
 */
export interface TodoSessionContent {
    sessionId: string;
    todos: TodoItem[];
    updatedAt: number;
}

/**
 * ユーザー毎のセッション数制限
 */
const MAX_SESSIONS_PER_USER = 3;

/**
 * Todo マネージャー
 */
export class TodoManager {
    private static sessionsDb = new JsonDB('todo_sessions', './Data');
    private static contentsDb = new JsonDB('todo_contents', './Data');
    // 共有リンクを保存するDB（guildIdごとに token -> metadata を保存）
    private static sharesDb = new JsonDB('todo_shares', './Data');

    /**
     * ユーザーのTodoセッションを取得（所有 + 共有されたもの）
     */
    static async getUserSessions(guildId: string, userId: string): Promise<TodoSession[]> {
        try {
            const allSessions = await this.sessionsDb.get(guildId, 'todo_sessions') || {};
            const sessions: TodoSession[] = [];

            for (const sessionId in allSessions) {
                const session = allSessions[sessionId];
                // 所有者、エディター、ビューワーのいずれかに該当する場合
                if (
                    session.ownerId === userId ||
                    session.editors.includes(userId) ||
                    session.viewers.includes(userId)
                ) {
                    sessions.push(session);
                }
            }

            return sessions;
        } catch (error) {
            console.error('Error fetching user sessions:', error);
            return [];
        }
    }

    /**
     * Todoセッションを作成
     */
    static async createSession(
        guildId: string,
        userId: string,
        name: string
    ): Promise<TodoSession> {
        // ユーザーが所有するセッション数を確認
        const allSessions = await this.sessionsDb.get(guildId, 'todo_sessions') || {};
        const ownedSessions = Object.values(allSessions).filter(
            (s: any) => s.ownerId === userId
        );

        if (ownedSessions.length >= MAX_SESSIONS_PER_USER) {
            throw new Error(`最大${MAX_SESSIONS_PER_USER}個までセッションを作成できます`);
        }

        const sessionId = crypto.randomBytes(16).toString('hex');
        const session: TodoSession = {
            id: sessionId,
            guildId,
            name,
            ownerId: userId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            viewers: [],
            editors: [],
            favoritedBy: []
        };

        // セッションを保存
        allSessions[sessionId] = session;
        await this.sessionsDb.set(guildId, 'todo_sessions', allSessions);

        // 初期コンテンツを作成
        const content: TodoSessionContent = {
            sessionId,
            todos: [],
            updatedAt: Date.now()
        };
        await this.contentsDb.set(guildId, sessionId, content);

        return session;
    }

    /**
     * Todoセッションを取得
     */
    static async getSession(guildId: string, sessionId: string): Promise<TodoSession | null> {
        try {
            const allSessions = await this.sessionsDb.get(guildId, 'todo_sessions') || {};
            return allSessions[sessionId] || null;
        } catch (error) {
            console.error('Error fetching session:', error);
            return null;
        }
    }

    /**
     * Todoセッションを削除
     */
    static async deleteSession(guildId: string, sessionId: string): Promise<void> {
        const allSessions = await this.sessionsDb.get(guildId, 'todo_sessions') || {};
        delete allSessions[sessionId];
        await this.sessionsDb.set(guildId, 'todo_sessions', allSessions);

        // コンテンツも削除
        await this.contentsDb.delete(guildId, sessionId);
    }

    /**
     * Todoセッションのコンテンツを取得
     */
    static async getContent(guildId: string, sessionId: string): Promise<TodoSessionContent | null> {
        try {
            const content = await this.contentsDb.get(guildId, sessionId);
            return content || null;
        } catch (error) {
            console.error('Error fetching content:', error);
            return null;
        }
    }

    /**
     * Todoアイテムを追加
     */
    static async addTodo(
        guildId: string,
        sessionId: string,
        text: string,
        createdBy: string,
        priority: 'low' | 'medium' | 'high' = 'medium',
        tags: string[] = [],
        description?: string,
        dueDate?: number
    ): Promise<TodoItem> {
        const content = await this.getContent(guildId, sessionId);
        if (!content) {
            throw new Error('Session not found');
        }

        const todo: TodoItem = {
            id: crypto.randomBytes(16).toString('hex'),
            sessionId,
            text,
            completed: false,
            priority,
            tags,
            description,
            dueDate,
            createdBy,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        content.todos.push(todo);
        content.updatedAt = Date.now();
        await this.contentsDb.set(guildId, sessionId, content);

        return todo;
    }

    /**
     * Todoアイテムを更新
     */
    static async updateTodo(
        guildId: string,
        sessionId: string,
        todoId: string,
        updates: Partial<TodoItem>
    ): Promise<void> {
        const content = await this.getContent(guildId, sessionId);
        if (!content) {
            throw new Error('Session not found');
        }

        const todoIndex = content.todos.findIndex(t => t.id === todoId);
        if (todoIndex === -1) {
            throw new Error('Todo not found');
        }

        // 完了状態が変更された場合、completedAtを設定
        if (updates.completed !== undefined && updates.completed !== content.todos[todoIndex].completed) {
            if (updates.completed) {
                updates.completedAt = Date.now();
            } else {
                updates.completedAt = undefined;
            }
        }

        content.todos[todoIndex] = {
            ...content.todos[todoIndex],
            ...updates,
            updatedAt: Date.now()
        };
        content.updatedAt = Date.now();

        await this.contentsDb.set(guildId, sessionId, content);
    }

    /**
     * Todoアイテムを削除
     */
    static async deleteTodo(guildId: string, sessionId: string, todoId: string): Promise<void> {
        const content = await this.getContent(guildId, sessionId);
        if (!content) {
            throw new Error('Session not found');
        }

        content.todos = content.todos.filter(t => t.id !== todoId);
        content.updatedAt = Date.now();

        await this.contentsDb.set(guildId, sessionId, content);
    }

    /**
     * 共有メンバーを追加（ビューワーまたはエディター）
     */
    static async addMember(
        guildId: string,
        sessionId: string,
        userId: string,
        role: 'viewer' | 'editor'
    ): Promise<void> {
        const allSessions = await this.sessionsDb.get(guildId, 'todo_sessions') || {};
        const session = allSessions[sessionId];

        if (!session) {
            throw new Error('Session not found');
        }

        // 既に追加されている場合は何もしない
        if (role === 'viewer') {
            if (!session.viewers.includes(userId)) {
                session.viewers.push(userId);
            }
            // エディターから削除（ビューワーに降格）
            session.editors = session.editors.filter((id: string) => id !== userId);
        } else {
            if (!session.editors.includes(userId)) {
                session.editors.push(userId);
            }
            // ビューワーから削除（エディターに昇格）
            session.viewers = session.viewers.filter((id: string) => id !== userId);
        }

        session.updatedAt = Date.now();
        await this.sessionsDb.set(guildId, 'todo_sessions', allSessions);
    }

    /**
     * 共有メンバーを削除
     */
    static async removeMember(guildId: string, sessionId: string, userId: string): Promise<void> {
        const allSessions = await this.sessionsDb.get(guildId, 'todo_sessions') || {};
        const session = allSessions[sessionId];

        if (!session) {
            throw new Error('Session not found');
        }

        session.viewers = session.viewers.filter((id: string) => id !== userId);
        session.editors = session.editors.filter((id: string) => id !== userId);
        session.updatedAt = Date.now();

        await this.sessionsDb.set(guildId, 'todo_sessions', allSessions);
    }

    /**
     * お気に入りに追加/削除
     */
    static async toggleFavorite(guildId: string, sessionId: string, userId: string): Promise<boolean> {
        const allSessions = await this.sessionsDb.get(guildId, 'todo_sessions') || {};
        const session = allSessions[sessionId];

        if (!session) {
            throw new Error('Session not found');
        }

        const index = session.favoritedBy.indexOf(userId);
        if (index === -1) {
            session.favoritedBy.push(userId);
            session.updatedAt = Date.now();
            await this.sessionsDb.set(guildId, 'todo_sessions', allSessions);
            return true; // お気に入りに追加
        } else {
            session.favoritedBy.splice(index, 1);
            session.updatedAt = Date.now();
            await this.sessionsDb.set(guildId, 'todo_sessions', allSessions);
            return false; // お気に入りから削除
        }
    }

    /**
     * アクセス権限を確認
     */
    static async canAccess(guildId: string, sessionId: string, userId: string): Promise<'owner' | 'editor' | 'viewer' | null> {
        const session = await this.getSession(guildId, sessionId);
        if (!session) {
            return null;
        }

        if (session.ownerId === userId) {
            return 'owner';
        }
        if (session.editors.includes(userId)) {
            return 'editor';
        }
        if (session.viewers.includes(userId)) {
            return 'viewer';
        }

        return null;
    }

    /**
     * 共有リンクを作成する
     * mode: 'view' | 'edit'
     * expiresInSeconds: null = 永続, number = 有効期限(秒)
     */
    static async createShareLink(
        guildId: string,
        sessionId: string,
        mode: 'view' | 'edit',
        expiresInSeconds: number | null = null
    ): Promise<string> {
        const session = await this.getSession(guildId, sessionId);
        if (!session) throw new Error('Session not found');

        const token = crypto.randomBytes(16).toString('hex');
        const meta: any = {
            sessionId,
            mode,
            createdAt: Date.now()
        };

        if (expiresInSeconds && expiresInSeconds > 0) {
            meta.expiresAt = Date.now() + expiresInSeconds * 1000;
        }

        // 保存
        await this.sharesDb.set(guildId, token, meta);
        return token;
    }

    /**
     * 共有トークンを検証してセッション情報を返す
     */
    static async getSessionByShareToken(guildId: string, token: string): Promise<{ session: TodoSession | null; mode: 'view' | 'edit' } | null> {
        try {
            const meta = await this.sharesDb.get<any>(guildId, token);
            if (!meta) return null;

            if (meta.expiresAt && Date.now() > meta.expiresAt) {
                // 期限切れなら削除してnullを返す
                await this.sharesDb.delete(guildId, token);
                return null;
            }

            const session = await this.getSession(guildId, meta.sessionId);
            if (!session) return null;

            return { session, mode: meta.mode };
        } catch (error) {
            console.error('Error validating share token:', error);
            return null;
        }
    }

    /**
     * 共有リンクを取り消す
     */
    static async revokeShareLink(guildId: string, token: string): Promise<boolean> {
        return await this.sharesDb.delete(guildId, token);
    }
}
