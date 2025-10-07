import { Request, Response } from 'express';
import { TodoManager, TodoSession, TodoItem } from '../../core/TodoManager.js';
import { SettingsSession } from '../SettingsServer.js';

/**
 * Todo コントローラー
 */
export class TodoController {
    /**
     * ユーザーのTodoセッション一覧を取得
     */
    async getSessions(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;

        try {
            const sessions = await TodoManager.getUserSessions(session.guildId, session.userId);
            res.json({ sessions });
        } catch (error) {
            console.error('Todoセッション一覧取得エラー:', error);
            res.status(500).json({ error: 'Failed to fetch todo sessions' });
        }
    }

    /**
     * Todoセッションを作成
     */
    async createSession(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { name } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            res.status(400).json({ error: 'Session name is required' });
            return;
        }

        if (name.length > 100) {
            res.status(400).json({ error: 'Session name is too long (max 100 characters)' });
            return;
        }

        try {
            const todoSession = await TodoManager.createSession(
                session.guildId,
                session.userId,
                name.trim()
            );

            res.json({ session: todoSession });
        } catch (error) {
            console.error('Todoセッション作成エラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to create todo session';
            res.status(500).json({ error: errorMessage });
        }
    }

    /**
     * Todoセッションを取得
     */
    async getSession(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { sessionId } = req.params;

        try {
            const todoSession = await TodoManager.getSession(session.guildId, sessionId);
            if (!todoSession) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }

            // アクセス権限を確認
            const accessLevel = await TodoManager.canAccess(session.guildId, sessionId, session.userId);
            if (!accessLevel) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            res.json({ session: todoSession, accessLevel });
        } catch (error) {
            console.error('Todoセッション取得エラー:', error);
            res.status(500).json({ error: 'Failed to fetch todo session' });
        }
    }

    /**
     * Todoセッションを削除
     */
    async deleteSession(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { sessionId } = req.params;

        try {
            const todoSession = await TodoManager.getSession(session.guildId, sessionId);
            if (!todoSession) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }

            // オーナーのみ削除可能
            if (todoSession.ownerId !== session.userId) {
                res.status(403).json({ error: 'Only owner can delete the session' });
                return;
            }

            await TodoManager.deleteSession(session.guildId, sessionId);
            res.json({ success: true });
        } catch (error) {
            console.error('Todoセッション削除エラー:', error);
            res.status(500).json({ error: 'Failed to delete todo session' });
        }
    }

    /**
     * Todoセッションのコンテンツを取得
     */
    async getContent(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { sessionId } = req.params;

        try {
            // アクセス権限を確認
            const accessLevel = await TodoManager.canAccess(session.guildId, sessionId, session.userId);
            if (!accessLevel) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const content = await TodoManager.getContent(session.guildId, sessionId);
            if (!content) {
                res.status(404).json({ error: 'Content not found' });
                return;
            }

            res.json({ content, accessLevel });
        } catch (error) {
            console.error('Todoコンテンツ取得エラー:', error);
            res.status(500).json({ error: 'Failed to fetch todo content' });
        }
    }

    /**
     * Todoアイテムを追加
     */
    async addTodo(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { sessionId } = req.params;
        const { text, priority, tags, description, dueDate } = req.body;

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            res.status(400).json({ error: 'Todo text is required' });
            return;
        }

        try {
            // 編集権限を確認（オーナーまたはエディター）
            const accessLevel = await TodoManager.canAccess(session.guildId, sessionId, session.userId);
            if (accessLevel !== 'owner' && accessLevel !== 'editor') {
                res.status(403).json({ error: 'Edit permission required' });
                return;
            }

            const todo = await TodoManager.addTodo(
                session.guildId,
                sessionId,
                text.trim(),
                session.userId,
                priority || 'medium',
                tags || [],
                description,
                dueDate
            );

            res.json({ success: true, todo });
        } catch (error) {
            console.error('Todo追加エラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to add todo';
            res.status(500).json({ error: errorMessage });
        }
    }

    /**
     * Todoアイテムを更新
     */
    async updateTodo(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { sessionId, todoId } = req.params;
        const updates = req.body;

        try {
            // 編集権限を確認（オーナーまたはエディター）
            const accessLevel = await TodoManager.canAccess(session.guildId, sessionId, session.userId);
            if (accessLevel !== 'owner' && accessLevel !== 'editor') {
                res.status(403).json({ error: 'Edit permission required' });
                return;
            }

            await TodoManager.updateTodo(session.guildId, sessionId, todoId, updates);
            res.json({ success: true });
        } catch (error) {
            console.error('Todo更新エラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to update todo';
            res.status(500).json({ error: errorMessage });
        }
    }

    /**
     * Todoアイテムを削除
     */
    async deleteTodo(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { sessionId, todoId } = req.params;

        try {
            // 編集権限を確認（オーナーまたはエディター）
            const accessLevel = await TodoManager.canAccess(session.guildId, sessionId, session.userId);
            if (accessLevel !== 'owner' && accessLevel !== 'editor') {
                res.status(403).json({ error: 'Edit permission required' });
                return;
            }

            await TodoManager.deleteTodo(session.guildId, sessionId, todoId);
            res.json({ success: true });
        } catch (error) {
            console.error('Todo削除エラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to delete todo';
            res.status(500).json({ error: errorMessage });
        }
    }

    /**
     * メンバーを追加（ビューワーまたはエディター）
     */
    async addMember(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { sessionId } = req.params;
        const { userId, role } = req.body;

        if (!userId || !role) {
            res.status(400).json({ error: 'userId and role are required' });
            return;
        }

        if (role !== 'viewer' && role !== 'editor') {
            res.status(400).json({ error: 'role must be "viewer" or "editor"' });
            return;
        }

        try {
            const todoSession = await TodoManager.getSession(session.guildId, sessionId);
            if (!todoSession) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }

            // オーナーのみメンバーを追加できる
            if (todoSession.ownerId !== session.userId) {
                res.status(403).json({ error: 'Only owner can add members' });
                return;
            }

            await TodoManager.addMember(session.guildId, sessionId, userId, role);
            res.json({ success: true });
        } catch (error) {
            console.error('メンバー追加エラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to add member';
            res.status(500).json({ error: errorMessage });
        }
    }

    /**
     * メンバーを削除
     */
    async removeMember(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { sessionId, userId } = req.params;

        try {
            const todoSession = await TodoManager.getSession(session.guildId, sessionId);
            if (!todoSession) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }

            // オーナーのみメンバーを削除できる
            if (todoSession.ownerId !== session.userId) {
                res.status(403).json({ error: 'Only owner can remove members' });
                return;
            }

            await TodoManager.removeMember(session.guildId, sessionId, userId);
            res.json({ success: true });
        } catch (error) {
            console.error('メンバー削除エラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to remove member';
            res.status(500).json({ error: errorMessage });
        }
    }

    /**
     * お気に入りのトグル
     */
    async toggleFavorite(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { sessionId } = req.params;

        try {
            // アクセス権限を確認
            const accessLevel = await TodoManager.canAccess(session.guildId, sessionId, session.userId);
            if (!accessLevel) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const isFavorited = await TodoManager.toggleFavorite(session.guildId, sessionId, session.userId);
            res.json({ success: true, isFavorited });
        } catch (error) {
            console.error('お気に入りトグルエラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to toggle favorite';
            res.status(500).json({ error: errorMessage });
        }
    }
}
