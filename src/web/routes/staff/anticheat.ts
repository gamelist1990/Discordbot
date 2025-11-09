import { Router } from 'express';
import { AntiCheatController } from '../../controllers/staff/AntiCheatController.js';
import { SettingsSession } from '../../types/index.js';
import { BotClient } from '../../../core/BotClient.js';
import { verifyAuth } from '../../middleware/auth.js';

/**
 * AntiCheat routes
 * All routes require staff authentication
 */
export function createAntiCheatRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    const controller = new AntiCheatController(botClient);

    // Get guild AntiCheat settings
    router.get('/:guildId/settings', verifyAuth(sessions), controller.getSettings.bind(controller));

    // Update guild AntiCheat settings
    router.post('/:guildId/settings', verifyAuth(sessions), controller.updateSettings.bind(controller));

    // Get detection logs
    router.get('/:guildId/logs', verifyAuth(sessions), controller.getLogs.bind(controller));

    // Execute manual punishment action
    router.post('/:guildId/action', verifyAuth(sessions), controller.executeAction.bind(controller));

    // Revoke timeout
    router.post('/:guildId/revoke', verifyAuth(sessions), controller.revokeTimeout.bind(controller));

    // Get user trust scores
    router.get('/:guildId/trust', verifyAuth(sessions), controller.getUserTrust.bind(controller));

    return router;
}
