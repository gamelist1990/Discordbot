import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { randomUUID } from 'crypto';
import { Logger } from '../utils/Logger.js';
import { BotClient } from '../core/BotClient.js';
import { database } from '../core/Database.js';
import { statusManager } from '../utils/StatusManager.js';

/**
 * 設定セッション情報
 */
export interface SettingsSession {
    token: string;
    guildId: string;
    userId: string;
    createdAt: number;
    expiresAt: number;
}

/**
 * 設定データ
 */
export interface GuildSettings {
    guildId: string;
    staffRoleId?: string;
    adminRoleId?: string;
    updatedAt: number;
}

/**
 * 設定画面用Webサーバー
 */
export class SettingsServer {
    private app: Express;
    private port: number;
    private sessions: Map<string, SettingsSession>;
    private botClient: BotClient;
    private server: any;

    constructor(botClient: BotClient, port: number = 3000) {
        this.app = express();
        this.port = port;
        this.sessions = new Map();
        this.botClient = botClient;

        this.setupMiddleware();
        this.setupRoutes();
    }

    /**
     * ミドルウェアの設定
     */
    private setupMiddleware(): void {
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '..', '..', 'dist', 'web')));
    }

    /**
     * ルートの設定
     */
    private setupRoutes(): void {
        // Bot ステータスの取得（認証不要）
        this.app.get('/api/status', this.handleGetStatus.bind(this));

        // 設定画面のトークン検証
        this.app.get('/api/validate/:token', this.handleValidateToken.bind(this));

        // ギルド情報の取得
        this.app.get('/api/guild/:token', this.handleGetGuild.bind(this));

        // 設定の取得
        this.app.get('/api/settings/:token', this.handleGetSettings.bind(this));

        // 設定の保存
        this.app.post('/api/settings/:token', this.handleSaveSettings.bind(this));

        // SPAのフォールバック（すべての非APIルートをindex.htmlにリダイレクト）
        this.app.use((_req: Request, res: Response) => {
            const indexPath = path.join(__dirname, '..', '..', 'dist', 'web', 'index.html');
            res.sendFile(indexPath);
        });
    }

    /**
     * Bot ステータスの取得
     */
    private async handleGetStatus(_req: Request, res: Response): Promise<void> {
        try {
            const status = statusManager.getStatus();
            const guildCount = this.botClient.getGuildCount();
            const maxGuilds = this.botClient.getMaxGuilds();

            res.json({
                ...status,
                guildCount,
                maxGuilds,
                uptimeFormatted: this.formatUptime(status.uptime),
            });
        } catch (error) {
            Logger.error('ステータス取得エラー:', error);
            res.status(500).json({ error: 'Failed to fetch status' });
        }
    }

    /**
     * アップタイムをフォーマット
     */
    private formatUptime(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}日 ${hours % 24}時間 ${minutes % 60}分`;
        } else if (hours > 0) {
            return `${hours}時間 ${minutes % 60}分`;
        } else if (minutes > 0) {
            return `${minutes}分 ${seconds % 60}秒`;
        } else {
            return `${seconds}秒`;
        }
    }

    /**
     * トークンの検証
     */
    private async handleValidateToken(req: Request, res: Response): Promise<void> {
        const { token } = req.params;

        const session = this.sessions.get(token);
        if (!session) {
            res.status(404).json({ valid: false, error: 'Session not found' });
            return;
        }

        if (Date.now() > session.expiresAt) {
            this.sessions.delete(token);
            res.status(401).json({ valid: false, error: 'Session expired' });
            return;
        }

        res.json({ valid: true, guildId: session.guildId, userId: session.userId });
    }

    /**
     * ギルド情報の取得
     */
    private async handleGetGuild(req: Request, res: Response): Promise<void> {
        const { token } = req.params;

        const session = this.sessions.get(token);
        if (!session || Date.now() > session.expiresAt) {
            res.status(401).json({ error: 'Invalid or expired session' });
            return;
        }

        try {
            const guild = await this.botClient.client.guilds.fetch(session.guildId);
            const roles = await guild.roles.fetch();

            res.json({
                id: guild.id,
                name: guild.name,
                iconURL: guild.iconURL(),
                roles: roles.map(role => ({
                    id: role.id,
                    name: role.name,
                    color: role.color,
                    position: role.position,
                })).filter(r => r.id !== guild.id) // @everyone を除外
            });
        } catch (error) {
            Logger.error('ギルド情報の取得に失敗:', error);
            res.status(500).json({ error: 'Failed to fetch guild information' });
        }
    }

    /**
     * 設定の取得
     */
    private async handleGetSettings(req: Request, res: Response): Promise<void> {
        const { token } = req.params;

        const session = this.sessions.get(token);
        if (!session || Date.now() > session.expiresAt) {
            res.status(401).json({ error: 'Invalid or expired session' });
            return;
        }

        try {
            const settings = await database.get<GuildSettings>(`guild_settings_${session.guildId}`);

            res.json(settings || {
                guildId: session.guildId,
                staffRoleId: null,
                adminRoleId: null,
                updatedAt: Date.now(),
            });
        } catch (error) {
            Logger.error('設定の取得に失敗:', error);
            res.status(500).json({ error: 'Failed to fetch settings' });
        }
    }

    /**
     * 設定の保存
     */
    private async handleSaveSettings(req: Request, res: Response): Promise<void> {
        const { token } = req.params;
        const { staffRoleId, adminRoleId } = req.body;

        const session = this.sessions.get(token);
        if (!session || Date.now() > session.expiresAt) {
            res.status(401).json({ error: 'Invalid or expired session' });
            return;
        }

        try {
            const settings: GuildSettings = {
                guildId: session.guildId,
                staffRoleId: staffRoleId || undefined,
                adminRoleId: adminRoleId || undefined,
                updatedAt: Date.now(),
            };

            await database.set(`guild_settings_${session.guildId}`, settings);

            Logger.info(`設定を保存しました: Guild=${session.guildId}, Staff=${staffRoleId}, Admin=${adminRoleId}`);
            res.json({ success: true });
        } catch (error) {
            Logger.error('設定の保存に失敗:', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    }

    /**
     * セッションの作成
     */
    public createSession(guildId: string, userId: string): string {
        const token = randomUUID();
        const expiresIn = 30 * 60 * 1000; // 30分

        const session: SettingsSession = {
            token,
            guildId,
            userId,
            createdAt: Date.now(),
            expiresAt: Date.now() + expiresIn,
        };

        this.sessions.set(token, session);

        // 期限切れセッションの自動削除
        setTimeout(() => {
            this.sessions.delete(token);
            Logger.debug(`セッションが期限切れになりました: ${token}`);
        }, expiresIn);

        Logger.info(`新しいセッションを作成しました: Token=${token}, Guild=${guildId}, User=${userId}`);
        return token;
    }

    /**
     * サーバーの起動
     */
    public async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(this.port, () => {
                    Logger.info(`🌐 設定サーバーが起動しました: http://localhost:${this.port}`);
                    resolve();
                });

                this.server.on('error', (error: Error) => {
                    Logger.error('設定サーバーの起動に失敗:', error);
                    reject(error);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * サーバーの停止
     */
    public async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    Logger.info('設定サーバーを停止しました');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}
