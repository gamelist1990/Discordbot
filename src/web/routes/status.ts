import { Router } from 'express';
import { StatusController } from '../controllers/StatusController.js';
import { BotClient } from '../../core/BotClient.js';

/**
 * ステータスルート
 */
export function createStatusRoutes(botClient: BotClient): Router {
    const router = Router();
    const controller = new StatusController(botClient);

    // Bot ステータスの取得（認証不要）
    router.get('/status', controller.getStatus.bind(controller));

    return router;
}
