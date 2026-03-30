import { Router } from 'express';
import { SettingsSession } from '../../types/index.js';
import { BotClient } from '../../../core/BotClient.js';
import { verifyAuth } from '../../middleware/auth.js';
import { CorePanelController } from '../../controllers/staff/CorePanelController.js';

export function createCorePanelRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    const controller = new CorePanelController(botClient);

    router.get('/:guildId', verifyAuth(sessions), controller.getConfig.bind(controller));
    router.post('/:guildId/config', verifyAuth(sessions), controller.saveConfig.bind(controller));
    router.post('/:guildId/post', verifyAuth(sessions), controller.postPanel.bind(controller));

    return router;
}
