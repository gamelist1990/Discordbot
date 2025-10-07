import { Router } from 'express';
import { TodoController } from '../controllers/TodoController.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { BotClient } from '../../core/BotClient.js';
import { SettingsSession } from '../SettingsServer.js';

/**
 * Todo ルート
 */
export function createTodoRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
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

    return router;
}
