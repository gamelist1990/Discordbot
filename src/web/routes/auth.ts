import { Router, Request, Response } from 'express';
import { BotClient } from '../../core/BotClient.js';
import crypto from 'crypto';
import config from '../../config.js';
// import { Logger } from '../../utils/Logger.js';
import { SettingsSession } from '../types';
import { database } from '../../core/Database.js';
import fs from 'fs';
import path from 'path';

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

    // Persisted OAuth sessions (Data/Auth/sessions.json)
    const authPersistPath = path.join(process.cwd(), 'Data', 'Auth', 'sessions.json');
    const oauthSessions: Map<string, any> = new Map();

    const loadOauthFromDisk = () => {
        try {
            if (!fs.existsSync(authPersistPath)) return;
            const raw = fs.readFileSync(authPersistPath, 'utf8');
            if (!raw) return;
            const obj = JSON.parse(raw) as Record<string, any>;
            for (const k of Object.keys(obj)) oauthSessions.set(k, obj[k]);
        } catch (e) {
            console.error('Failed to load OAuth sessions from disk:', e);
        }
    };

    const saveOauthToDisk = () => {
        try {
            const dir = path.dirname(authPersistPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const obj: Record<string, any> = Object.fromEntries(oauthSessions as any);
            fs.writeFileSync(authPersistPath, JSON.stringify(obj, null, 2), 'utf8');
        } catch (e) {
            console.error('Failed to save OAuth sessions to disk:', e);
        }
    };

    loadOauthFromDisk();

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

            // DEBUG: log incoming cookies and session table keys to help diagnose "Session not found" issues
            try {
                console.info('[DEBUG][/api/auth/session] incoming Cookie header:', req.headers['cookie']);
                console.info('[DEBUG][/api/auth/session] parsed sessionId cookie:', sessionId);
                console.info('[DEBUG][/api/auth/session] sessions keys:', Array.from(sessions.keys()).slice(0,50));
            } catch (dbgErr) {
                console.warn('[DEBUG][/api/auth/session] failed to log debug info', dbgErr);
            }

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

            // Determine owner flag based on server config
            const owners: string[] = Array.isArray((config as any).owner) ? (config as any).owner : [];
            const isOwner = owners.includes(session.userId);

            // Calculate max permission level across all guilds
            let maxPermissionLevel = 0;
            if (session.permissions) {
                for (const perm of session.permissions) {
                    if (perm.level > maxPermissionLevel) {
                        maxPermissionLevel = perm.level;
                    }
                }
            }
            // If user is owner, set max permission level
            if (isOwner) {
                maxPermissionLevel = 3; // OWNER level
            }

            res.json({
                authenticated: true,
                user: {
                    userId: session.userId,
                    guildId: session.guildId || (session.guildIds && session.guildIds.length > 0 ? session.guildIds[0] : undefined), // 後方互換性
                    guildIds: session.guildIds || [], // 全ギルドID
                    username: session.username || session.userId,
                    avatar: (session as any).avatar || null,
                    permissions: session.permissions || [],
                    permissionLevel: maxPermissionLevel,
                    isOwner,
                    owners
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
            let redirectPath = req.query.redirect as string || '/';
            // Prefer explicit guildId query param（今後の拡張用に残すが、Refererパースは削除）
            let guildId = req.query.guildId as string || '';
            if (!guildId) guildId = 'default';

            // 環境変数または設定からOAuth2情報を取得
            const clientId = botClient.getClientId();
            const baseUrl = config.BASE_URL;
            const redirectUri = `${baseUrl}/api/auth/callback`;
            (global as any).Logger.info(`[OAuth] initiating Discord auth - baseUrl=${baseUrl} redirect_uri=${redirectUri}`);

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
            (global as any).Logger.info(`[OAuth] callback received - expected redirect_uri=${redirectUri}`);

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

            // Discord APIからユーザーの所属ギルド一覧・権限を取得
            let guilds: any[] = [];
            try {
                const resp = await fetch('https://discord.com/api/users/@me/guilds', {
                    headers: { Authorization: `Bearer ${tokenData.access_token}` }
                });
                if (resp.ok) {
                    guilds = await resp.json();
                }
            } catch { }
            // Botが参加しているサーバーID一覧を取得
            const botGuilds = botClient.getGuildList().map(g => g.id);
            // 共通部分のみ抽出
            const filteredGuilds = guilds.filter(g => botGuilds.includes(g.id));
            // guildIds配列
            const guildIds = filteredGuilds.map(g => g.id);
            // permissions配列（0:any, 1:staff, 2:admin, 3:管理者）
            // 各guildIdごとにadminRoleId/staffRoleIdを参照し、ユーザーがそのロールを持っていればlevel:2(admin)またはlevel:1(staff)を付与
            const permissions: { guildId: string; level: number }[] = [];
            for (const g of filteredGuilds) {
                let level = 0;
                try {
                    // サーバー設定取得
                    const settings = await database.get(g.id, `Guild/${g.id}/settings`);
                    // メンバー情報取得
                    const memberResp = await fetch(`https://discord.com/api/guilds/${g.id}/members/${userData.id}`, {
                        headers: { Authorization: `Bot ${botClient.token}` }
                    });
                    if (memberResp.ok) {
                        const member = await memberResp.json();
                        const roles = member.roles || [];
                        if (settings && settings.adminRoleId && roles.includes(settings.adminRoleId)) {
                            level = 2;
                        } else if (settings && settings.staffRoleId && roles.includes(settings.staffRoleId)) {
                            level = 1;
                        } else if (g.owner) {
                            level = 2;
                        } else if (g.permissions & 0x20) {
                            level = 3;
                        } else if (g.permissions & 0x8) {
                            level = 1;
                        }
                    }
                } catch (e) {
                    // fallback: owner/権限フラグ
                    if (g.owner) {
                        level = 2;
                    } else if (g.permissions & 0x20) {
                        level = 3;
                    } else if (g.permissions & 0x8) {
                        level = 1;
                    }
                }
                permissions.push({ guildId: g.id, level });
            }
            const sessionId = crypto.randomBytes(32).toString('hex');
            const sessionTTL = 30 * 24 * 60 * 60 * 1000; // 30日
            const session: SettingsSession = {
                token: sessionId,
                userId: userData.id,
                guildIds,
                username,
                ...(userData.avatar ? { avatar: userData.avatar } : {}),
                permissions,
                createdAt: Date.now(),
                expiresAt: Date.now() + sessionTTL
            };

            // Permission computation is intentionally omitted here; keep default permission

            sessions.set(sessionId, session);

            // Save OAuth tokens into Data/Auth so we can refresh later and avoid asking user to re-login
            try {
                oauthSessions.set(userData.id, {
                    userId: userData.id,
                    guildId: stateData.guildId,
                    accessToken: tokenData.access_token,
                    refreshToken: tokenData.refresh_token,
                    expiresAt: Date.now() + (tokenData.expires_in * 1000),
                    scopes: tokenData.scope ? tokenData.scope.split(' ') : []
                });
                saveOauthToDisk();
            } catch (e) {
                console.error('Failed to persist OAuth token:', e);
            }

            // WEB認証ロールを付与
            try {
                for (const g of filteredGuilds) {
                    try {
                        const settings = await database.get(g.id, `Guild/${g.id}/settings`);
                        if (settings?.webAuthRoleId) {
                            const guild = botClient.client.guilds.cache.get(g.id);
                            if (guild) {
                                const member = await guild.members.fetch(userData.id);
                                if (member) {
                                    await member.roles.add(settings.webAuthRoleId);
                                    console.log(`[WebAuth] ロール付与: ${userData.id} -> ${settings.webAuthRoleId} (Guild: ${g.id})`);
                                }
                            }
                        }
                    } catch (roleError) {
                        console.error(`[WebAuth] ロール付与に失敗 (Guild: ${g.id}):`, roleError);
                        // ロール付与失敗は認証を失敗させない
                    }
                }
            } catch (e) {
                console.error('[WebAuth] ロール付与処理でエラー:', e);
                // ロール付与エラーは認証を失敗させない
            }

            // クッキーを設定してリダイレクト
            res.cookie('sessionId', sessionId, {
                httpOnly: true,
                secure: config.NODE_ENV === 'production',
                maxAge: sessionTTL,
                sameSite: 'lax'
            });

            // 元のページにリダイレクト、またはlocalStorageの保存された戻り先を使用
            // ただし、優先度はクエリパラメータ > OAuth2 state > デフォルトホーム
            let redirectPath = stateData.redirectPath || '/';

            // クライアントサイドで保存された戻り先パスがある場合はそちらを優先
            // （localStorageから取得する場合、サーバー側ではアクセスできないので、
            //  クエリパラメータ経由で受け渡す仕組みを追加する必要がある）
            // ここではシンプルにOAuth2 stateのredirectPathを使用

            res.redirect(redirectPath);
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
                const session = sessions.get(sessionId);
                
                // ロール削除（WEB認証時に付与したロール）
                if (session && session.guildIds) {
                    try {
                        for (const guildId of session.guildIds) {
                            try {
                                const settings = await database.get(guildId, `Guild/${guildId}/settings`);
                                if (settings?.webAuthRoleId) {
                                    const guild = botClient.client.guilds.cache.get(guildId);
                                    if (guild) {
                                        const member = await guild.members.fetch(session.userId);
                                        if (member) {
                                            await member.roles.remove(settings.webAuthRoleId);
                                            console.log(`[WebAuth] ロール削除: ${session.userId} -> ${settings.webAuthRoleId} (Guild: ${guildId})`);
                                        }
                                    }
                                }
                            } catch (roleError) {
                                console.error(`[WebAuth] ロール削除に失敗 (Guild: ${guildId}):`, roleError);
                                // ロール削除失敗はログアウトを失敗させない
                            }
                        }
                    } catch (e) {
                        console.error('[WebAuth] ロール削除処理でエラー:', e);
                        // ロール削除エラーはログアウトを失敗させない
                    }
                }
                
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
