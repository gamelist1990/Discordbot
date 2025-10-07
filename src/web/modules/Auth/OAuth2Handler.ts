import { Request, Response } from 'express';
import crypto from 'crypto';

/**
 * Discord OAuth2 認証情報
 */
interface DiscordOAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

/**
 * OAuth2 セッション情報
 */
interface OAuth2Session {
    userId: string;
    guildId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
}

/**
 * Discord OAuth2 ハンドラー
 */
export class OAuth2Handler {
    private config: DiscordOAuthConfig;
    private sessions: Map<string, OAuth2Session>;
    private states: Map<string, { guildId: string; createdAt: number }>;

    constructor(config: DiscordOAuthConfig) {
        this.config = config;
        this.sessions = new Map();
        this.states = new Map();

        // 期限切れのstateを定期的にクリーンアップ
        setInterval(() => this.cleanupExpiredStates(), 60000); // 1分ごと
    }

    /**
     * OAuth2 認証URLを生成
     */
    generateAuthUrl(guildId: string): string {
        const state = crypto.randomBytes(16).toString('hex');
        
        // stateを保存（10分間有効）
        this.states.set(state, {
            guildId,
            createdAt: Date.now()
        });

        const params = new URLSearchParams({
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            response_type: 'code',
            scope: 'identify guilds',
            state: state
        });

        return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
    }

    /**
     * OAuth2 コールバック処理
     */
    async handleCallback(req: Request, res: Response): Promise<void> {
        const { code, state } = req.query;

        if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
            res.status(400).json({ error: 'Invalid callback parameters' });
            return;
        }

        // stateを検証
        const stateData = this.states.get(state);
        if (!stateData) {
            res.status(400).json({ error: 'Invalid or expired state' });
            return;
        }

        // stateを削除（使い捨て）
        this.states.delete(state);

        try {
            // アクセストークンを取得
            const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret,
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: this.config.redirectUri
                })
            });

            if (!tokenResponse.ok) {
                throw new Error(`Token exchange failed: ${tokenResponse.status}`);
            }

            const tokenData = await tokenResponse.json() as any;

            // ユーザー情報を取得
            const userResponse = await fetch('https://discord.com/api/users/@me', {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`
                }
            });

            if (!userResponse.ok) {
                throw new Error('Failed to fetch user info');
            }

            const userData = await userResponse.json() as any;

            // セッションを作成
            const sessionToken = crypto.randomBytes(32).toString('hex');
            const session: OAuth2Session = {
                userId: userData.id,
                guildId: stateData.guildId,
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: Date.now() + (tokenData.expires_in * 1000),
                scopes: tokenData.scope.split(' ')
            };

            this.sessions.set(sessionToken, session);

            // セッショントークンをクライアントに返す
            res.json({
                success: true,
                sessionToken,
                userId: userData.id,
                username: userData.username
            });
        } catch (error) {
            console.error('OAuth2 callback error:', error);
            res.status(500).json({ error: 'Authentication failed' });
        }
    }

    /**
     * セッションを検証
     */
    validateSession(token: string): OAuth2Session | null {
        const session = this.sessions.get(token);
        
        if (!session) {
            return null;
        }

        // 有効期限をチェック
        if (Date.now() > session.expiresAt) {
            this.sessions.delete(token);
            return null;
        }

        return session;
    }

    /**
     * セッションを削除
     */
    revokeSession(token: string): boolean {
        return this.sessions.delete(token);
    }

    /**
     * 期限切れのstateをクリーンアップ
     */
    private cleanupExpiredStates(): void {
        const now = Date.now();
        const maxAge = 10 * 60 * 1000; // 10分

        for (const [state, data] of this.states.entries()) {
            if (now - data.createdAt > maxAge) {
                this.states.delete(state);
            }
        }
    }
}
