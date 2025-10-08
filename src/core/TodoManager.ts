import crypto from 'crypto';
import { database } from './Database.js';

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
    status: 'planned' | 'in_progress' | 'completed'; // 予定/進行中/完了
    progress: number; // 0-100 の進捗率
    priority: 'low' | 'medium' | 'high';
    dueDate?: number;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    tags: string[];
    description?: string; // Markdown対応
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
    private static db = database;

    /**
     * ユーザーのTodoセッションを取得（所有 + 共有されたもの）
     */
    static async getUserSessions(userId: string): Promise<TodoSession[]> {
        try {
            const allSessions = await this.db.get('', 'todo/sessions') || {};
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
    static async createSession(userId: string, name: string): Promise<TodoSession> {
        // ユーザーが所有するセッション数を確認
        const allSessions = await this.db.get('', 'todo/sessions') || {};
        const ownedSessions = Object.values(allSessions).filter(
            (s: any) => s.ownerId === userId
        );

        if (ownedSessions.length >= MAX_SESSIONS_PER_USER) {
            throw new Error(`最大${MAX_SESSIONS_PER_USER}個までセッションを作成できます`);
        }

        const sessionId = crypto.randomBytes(16).toString('hex');
        const session: TodoSession = {
            id: sessionId,
            guildId: '',
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
    await this.db.set('', 'todo/sessions', allSessions);

        // 初期コンテンツを作成
        const content: TodoSessionContent = {
            sessionId,
            todos: [],
            updatedAt: Date.now()
        };
    await this.db.set('', `todo/content/${sessionId}`, content);

        return session;
    }

    /**
     * Todoセッションを取得
     */
    static async getSession(sessionId: string): Promise<TodoSession | null> {
        try {
            const allSessions = await this.db.get('', 'todo/sessions') || {};
            return allSessions[sessionId] || null;
        } catch (error) {
            console.error('Error fetching session:', error);
            return null;
        }
    }

    /**
     * Todoセッションを削除
     */
    static async deleteSession(sessionId: string): Promise<void> {
        const allSessions = await this.db.get('', 'todo/sessions') || {};
        delete allSessions[sessionId];
        await this.db.set('', 'todo/sessions', allSessions);

        // コンテンツも削除
        await this.db.delete('', `todo/content/${sessionId}`);
    }

    /**
     * Todoセッションのコンテンツを取得
     */
    static async getContent(sessionId: string): Promise<TodoSessionContent | null> {
        try {
            const content = await this.db.get('', `todo/content/${sessionId}`);
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
        sessionId: string,
        text: string,
        createdBy: string,
        priority: 'low' | 'medium' | 'high' = 'medium',
        tags: string[] = [],
        description?: string,
        dueDate?: number
    ): Promise<TodoItem> {
        const content = await this.getContent(sessionId);
        if (!content) {
            throw new Error('Session not found');
        }

        const todo: TodoItem = {
            id: crypto.randomBytes(16).toString('hex'),
            sessionId,
            text,
            completed: false,
            status: 'planned', // デフォルトは予定
            progress: 0, // デフォルトは0%
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
    await this.db.set('', `todo/content/${sessionId}`, content);

        return todo;
    }

    /**
     * Todoアイテムを更新
     */
    static async updateTodo(
        sessionId: string,
        todoId: string,
        updates: Partial<TodoItem>
    ): Promise<void> {
        const content = await this.getContent(sessionId);
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
                updates.status = 'completed'; // 完了時はステータスも更新
                updates.progress = 100; // 進捗も100%に
            } else {
                updates.completedAt = undefined;
            }
        }

        // ステータスが完了に変更された場合、completed と progress も更新
        if (updates.status === 'completed') {
            updates.completed = true;
            updates.progress = 100;
            if (!content.todos[todoIndex].completed) {
                updates.completedAt = Date.now();
            }
        }

        // 進捗が100%になった場合、ステータスを完了に
        if (updates.progress === 100 && content.todos[todoIndex].status !== 'completed') {
            updates.status = 'completed';
            updates.completed = true;
            updates.completedAt = Date.now();
        }

        // 進捗が0-99%でステータスが予定の場合、進行中に変更
        if (updates.progress !== undefined && updates.progress > 0 && updates.progress < 100) {
            if (content.todos[todoIndex].status === 'planned') {
                updates.status = 'in_progress';
            }
        }

        content.todos[todoIndex] = {
            ...content.todos[todoIndex],
            ...updates,
            updatedAt: Date.now()
        };
        content.updatedAt = Date.now();

        await this.db.set('', `todo/content/${sessionId}`, content);
    }

    /**
     * Todoアイテムを削除
     */
    static async deleteTodo(sessionId: string, todoId: string): Promise<void> {
        const content = await this.getContent(sessionId);
        if (!content) {
            throw new Error('Session not found');
        }

        content.todos = content.todos.filter(t => t.id !== todoId);
        content.updatedAt = Date.now();

        await this.db.set('', `todo/content/${sessionId}`, content);
    }

    /**
     * 共有メンバーを追加（ビューワーまたはエディター）
     */
    static async addMember(
        sessionId: string,
        userId: string,
        role: 'viewer' | 'editor'
    ): Promise<void> {
        const allSessions = await this.db.get('', 'todo/sessions') || {};
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
        await this.db.set('', 'todo/sessions', allSessions);
    }

    /**
     * 共有メンバーを削除
     */
    static async removeMember(sessionId: string, userId: string): Promise<void> {
        const allSessions = await this.db.get('', 'todo/sessions') || {};
        const session = allSessions[sessionId];

        if (!session) {
            throw new Error('Session not found');
        }

        session.viewers = session.viewers.filter((id: string) => id !== userId);
        session.editors = session.editors.filter((id: string) => id !== userId);
        session.updatedAt = Date.now();

        await this.db.set('', 'todo/sessions', allSessions);
    }

    /**
     * お気に入りに追加/削除
     */
    static async toggleFavorite(sessionId: string, userId: string): Promise<boolean> {
        const allSessions = await this.db.get('', 'todo/sessions') || {};
        const session = allSessions[sessionId];

        if (!session) {
            throw new Error('Session not found');
        }

        const index = session.favoritedBy.indexOf(userId);
        if (index === -1) {
            session.favoritedBy.push(userId);
            session.updatedAt = Date.now();
            await this.db.set('', 'todo_sessions', allSessions);
            return true; // お気に入りに追加
        } else {
            session.favoritedBy.splice(index, 1);
            session.updatedAt = Date.now();
            await this.db.set('', 'todo_sessions', allSessions);
            return false; // お気に入りから削除
        }
    }

    /**
     * アクセス権限を確認
     */
    static async canAccess(sessionId: string, userId: string): Promise<'owner' | 'editor' | 'viewer' | null> {
        const session = await this.getSession(sessionId);
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
        sessionId: string,
        mode: 'view' | 'edit',
        expiresInSeconds: number | null = null
    ): Promise<string> {
        const session = await this.getSession(sessionId);
        if (!session) throw new Error('Session not found');

        const token = crypto.randomUUID(); // UUIDv4を使用
        const meta: any = {
            sessionId,
            mode,
            createdAt: Date.now()
        };

        if (expiresInSeconds && expiresInSeconds > 0) {
            meta.expiresAt = Date.now() + expiresInSeconds * 1000;
        }

        // 保存
        await this.db.set('', `todo/shares/${token}`, meta);
        return token;
    }

    /**
     * 共有トークンを検証してセッション情報を返す
     */
    static async getSessionByShareToken(token: string): Promise<{ session: TodoSession | null; mode: 'view' | 'edit' } | null> {
        try {
            const meta = await this.db.get<any>('', `todo/shares/${token}`);
            if (!meta) return null;

            if (meta.expiresAt && Date.now() > meta.expiresAt) {
                // 期限切れなら削除してnullを返す
                await this.db.delete('', `todo/shares/${token}`);
                return null;
            }

            const session = await this.getSession(meta.sessionId);
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
    static async revokeShareLink(token: string): Promise<boolean> {
        return await this.db.delete('', `todo/shares/${token}`);
    }

    /**
     * ギルドの全共有リンクを取得
     */
    static async getAllShareLinks(): Promise<{ token: string; sessionId: string; mode: 'view' | 'edit'; createdAt: number; expiresAt?: number }[]> {
        try {
            const allKeys = await this.db.keys();
            // Support both legacy prefixed keys like '<guild>_todo/shares/<token>'
            // and new layout 'todo/shares/<token>' (no guild prefix). Match any key that contains 'todo/shares/'.
            const shareKeys = allKeys.filter(key => key.includes('todo/shares/'));
            const result: { token: string; sessionId: string; mode: 'view' | 'edit'; createdAt: number; expiresAt?: number }[] = [];

            for (const key of shareKeys) {
                // Extract token after 'todo/shares/' (works for both prefixed and non-prefixed keys)
                const token = key.split('todo/shares/')[1];
                const meta = await this.db.get<any>('', `todo/shares/${token}`);
                if (meta) {
                    result.push({
                        token,
                        sessionId: meta.sessionId,
                        mode: meta.mode,
                        createdAt: meta.createdAt,
                        expiresAt: meta.expiresAt
                    });
                }
            }

            return result;
        } catch (error) {
            console.error('Error getting all share links:', error);
            return [];
        }
    }

    /**
     * 指定のセッションIDに紐づく共有リンクを取得
     * guildId は保持しているDBキーのプレフィックス確認用に渡すが、実際のフィルタは sessionId で行う
     */
    static async getSharesForSession(sessionId: string): Promise<{ token: string; sessionId: string; mode: 'view' | 'edit'; createdAt: number; expiresAt?: number }[]> {
        try {
            const all = await this.getAllShareLinks();
            // sessionIdでフィルタ
            return all.filter(s => s.sessionId === sessionId);
        } catch (error) {
            console.error('Error getting shares for session:', error);
            return [];
        }
    }

    /**
     * セッションのコンテンツを取得
     */
    static async getSessionContent(guildId: string, sessionId: string): Promise<TodoSessionContent | null> {
        try {
            return await this.db.get(guildId, `todo/content/${sessionId}`) || null;
        } catch (error) {
            console.error('Error getting session content:', error);
            return null;
        }
    }

    /**
     * 編集者をセッションに追加（存在しなければ追加）
     */
    static async addEditorIfNotExists(guildId: string, sessionId: string, userId: string): Promise<void> {
        const allSessions = await this.db.get(guildId, 'todo/sessions') || {};
        const session = allSessions[sessionId];
        if (!session) throw new Error('Session not found');

        if (!session.editors.includes(userId)) {
            session.editors.push(userId);
            session.updatedAt = Date.now();
            await this.db.set(guildId, 'todo/sessions', allSessions);
        }
    }
}
