import { Router } from 'express';
import { StaffController } from '../controllers/StaffController.js';
import { SettingsSession } from '../types/index.js';
import { BotClient } from '../../core/BotClient.js';
import { verifyAuth } from '../middleware/auth.js';

/**
 * スタッフルート
 */
export function createStaffRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    const controller = new StaffController(botClient);


    // プライベートチャット一覧の取得 (session-based)
    router.get('/privatechats', verifyAuth(sessions), controller.getPrivateChats.bind(controller));

    // プライベートチャットの作成 (session-based)
    router.post('/privatechats', verifyAuth(sessions), controller.createPrivateChat.bind(controller));

    // プライベートチャットの削除 (session-based)
    router.delete('/privatechats/:chatId', verifyAuth(sessions), controller.deletePrivateChat.bind(controller));

    // プライベートチャット統計の取得 (session-based)
    router.get('/stats', verifyAuth(sessions), controller.getPrivateChatStats.bind(controller));

    // プライベートチャットのリアルタイム更新（SSE） (session-based)
    router.get('/privatechats/stream', verifyAuth(sessions), controller.streamPrivateChatUpdates.bind(controller));

    // セッションベースでアクセス可能なギルド一覧取得
    router.get('/guilds', verifyAuth(sessions), controller.getAccessibleGuilds.bind(controller));

    // ギルドのチャンネル一覧取得
    router.get('/guilds/:guildId/channels', verifyAuth(sessions), controller.getGuildChannels.bind(controller));

    // ギルドのロール一覧取得
    router.get('/guilds/:guildId/roles', verifyAuth(sessions), controller.getGuildRoles.bind(controller));

    // ギルドの絵文字一覧取得
    router.get('/guilds/:guildId/emojis', verifyAuth(sessions), controller.getGuildEmojis.bind(controller));

    // メンバー管理エンドポイント (session-based)
    router.get('/privatechats/:chatId/members', verifyAuth(sessions), controller.getChatMembers.bind(controller));
    router.post('/privatechats/:chatId/members', verifyAuth(sessions), controller.addChatMember.bind(controller));
    router.delete('/privatechats/:chatId/members/:userId', verifyAuth(sessions), controller.removeChatMember.bind(controller));

    // ユーザー検索 (session-based)
    router.get('/searchusers', verifyAuth(sessions), controller.searchUsers.bind(controller));

    // スタッフコマンド情報の取得 (session-based)
    router.get('/commands', verifyAuth(sessions), controller.getStaffCommands.bind(controller));

    return router;
}
