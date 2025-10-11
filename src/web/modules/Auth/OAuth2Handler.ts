import { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

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
    private persistPath: string;

    constructor(config: DiscordOAuthConfig) {
        this.config = config;
        this.sessions = new Map();
        this.states = new Map();
        this.persistPath = path.join(process.cwd(), 'Data', 'Auth', 'sessions.json');

        // Load persisted sessions from disk
        this.loadFromDisk();

        // 期限切れのstateを定期的にクリーンアップ
        setInterval(() => this.cleanupExpiredStates(), 60000); // 1分ごと
        // Periodically cleanup expired sessions (and try refresh)
        setInterval(() => this.cleanupAndRefreshSessions(), 60 * 1000);
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

            // セッションを作成して永続化
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
            try {
                this.saveToDisk();
            } catch (e) {
                // ignore
            }

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
    // Make async because refreshSession is async
    async validateSession(token: string): Promise<OAuth2Session | null> {
        const session = this.sessions.get(token);

        if (!session) return null;

        // 有効期限をチェック。期限切れならリフレッシュを試みる
        if (Date.now() > session.expiresAt) {
            try {
                const refreshed = await this.refreshSession(session);
                if (refreshed) {
                    try { this.saveToDisk(); } catch (e) {}
                    return this.sessions.get(token) || null;
                }
            } catch (e) {
                // ignore
            }

            // リフレッシュ失敗または無効なら削除
            this.sessions.delete(token);
            try { this.saveToDisk(); } catch (e) {}
            return null;
        }

        return session;
    }

    /**
     * セッションを削除
     */
    revokeSession(token: string): boolean {
        const res = this.sessions.delete(token);
        try { this.saveToDisk(); } catch (e) {}
        return res;
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

    // Periodic cleanup for sessions: try to refresh if expired, otherwise remove
    private async cleanupAndRefreshSessions(): Promise<void> {
        const now = Date.now();
        for (const [token, session] of Array.from(this.sessions.entries())) {
            if (now > session.expiresAt) {
                try {
                    const refreshed = await this.refreshSession(session);
                    if (!refreshed) {
                        this.sessions.delete(token);
                    }
                } catch (e) {
                    this.sessions.delete(token);
                }
            }
        }
        try { this.saveToDisk(); } catch (e) {}
    }

    // Try to refresh a session using refresh token. Returns true if refreshed.
    private async refreshSession(session: OAuth2Session): Promise<boolean> {
        if (!session.refreshToken) return false;

        try {
            const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret,
                    grant_type: 'refresh_token',
                    refresh_token: session.refreshToken,
                    redirect_uri: this.config.redirectUri
                })
            });

            if (!tokenResponse.ok) return false;

            const tokenData = await tokenResponse.json() as any;

            session.accessToken = tokenData.access_token;
            if (tokenData.refresh_token) session.refreshToken = tokenData.refresh_token;
            session.expiresAt = Date.now() + (tokenData.expires_in * 1000);
            session.scopes = tokenData.scope ? tokenData.scope.split(' ') : session.scopes;

            return true;
        } catch (err) {
            console.error('Failed to refresh OAuth2 session:', err);
            return false;
        }
    }

    // Persist sessions to disk
    private loadFromDisk(): void {
        try {
            if (!fs.existsSync(this.persistPath)) return;
            const raw = fs.readFileSync(this.persistPath, 'utf8');
            if (!raw) return;
            const obj = JSON.parse(raw) as Record<string, OAuth2Session>;
            for (const k of Object.keys(obj)) {
                this.sessions.set(k, obj[k]);
            }
        } catch (err) {
            console.error('Failed to load OAuth2 sessions from disk:', err);
        }
    }

    private saveToDisk(): void {
        try {
            const dir = path.dirname(this.persistPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const obj: Record<string, OAuth2Session> = Object.fromEntries(this.sessions as any);
            fs.writeFileSync(this.persistPath, JSON.stringify(obj, null, 2), 'utf8');
        } catch (err) {
            console.error('Failed to save OAuth2 sessions to disk:', err);
        }
    }
}
