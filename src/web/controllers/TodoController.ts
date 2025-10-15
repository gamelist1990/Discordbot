import { Request, Response } from 'express';
import { TodoManager } from '../../core/TodoManager.js';
import { SettingsSession } from '../types/index.js';
import { CacheManager } from '../../utils/CacheManager.js';

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
            // キャッシュチェック
            const cacheKey = `todo_sessions_${session.userId}`;
            const cachedSessions = CacheManager.get<any[]>(cacheKey);
            if (cachedSessions) {
                res.json({ sessions: cachedSessions });
                return;
            }

            const sessions = await TodoManager.getUserSessions(session.userId);

            // キャッシュに保存（5分間）
            CacheManager.set(cacheKey, sessions, 5 * 60 * 1000);

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
            const todoSession = await TodoManager.createSession(session.userId, name.trim(), session.guildId);

            // キャッシュをクリア
            CacheManager.delete(`todo_sessions_${session.userId}`);

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
            // キャッシュチェック
            const cacheKey = `todo_session_${sessionId}`;
            const cachedSession = CacheManager.get<any>(cacheKey);
            if (cachedSession) {
                res.json(cachedSession);
                return;
            }

            const todoSession = await TodoManager.getSession(sessionId);
            if (!todoSession) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }

            // アクセス権限を確認
            const accessLevel = await TodoManager.canAccess(sessionId, session.userId);
            if (!accessLevel) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const result = { session: todoSession, accessLevel };

            // キャッシュに保存（10分間）
            CacheManager.set(cacheKey, result, 10 * 60 * 1000);

            res.json(result);
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
            const todoSession = await TodoManager.getSession(sessionId);
            if (!todoSession) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }

            // オーナーのみ削除可能
            if (todoSession.ownerId !== session.userId) {
                res.status(403).json({ error: 'Only owner can delete the session' });
                return;
            }

            await TodoManager.deleteSession(sessionId);

            // キャッシュをクリア
            CacheManager.delete(`todo_sessions_${session.userId}`);
            CacheManager.delete(`todo_session_${sessionId}`);

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
            const accessLevel = await TodoManager.canAccess(sessionId, session.userId);
            if (!accessLevel) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const content = await TodoManager.getContent(sessionId);
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
            const accessLevel = await TodoManager.canAccess(sessionId, session.userId);
            if (accessLevel !== 'owner' && accessLevel !== 'editor') {
                res.status(403).json({ error: 'Edit permission required' });
                return;
            }

            const todo = await TodoManager.addTodo(
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
        const { shareToken } = req.query;
        const updates = req.body;

        try {
            let hasEditPermission = false;

            // 通常の権限チェック
            if (session?.userId) {
                const accessLevel = await TodoManager.canAccess(sessionId, session.userId);
                if (accessLevel === 'owner' || accessLevel === 'editor') {
                    hasEditPermission = true;
                }
            }

            // 共有トークン経由の権限チェック（フォールバック）
            if (!hasEditPermission) {
                let tokenToCheck = shareToken as string;

                // shareTokenパラメータがない場合、Refererから共有リンクトークンを抽出
                if (!tokenToCheck && req.headers.referer) {
                    const referer = req.headers.referer;
                    const shareMatch = referer.match(/\/todo\/shared\/([a-f0-9-]+)/);
                    if (shareMatch) {
                        tokenToCheck = shareMatch[1];
                    }
                }

                if (tokenToCheck) {
                    const shareResult = await TodoManager.getSessionByShareToken(tokenToCheck);
                    if (shareResult && shareResult.mode === 'edit' && shareResult.session?.id === sessionId) {
                        hasEditPermission = true;
                    }
                }
            }

            if (!hasEditPermission) {
                res.status(403).json({ error: 'Edit permission required' });
                return;
            }

            await TodoManager.updateTodo(sessionId, todoId, updates);
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
            const accessLevel = await TodoManager.canAccess(sessionId, session.userId);
            if (accessLevel !== 'owner' && accessLevel !== 'editor') {
                res.status(403).json({ error: 'Edit permission required' });
                return;
            }

            await TodoManager.deleteTodo(sessionId, todoId);
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
    async addMember(_req: Request, res: Response): Promise<void> {
        // Deprecated: member addition via API is removed in favor of URL-based sharing.
        res.status(410).json({ error: 'Member addition via API is deprecated. Use share links instead.' });
    }

    /**
     * メンバーを削除
     */
    async removeMember(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { sessionId, userId } = req.params;

        try {
            const todoSession = await TodoManager.getSession(sessionId);
            if (!todoSession) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }

            // オーナーのみメンバーを削除できる
            if (todoSession.ownerId !== session.userId) {
                res.status(403).json({ error: 'Only owner can remove members' });
                return;
            }

            await TodoManager.removeMember(sessionId, userId);
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
            const accessLevel = await TodoManager.canAccess(sessionId, session.userId);
            if (!accessLevel) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const isFavorited = await TodoManager.toggleFavorite(sessionId, session.userId);
            res.json({ success: true, isFavorited });
        } catch (error) {
            console.error('お気に入りトグルエラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to toggle favorite';
            res.status(500).json({ error: errorMessage });
        }
    }

    /**
     * 共有リンクを作成
     */
    async createShare(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { sessionId } = req.params;
        const { mode, expiresInSeconds } = req.body; // mode: 'view' | 'edit'

        if (mode !== 'view' && mode !== 'edit') {
            res.status(400).json({ error: 'mode must be "view" or "edit"' });
            return;
        }

        try {
            const todoSession = await TodoManager.getSession(sessionId);
            if (!todoSession) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }

            // オーナーのみ共有リンク作成可能
            if (todoSession.ownerId !== session.userId) {
                res.status(403).json({ error: 'Only owner can create share links' });
                return;
            }

            const token = await TodoManager.createShareLink(sessionId, mode, typeof expiresInSeconds === 'number' ? expiresInSeconds : null);
            res.json({ token, expiresInSeconds: expiresInSeconds || null });
        } catch (error) {
            console.error('共有リンク作成エラー:', error);
            res.status(500).json({ error: 'Failed to create share link' });
        }
    }

    /**
     * 共有リンク一覧を取得
     */
    async getShareLinks(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { sessionId } = req.params;

        try {
            // セッション存在・権限チェックは従来通り
            const todoSession = await TodoManager.getSession(sessionId);
            if (!todoSession) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            if (todoSession.ownerId !== session.userId) {
                res.status(403).json({ error: 'Only owner can view share links' });
                return;
            }

            // すべての共有リンクを取得し、sessionIdでフィルタ
            const sessionShares = await TodoManager.getSharesForSession(sessionId);
            res.json({ shareLinks: sessionShares });
        } catch (error) {
            console.error('共有リンク一覧取得エラー:', error);
            res.status(500).json({ error: 'Failed to get share links' });
        }
    }
    async revokeShare(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { sessionId, token } = req.params;

        try {
            const todoSession = await TodoManager.getSession(sessionId);
            if (!todoSession) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }

            // オーナーのみ取り消し可能
            if (todoSession.ownerId !== session.userId) {
                res.status(403).json({ error: 'Only owner can revoke share links' });
                return;
            }

            const ok = await TodoManager.revokeShareLink(token);
            res.json({ success: ok });
        } catch (error) {
            console.error('共有リンク取り消しエラー:', error);
            res.status(500).json({ error: 'Failed to revoke share link' });
        }
    }

    /**
     * 共有トークン経由でセッションを取得
     */
    async getSessionByToken(req: Request, res: Response): Promise<void> {
        const { token } = req.params;
        try {
            const result = await TodoManager.getSessionByShareToken(token);
            if (!result) {
                res.status(404).json({ error: 'Shared session not found or token expired' });
                return;
            }

            let addedAsEditor = false;

            // If token mode is edit, and request has an authenticated session cookie for the same guild,
            // auto-add that user as editor to the target todo session (so they get persistent edit rights)
            if (result.mode === 'edit') {
                try {
                    const authSession = (req as any).session as SettingsSession | undefined;
                    // We treat guildId present on the todo session as authoritative; if the authSession exists
                    // and the guild IDs match (or todo session has no guildId), add the user as editor.
                    if (authSession && result.session && authSession.userId) {
                        const guildMatch = !result.session.guildId || authSession.guildId === result.session.guildId;
                        if (guildMatch) {
                            await TodoManager.addEditorIfNotExists(result.session.id, authSession.userId);
                            addedAsEditor = true;
                        }
                    }
                } catch (e) {
                    console.error('Failed to auto-add editor from share token access:', e);
                }
            }

            // 返却するのはセッションメタとアクセスモード。編集権限がある場合は編集可能
            const content = await TodoManager.getContent(result.session!.id);
            res.json({ 
                session: result.session, 
                accessLevel: result.mode === 'edit' ? 'editor' : 'viewer', 
                addedAsEditor,
                content 
            });
        } catch (error) {
            console.error('共有トークン取得エラー:', error);
            res.status(500).json({ error: 'Failed to fetch shared session' });
        }
    }

    /**
     * 共有トークン経由でTodoアイテムを更新
     */
    async updateTodoByToken(req: Request, res: Response): Promise<void> {
        const { token, todoId } = req.params;
        const updates = req.body;

        try {
            // トークンを検証
            const result = await TodoManager.getSessionByShareToken(token);
            if (!result) {
                res.status(404).json({ error: 'Shared session not found or token expired' });
                return;
            }

            // 編集権限があるか確認
            if (result.mode !== 'edit') {
                res.status(403).json({ error: 'Edit permission required' });
                return;
            }

            await TodoManager.updateTodo(result.session!.id, todoId, updates);
            res.json({ success: true });
        } catch (error) {
            console.error('共有トークン経由Todo更新エラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to update todo';
            res.status(500).json({ error: errorMessage });
        }
    }
}
