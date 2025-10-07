import { Router, Request, Response } from 'express';
import { SettingsSession } from '../types/index.js';

/**
 * 認証ルート
 * Discord OAuth2認証を処理
 */
export function createAuthRoutes(
    sessions: Map<string, SettingsSession>
): Router {
    const router = Router();

    /**
     * 現在のセッション情報を取得
     */
    router.get('/session', async (req: Request, res: Response) => {
        try {
            const sessionId = req.cookies?.sessionId;
            
            if (!sessionId) {
                res.status(401).json({ authenticated: false });
                return;
            }

            const session = sessions.get(sessionId);
            
            if (!session || Date.now() > session.expiresAt) {
                if (session) {
                    sessions.delete(sessionId);
                }
                res.status(401).json({ authenticated: false });
                return;
            }

            res.json({
                authenticated: true,
                user: {
                    userId: session.userId,
                    guildId: session.guildId,
                    isStaff: true // TODO: 実際の権限チェック
                }
            });
        } catch (error) {
            console.error('Session check error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * Discord OAuth2認証開始
     * TODO: 実際のOAuth2フローを実装
     */
    router.get('/discord', async (req: Request, res: Response) => {
        try {
            const redirectPath = req.query.redirect as string || '/jamboard';
            
            // TODO: 実際のDiscord OAuth2フローを実装
            // 現在は簡易的なエラーメッセージを返す
            res.status(501).json({
                error: 'OAuth2 flow not yet implemented',
                message: 'Discord OAuth2認証は現在開発中です。',
                redirectPath
            });
        } catch (error) {
            console.error('Discord OAuth2 error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * OAuth2コールバック
     * TODO: 実装
     */
    router.get('/callback', async (req: Request, res: Response) => {
        try {
            const code = req.query.code as string;
            const state = req.query.state as string;
            
            if (!code || !state) {
                res.status(400).json({ error: 'Invalid callback parameters' });
                return;
            }

            // TODO: Discord OAuth2トークン交換とセッション作成
            res.status(501).json({
                error: 'OAuth2 callback not yet implemented'
            });
        } catch (error) {
            console.error('OAuth2 callback error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * ログアウト
     */
    router.post('/logout', async (req: Request, res: Response) => {
        try {
            const sessionId = req.cookies?.sessionId;
            
            if (sessionId) {
                sessions.delete(sessionId);
            }

            res.clearCookie('sessionId');
            res.json({ success: true });
        } catch (error) {
            console.error('Logout error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}
