import { Router } from 'express';
import { SettingsController } from '../controllers/SettingsController.js';
import { SettingsSession } from '../types/index.js';
import { AuthMiddleware } from '../middleware/auth.js';

/**
 * 設定ルート
 */
export function createSettingsRoutes(sessions: Map<string, SettingsSession>): Router {
    const router = Router();
    const controller = new SettingsController();
    const auth = new AuthMiddleware(sessions);

    // 設定の取得
    router.get('/settings/:token', auth.validateToken, controller.getSettings.bind(controller));

    // 設定の保存
    router.post('/settings/:token', auth.validateToken, controller.saveSettings.bind(controller));

    return router;
}
