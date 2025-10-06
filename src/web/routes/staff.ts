import { Router } from 'express';
import { StaffController } from '../controllers/StaffController.js';
import { SettingsSession } from '../types/index.js';
import { BotClient } from '../../core/BotClient.js';
import { AuthMiddleware } from '../middleware/auth.js';

/**
 * スタッフルート
 */
export function createStaffRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    const controller = new StaffController(botClient);
    const auth = new AuthMiddleware(sessions);

    // プライベートチャット一覧の取得
    router.get('/privatechats/:token', auth.validateToken, controller.getPrivateChats.bind(controller));

    // プライベートチャットの作成
    router.post('/privatechats/:token', auth.validateToken, controller.createPrivateChat.bind(controller));

    // プライベートチャットの削除
    router.delete('/privatechats/:token/:chatId', auth.validateToken, controller.deletePrivateChat.bind(controller));

    // プライベートチャット統計の取得
    router.get('/stats/:token', auth.validateToken, controller.getPrivateChatStats.bind(controller));

    return router;
}
