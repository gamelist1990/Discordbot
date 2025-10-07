import { Router, Request, Response } from 'express';
import { SettingsSession } from '../types/index.js';
import { BotClient } from '../../core/BotClient.js';
import crypto from 'crypto';
import config from '../../config.js';
import { Logger } from '../../utils/Logger.js';

/**
 * OAuth2 state情報
 */
interface OAuth2State {
    guildId: string;
    redirectPath: string;
    createdAt: number;
}

/**
 * 認証ルート
 * Discord OAuth2認証を処理
 */
export function createAuthRoutes(
    sessions: Map<string, SettingsSession>,
    botClient: BotClient
): Router {
    const router = Router();
    
    // OAuth2 state管理
    const states = new Map<string, OAuth2State>();
    
    // 期限切れstateのクリーンアップ（10分ごと）
    setInterval(() => {
        const now = Date.now();
        const maxAge = 10 * 60 * 1000; // 10分
        for (const [state, data] of states.entries()) {
            if (now - data.createdAt > maxAge) {
                states.delete(state);
            }
        }
    }, 10 * 60 * 1000);

    /**
     * 現在のセッション情報を取得
     */
    router.get('/session', async (req: Request, res: Response) => {
        try {
            // Ensure the session endpoint responses are not cached by browsers/proxies
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
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
                    username: session.username || session.userId,
                    // permission: 0=any,1=staff,2=admin,3=owner
                    permission: typeof session.permission === 'number' ? session.permission : 0
                }
            });
        } catch (error) {
            console.error('Session check error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * Discord OAuth2認証開始
     */
    router.get('/discord', async (req: Request, res: Response) => {
        try {
            const redirectPath = req.query.redirect as string || '/jamboard';
            const guildId = req.query.guildId as string || 'default';
            
            // 環境変数または設定からOAuth2情報を取得
            const clientId = botClient.getClientId();
            const baseUrl = config.BASE_URL;
            const redirectUri = `${baseUrl}/api/auth/callback`;
            Logger.info(`[OAuth] initiating Discord auth - baseUrl=${baseUrl} redirect_uri=${redirectUri}`);
            
            // stateを生成
            const state = crypto.randomBytes(16).toString('hex');
            states.set(state, {
                guildId,
                redirectPath,
                createdAt: Date.now()
            });

            // Discord OAuth2 URLを生成
            const params = new URLSearchParams({
                client_id: clientId,
                redirect_uri: redirectUri,
                response_type: 'code',
                scope: 'identify guilds',
                state: state
            });

            const authUrl = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
            
            // リダイレクト
            res.redirect(authUrl);
        } catch (error) {
            console.error('Discord OAuth2 error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * OAuth2コールバック
     */
    router.get('/callback', async (req: Request, res: Response) => {
        try {
            const code = req.query.code as string;
            const state = req.query.state as string;
            
            if (!code || !state) {
                res.status(400).send('Invalid callback parameters');
                return;
            }

            // stateを検証
            const stateData = states.get(state);
            if (!stateData) {
                res.status(400).send('Invalid or expired state');
                return;
            }
            
            // stateを削除（使い捨て）
            states.delete(state);

            // 環境変数から設定を取得
            const clientId = botClient.getClientId();
            const clientSecret = config.DISCORD_CLIENT_SECRET;
            const baseUrl = config.BASE_URL;
            const redirectUri = `${baseUrl}/api/auth/callback`;
            Logger.info(`[OAuth] callback received - expected redirect_uri=${redirectUri}`);
            
            if (!clientSecret) {
                console.error('DISCORD_CLIENT_SECRET not configured');
                res.status(500).send('Server configuration error');
                return;
            }

            // アクセストークンを取得
            const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: redirectUri
                })
            });

            if (!tokenResponse.ok) {
                const errorText = await tokenResponse.text();
                console.error('Token exchange failed:', tokenResponse.status, errorText);
                res.status(500).send('Authentication failed');
                return;
            }

            const tokenData = await tokenResponse.json() as any;

            // ユーザー情報を取得
            const userResponse = await fetch('https://discord.com/api/users/@me', {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`
                }
            });

            if (!userResponse.ok) {
                console.error('Failed to fetch user info');
                res.status(500).send('Failed to fetch user info');
                return;
            }

            const userData = await userResponse.json() as any;

            // Determine username (username#discriminator)
            const username = userData.username && userData.discriminator ? `${userData.username}#${userData.discriminator}` : userData.username || userData.id;

            // TODO: determine permission level properly using guild roles/members; default to 0
            const defaultPermission = 0;

            // セッションを作成
            const sessionId = crypto.randomBytes(32).toString('hex');
            const session: SettingsSession = {
                token: sessionId,
                userId: userData.id,
                guildId: stateData.guildId,
                username,
                permission: defaultPermission,
                createdAt: Date.now(),
                expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24時間
            };

            sessions.set(sessionId, session);

            // クッキーを設定してリダイレクト
            res.cookie('sessionId', sessionId, {
                httpOnly: true,
                secure: config.NODE_ENV === 'production',
                maxAge: 24 * 60 * 60 * 1000, // 24時間
                sameSite: 'lax'
            });

            // 元のページにリダイレクト
            res.redirect(stateData.redirectPath);
        } catch (error) {
            console.error('OAuth2 callback error:', error);
            res.status(500).send('Authentication failed');
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
