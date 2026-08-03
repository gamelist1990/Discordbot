import { Router } from 'express';
import { Client } from 'discord.js';
import { SettingsSession } from '../types/index.js';
import { attachSessionIfPresent } from '../middleware/auth.js';
import { GameRankingController } from '../controllers/GameRankingController.js';

export function createGameRankingRoutes(
    sessions: Map<string, SettingsSession>,
    client: Client
): Router {
    const router = Router();
    const controller = new GameRankingController(client);

    router.get(
        '/:guildId/:gameKey/leaderboard',
        attachSessionIfPresent(sessions),
        controller.leaderboard.bind(controller)
    );
    router.get(
        '/:guildId/:gameKey/users/:userId',
        attachSessionIfPresent(sessions),
        controller.profile.bind(controller)
    );

    return router;
}