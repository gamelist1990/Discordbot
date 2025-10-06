import { randomUUID } from 'crypto';
import { SettingsSession } from '../types/index.js';

/**
 * セッション管理サービス
 */
export class SessionService {
    private sessions: Map<string, SettingsSession>;

    constructor() {
        this.sessions = new Map();
    }

    /**
     * セッションを作成
     */
    createSession(guildId: string, userId: string): string {
        const token = randomUUID();
        const expiresIn = 30 * 60 * 1000; // 30分
        const expiresAt = Date.now() + expiresIn;

        const session: SettingsSession = {
            token,
            guildId,
            userId,
            createdAt: Date.now(),
            expiresAt,
        };

        this.sessions.set(token, session);

        // 期限切れセッションを自動削除
        setTimeout(() => {
            this.sessions.delete(token);
        }, expiresIn);

        return token;
    }

    /**
     * セッションを取得
     */
    getSession(token: string): SettingsSession | undefined {
        return this.sessions.get(token);
    }

    /**
     * セッションマップを取得
     */
    getSessions(): Map<string, SettingsSession> {
        return this.sessions;
    }

    /**
     * 期限切れセッションをクリーンアップ
     */
    cleanupExpiredSessions(): void {
        const now = Date.now();
        for (const [token, session] of this.sessions.entries()) {
            if (now > session.expiresAt) {
                this.sessions.delete(token);
            }
        }
    }
}
