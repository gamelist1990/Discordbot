import { Router } from 'express';
import { SettingsSession } from '../../types/index.js';
import { BotClient } from '../../../core/BotClient.js';
import { verifyAuth } from '../../middleware/auth.js';
import { RequestManagerController } from '../../controllers/staff/RequestManagerController.js';

export function createRequestManagerRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    const controller = new RequestManagerController(botClient);

    router.get('/:guildId', verifyAuth(sessions), controller.getConfig.bind(controller));
    router.post('/:guildId/config', verifyAuth(sessions), controller.saveConfig.bind(controller));
    router.get('/:guildId/items', verifyAuth(sessions), controller.listItems.bind(controller));
    router.post('/:guildId/items/cleanup-missing', verifyAuth(sessions), controller.cleanupMissingItems.bind(controller));

    return router;
}
