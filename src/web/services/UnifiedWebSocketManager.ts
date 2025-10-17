import { WebSocketServer, WebSocket } from 'ws';
import { Server as HTTPServer } from 'http';
import { parse as parseCookie } from 'cookie';
import { SettingsSession } from '../types/index.js';

/**
 * 統合 WebSocket マネージャー
 * 複数のチャンネル（feedback, trigger）を単一の WebSocketServer で管理
 */
export class UnifiedWebSocketManager {
    private wss: WebSocketServer | null = null;
    private channelHandlers: Map<string, (ws: WebSocket, data: any) => Promise<void>> = new Map();
    private connections: Map<string, Set<WebSocket>> = new Map(); // チャンネルごとの接続

    /**
     * WebSocket サーバーを初期化
     */
    public initialize(
        server: HTTPServer,
        sessions: Map<string, SettingsSession>
    ): void {
        try {
            // 単一の WebSocketServer インスタンス
            this.wss = new WebSocketServer({
                server,
                perMessageDeflate: false,
                maxPayload: 1024 * 1024 // 1MB
            });

            // エラーハンドリング
            this.wss.on('error', (error: Error) => {
                console.error('[UnifiedWebSocketManager] Server error:', error);
            });

            // 接続ハンドラー
            this.wss.on('connection', async (ws: WebSocket, req) => {
                await this.handleConnection(ws, req, sessions);
            });

            console.log('[UnifiedWebSocketManager] WebSocket server initialized');
        } catch (error) {
            console.error('[UnifiedWebSocketManager] Failed to initialize:', error);
            throw error;
        }
    }

    /**
     * チャンネルメッセージハンドラーを登録
     */
    public registerChannelHandler(
        channel: string,
        handler: (ws: WebSocket, data: any) => Promise<void>
    ): void {
        this.channelHandlers.set(channel, handler);
        if (!this.connections.has(channel)) {
            this.connections.set(channel, new Set());
        }
        console.log(`[UnifiedWebSocketManager] Registered handler for channel: ${channel}`);
    }

    /**
     * 接続処理
     */
    private async handleConnection(
        ws: WebSocket,
        req: any,
        sessions: Map<string, SettingsSession>
    ): Promise<void> {
        const clientIp = req.socket.remoteAddress;
        const connectionId = `${clientIp}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        try {
            // ストリームが既に終了していないか確認
            if (ws.readyState !== ws.OPEN) {
                console.warn(`[UnifiedWebSocketManager] Connection not in OPEN state: ${connectionId}`);
                return;
            }

            // URL から チャンネル名を抽出
            const url = req.url || '/';
            const channel = this.extractChannel(url);

            if (!channel) {
                console.warn(
                    `[UnifiedWebSocketManager] Invalid channel from URL: ${url}`
                );
                this.closeConnection(ws, 1008, 'Invalid channel');
                return;
            }

            // セッション検証
            const session = this.validateSession(req, sessions);
            if (!session) {
                console.warn(`[UnifiedWebSocketManager] Session validation failed: ${connectionId}`);
                this.closeConnection(ws, 1008, 'Unauthorized');
                return;
            }

            // チャンネルに接続を登録
            const connections = this.connections.get(channel);
            if (connections) {
                connections.add(ws);
            }

            console.log(
                `[UnifiedWebSocketManager] Client connected: ${connectionId} (Channel: ${channel}, User: ${session.username})`
            );

            // メタデータを WebSocket に添付
            (ws as any).connectionId = connectionId;
            (ws as any).channel = channel;
            (ws as any).session = session;

            // メッセージハンドラー
            ws.on('message', async (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());
                    const handler = this.channelHandlers.get(channel);

                    if (handler) {
                        await handler(ws, message);
                    }
                } catch (error) {
                    console.error(
                        `[UnifiedWebSocketManager] Message handling error (${channel}):`,
                        error
                    );
                }
            });

            // クローズハンドラー
            ws.on('close', () => {
                const connections = this.connections.get(channel);
                if (connections) {
                    connections.delete(ws);
                }
                console.log(
                    `[UnifiedWebSocketManager] Client disconnected: ${connectionId} (Channel: ${channel})`
                );
            });

            // エラーハンドラー
            ws.on('error', (error: Error) => {
                console.error(
                    `[UnifiedWebSocketManager] WebSocket error (${connectionId}):`,
                    error
                );
            });

            // Pong 応答（ハートビート用）
            ws.on('pong', () => {
                (ws as any).isAlive = true;
            });
        } catch (error) {
            console.error(
                `[UnifiedWebSocketManager] Connection handler error (${connectionId}):`,
                error
            );
            this.closeConnection(ws, 1011, 'Internal server error');
        }
    }

    /**
     * セッション検証
     */
    private validateSession(
        req: any,
        sessions: Map<string, SettingsSession>
    ): SettingsSession | null {
        try {
            const rawCookie = req.headers.cookie || '';
            const cookies = parseCookie(rawCookie);
            const sessionToken =
                cookies['sessionId'] || cookies['connect.sid'] || cookies['session'];

            if (!sessionToken) {
                return null;
            }

            const session = sessions.get(sessionToken);
            return session || null;
        } catch (error) {
            console.error('[UnifiedWebSocketManager] Session validation error:', error);
            return null;
        }
    }

    /**
     * URL からチャンネル名を抽出
     */
    private extractChannel(url: string): string | null {
        // URL パターン: /ws/feedback, /ws/trigger, etc.
        const match = url.match(/^\/ws\/([a-zA-Z0-9_-]+)/);
        return match ? match[1] : null;
    }

    /**
     * 安全に接続を閉じる
     */
    private closeConnection(
        ws: WebSocket,
        code: number,
        reason: string
    ): void {
        try {
            if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
                ws.close(code, reason);
            }
        } catch (error) {
            console.error('[UnifiedWebSocketManager] Error closing connection:', error);
        }
    }

    /**
     * チャンネルのすべてのクライアントにメッセージをブロードキャスト
     */
    public broadcast(channel: string, data: any): void {
        const connections = this.connections.get(channel);
        if (!connections) return;

        const payload = JSON.stringify(data);
        connections.forEach((ws) => {
            try {
                if (ws.readyState === ws.OPEN) {
                    ws.send(payload);
                }
            } catch (error) {
                console.error(
                    `[UnifiedWebSocketManager] Broadcast error (${channel}):`,
                    error
                );
            }
        });
    }

    /**
     * 特定のクライアントにメッセージを送信
     */
    public sendToConnection(connectionId: string, data: any): void {
        if (!this.wss) return;

        const payload = JSON.stringify(data);
        this.wss.clients.forEach((ws) => {
            if ((ws as any).connectionId === connectionId) {
                try {
                    if (ws.readyState === ws.OPEN) {
                        ws.send(payload);
                    }
                } catch (error) {
                    console.error(
                        `[UnifiedWebSocketManager] Send error (${connectionId}):`,
                        error
                    );
                }
            }
        });
    }

    /**
     * ハートビート処理（生存確認）
     */
    public startHeartbeat(interval: number = 30000): void {
        setInterval(() => {
            if (!this.wss) return;

            this.wss.clients.forEach((ws: any) => {
                if (ws.isAlive === false) {
                    try {
                        ws.terminate();
                    } catch (error) {
                        console.error('[UnifiedWebSocketManager] Heartbeat terminate error:', error);
                    }
                    return;
                }
                ws.isAlive = false;
                try {
                    ws.ping();
                } catch (error) {
                    console.error('[UnifiedWebSocketManager] Heartbeat ping error:', error);
                }
            });
        }, interval);
    }

    /**
     * チャンネルの接続数を取得
     */
    public getConnectionCount(channel: string): number {
        return this.connections.get(channel)?.size || 0;
    }

    /**
     * 全体の接続数を取得
     */
    public getTotalConnectionCount(): number {
        let count = 0;
        this.connections.forEach((conns) => {
            count += conns.size;
        });
        return count;
    }

    /**
     * シャットダウン処理
     */
    public shutdown(): void {
        if (!this.wss) return;

        try {
            this.wss.clients.forEach((ws) => {
                this.closeConnection(ws, 1000, 'Server shutdown');
            });
            this.wss.close(() => {
                console.log('[UnifiedWebSocketManager] Server closed');
            });
            this.connections.clear();
        } catch (error) {
            console.error('[UnifiedWebSocketManager] Shutdown error:', error);
        }
    }
}

// シングルトンインスタンス
export const unifiedWsManager = new UnifiedWebSocketManager();
