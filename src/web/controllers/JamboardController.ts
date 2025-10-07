import { Request, Response } from 'express';
import { JamboardManager, DrawingStroke, TodoItem } from '../../core/JamboardManager.js';
import crypto from 'crypto';
import { BotClient } from '../../core/BotClient.js';
import { GuildSettings, SettingsSession } from '../SettingsServer.js';

// In-memory guild settings store (simple). In production, this should be persisted.
const guildSettingsStore = new Map<string, GuildSettings>();

/**
 * Jamboard コントローラー
 */
export class JamboardController {
    private botClient?: BotClient;

    constructor(botClient?: BotClient) {
        this.botClient = botClient;
    }
    /**
     * ユーザーがスタッフかどうかを確認
     * TODO: 実際のスタッフ判定ロジックに置き換える
     */
    // permission levels: 0=any,1=staff,2=admin,3=owner
    private async permissionLevel(guildId: string, userId: string): Promise<number> {
        // Default permission
        let level = 0;

        // If we don't have a bot client, return default
        if (!this.botClient || !this.botClient.client) {
            return level;
        }

        try {
            // Try to use guild settings if available
            const settings = guildSettingsStore.get(guildId);

            // Fetch guild member via discord.js cache or API
            const guild = this.botClient.client.guilds.cache.get(guildId);
            let member = guild ? guild.members.cache.get(userId) : undefined;

            if (!member && guild) {
                // Try fetching from API
                member = await guild.members.fetch(userId).catch(() => undefined as any);
            }

            // Owner check
            if (guild && guild.ownerId === userId) {
                return 3;
            }

            if (member) {
                // Admin role if member has MANAGE_GUILD or ADMINISTRATOR
                if (member.permissions.has('Administrator') || member.permissions.has('ManageGuild')) {
                    return 2;
                }

                // Role-based staff/admin check using guild settings
                if (settings) {
                    if (settings.adminRoleId && member.roles.cache.has(settings.adminRoleId)) {
                        return 2;
                    }
                    if (settings.staffRoleId && member.roles.cache.has(settings.staffRoleId)) {
                        return 1;
                    }
                }
            }
        } catch (err) {
            console.error('permissionLevel check failed:', err);
        }

        return level;
    }

    /**
     * Jamboard一覧を取得
     */
    async getJamboards(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;

        try {
            const perm = await this.permissionLevel(session.guildId, session.userId);
            const isStaff = perm >= 1;
            const jamboards = await JamboardManager.getAccessibleJamboards(
                session.guildId,
                session.userId,
                isStaff
            );

            res.json({ jamboards });
        } catch (error) {
            console.error('Jamboard一覧取得エラー:', error);
            res.status(500).json({ error: 'Failed to fetch jamboards' });
        }
    }

    /**
     * スタッフJamboardを取得または作成
     */
    async getOrCreateStaffJamboard(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;

        try {
            const perm = await this.permissionLevel(session.guildId, session.userId);
            if (perm < 1) {
                res.status(403).json({ error: 'Staff only' });
                return;
            }

            const jamboard = await JamboardManager.getOrCreateStaffJamboard(session.guildId);
            res.json({ jamboard });
        } catch (error) {
            console.error('スタッフJamboard取得エラー:', error);
            res.status(500).json({ error: 'Failed to get staff jamboard' });
        }
    }

    /**
     * 個人用Jamboardを作成
     */
    async createPersonalJamboard(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { name } = req.body;

        try {
            const jamboard = await JamboardManager.createPersonalJamboard(
                session.guildId,
                session.userId,
                name
            );

            res.json({ jamboard });
        } catch (error) {
            console.error('個人用Jamboard作成エラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to create jamboard';
            res.status(500).json({ error: errorMessage });
        }
    }

    /**
     * Jamboardを取得
     */
    async getJamboard(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { jamboardId } = req.params;

        try {
            let actualJamboardId = jamboardId;
            
            // もし jamboardId が数字のみ（ギルドID形式）の場合、staff jamboard を指している可能性がある
            if (/^\d+$/.test(jamboardId)) {
                actualJamboardId = `staff_${jamboardId}`;
            }

            const jamboard = await JamboardManager.getJamboard(session.guildId, actualJamboardId);
            if (!jamboard) {
                res.status(404).json({ error: 'Jamboard not found' });
                return;
            }

            const perm = await this.permissionLevel(session.guildId, session.userId);
            const canAccess = await JamboardManager.canAccess(
                session.guildId,
                actualJamboardId,
                session.userId,
                perm >= 1
            );

            if (!canAccess) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            res.json({ jamboard });
        } catch (error) {
            console.error('Jamboard取得エラー:', error);
            res.status(500).json({ error: 'Failed to fetch jamboard' });
        }
    }

    /**
     * Jamboardコンテンツを取得
     */
    async getContent(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { jamboardId } = req.params;

        try {
            const perm = await this.permissionLevel(session.guildId, session.userId);
            const canAccess = await JamboardManager.canAccess(
                session.guildId,
                jamboardId,
                session.userId,
                perm >= 1
            );

            if (!canAccess) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const content = await JamboardManager.getContent(session.guildId, jamboardId);
            if (!content) {
                res.status(404).json({ error: 'Content not found' });
                return;
            }

            res.json({ content });
        } catch (error) {
            console.error('コンテンツ取得エラー:', error);
            res.status(500).json({ error: 'Failed to fetch content' });
        }
    }

    /**
     * ストロークを追加
     */
    async addStroke(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { jamboardId } = req.params;
        const { points, color, width, tool } = req.body;

        try {
            const perm = await this.permissionLevel(session.guildId, session.userId);
            const canAccess = await JamboardManager.canAccess(
                session.guildId,
                jamboardId,
                session.userId,
                perm >= 1
            );

            if (!canAccess) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const stroke: DrawingStroke = {
                id: crypto.randomBytes(16).toString('hex'),
                points,
                color,
                width,
                tool,
                timestamp: Date.now()
            };

            await JamboardManager.addStroke(session.guildId, jamboardId, stroke);
            res.json({ success: true, stroke });
        } catch (error) {
            console.error('ストローク追加エラー:', error);
            res.status(500).json({ error: 'Failed to add stroke' });
        }
    }

    /**
     * ストロークを削除
     */
    async removeStroke(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { jamboardId, strokeId } = req.params;

        try {
            const perm = await this.permissionLevel(session.guildId, session.userId);
            const canAccess = await JamboardManager.canAccess(
                session.guildId,
                jamboardId,
                session.userId,
                perm >= 1
            );

            if (!canAccess) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            await JamboardManager.removeStroke(session.guildId, jamboardId, strokeId);
            res.json({ success: true });
        } catch (error) {
            console.error('ストローク削除エラー:', error);
            res.status(500).json({ error: 'Failed to remove stroke' });
        }
    }

    /**
     * Todoを追加
     */
    async addTodo(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { jamboardId } = req.params;
        const { text } = req.body;

        if (!text || typeof text !== 'string') {
            res.status(400).json({ error: 'Invalid todo text' });
            return;
        }

        try {
            const perm = await this.permissionLevel(session.guildId, session.userId);
            const canAccess = await JamboardManager.canAccess(
                session.guildId,
                jamboardId,
                session.userId,
                perm >= 1
            );

            if (!canAccess) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            const todo: TodoItem = {
                id: crypto.randomBytes(16).toString('hex'),
                text,
                completed: false,
                createdBy: session.userId,
                createdAt: Date.now()
            };

            await JamboardManager.addTodo(session.guildId, jamboardId, todo);
            res.json({ success: true, todo });
        } catch (error) {
            console.error('Todo追加エラー:', error);
            res.status(500).json({ error: 'Failed to add todo' });
        }
    }

    /**
     * Todoを更新
     */
    async updateTodo(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { jamboardId, todoId } = req.params;
        const updates = req.body;

        try {
            const perm = await this.permissionLevel(session.guildId, session.userId);
            const canAccess = await JamboardManager.canAccess(
                session.guildId,
                jamboardId,
                session.userId,
                perm >= 1
            );

            if (!canAccess) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            await JamboardManager.updateTodo(session.guildId, jamboardId, todoId, updates);
            res.json({ success: true });
        } catch (error) {
            console.error('Todo更新エラー:', error);
            res.status(500).json({ error: 'Failed to update todo' });
        }
    }

    /**
     * Todoを削除
     */
    async deleteTodo(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { jamboardId, todoId } = req.params;

        try {
            const perm = await this.permissionLevel(session.guildId, session.userId);
            const canAccess = await JamboardManager.canAccess(
                session.guildId,
                jamboardId,
                session.userId,
                perm >= 1
            );

            if (!canAccess) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            await JamboardManager.deleteTodo(session.guildId, jamboardId, todoId);
            res.json({ success: true });
        } catch (error) {
            console.error('Todo削除エラー:', error);
            res.status(500).json({ error: 'Failed to delete todo' });
        }
    }

    /**
     * メンバーを追加
     */
    async addMember(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { jamboardId } = req.params;
        const { userId } = req.body;

        if (!userId) {
            res.status(400).json({ error: 'userId is required' });
            return;
        }

        try {
            const jamboard = await JamboardManager.getJamboard(session.guildId, jamboardId);
            if (!jamboard) {
                res.status(404).json({ error: 'Jamboard not found' });
                return;
            }

            // オーナーのみメンバーを追加できる
            if (jamboard.ownerId !== session.userId) {
                res.status(403).json({ error: 'Only owner can add members' });
                return;
            }

            await JamboardManager.addMember(session.guildId, jamboardId, userId);
            res.json({ success: true });
        } catch (error) {
            console.error('メンバー追加エラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to add member';
            res.status(500).json({ error: errorMessage });
        }
    }

    /**
     * メンバーを削除
     */
    async removeMember(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { jamboardId, userId } = req.params;

        try {
            const jamboard = await JamboardManager.getJamboard(session.guildId, jamboardId);
            if (!jamboard) {
                res.status(404).json({ error: 'Jamboard not found' });
                return;
            }

            // オーナーのみメンバーを削除できる
            if (jamboard.ownerId !== session.userId) {
                res.status(403).json({ error: 'Only owner can remove members' });
                return;
            }

            await JamboardManager.removeMember(session.guildId, jamboardId, userId);
            res.json({ success: true });
        } catch (error) {
            console.error('メンバー削除エラー:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to remove member';
            res.status(500).json({ error: errorMessage });
        }
    }

    /**
     * リアルタイム更新をストリーム（SSE）
     */
    async streamUpdates(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { jamboardId } = req.params;

        try {
            const perm = await this.permissionLevel(session.guildId, session.userId);
            const canAccess = await JamboardManager.canAccess(
                session.guildId,
                jamboardId,
                session.userId,
                perm >= 1
            );

            if (!canAccess) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }

            // SSE ヘッダーを設定
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');

            // 初期データを送信
            const sendUpdate = async () => {
                try {
                    const content = await JamboardManager.getContent(session.guildId, jamboardId);
                    if (content) {
                        res.write(`data: ${JSON.stringify(content)}\n\n`);
                    }
                } catch (error) {
                    console.error('SSE データ送信エラー:', error);
                }
            };

            await sendUpdate();

            // 10秒ごとに更新を送信
            const intervalId = setInterval(sendUpdate, 10000);

            // キープアライブ（30秒ごと）
            const keepAliveId = setInterval(() => {
                res.write(': keepalive\n\n');
            }, 30000);

            // クライアントが切断した場合のクリーンアップ
            req.on('close', () => {
                clearInterval(intervalId);
                clearInterval(keepAliveId);
                console.log(`SSE 接続を閉じました (Jamboard: ${jamboardId})`);
            });

        } catch (error) {
            console.error('SSE ストリーム初期化エラー:', error);
            res.status(500).json({ error: 'Stream initialization failed' });
        }
    }
}
