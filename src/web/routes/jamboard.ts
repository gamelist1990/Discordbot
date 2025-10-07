import { Router } from 'express';
import { JamboardController } from '../controllers/JamboardController.js';
import { SettingsSession } from '../types/index.js';
import { AuthMiddleware } from '../middleware/auth.js';

/**
 * Jamboard ルート
 */
export function createJamboardRoutes(
    sessions: Map<string, SettingsSession>
): Router {
    const router = Router();
    const controller = new JamboardController();
    const auth = new AuthMiddleware(sessions);

    // Jamboard一覧の取得
    router.get('/jamboards/:token', auth.validateToken, controller.getJamboards.bind(controller));
    // Convenience: cookie-based client calls (no token param)
    router.get('/jamboards', auth.validateToken, controller.getJamboards.bind(controller));

    // スタッフJamboardの取得または作成
    router.get('/jamboards/:token/staff', auth.validateToken, controller.getOrCreateStaffJamboard.bind(controller));
    router.get('/jamboards/staff', auth.validateToken, controller.getOrCreateStaffJamboard.bind(controller));

    // 個人用Jamboardの作成
    router.post('/jamboards/:token/personal', auth.validateToken, controller.createPersonalJamboard.bind(controller));
    router.post('/jamboards/personal', auth.validateToken, controller.createPersonalJamboard.bind(controller));

    // 特定のJamboardを取得
    router.get('/jamboards/:token/:jamboardId', auth.validateToken, controller.getJamboard.bind(controller));
    router.get('/jamboards/:jamboardId', auth.validateToken, controller.getJamboard.bind(controller));

    // Jamboardコンテンツの取得
    router.get('/jamboards/:token/:jamboardId/content', auth.validateToken, controller.getContent.bind(controller));
    router.get('/jamboards/:jamboardId/content', auth.validateToken, controller.getContent.bind(controller));

    // ストローク関連
    router.post('/jamboards/:token/:jamboardId/strokes', auth.validateToken, controller.addStroke.bind(controller));
    router.post('/jamboards/:jamboardId/strokes', auth.validateToken, controller.addStroke.bind(controller));
    router.delete('/jamboards/:token/:jamboardId/strokes/:strokeId', auth.validateToken, controller.removeStroke.bind(controller));
    router.delete('/jamboards/:jamboardId/strokes/:strokeId', auth.validateToken, controller.removeStroke.bind(controller));

    // Todo関連
    router.post('/jamboards/:token/:jamboardId/todos', auth.validateToken, controller.addTodo.bind(controller));
    router.post('/jamboards/:jamboardId/todos', auth.validateToken, controller.addTodo.bind(controller));
    router.patch('/jamboards/:token/:jamboardId/todos/:todoId', auth.validateToken, controller.updateTodo.bind(controller));
    router.patch('/jamboards/:jamboardId/todos/:todoId', auth.validateToken, controller.updateTodo.bind(controller));
    router.delete('/jamboards/:token/:jamboardId/todos/:todoId', auth.validateToken, controller.deleteTodo.bind(controller));
    router.delete('/jamboards/:jamboardId/todos/:todoId', auth.validateToken, controller.deleteTodo.bind(controller));

    // メンバー管理
    router.post('/jamboards/:token/:jamboardId/members', auth.validateToken, controller.addMember.bind(controller));
    router.post('/jamboards/:jamboardId/members', auth.validateToken, controller.addMember.bind(controller));
    router.delete('/jamboards/:token/:jamboardId/members/:userId', auth.validateToken, controller.removeMember.bind(controller));
    router.delete('/jamboards/:jamboardId/members/:userId', auth.validateToken, controller.removeMember.bind(controller));

    // リアルタイム更新（SSE）
    router.get('/jamboards/:token/:jamboardId/stream', auth.validateToken, controller.streamUpdates.bind(controller));
    router.get('/jamboards/:jamboardId/stream', auth.validateToken, controller.streamUpdates.bind(controller));

    return router;
}
