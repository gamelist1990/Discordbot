import { Router } from 'express';
import { SettingsSession } from '../../types/index.js';
import { BotClient } from '../../../core/BotClient.js';
import { verifyAuth } from '../../middleware/auth.js';
import { TodoController } from '../../controllers/staff/TodoController.js';

export function createTodoRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    const controller = new TodoController(botClient);

    router.get('/:guildId/:channelId', verifyAuth(sessions), controller.getTodo);
    router.post('/:guildId/:channelId', verifyAuth(sessions), controller.upsertTodo);

    return router;
}
