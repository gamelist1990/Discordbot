import { Request, Response, NextFunction } from 'express';
import { SettingsSession } from '../types/index.js';

/**
 * セッション認証ミドルウェア
 */
export class AuthMiddleware {
    private sessions: Map<string, SettingsSession>;

    constructor(sessions: Map<string, SettingsSession>) {
        this.sessions = sessions;
    }

    /**
     * トークンを検証するミドルウェア
     */
    validateToken = (req: Request, res: Response, next: NextFunction): void => {
        // DEBUG: incoming cookie and session table snapshot for troubleshooting "Session not found"
        try {
            console.info('[DEBUG][auth.validateToken] incoming Cookie header:', req.headers['cookie']);
            console.info('[DEBUG][auth.validateToken] parsed sessionId cookie:', (req as any).cookies?.sessionId);
            console.info('[DEBUG][auth.validateToken] sessions keys (first 50):', Array.from(this.sessions.keys()).slice(0, 50));
        } catch (dbgErr) {
            // ignore logging errors
        }

        // Accept token from path param or sessionId cookie (cookie-based sessions)
        const token = req.params?.token || (req as any).cookies?.sessionId;

        if (!token) {
            res.status(401).json({ error: 'Token is required' });
            return;
        }

        const session = this.sessions.get(token as string);

        if (!session) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }

        if (Date.now() > session.expiresAt) {
            this.sessions.delete(token);
            res.status(401).json({ error: 'Session expired' });
            return;
        }

        // セッション情報をリクエストに追加
        (req as any).session = session;
        next();
    };
}

/**
 * 認証検証ミドルウェア（関数形式）
 */
export function verifyAuth(sessions: Map<string, SettingsSession>) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const token = req.cookies?.sessionId;

        if (!token) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const session = sessions.get(token);

        if (!session) {
            res.status(401).json({ error: 'Session not found' });
            return;
        }

        if (Date.now() > session.expiresAt) {
            sessions.delete(token);
            res.status(401).json({ error: 'Session expired' });
            return;
        }

        // セッション情報をリクエストに追加
        (req as any).session = session;
        next();
    };
}

/**
 * 現在のユーザー情報を取得
 */
export function getCurrentUser(req: Request) {
    return (req as any).session;
}

/**
 * STAFF権限を要求するミドルウェア
 */
export function requireStaffAuth(sessions: Map<string, SettingsSession>) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const token = req.cookies?.sessionId;

        if (!token) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const session = sessions.get(token);

        if (!session) {
            res.status(401).json({ error: 'Session not found' });
            return;
        }

        if (Date.now() > session.expiresAt) {
            sessions.delete(token);
            res.status(401).json({ error: 'Session expired' });
            return;
        }

        // STAFF権限チェック（後方互換対応）
        // - 既存の permissionLevel があればそれを使う
        // - なければ owners 配列や permissions 数値配列を参照して STAFF 判定する
        const hasStaff = (() => {
            try {
                // explicit permissionLevel (string)
                if ((session as any).permissionLevel) {
                    const lvl = (session as any).permissionLevel;
                    return lvl === 'STAFF' || lvl === 'ADMIN' || lvl === 'OP';
                }
                // owners array (e.g., created by /api/auth)
                const owners = Array.isArray((session as any).owners) ? (session as any).owners : [];
                if (owners.includes(session.userId)) return true;
                // permissions array with numeric levels (fallback)
                const perms = (session as any).permissions;
                if (Array.isArray(perms)) {
                    for (const p of perms) {
                        if (p && typeof p.level === 'number' && p.level >= 1) {
                            // level 1 = staff, 2 = admin, 3 = owner/admin-equivalent
                            return true;
                        }
                    }
                }
            } catch (e) {
                // ignore and treat as not staff
            }
            return false;
        })();
        if (!hasStaff) {
            res.status(403).json({ error: 'Forbidden: STAFF permission required' });
            return;
        }

        // セッション情報をリクエストに追加
        (req as any).session = session;
        next();
    };
}