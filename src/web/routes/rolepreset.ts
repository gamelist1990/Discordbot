import { Router } from 'express';
import { RolePresetController } from '../controllers/RolePresetController.js';
import { SettingsSession } from '../types/index.js';
import { BotClient } from '../../core/BotClient.js';
import { verifyAuth } from '../middleware/auth.js';

/**
 * ロールプリセットルート
 */
export function createRolePresetRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    const controller = new RolePresetController(botClient);

    // ギルドのロール一覧を取得
    router.get('/guilds/:guildId/roles', verifyAuth(sessions), controller.getGuildRoles.bind(controller));

    // ギルドのプリセット一覧を取得
    router.get('/guilds/:guildId/role-presets', verifyAuth(sessions), controller.getPresets.bind(controller));

    // プリセットを作成
    router.post('/guilds/:guildId/role-presets', verifyAuth(sessions), controller.createPreset.bind(controller));

    // プリセットを更新
    router.put('/guilds/:guildId/role-presets/:id', verifyAuth(sessions), controller.updatePreset.bind(controller));

    // プリセットを削除
    router.delete('/guilds/:guildId/role-presets/:id', verifyAuth(sessions), controller.deletePreset.bind(controller));

    // ロール変更ログを取得
    router.get('/guilds/:guildId/role-logs', verifyAuth(sessions), controller.getRoleChangeLogs.bind(controller));

    return router;
}
