import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { Logger } from '../utils/Logger.js';
import { BotClient } from '../core/BotClient.js';
import { SessionService } from './services/SessionService.js';
import { createStatusRoutes, createSessionRoutes, createSettingsRoutes, createStaffRoutes } from './routes/index.js';

// 型定義を型として再エクスポート（実行時には存在しないため type を使用）
export type { SettingsSession, GuildSettings } from './types/index.js';

/**
 * 設定画面用Webサーバー（モジュール構造）
 * 
 * アーキテクチャ:
 * - routes/: ルート定義
 * - controllers/: ビジネスロジック
 * - middleware/: 認証・検証
 * - services/: セッション管理
 * - types/: 型定義
 */
export class SettingsServer {
    private app: Express;
    private port: number;
    private sessionService: SessionService;
    private botClient: BotClient;
    private server: any;

    constructor(botClient: BotClient, port: number = 3000) {
        this.app = express();
        this.port = port;
        this.sessionService = new SessionService();
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
    }

    /**
     * ルートの設定（モジュール化）
     */
    private setupRoutes(): void {
        const sessions = this.sessionService.getSessions();

        // APIルートをモジュールから読み込み（静的ファイルより先に定義）
        this.app.use('/api', createStatusRoutes(this.botClient));
        this.app.use('/api', createSessionRoutes(sessions, this.botClient));
        this.app.use('/api', createSettingsRoutes(sessions));
        this.app.use('/api/staff', createStaffRoutes(sessions, this.botClient));

        // 静的ファイルの配信
        this.app.use(express.static(path.join(__dirname, '..', '..', 'dist', 'web')));

        // SPAのフォールバック（すべての非APIルートをindex.htmlにリダイレクト）
        this.app.get('*', (_req: Request, res: Response) => {
            const indexPath = path.join(__dirname, '..', '..', 'dist', 'web', 'index.html');
            res.sendFile(indexPath);
        });
    }

    /**
     * サーバーの起動
     */
    public async start(): Promise<void> {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.port, () => {
                Logger.info(`Webサーバーをポート ${this.port} で起動しました`);
                resolve();
            });
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

    /**
     * セッションの作成（後方互換性のため）
     */
    public createSession(guildId: string, userId: string): string {
        return this.sessionService.createSession(guildId, userId);
    }
}
