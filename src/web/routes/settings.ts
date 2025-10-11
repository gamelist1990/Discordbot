import { Router } from 'express';
import { SettingsController } from '../controllers/SettingsController.js';
import { SettingsSession } from '../types/index.js';
import { AuthMiddleware, verifyAuth } from '../middleware/auth.js';

/**
 * 設定ルート
 */
export function createSettingsRoutes(sessions: Map<string, SettingsSession>): Router {
    const router = Router();
    const controller = new SettingsController();
    const auth = new AuthMiddleware(sessions);

    // 設定の取得 (token ベース、既存互換)
    // トークンルートは guildId ベースと衝突するため明示的に token サブパスに移動
    router.get('/settings/token/:token', auth.validateToken, controller.getSettings.bind(controller));

    // 設定の取得 (guildId ベース、クライアントからの直接リクエスト互換用)
    // Cookie の sessionId を使って認証を行い、該当ギルド設定を返します
    router.get('/settings/:guildId', verifyAuth(sessions), controller.getSettings.bind(controller));

    // 設定の保存 (guildId ベース - クライアントが直接呼ぶ経路)
    router.post('/settings/:guildId', verifyAuth(sessions), controller.saveSettings.bind(controller));

    // 設定の保存 (token ベース、既存互換)
    router.post('/settings/token/:token', auth.validateToken, controller.saveSettings.bind(controller));

    return router;
}
