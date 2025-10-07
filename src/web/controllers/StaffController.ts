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
            const { PrivateChatManager } = await import('../../core/PrivateChatManager.js');
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

            const { PrivateChatManager } = await import('../../core/PrivateChatManager.js');
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

            const { PrivateChatManager } = await import('../../core/PrivateChatManager.js');
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
            const { PrivateChatManager } = await import('../../core/PrivateChatManager.js');
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
        let isFirstUpdate = true;

        try {
            const { PrivateChatManager } = await import('../../core/PrivateChatManager.js');
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
                            if (isFirstUpdate) {
                                console.log('Processing chat:', chat.chatId, 'roomName:', chat.roomName, 'userId:', chat.userId);
                            }
                            let userName = 'Unknown User';
                            
                            if (chat.roomName) {
                                // roomNameベースのチャット
                                userName = `Room: ${chat.roomName}`;
                                if (isFirstUpdate) {
                                    console.log('Using roomName for userName:', userName);
                                }
                            } else if (chat.userId) {
                                // userIdベースのチャット
                                if (isFirstUpdate) {
                                    console.log('Fetching user for userId:', chat.userId);
                                }
                                const user = await guild.members.fetch(chat.userId).catch(() => null);
                                userName = user?.user.username || 'Unknown User';
                                if (isFirstUpdate) {
                                    console.log('Fetched userName:', userName);
                                }
                            } else {
                                if (isFirstUpdate) {
                                    console.log('No roomName or userId for chat:', chat.chatId);
                                }
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
                    isFirstUpdate = false;
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

            const { PrivateChatManager } = await import('../../core/PrivateChatManager.js');
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
        const { userName } = req.body;

        if (!userName) {
            res.status(400).json({ error: 'userName is required' });
            return;
        }

        try {
            const guild = this.botClient.client.guilds.cache.get(session.guildId);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            // ユーザー名からユーザーIDを取得
            const searchName = userName.trim().toLowerCase();
            let member = guild.members.cache.find(m =>
                m.user.username.toLowerCase() === searchName ||
                (m.displayName && m.displayName.toLowerCase() === searchName)
            );

            // キャッシュに見つからない場合は Discord API を使って検索（部分一致）
            if (!member) {
                try {
                    const fetched = await guild.members.fetch({ query: userName, limit: 5 });
                    member = Array.from(fetched.values()).find(m =>
                        m.user.username.toLowerCase() === searchName ||
                        (m.displayName && m.displayName.toLowerCase() === searchName) ||
                        m.user.username.toLowerCase().includes(searchName) ||
                        (m.displayName && m.displayName.toLowerCase().includes(searchName))
                    );
                } catch (fetchErr) {
                    console.warn('guild.members.fetch failed during addChatMember lookup:', fetchErr);
                }
            }

            if (!member) {
                res.status(404).json({ error: 'ユーザーが見つかりません' });
                return;
            }

            const { PrivateChatManager } = await import('../../core/PrivateChatManager.js');
            await PrivateChatManager.addMember(guild, chatId, member.id);

            console.log(`メンバー追加: ${userName} (${member.id}) to ${chatId}`);
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

            const { PrivateChatManager } = await import('../../core/PrivateChatManager.js');
            await PrivateChatManager.removeMember(guild, chatId, userId);

            console.log(`メンバー削除: ${userId} from ${chatId}`);
            res.json({ success: true });
        } catch (error) {
            console.error('メンバー削除エラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to remove member';
            res.status(500).json({ error: errorMessage });
        }
    }

    /**
     * ユーザー検索（部分一致）
     */
    async searchUsers(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { query, chatId } = req.query;

        if (!query || typeof query !== 'string') {
            res.status(400).json({ error: 'query parameter is required' });
            return;
        }

        try {
            const guild = this.botClient.client.guilds.cache.get(session.guildId);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            // 既に追加済みのメンバーを取得（chatIdが指定されている場合）
            let existingMemberIds: string[] = [];
            if (chatId && typeof chatId === 'string') {
                const { PrivateChatManager } = await import('../../core/PrivateChatManager.js');
                existingMemberIds = await PrivateChatManager.getMembers(guild, chatId);
            }

            // ギルドメンバーを検索（REST を使ってサーバー側で検索する）
            // キャッシュに存在しない場合でも Discord API から取得するため、guild.members.fetch を使用する
            const queryStr = (query as string).trim();
            let foundMembers: Array<any> = [];

            try {
                // Discord のメンバー検索（部分一致）。limit は最大 25 件に設定し、後でクライアント側で最大 10 件に制限する
                const fetched = await guild.members.fetch({ query: queryStr, limit: 25 });

                foundMembers = Array.from(fetched.values())
                    .filter(member => !member.user.bot && member.id !== session.userId && !existingMemberIds.includes(member.id))
                    .map(member => ({
                        id: member.id,
                        username: member.user.username,
                        displayName: member.displayName,
                        avatar: member.user.displayAvatarURL() || null
                    }));
            } catch (fetchErr) {
                // fetch が失敗した場合はフォールバックでキャッシュを検索
                console.warn('guild.members.fetch failed, falling back to cache search:', fetchErr);
                foundMembers = guild.members.cache
                    .filter(member =>
                        !member.user.bot && member.id !== session.userId && !existingMemberIds.includes(member.id) &&
                        (member.user.username.toLowerCase().includes(queryStr.toLowerCase()) ||
                         (member.displayName && member.displayName.toLowerCase().includes(queryStr.toLowerCase())))
                    )
                    .map(member => ({
                        id: member.id,
                        username: member.user.username,
                        displayName: member.displayName,
                        avatar: member.user.displayAvatarURL() || null
                    }));
            }

            // クライアントには最大 10 件だけ返す
            res.json({ users: foundMembers.slice(0, 10) });
        } catch (error) {
            console.error('ユーザー検索エラー:', error);
            res.status(500).json({ error: 'Failed to search users' });
        }
    }
}
