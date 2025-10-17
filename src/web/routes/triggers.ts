import { Router } from 'express';
import { TriggerController } from '../controllers/TriggerController.js';
import { BotClient } from '../../core/BotClient.js';
import { SettingsSession } from '../types/index.js';
import { requireStaffAuth } from '../middleware/auth.js';

/**
 * トリガー管理用ルート
 * すべてのエンドポイントはSTAFF権限が必要
 */
export function createTriggerRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    const controller = new TriggerController(botClient);

    // すべてのルートにSTAFF権限チェックを適用
    router.use(requireStaffAuth(sessions));

    // GET /api/triggers?guildId=...
    router.get('/triggers', (req, res) => controller.getAllTriggers(req, res));

    // GET /api/triggers/:id
    router.get('/triggers/:id', (req, res) => controller.getTrigger(req, res));

    // POST /api/triggers
    router.post('/triggers', (req, res) => controller.createTrigger(req, res));

    // PUT /api/triggers/:id
    router.put('/triggers/:id', (req, res) => controller.updateTrigger(req, res));

    // DELETE /api/triggers/:id
    router.delete('/triggers/:id', (req, res) => controller.deleteTrigger(req, res));

    // POST /api/triggers/:id/test
    router.post('/triggers/:id/test', (req, res) => controller.testTrigger(req, res));

    // POST /api/triggers/import
    router.post('/triggers/import', (req, res) => controller.importTriggers(req, res));

    // POST /api/triggers/export
    router.post('/triggers/export', (req, res) => controller.exportTriggers(req, res));

    // GET /api/triggers/live-buffer
    router.get('/triggers/live-buffer', (req, res) => controller.getLiveBuffer(req, res));

    // DELETE /api/triggers/live-buffer
    router.delete('/triggers/live-buffer', (req, res) => controller.clearLiveBuffer(req, res));

    return router;
}
