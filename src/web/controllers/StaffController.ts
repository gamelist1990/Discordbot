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
     * セッションユーザーがアクセス可能なギルド一覧を返す
     */
    async getAccessibleGuilds(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;

        try {
            if (!session) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const botGuilds = this.botClient.getGuildList();

            // Try to read persisted OAuth sessions to get user's access token
            const fs = await import('fs');
            const path = await import('path');
            const authPersistPath = path.join(process.cwd(), 'Data', 'Auth', 'sessions.json');
            let userOauth: any = null;
            try {
                if (fs.existsSync(authPersistPath)) {
                    const raw = fs.readFileSync(authPersistPath, 'utf8') || '{}';
                    const obj = JSON.parse(raw) as Record<string, any>;
                    userOauth = obj[session.userId];
                }
            } catch (e) {
                console.warn('[StaffController.getAccessibleGuilds] Failed to read OAuth sessions from disk:', e);
            }

            let userGuilds: any[] = [];
            if (userOauth && userOauth.accessToken) {
                try {
                    const resp = await fetch('https://discord.com/api/users/@me/guilds', {
                        headers: {
                            Authorization: `Bearer ${userOauth.accessToken}`
                        }
                    });
                    if (resp.ok) {
                        const guilds = await resp.json() as Array<any>;
                        userGuilds = guilds.filter(g => (g.permissions & 0x8) || (g.owner === true));
                    }
                } catch (e) {
                    console.warn('[StaffController.getAccessibleGuilds] Error fetching user guilds:', e);
                }
            }

            const botGuildIds = new Set(botGuilds.map(g => g.id));
            const filtered = userGuilds.filter(g => botGuildIds.has(g.id));

            res.json({ guilds: filtered });
        } catch (error) {
            console.error('getAccessibleGuilds failed:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * プライベートチャット一覧の取得
     */
    async getPrivateChats(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        // allow optional guildId query to fetch a specific guild (only if session has access)
        const queryGuildId = (req.query && (req.query as any).guildId) as string | undefined;
        let targetGuildId = queryGuildId;

        try {
            // Determine target guild from query or session (support guildIds array)
            if (!targetGuildId) {
                targetGuildId = session.guildId;
                if (!targetGuildId && session.guildIds && session.guildIds.length > 0) {
                    targetGuildId = session.guildIds[0];
                }
            } else {
                // if provided, ensure the session has access to this guild
                const allowed = (session.guildIds || []).length === 0 ? (session.guildId === targetGuildId) : (session.guildIds || []).includes(targetGuildId);
                if (!allowed) {
                    res.status(403).json({ error: 'Forbidden: session does not have access to this guild' });
                    return;
                }
            }

            if (!targetGuildId) {
                res.status(400).json({ error: 'Invalid session: missing guild ID' });
                return;
            }

            const { PrivateChatManager } = await import('../../core/PrivateChatManager.js');
            const chats = await PrivateChatManager.getChatsByGuild(targetGuildId);

            // ユーザー情報を付加
            const guild = this.botClient.client.guilds.cache.get(targetGuildId);
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
            // allow optional guildId query to target a specific guild (if session has access)
            const queryGuildId = (req.query && (req.query as any).guildId) as string | undefined;
            let targetGuildId = queryGuildId || session.guildId;
            if (!targetGuildId && session.guildIds && session.guildIds.length > 0) {
                targetGuildId = session.guildIds[0];
            }
            if (!targetGuildId) {
                res.status(400).json({ error: 'Invalid session: missing guild ID' });
                return;
            }
            const allowed = (session.guildIds || []).length === 0 ? (session.guildId === targetGuildId) : (session.guildIds || []).includes(targetGuildId);
            if (!allowed) {
                res.status(403).json({ error: 'Forbidden: session does not have access to this guild' });
                return;
            }

            const guild = this.botClient.client.guilds.cache.get(targetGuildId);
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
            const queryGuildId = (req.query && (req.query as any).guildId) as string | undefined;
            let targetGuildId = queryGuildId || session.guildId;
            if (!targetGuildId && session.guildIds && session.guildIds.length > 0) {
                targetGuildId = session.guildIds[0];
            }
            if (!targetGuildId) {
                res.status(400).json({ error: 'Invalid session: missing guild ID' });
                return;
            }
            const allowed = (session.guildIds || []).length === 0 ? (session.guildId === targetGuildId) : (session.guildIds || []).includes(targetGuildId);
            if (!allowed) {
                res.status(403).json({ error: 'Forbidden: session does not have access to this guild' });
                return;
            }

            const guild = this.botClient.client.guilds.cache.get(targetGuildId);
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
            const queryGuildId = (req.query && (req.query as any).guildId) as string | undefined;
            let targetGuildId = queryGuildId || session.guildId;
            if (!targetGuildId && session.guildIds && session.guildIds.length > 0) {
                targetGuildId = session.guildIds[0];
            }
            if (!targetGuildId) {
                res.status(400).json({ error: 'Invalid session: missing guild ID' });
                return;
            }
            const allowed = (session.guildIds || []).length === 0 ? (session.guildId === targetGuildId) : (session.guildIds || []).includes(targetGuildId);
            if (!allowed) {
                res.status(403).json({ error: 'Forbidden: session does not have access to this guild' });
                return;
            }

            const { PrivateChatManager } = await import('../../core/PrivateChatManager.js');
            const stats = await PrivateChatManager.getStats(targetGuildId);

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
                // Determine target guild: query param overrides session defaults
                const queryGuildId = (req.query && (req.query as any).guildId) as string | undefined;
                let targetGuildId = queryGuildId || session.guildId;
                if (!targetGuildId && session.guildIds && session.guildIds.length > 0) {
                    targetGuildId = session.guildIds[0];
                }

                if (!targetGuildId) {
                    res.write(`data: ${JSON.stringify({ error: 'Invalid session: missing guild ID' })}\n\n`);
                    res.end();
                    return;
                }

                // ensure session has access to the target guild
                const allowed = (session.guildIds || []).length === 0 ? (session.guildId === targetGuildId) : (session.guildIds || []).includes(targetGuildId);
                if (!allowed) {
                    res.write(`data: ${JSON.stringify({ error: 'Forbidden: session does not have access to this guild' })}\n\n`);
                    res.end();
                    return;
                }

            const { PrivateChatManager } = await import('../../core/PrivateChatManager.js');
                const guild = this.botClient.client.guilds.cache.get(targetGuildId as string);

            if (!guild) {
                res.write(`data: ${JSON.stringify({ error: 'Guild not found' })}\n\n`);
                res.end();
                return;
            }

            // 初期データを送信
            const sendUpdate = async () => {
                try {
                        const chats = await PrivateChatManager.getChatsByGuild(targetGuildId!);
                        const stats = await PrivateChatManager.getStats(targetGuildId!);

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

            // PrivateChatEvents の emitter を購読して即時通知を送る
            let eventListener: ((payload: any) => void) | undefined;
            try {
                const { getPrivateChatEmitter } = await import('../../core/PrivateChatEvents.js');
                const emitter = getPrivateChatEmitter();
                eventListener = (payload: any) => {
                    try {
                        // まずは簡易イベント通知を送る（互換性維持）
                        const ev = { type: 'privateChatEvent', timestamp: Date.now(), payload };
                        res.write(`data: ${JSON.stringify(ev)}\n\n`);
                    } catch (err) {
                        console.error('SSE event push failed:', err);
                    }

                    // 直ちに全体更新も送信してクライアント側の一覧を最新化する
                    try {
                        // sendUpdate は外側で定義されているため呼び出す
                        // NOTE: sendUpdate は非同期関数
                        sendUpdate().catch((err) => {
                            console.error('SSE sendUpdate after event failed:', err);
                        });
                    } catch (err) {
                        console.error('Failed to trigger sendUpdate on event:', err);
                    }
                };
                emitter.on('privateChatEvent', eventListener);
            } catch (err) {
                console.error('Failed to subscribe to PrivateChatEvents:', err);
            }

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
                if (eventListener) {
                    try {
                        const { getPrivateChatEmitter } = require('../../core/PrivateChatEvents.js');
                        const emitter = getPrivateChatEmitter();
                        emitter.removeListener('privateChatEvent', eventListener as any);
                    } catch (e) {
                        // require may not be available in ESM or other issues; ignore
                    }
                }
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
            const queryGuildId = (req.query && (req.query as any).guildId) as string | undefined;
            let targetGuildId = queryGuildId || session.guildId;
            if (!targetGuildId && session.guildIds && session.guildIds.length > 0) {
                targetGuildId = session.guildIds[0];
            }
            if (!targetGuildId) {
                res.status(400).json({ error: 'Invalid session: missing guild ID' });
                return;
            }
            const allowed = (session.guildIds || []).length === 0 ? (session.guildId === targetGuildId) : (session.guildIds || []).includes(targetGuildId);
            if (!allowed) {
                res.status(403).json({ error: 'Forbidden: session does not have access to this guild' });
                return;
            }

            const guild = this.botClient.client.guilds.cache.get(targetGuildId);
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
            const queryGuildId = (req.query && (req.query as any).guildId) as string | undefined;
            let targetGuildId = queryGuildId || session.guildId;
            if (!targetGuildId && session.guildIds && session.guildIds.length > 0) {
                targetGuildId = session.guildIds[0];
            }
            if (!targetGuildId) {
                res.status(400).json({ error: 'Invalid session: missing guild ID' });
                return;
            }
            const allowed = (session.guildIds || []).length === 0 ? (session.guildId === targetGuildId) : (session.guildIds || []).includes(targetGuildId);
            if (!allowed) {
                res.status(403).json({ error: 'Forbidden: session does not have access to this guild' });
                return;
            }

            const guild = this.botClient.client.guilds.cache.get(targetGuildId);
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
            const queryGuildId = (req.query && (req.query as any).guildId) as string | undefined;
            let targetGuildId = queryGuildId || session.guildId;
            if (!targetGuildId && session.guildIds && session.guildIds.length > 0) {
                targetGuildId = session.guildIds[0];
            }
            if (!targetGuildId) {
                res.status(400).json({ error: 'Invalid session: missing guild ID' });
                return;
            }
            const allowed = (session.guildIds || []).length === 0 ? (session.guildId === targetGuildId) : (session.guildIds || []).includes(targetGuildId);
            if (!allowed) {
                res.status(403).json({ error: 'Forbidden: session does not have access to this guild' });
                return;
            }

            const guild = this.botClient.client.guilds.cache.get(targetGuildId);
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
            const queryGuildId = (req.query && (req.query as any).guildId) as string | undefined;
            let targetGuildId = queryGuildId || session.guildId;
            if (!targetGuildId && session.guildIds && session.guildIds.length > 0) {
                targetGuildId = session.guildIds[0];
            }
            if (!targetGuildId) {
                res.status(400).json({ error: 'Invalid session: missing guild ID' });
                return;
            }
            const allowed = (session.guildIds || []).length === 0 ? (session.guildId === targetGuildId) : (session.guildIds || []).includes(targetGuildId);
            if (!allowed) {
                res.status(403).json({ error: 'Forbidden: session does not have access to this guild' });
                return;
            }

            const guild = this.botClient.client.guilds.cache.get(targetGuildId);
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

    /**
     * スタッフコマンドの情報を取得
     */
    async getStaffCommands(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;

        try {
            // guildId が直接ない場合は guildIds 配列の最初の要素を使用（後方互換性）
            let targetGuildId = session.guildId;
            if (!targetGuildId && session.guildIds && session.guildIds.length > 0) {
                targetGuildId = session.guildIds[0];
            }

            if (!targetGuildId) {
                res.status(400).json({ error: 'Invalid session: missing guild ID' });
                return;
            }

            // staff コマンドの情報を取得
            const staffCommand = this.botClient.commands.get('staff');
            
            if (!staffCommand || !staffCommand.data) {
                res.status(404).json({ error: 'Staff command not found' });
                return;
            }

            // SlashCommandBuilder から情報を抽出
            const commandData = staffCommand.data.toJSON();
            
            // サブコマンドの情報を整形
            const subcommands = commandData.options?.map((option: any) => {
                if (option.type === 1) { // SUB_COMMAND type
                    return {
                        name: option.name,
                        description: option.description,
                        options: option.options?.map((opt: any) => ({
                            name: opt.name,
                            description: opt.description,
                            type: this.getOptionTypeName(opt.type),
                            required: opt.required || false,
                            choices: opt.choices || []
                        })) || []
                    };
                }
                return null;
            }).filter(Boolean) || [];

            res.json({
                name: commandData.name,
                description: commandData.description,
                subcommands
            });
        } catch (error) {
            console.error('スタッフコマンド情報取得エラー:', error);
            res.status(500).json({ error: 'Failed to fetch staff commands' });
        }
    }

    /**
     * オプションのタイプ番号を名前に変換
     */
    private getOptionTypeName(type: number): string {
        const typeMap: Record<number, string> = {
            3: 'STRING',
            4: 'INTEGER',
            5: 'BOOLEAN',
            6: 'USER',
            7: 'CHANNEL',
            8: 'ROLE',
            9: 'MENTIONABLE',
            10: 'NUMBER'
        };
        return typeMap[type] || 'UNKNOWN';
    }
}
