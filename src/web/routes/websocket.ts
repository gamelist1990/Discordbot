import { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseCookie } from 'cookie';
import { wsManager } from '../services/WebSocketManager.js';
import { SettingsSession } from '../types/index.js';

/**
 * WebSocketサーバーをHTTPサーバーにアタッチ
 * @param server HTTPサーバーインスタンス
 * @param sessions セッションマップ
 */
export function setupWebSocketServer(
    server: HTTPServer,
    sessions: Map<string, SettingsSession>
): void {
    const wss = new WebSocketServer({ 
        server,
        path: '/ws/feedback'
    });

    wss.on('connection', (ws: WebSocket, req) => {
        try {
            // Log incoming cookie header (helpful for debugging handshake auth)
            const rawCookie = req.headers.cookie;
            console.log('[WebSocket] Upgrade request cookies:', rawCookie || '<none>');

            // Cookieからセッション認証
            const cookies = rawCookie ? parseCookie(rawCookie) : {};
            // NOTE: Auth route sets cookie name 'sessionId' — accept that first for compatibility
            const sessionToken = cookies['sessionId'] || cookies['connect.sid'] || cookies['session'];

            if (!sessionToken) {
                console.warn('[WebSocket] No session token found in cookies, closing connection');
                ws.close(1008, 'Unauthorized: No session token');
                return;
            }

            const session = sessions.get(sessionToken);
            if (!session) {
                console.warn('[WebSocket] Invalid session token, closing connection');
                ws.close(1008, 'Unauthorized: Invalid session');
                return;
            }

            // WebSocketManagerに接続を登録
            const connectionId = wsManager.addConnection(ws, 'feedback', {
                userId: session.userId,
                username: session.username,
                avatar: session.avatar
            });

            console.log(`[WebSocket] Client connected: ${connectionId} (User: ${session.username})`);

        } catch (error) {
            console.error('[WebSocket] Connection error:', error);
            try { ws.close(1011, 'Internal server error'); } catch (e) { /* ignore */ }
        }
    });

    // WebSocketManagerのメッセージハンドラーを設定
    wsManager.onMessage('feedback', async (connection, message) => {
        try {
            // クライアントからのメッセージを処理
            switch (message.type) {
                case 'ping':
                    // Pingに対してPongを返す
                    wsManager.sendToConnection(connection.id, {
                        type: 'pong',
                        timestamp: Date.now()
                    });
                    break;

                case 'subscribe':
                    // 特定のフィードバックを購読（将来的な拡張）
                    console.log(`[WebSocket] ${connection.id} subscribed to:`, message.payload);
                    break;

                default:
                    console.warn(`[WebSocket] Unknown message type: ${message.type}`);
            }
        } catch (error) {
            console.error('[WebSocket] Message handler error:', error);
            wsManager.sendToConnection(connection.id, {
                type: 'error',
                timestamp: Date.now(),
                payload: { error: 'Failed to process message' }
            });
        }
    });

    console.log('[WebSocket] Server setup complete on path: /ws/feedback');
}
