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
    // Feedback用WebSocketサーバー
    const wss = new WebSocketServer({ 
        server,
        path: '/ws/feedback',
        perMessageDeflate: false
    });
    
    // Trigger用WebSocketサーバー
    const wssTrigger = new WebSocketServer({ 
        server,
        path: '/ws/trigger',
        perMessageDeflate: false
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
                if (ws.readyState === ws.OPEN) {
                    ws.close(1008, 'Unauthorized: No session token');
                }
                return;
            }

            const session = sessions.get(sessionToken);
            if (!session) {
                console.warn('[WebSocket] Invalid session token, closing connection');
                if (ws.readyState === ws.OPEN) {
                    ws.close(1008, 'Unauthorized: Invalid session');
                }
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

    // Trigger WebSocket接続ハンドラー
    wssTrigger.on('connection', (ws: WebSocket, req) => {
        try {
            const rawCookie = req.headers.cookie;
            const cookies = rawCookie ? parseCookie(rawCookie) : {};
            const sessionToken = cookies['sessionId'] || cookies['connect.sid'] || cookies['session'];

            if (!sessionToken) {
                console.warn('[WebSocket/Trigger] No session token found, closing connection');
                if (ws.readyState === ws.OPEN) {
                    ws.close(1008, 'Unauthorized: No session token');
                }
                return;
            }

            const session = sessions.get(sessionToken);
            if (!session) {
                console.warn('[WebSocket/Trigger] Invalid session token, closing connection');
                if (ws.readyState === ws.OPEN) {
                    ws.close(1008, 'Unauthorized: Invalid session');
                }
                return;
            }

            // Trigger用チャンネルに接続を登録
            const connectionId = wsManager.addConnection(ws, 'trigger', {
                userId: session.userId,
                username: session.username,
                avatar: session.avatar,
                guildId: session.guildId // ギルドIDもメタデータに含める
            });

            console.log(`[WebSocket/Trigger] Client connected: ${connectionId} (User: ${session.username})`);

        } catch (error) {
            console.error('[WebSocket/Trigger] Connection error:', error);
            try { ws.close(1011, 'Internal server error'); } catch (e) { /* ignore */ }
        }
    });

    // WebSocketManagerのメッセージハンドラーを設定（Feedback）
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

    // WebSocketManagerのメッセージハンドラーを設定（Trigger）
    wsManager.onMessage('trigger', async (connection, message) => {
        try {
            switch (message.type) {
                case 'ping':
                    wsManager.sendToConnection(connection.id, {
                        type: 'pong',
                        timestamp: Date.now()
                    });
                    break;

                case 'subscribe':
                    console.log(`[WebSocket/Trigger] ${connection.id} subscribed to:`, message.payload);
                    break;

                default:
                    console.warn(`[WebSocket/Trigger] Unknown message type: ${message.type}`);
            }
        } catch (error) {
            console.error('[WebSocket/Trigger] Message handler error:', error);
            wsManager.sendToConnection(connection.id, {
                type: 'error',
                timestamp: Date.now(),
                payload: { error: 'Failed to process message' }
            });
        }
    });

    console.log('[WebSocket] Server setup complete on paths: /ws/feedback, /ws/trigger');
}
