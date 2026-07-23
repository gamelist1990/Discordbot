import { Router } from 'express';
import { BotClient } from '../../../core/platform/BotClient.js';
import { SettingsSession } from '../../types/index.js';
import { verifyAuth } from '../../middleware/auth.js';
import { JoinLogController } from '../../controllers/staff/JoinLogController.js';

export function createJoinLogRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    const controller = new JoinLogController(botClient);

    router.get('/:guildId', verifyAuth(sessions), controller.getState);
    router.put('/:guildId', verifyAuth(sessions), controller.saveState);
    router.post('/:guildId/reset', verifyAuth(sessions), controller.resetState);

    return router;
}
