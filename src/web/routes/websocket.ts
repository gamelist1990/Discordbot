import { Server as HTTPServer } from 'http';
import { WebSocket } from 'ws';
import { unifiedWsManager } from '../services/UnifiedWebSocketManager.js';
import { SettingsSession } from '../types/index.js';

/**
 * WebSocketサーバーをHTTPサーバーにアタッチ（統合マネージャー使用）
 * @param server HTTPサーバーインスタンス
 * @param sessions セッションマップ
 */
export function setupWebSocketServer(
    server: HTTPServer,
    sessions: Map<string, SettingsSession>
): void {
    // 統合 WebSocket マネージャーを初期化
    unifiedWsManager.initialize(server, sessions);

    // Feedback チャンネルハンドラーを登録
    unifiedWsManager.registerChannelHandler('feedback', async (ws: WebSocket, message: any) => {
        try {
            switch (message.type) {
                case 'ping':
                    const session = (ws as any).session;
                    unifiedWsManager.broadcast('feedback', {
                        type: 'pong',
                        timestamp: Date.now(),
                        user: session?.username
                    });
                    break;

                case 'subscribe':
                    console.log(
                        `[WebSocket/Feedback] ${(ws as any).connectionId} subscribed to:`,
                        message.payload
                    );
                    break;

                default:
                    console.warn(`[WebSocket/Feedback] Unknown message type: ${message.type}`);
            }
        } catch (error) {
            console.error('[WebSocket/Feedback] Message handler error:', error);
        }
    });

    // Trigger チャンネルハンドラーを登録
    unifiedWsManager.registerChannelHandler('trigger', async (ws: WebSocket, message: any) => {
        try {
            switch (message.type) {
                case 'ping':
                    const session = (ws as any).session;
                    unifiedWsManager.broadcast('trigger', {
                        type: 'pong',
                        timestamp: Date.now(),
                        user: session?.username
                    });
                    break;

                case 'subscribe':
                    console.log(
                        `[WebSocket/Trigger] ${(ws as any).connectionId} subscribed to:`,
                        message.payload
                    );
                    break;

                case 'triggerUpdate':
                    // Trigger 更新メッセージ
                    unifiedWsManager.broadcast('trigger', {
                        type: 'triggerUpdate',
                        timestamp: Date.now(),
                        payload: message.payload
                    });
                    break;

                default:
                    console.warn(`[WebSocket/Trigger] Unknown message type: ${message.type}`);
            }
        } catch (error) {
            console.error('[WebSocket/Trigger] Message handler error:', error);
        }
    });

    // ハートビートを開始（30秒ごとに生存確認）
    unifiedWsManager.startHeartbeat(30000);

    console.log(
        '[WebSocket] Unified WebSocket server initialized on paths: /ws/feedback, /ws/trigger'
    );
}
