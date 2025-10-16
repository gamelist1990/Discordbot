import { Router } from 'express';
import { RankController } from '../controllers/RankController.js';
import { BotClient } from '../../core/BotClient.js';
import { SettingsSession } from '../types/index.js';
import { verifyAuth } from '../middleware/auth.js';

/**
 * ランク管理ルートを作成
 */
export function createRankRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    const controller = new RankController(botClient);

    // すべてのルートで認証を要求
    router.use(verifyAuth(sessions));

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
    router.get('/leaderboard/:guildId/presets/:presetName', (req, res) => controller.getPresetLeaderboard(req, res));
    router.get('/leaderboard/:guildId/all', (req, res) => controller.getAllPresetLeaderboards(req, res));

    // ウェブランキングボード用エンドポイント
    router.get('/guilds', (req, res) => controller.getUserGuilds(req, res));
    router.get('/guild/:id', (req, res) => controller.getGuildRankings(req, res));
    router.get('/panels/:guildId', (req, res) => controller.getGuildPanels(req, res));
    router.get('/panel/:guildId/:panelId', (req, res) => controller.getPanelLeaderboard(req, res));

    // XP操作
    router.post('/xp/add', (req, res) => controller.addUserXp(req, res));

    // ランクリセット
    router.post('/guilds/:guildId/reset', (req, res) => controller.resetRank(req, res));

    // XP条件ルール管理
    router.get('/guilds/:guildId/presets/:presetName/rules', (req, res) => controller.getXpConditionRules(req, res));
    router.post('/guilds/:guildId/presets/:presetName/rules', (req, res) => controller.addXpConditionRule(req, res));
    router.put('/guilds/:guildId/presets/:presetName/rules/:ruleId', (req, res) => controller.updateXpConditionRule(req, res));
    router.delete('/guilds/:guildId/presets/:presetName/rules/:ruleId', (req, res) => controller.deleteXpConditionRule(req, res));

    return router;
}

/**
 * 公開ランキングボード用ルート（認証不要）
 */
export function createPublicRankRoutes(
    botClient: BotClient
): Router {
    const router = Router();
    const controller = new RankController(botClient);

    // 公開エンドポイント（認証不要）
    router.get('/panel/:guildId/:panelId', (req, res) => controller.getPanelLeaderboard(req, res));
    router.get('/leaderboard/:guildId/presets/:presetName', (req, res) => controller.getPresetLeaderboard(req, res));

    return router;
}

/**
 * ウェブランキングボード用ルートを作成（認証必須）
 */
export function createWebRankRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    const controller = new RankController(botClient);

    // すべてのルートで認証を要求
    router.use(verifyAuth(sessions));

    // ウェブランキングボード用エンドポイントのみ
    router.get('/guilds', (req, res) => controller.getUserGuilds(req, res));
    router.get('/guild/:id', (req, res) => controller.getGuildRankings(req, res));
    router.get('/panels/:guildId', (req, res) => controller.getGuildPanels(req, res));
    router.get('/panel/:guildId/:panelId', (req, res) => controller.getPanelLeaderboard(req, res));
    router.get('/leaderboard/:guildId', (req, res) => controller.getLeaderboard(req, res));
    router.get('/leaderboard/:guildId/presets/:presetName', (req, res) => controller.getPresetLeaderboard(req, res));
    router.get('/leaderboard/:guildId/all', (req, res) => controller.getAllPresetLeaderboards(req, res));

    return router;
}
