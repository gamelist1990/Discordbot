import { Router } from 'express';
import { TodoController } from '../controllers/TodoController.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { BotClient } from '../../core/BotClient.js';
import { SettingsSession } from '../types';

/**
 * Todo ルート
 */
export function createTodoRoutes(
    sessions: Map<string, SettingsSession>,
    _botClient: BotClient
): Router {
    const router = Router();
    const controller = new TodoController();
    const auth = new AuthMiddleware(sessions);

    // Todoセッション一覧の取得
    router.get('/todos/sessions', auth.validateToken, controller.getSessions.bind(controller));

    // Todoセッションの作成
    router.post('/todos/sessions', auth.validateToken, controller.createSession.bind(controller));

    // Todoセッションの取得
    router.get('/todos/sessions/:sessionId', auth.validateToken, controller.getSession.bind(controller));

    // Todoセッションの削除
    router.delete('/todos/sessions/:sessionId', auth.validateToken, controller.deleteSession.bind(controller));

    // Todoセッションのコンテンツを取得
    router.get('/todos/sessions/:sessionId/content', auth.validateToken, controller.getContent.bind(controller));

    // Todoアイテムの追加
    router.post('/todos/sessions/:sessionId/items', auth.validateToken, controller.addTodo.bind(controller));

    // Todoアイテムの更新
    router.patch('/todos/sessions/:sessionId/items/:todoId', auth.validateToken, controller.updateTodo.bind(controller));

    // Todoアイテムの削除
    router.delete('/todos/sessions/:sessionId/items/:todoId', auth.validateToken, controller.deleteTodo.bind(controller));

    // メンバーの追加
    router.post('/todos/sessions/:sessionId/members', auth.validateToken, controller.addMember.bind(controller));

    // メンバーの削除
    router.delete('/todos/sessions/:sessionId/members/:userId', auth.validateToken, controller.removeMember.bind(controller));

    // お気に入りのトグル
    router.post('/todos/sessions/:sessionId/favorite', auth.validateToken, controller.toggleFavorite.bind(controller));

    // 共有リンク作成 (認可: オーナーのみ)
    router.post('/todos/sessions/:sessionId/share', auth.validateToken, controller.createShare.bind(controller));

    // 共有リンク一覧取得 (認可: オーナーのみ)
    router.get('/todos/sessions/:sessionId/share', auth.validateToken, controller.getShareLinks.bind(controller));

    // 共有リンク取り消し (認可: オーナーのみ)
    router.delete('/todos/sessions/:sessionId/share/:token', auth.validateToken, controller.revokeShare.bind(controller));

    // 共有トークン経由でセッションを取得 (公開エンドポイント - トークンにより検証)
    // If the user has a sessionId cookie, populate req.session so the controller
    // can optionally add the authenticated user as an editor when the share
    // token grants edit rights.
    router.get('/todos/shared/:token', (req, _res, next) => {
        try {
            const cookieSessionId = (req as any).cookies?.sessionId;
            if (cookieSessionId && sessions.has(cookieSessionId)) {
                (req as any).session = sessions.get(cookieSessionId);
            }
        } catch (e) {
            // ignore — best-effort
        }
        next();
    }, controller.getSessionByToken.bind(controller));

    // 共有トークン経由でTodoアイテムを更新 (公開エンドポイント - トークンにより検証)
    router.patch('/todos/shared/:token/items/:todoId', controller.updateTodoByToken.bind(controller));

    return router;
}
