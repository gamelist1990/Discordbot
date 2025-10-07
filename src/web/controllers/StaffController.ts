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
                    console.log('GET Processing chat:', chat.chatId, 'roomName:', chat.roomName, 'userId:', chat.userId);
                    let userName = 'Unknown User';
                    
                    if (chat.roomName) {
                        // roomNameベースのチャット
                        userName = `Room: ${chat.roomName}`;
                        console.log('GET Using roomName for userName:', userName);
                    } else if (chat.userId) {
                        // userIdベースのチャット
                        console.log('GET Fetching user for userId:', chat.userId);
                        const user = await guild?.members.fetch(chat.userId).catch(() => null);
                        userName = user?.user.username || 'Unknown User';
                        console.log('GET Fetched userName:', userName);
                    } else {
                        console.log('GET No roomName or userId for chat:', chat.chatId);
                    }
                    
                    const staff = await guild?.members.fetch(chat.staffId).catch(() => null);
                    const channel = guild?.channels.cache.get(chat.channelId);
                    
                    return {
                        ...chat,
                        userName: userName,
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
        const { userId, roomName, members } = req.body;

        // userId または roomName のどちらかが必要
        if (!userId && !roomName) {
            res.status(400).json({ error: 'userId or roomName is required' });
            return;
        }

        try {
            const guild = this.botClient.client.guilds.cache.get(session.guildId);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const { PrivateChatManager } = await import('../../commands/staff/PrivateChatManager.js');
            let chat;

            if (roomName) {
                const memberList: string[] = Array.isArray(members) ? members : [];
                chat = await PrivateChatManager.createChatWithName(guild, roomName, memberList, session.userId);
            } else {
                chat = await PrivateChatManager.createChat(guild, userId, session.userId);
            }

            console.log(`プライベートチャット作成: ${chat.chatId} (Staff: ${session.userId})`);
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

    let intervalId: NodeJS.Timeout | undefined;

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
                            console.log('Processing chat:', chat.chatId, 'roomName:', chat.roomName, 'userId:', chat.userId);
                            let userName = 'Unknown User';
                            
                            if (chat.roomName) {
                                // roomNameベースのチャット
                                userName = `Room: ${chat.roomName}`;
                                console.log('Using roomName for userName:', userName);
                            } else if (chat.userId) {
                                // userIdベースのチャット
                                console.log('Fetching user for userId:', chat.userId);
                                const user = await guild.members.fetch(chat.userId).catch(() => null);
                                userName = user?.user.username || 'Unknown User';
                                console.log('Fetched userName:', userName);
                            } else {
                                console.log('No roomName or userId for chat:', chat.chatId);
                            }
                            
                            const staff = await guild.members.fetch(chat.staffId).catch(() => null);
                            const channel = guild.channels.cache.get(chat.channelId);
                            
                            return {
                                ...chat,
                                userName: userName,
                                staffName: staff?.user.username || 'Unknown Staff',
                                channelExists: !!channel
                            };
                        })
                    );                    const updateData = {
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
                if (intervalId) clearInterval(intervalId);
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

    /**
     * チャットのメンバーリストを取得
     */
    async getChatMembers(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { chatId } = req.params;

        try {
            const guild = this.botClient.client.guilds.cache.get(session.guildId);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const { PrivateChatManager } = await import('../../commands/staff/PrivateChatManager.js');
            const memberIds = await PrivateChatManager.getMembers(guild, chatId);

            // メンバー情報を取得
            const members = await Promise.all(
                memberIds.map(async (id) => {
                    const member = await guild.members.fetch(id).catch(() => null);
                    return {
                        id,
                        username: member?.user.username || 'Unknown User',
                        avatar: member?.user.displayAvatarURL() || null
                    };
                })
            );

            res.json({ members });
        } catch (error) {
            console.error('メンバーリスト取得エラー:', error);
            res.status(500).json({ error: 'Failed to fetch members' });
        }
    }

    /**
     * チャットにメンバーを追加
     */
    async addChatMember(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { chatId } = req.params;
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
            await PrivateChatManager.addMember(guild, chatId, userId);

            console.log(`メンバー追加: ${userId} to ${chatId}`);
            res.json({ success: true });
        } catch (error) {
            console.error('メンバー追加エラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to add member';
            res.status(500).json({ error: errorMessage });
        }
    }

    /**
     * チャットからメンバーを削除
     */
    async removeChatMember(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { chatId, userId } = req.params;

        try {
            const guild = this.botClient.client.guilds.cache.get(session.guildId);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const { PrivateChatManager } = await import('../../commands/staff/PrivateChatManager.js');
            await PrivateChatManager.removeMember(guild, chatId, userId);

            console.log(`メンバー削除: ${userId} from ${chatId}`);
            res.json({ success: true });
        } catch (error) {
            console.error('メンバー削除エラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to remove member';
            res.status(500).json({ error: errorMessage });
        }
    }
}
