import { randomUUID } from 'crypto';
import { SettingsSession } from '../types';
import fs from 'fs';
import path from 'path';

/**
 * セッション管理サービス
 */
export class SessionService {
    private sessions: Map<string, SettingsSession>;
    private persistPath: string;

    constructor() {
        this.sessions = new Map();
        // Persist sessions to project Data directory so sessions survive restarts
        this.persistPath = path.join(process.cwd(), 'Data', 'sessions.json');
        this.loadFromDisk();

        // Periodically cleanup expired sessions and persist
        setInterval(() => {
            try {
                this.cleanupExpiredSessions();
                this.saveToDisk();
            } catch (e) {
                // swallow
            }
        }, 60 * 1000);
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

        // Persist immediately
        try {
            this.saveToDisk();
        } catch (e) {
            // ignore disk errors
        }

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
        try {
            this.saveToDisk();
        } catch (e) {
            // ignore
        }
    }

    private loadFromDisk(): void {
        try {
            if (!fs.existsSync(this.persistPath)) return;
            const raw = fs.readFileSync(this.persistPath, 'utf8');
            if (!raw) return;
            const obj = JSON.parse(raw) as Record<string, SettingsSession>;
            for (const k of Object.keys(obj)) {
                this.sessions.set(k, obj[k]);
            }
        } catch (err) {
            console.error('Failed to load sessions from disk:', err);
        }
    }

    private saveToDisk(): void {
        try {
            const obj: Record<string, SettingsSession> = Object.fromEntries(this.sessions as any);
            // Ensure Data directory exists
            const dir = path.dirname(this.persistPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.persistPath, JSON.stringify(obj, null, 2), 'utf8');
        } catch (err) {
            console.error('Failed to save sessions to disk:', err);
        }
    }
}
