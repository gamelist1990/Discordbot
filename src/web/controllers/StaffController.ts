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

    /**
     * プライベートチャットのリアルタイム更新（Server-Sent Events）
     */
    async streamPrivateChatUpdates(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;

        // SSE ヘッダーを設定
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // nginx のバッファリングを無効化

        let intervalId: NodeJS.Timeout;

        try {
            const { PrivateChatManager } = await import('../../commands/staff/PrivateChatManager.js');
            const guild = this.botClient.client.guilds.cache.get(session.guildId);

            if (!guild) {
                res.write(`data: ${JSON.stringify({ error: 'Guild not found' })}\n\n`);
                res.end();
                return;
            }

            // 初期データを送信
            const sendUpdate = async () => {
                try {
                    const chats = await PrivateChatManager.getChatsByGuild(session.guildId);
                    const stats = await PrivateChatManager.getStats(session.guildId);

                    // チャット情報を強化
                    const enrichedChats = await Promise.all(
                        chats.map(async (chat) => {
                            const user = await guild.members.fetch(chat.userId).catch(() => null);
                            const staff = await guild.members.fetch(chat.staffId).catch(() => null);
                            const channel = guild.channels.cache.get(chat.channelId);

                            return {
                                ...chat,
                                userName: user?.user.username || 'Unknown User',
                                staffName: staff?.user.username || 'Unknown Staff',
                                channelExists: !!channel
                            };
                        })
                    );

                    const updateData = {
                        type: 'update',
                        timestamp: Date.now(),
                        chats: enrichedChats,
                        stats
                    };

                    res.write(`data: ${JSON.stringify(updateData)}\n\n`);
                } catch (error) {
                    console.error('SSE データ送信エラー:', error);
                }
            };

            // 初回送信
            await sendUpdate();

            // 10秒ごとに更新を送信
            intervalId = setInterval(sendUpdate, 10000);

            // キープアライブ（30秒ごと）
            const keepAliveId = setInterval(() => {
                res.write(': keepalive\n\n');
            }, 30000);

            // クライアントが切断した場合のクリーンアップ
            req.on('close', () => {
                clearInterval(intervalId);
                clearInterval(keepAliveId);
                console.log(`SSE 接続を閉じました (Guild: ${session.guildId})`);
            });

        } catch (error) {
            console.error('SSE ストリーム初期化エラー:', error);
            if (intervalId) clearInterval(intervalId);
            res.write(`data: ${JSON.stringify({ error: 'Stream initialization failed' })}\n\n`);
            res.end();
        }
    }
}
