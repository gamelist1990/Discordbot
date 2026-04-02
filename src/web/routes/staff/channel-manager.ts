import { Router } from 'express';
import { SettingsSession } from '../../types/index.js';
import { BotClient } from '../../../core/BotClient.js';
import { verifyAuth } from '../../middleware/auth.js';
import { ChannelManagerController } from '../../controllers/staff/ChannelManagerController.js';

export function createChannelManagerRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    const controller = new ChannelManagerController(botClient);

    router.get('/:guildId/state', verifyAuth(sessions), controller.getState);
    router.post('/:guildId/channels', verifyAuth(sessions), controller.createChannel);
    router.patch('/:guildId/channels/:channelId', verifyAuth(sessions), controller.updateChannel);
    router.post('/:guildId/channels/:channelId/move', verifyAuth(sessions), controller.moveChannel);
    router.post('/:guildId/channels/:channelId/reorder', verifyAuth(sessions), controller.reorderChannel);
    router.post('/:guildId/channels/:channelId/sync-category-permissions', verifyAuth(sessions), controller.syncChannelPermissions);
    router.post('/:guildId/channels/:channelId/duplicate', verifyAuth(sessions), controller.duplicateChannel);
    router.delete('/:guildId/channels/:channelId', verifyAuth(sessions), controller.deleteChannel);
    router.put('/:guildId/channels/:channelId/overwrites/:targetId', verifyAuth(sessions), controller.updateOverwrite);
    router.post('/:guildId/roles', verifyAuth(sessions), controller.createRole);
    router.patch('/:guildId/roles/:roleId', verifyAuth(sessions), controller.updateRole);
    router.post('/:guildId/roles/:roleId/reorder', verifyAuth(sessions), controller.reorderRole);
    router.post('/:guildId/roles/:roleId/duplicate', verifyAuth(sessions), controller.duplicateRole);
    router.delete('/:guildId/roles/:roleId', verifyAuth(sessions), controller.deleteRole);

    return router;
}
