// MaxListenersExceededWarning を非表示にする
process.on('warning', (warning) => {
    if (warning.name === 'MaxListenersExceededWarning') return;
    console.warn(warning);
});
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { Logger } from '../utils/Logger.js';
import { BotClient } from '../core/BotClient.js';
import { SessionService } from './services/SessionService.js';
import { createStatusRoutes, createSessionRoutes, createSettingsRoutes, createStaffRoutes, createAuthRoutes, createTodoRoutes, createUserRoutes, createModRoutes, createFeedbackRoutes, createRolePresetRoutes } from './routes/index.js';
import { createGuildRoutes } from './routes/guild.js';
import { setupWebSocketServer } from './routes/websocket.js';
import { previewHandler } from './preview/PreviewController.js';
// 開発時に Vite dev server へプロキシするためのミドルウェア（optional）
import { statsManagerSingleton } from '../core/StatsManager.js';
import { TodoManager } from '../core/TodoManager.js';
// config.json を読み込む

// 型定義を型として再エクスポート（実行時には存在しないため type を使用）

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
        // Disable ETag generation for API responses to avoid 304 cached responses
        this.app.disable('etag');
        this.port = port;
        this.sessionService = new SessionService();
        this.botClient = botClient;

        this.setupMiddleware();
        this.setupRoutes();
        // Initialize StatsManager if bot client is available
        try {
            statsManagerSingleton.init(this.botClient.client);
        } catch (e) {
            Logger.warn('Failed to init StatsManager:', e);
        }

        // 定期的に期限切れの共有エディターをクリーンアップ
        setInterval(() => {
            TodoManager.cleanupExpiredSharedEditors().catch(err => {
                console.error('Failed to cleanup expired shared editors:', err);
            });
        }, 60 * 1000); // 1分ごとにチェック
    }

    /**
     * ミドルウェアの設定
     */
    private setupMiddleware(): void {
        this.app.use(cors({
            credentials: true,
            origin: true
        }));
        this.app.use(express.json());

        // Cookie parser (簡易実装)
        this.app.use((req, res, next) => {
            req.cookies = {};
            const cookieHeader = req.headers.cookie;
            if (cookieHeader) {
                cookieHeader.split(';').forEach(cookie => {
                    const [name, value] = cookie.trim().split('=');
                    req.cookies[name] = value;
                });
            }

            // res.cookie() ヘルパーを追加
            res.cookie = function (name: string, value: string, options: any = {}) {
                let cookie = `${name}=${value}`;

                if (options.maxAge) {
                    cookie += `; Max-Age=${Math.floor(options.maxAge / 1000)}`;
                }
                if (options.httpOnly) {
                    cookie += '; HttpOnly';
                }
                if (options.secure) {
                    cookie += '; Secure';
                }
                if (options.sameSite) {
                    cookie += `; SameSite=${options.sameSite}`;
                }
                if (options.path) {
                    cookie += `; Path=${options.path}`;
                } else {
                    cookie += '; Path=/';
                }

                res.setHeader('Set-Cookie', cookie);
                return res;
            };

            // res.clearCookie() ヘルパーを追加
            res.clearCookie = function (name: string) {
                res.setHeader('Set-Cookie', `${name}=; Path=/; Max-Age=0`);
                return res;
            };

            next();
        });
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
        this.app.use('/api/staff', createRolePresetRoutes(sessions, this.botClient));
        this.app.use('/api', createTodoRoutes(sessions, this.botClient));
        this.app.use('/api/auth', createAuthRoutes(sessions, this.botClient));
        this.app.use('/api/user', createUserRoutes(sessions, this.botClient));
        this.app.use('/api/guilds', createModRoutes(sessions, this.botClient));
        this.app.use('/api', createGuildRoutes(sessions, this.botClient));
        this.app.use('/api', createFeedbackRoutes(sessions));

    // Temporary debug route to inspect StatsManager buffer
        this.app.get('/__debug/stats-buffer', (_req, res) => {
            try {
                const s = statsManagerSingleton.instance as any;
                if (!s) return res.status(200).json({ buffer: null });
                const buf: Record<string, Record<string, any>> = {};
                for (const [g, m] of s['buffer'].entries()) {
                    buf[g] = {};
                    for (const [u, c] of m.entries()) {
                        buf[g][u] = c;
                    }
                }
                res.json({ buffer: buf });
            } catch (e) {
                res.status(500).json({ error: 'debug failed' });
            }
        });

    // Generic preview handler (mount before static files so crawlers see OG meta)
    // The handler consults a registry populated by modules (e.g., feedback route registers itself).
    // Use a RegExp for the preview path to avoid path-to-regexp parameter parsing issues.
    // Express supports regex paths; this avoids version-specific parameter syntax.
    this.app.get(['/feedback', '/feedback/:id', /^\/preview\/.*$/], previewHandler as any);

        // 静的ファイルの配信
        this.app.use(express.static(path.join(__dirname, '..', '..', 'dist', 'web')));

        // SPAのフォールバック（GETかつ/apiで始まらないリクエストに対してindex.htmlを返す）
        // path-to-regexp のバージョン差による '*' パースエラーを回避するため、
        // 明示的にメソッドとパスをチェックするミドルウェアを使います。
        this.app.use((req: Request, res: Response, next) => {
            // DEBUG: ブラウザから来たリクエストのURL（クエリ含む）をログ出力して、
            // クライアントが送った query string がサーバに届いているか確認する
            // 一時的なログなので調査完了後は削除してOK
            Logger.info(`[SPA Fallback] incoming request: ${req.originalUrl}`);
            // APIルートは次へ
            if (req.path.startsWith('/api')) return next();

            // GETのみをSPAフォールバックとして扱う
            if (req.method !== 'GET') return next();

            const indexPath = path.join(__dirname, '..', '..', 'dist', 'web', 'index.html');
            res.sendFile(indexPath, (err) => {
                if (err) next(err);
            });
        });

    }

    /**
     * サーバーの起動
     */
    public async start(): Promise<void> {
        return new Promise((resolve) => {
            // 明示的に 0.0.0.0 にバインドして外部からアクセス可能にする
            this.server = this.app.listen(this.port, '0.0.0.0', () => {
                Logger.info(`Webサーバーをポート ${this.port} で起動しました (bound to 0.0.0.0)`);
                
                // WebSocketサーバーをセットアップ
                try {
                    setupWebSocketServer(this.server, this.sessionService.getSessions());
                    Logger.info('WebSocketサーバーを起動しました (path: /ws/feedback)');
                } catch (error) {
                    Logger.error('WebSocketサーバーの起動に失敗しました:', error);
                }
                
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
