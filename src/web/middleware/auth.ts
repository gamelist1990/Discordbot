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

        // STAFF権限チェック
        if (session.permissionLevel !== 'STAFF' && session.permissionLevel !== 'ADMIN' && session.permissionLevel !== 'OP') {
            res.status(403).json({ error: 'Forbidden: STAFF permission required' });
            return;
        }

        // セッション情報をリクエストに追加
        (req as any).session = session;
        next();
    };
}