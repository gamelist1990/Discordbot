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
