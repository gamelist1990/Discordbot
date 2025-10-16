import { Router } from 'express';
import { RankController } from '../controllers/RankController.js';
import { BotClient } from '../../core/BotClient.js';

/**
 * ランク管理ルートを作成
 */
export function createRankRoutes(botClient: BotClient): Router {
    const router = Router();
    const controller = new RankController(botClient);

    // プリセット関連
    router.get('/presets', (req, res) => controller.getPresets(req, res));
    router.post('/presets', (req, res) => controller.createPreset(req, res));
    router.put('/presets/:presetName', (req, res) => controller.updatePreset(req, res));
    router.delete('/presets/:presetName', (req, res) => controller.deletePreset(req, res));

    // パネル関連
    router.get('/panels', (req, res) => controller.getPanels(req, res));
    router.delete('/panels/:panelId', (req, res) => controller.deletePanel(req, res));

    // 設定関連
    router.get('/settings', (req, res) => controller.getSettings(req, res));
    router.put('/settings', (req, res) => controller.updateSettings(req, res));

    // リーダーボード
    router.get('/leaderboard', (req, res) => controller.getLeaderboard(req, res));

    // XP操作
    router.post('/xp/add', (req, res) => controller.addUserXp(req, res));

    return router;
}
