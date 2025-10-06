import { Request, Response } from 'express';
import { SettingsSession } from '../types/index.js';
import { BotClient } from '../../core/BotClient.js';

/**
 * スタッフコントローラー
 */
export class StaffController {
    private botClient: BotClient;

    constructor(botClient: BotClient) {
        this.botClient = botClient;
    }

    /**
     * プライベートチャット一覧の取得
     */
    async getPrivateChats(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;

        try {
            const { PrivateChatManager } = await import('../../commands/staff/PrivateChatManager.js');
            const chats = await PrivateChatManager.getChatsByGuild(session.guildId);
            
            // ユーザー情報を付加
            const guild = this.botClient.client.guilds.cache.get(session.guildId);
            const enrichedChats = await Promise.all(
                chats.map(async (chat) => {
                    const user = await guild?.members.fetch(chat.userId).catch(() => null);
                    const staff = await guild?.members.fetch(chat.staffId).catch(() => null);
                    const channel = guild?.channels.cache.get(chat.channelId);
                    
                    return {
                        ...chat,
                        userName: user?.user.username || 'Unknown User',
                        staffName: staff?.user.username || 'Unknown Staff',
                        channelExists: !!channel
                    };
                })
            );

            res.json({ chats: enrichedChats });
        } catch (error) {
            console.error('プライベートチャット一覧取得エラー:', error);
            res.status(500).json({ error: 'Failed to fetch private chats' });
        }
    }

    /**
     * プライベートチャットの作成
     */
    async createPrivateChat(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { userId } = req.body;

        if (!userId) {
            res.status(400).json({ error: 'userId is required' });
            return;
        }

        try {
            const guild = this.botClient.client.guilds.cache.get(session.guildId);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const { PrivateChatManager } = await import('../../commands/staff/PrivateChatManager.js');
            const chat = await PrivateChatManager.createChat(guild, userId, session.userId);

            console.log(`プライベートチャット作成: ${chat.chatId} (User: ${userId}, Staff: ${session.userId})`);
            res.json({ success: true, chat });
        } catch (error) {
            console.error('プライベートチャット作成エラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to create private chat';
            res.status(500).json({ error: errorMessage });
        }
    }

    /**
     * プライベートチャットの削除
     */
    async deletePrivateChat(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { chatId } = req.params;

        try {
            const guild = this.botClient.client.guilds.cache.get(session.guildId);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const { PrivateChatManager } = await import('../../commands/staff/PrivateChatManager.js');
            const deleted = await PrivateChatManager.deleteChat(guild, chatId);

            if (deleted) {
                console.log(`プライベートチャット削除: ${chatId}`);
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Chat not found' });
            }
        } catch (error) {
            console.error('プライベートチャット削除エラー:', error);
            res.status(500).json({ error: 'Failed to delete private chat' });
        }
    }

    /**
     * プライベートチャット統計の取得
     */
    async getPrivateChatStats(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;

        try {
            const { PrivateChatManager } = await import('../../commands/staff/PrivateChatManager.js');
            const stats = await PrivateChatManager.getStats(session.guildId);

            res.json(stats);
        } catch (error) {
            console.error('統計情報取得エラー:', error);
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    }
}
