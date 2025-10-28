import { Router, Request, Response } from 'express';
import { BotClient } from '../../core/BotClient.js';
import { SettingsSession } from '../types/index.js';

/**
 * Tool ページ用ルート
 * OAuth認証が必須のツールページを管理
 */
export function createToolRoutes(
    sessions: Map<string, SettingsSession>,
    _botClient: BotClient
): Router {
    const router = Router();

    /**
     * 認証ミドルウェア（Tool ページ用）
     * OAuth ログインが必須
     */
    const requireAuth = (req: Request, res: Response, next: Function) => {
        const sessionId = req.cookies?.sessionId;

        if (!sessionId) {
            res.status(401).json({ 
                error: 'Unauthorized',
                requiresAuth: true,
                message: 'OAuth ログインが必須です' 
            });
            return;
        }

        const session = sessions.get(sessionId);
        if (!session || Date.now() > session.expiresAt) {
            if (session) {
                sessions.delete(sessionId);
            }
            res.status(401).json({ 
                error: 'Session expired',
                requiresAuth: true,
                message: 'セッションの有効期限が切れました' 
            });
            return;
        }

        (req as any).session = session;
        next();
    };

    /**
     * Tool ページが利用可能か確認
     */
    router.get('/available', requireAuth, async (req: Request, res: Response) => {
        try {
            const session = (req as any).session as SettingsSession;
            res.json({
                available: true,
                user: {
                    userId: session.userId,
                    username: session.username || session.userId,
                    avatar: (session as any).avatar || null
                }
            });
        } catch (error) {
            console.error('Tool availability check error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * Minecraft Skin - プリセット読み込み
     * クライアント側で Cookie から読み込むが、バックエンドでもキャッシュ可能
     */
    router.get('/minecraft/presets', requireAuth, async (_req: Request, res: Response) => {
        try {
            // クッキー経由でプリセットが送られてくるため、バックエンドではクライアント保存を前提に応答
            res.json({
                presetsFromClient: true,
                message: 'プリセットはブラウザクッキーで管理されます'
            });
        } catch (error) {
            console.error('Presets fetch error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * Minecraft Skin - プリセット保存（オプション: バックエンドサーバー側でも保存）
     */
    router.post('/minecraft/presets/save', requireAuth, async (req: Request, res: Response) => {
        try {
            const { preset } = req.body;

            if (!preset || !preset.name) {
                res.status(400).json({ error: 'Invalid preset format' });
                return;
            }

            // TODO: バックエンドでもプリセット保存したい場合はここで Database に保存
            // const database = await import('../../core/Database.js').then(m => m.database);
            // database.set(_session.userId, `tools/minecraft/presets/${preset.name}`, preset);

            res.json({
                success: true,
                message: 'プリセットが保存されました',
                preset
            });
        } catch (error) {
            console.error('Preset save error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * プリセット共有リンク生成
     */
    router.post('/minecraft/share', requireAuth, async (req: Request, res: Response) => {
        try {
            const { presetData } = req.body;

            if (!presetData) {
                res.status(400).json({ error: 'No preset data provided' });
                return;
            }

            // プリセットデータを Base64 でエンコード
            const encoded = Buffer.from(JSON.stringify(presetData)).toString('base64');
            const shareUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/tools/minecraft?preset=${encoded}`;

            res.json({
                success: true,
                shareUrl,
                message: 'シェアリンクが生成されました'
            });
        } catch (error) {
            console.error('Share generation error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}
