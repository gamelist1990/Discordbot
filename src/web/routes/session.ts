import { Router } from 'express';
import { SessionController } from '../controllers/SessionController.js';
import { SettingsSession } from '../types/index.js';
import { BotClient } from '../../core/BotClient.js';
import { AuthMiddleware } from '../middleware/auth.js';

/**
 * セッションルート
 */
export function createSessionRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    const controller = new SessionController(sessions, botClient);
    const auth = new AuthMiddleware(sessions);

    // トークンの検証
    router.get('/validate/:token', controller.validateToken.bind(controller));

    // 現在のセッション情報を取得（クッキーまたは sessionId を使用）
    // 統一: /api/auth/session を使用
    router.get('/auth/session', auth.validateToken, controller.getCurrent.bind(controller));

    // ギルド情報の取得（トークン指定）
    // NOTE: 以前は '/guild/:token' でしたが、同パスが別ルートと衝突するため
    // 明示的に '/auth/session/guild/:token' に移動しました。
    router.get('/auth/session/guild/:token', auth.validateToken, controller.getGuild.bind(controller));

    return router;
}
