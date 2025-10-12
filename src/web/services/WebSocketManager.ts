import WebSocket from 'ws';
import crypto from 'crypto';

/**
 * WebSocket接続情報
 */
export interface WSConnection {
    id: string;
    ws: WebSocket;
    channel: string;
    metadata?: Record<string, any>;
    connectedAt: number;
    lastPing?: number;
}

/**
 * WebSocketメッセージの基本構造
 */
export interface WSMessage {
    type: string;
    timestamp: number;
    payload?: any;
}

/**
 * クライアントからのメッセージハンドラー
 */
export type MessageHandler = (
    connection: WSConnection,
    message: WSMessage
) => void | Promise<void>;

/**
 * 汎用WebSocketマネージャー
 * 双方向リアルタイム通信を管理
 */
export class WebSocketManager {
    private connections: Map<string, WSConnection> = new Map();
    private channels: Map<string, Set<string>> = new Map();
    private messageHandlers: Map<string, MessageHandler> = new Map();
    private pingInterval: NodeJS.Timeout | null = null;

    constructor(private options: {
        pingIntervalMs?: number;
        connectionTimeoutMs?: number;
    } = {}) {
        this.options.pingIntervalMs = options.pingIntervalMs || 30000; // 30秒
        this.options.connectionTimeoutMs = options.connectionTimeoutMs || 60000; // 60秒

        // 定期的にping/pongを送信してコネクションを維持
        this.startPingInterval();
    }

    /**
     * 新しいWebSocket接続を登録
     * @param ws WebSocketインスタンス
     * @param channel チャンネル名（例: 'feedback', 'privatechat'）
     * @param metadata オプションのメタデータ（ユーザーID、ギルドIDなど）
     * @returns 接続ID
     */
    addConnection(
        ws: WebSocket,
        channel: string,
        metadata?: Record<string, any>
    ): string {
        const connectionId = `${channel}-${crypto.randomUUID()}`;

        const connection: WSConnection = {
            id: connectionId,
            ws,
            channel,
            metadata,
            connectedAt: Date.now(),
            lastPing: Date.now()
        };

        this.connections.set(connectionId, connection);

        // チャンネルに接続を追加
        if (!this.channels.has(channel)) {
            this.channels.set(channel, new Set());
        }
        this.channels.get(channel)!.add(connectionId);

        // クライアントからのメッセージを処理
        ws.on('message', (data: WebSocket.RawData) => {
            this.handleClientMessage(connectionId, data);
        });

        // Pong応答を処理
        ws.on('pong', () => {
            const conn = this.connections.get(connectionId);
            if (conn) {
                conn.lastPing = Date.now();
            }
        });

        // エラー処理
        ws.on('error', (error) => {
            console.error(`[WebSocketManager] Error on connection ${connectionId}:`, error);
        });

        // クライアント切断時のクリーンアップ
        ws.on('close', (code?: number, reason?: Buffer) => {
            try {
                const reasonText = reason ? reason.toString() : '';
                console.log(`[WebSocketManager] Connection ${connectionId} closed. code=${code} reason=${reasonText}`);
            } catch (e) {
                // ignore
            }
            this.removeConnection(connectionId);
        });

        // 接続確認メッセージを送信
        this.sendToConnection(connectionId, {
            type: 'connected',
            timestamp: Date.now(),
            payload: { connectionId, channel }
        });

        console.log(`[WebSocketManager] Connection added: ${connectionId} to channel: ${channel}`);

        return connectionId;
    }

    /**
     * 接続を削除
     * @param connectionId 接続ID
     */
    removeConnection(connectionId: string): void {
        const connection = this.connections.get(connectionId);
        if (!connection) return;

        // WebSocketを閉じる
        if (connection.ws.readyState === WebSocket.OPEN) {
            connection.ws.close();
        }

        // チャンネルから削除
        const channelConnections = this.channels.get(connection.channel);
        if (channelConnections) {
            channelConnections.delete(connectionId);
            if (channelConnections.size === 0) {
                this.channels.delete(connection.channel);
            }
        }

        // 接続マップから削除
        this.connections.delete(connectionId);

        console.log(`[WebSocketManager] Connection removed: ${connectionId} from channel: ${connection.channel}`);
    }

    /**
     * 特定の接続にデータを送信
     * @param connectionId 接続ID
     * @param message 送信するメッセージ
     */
    sendToConnection(connectionId: string, message: WSMessage): boolean {
        const connection = this.connections.get(connectionId);
        if (!connection) return false;

        if (connection.ws.readyState !== WebSocket.OPEN) {
            this.removeConnection(connectionId);
            return false;
        }

        try {
            connection.ws.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error(`[WebSocketManager] Failed to send to connection ${connectionId}:`, error);
            this.removeConnection(connectionId);
            return false;
        }
    }

    /**
     * チャンネル全体にブロードキャスト
     * @param channel チャンネル名
     * @param message 送信するメッセージ
     * @param filter オプション: 特定の条件でフィルタリング
     */
    broadcast(
        channel: string,
        message: WSMessage,
        filter?: (connection: WSConnection) => boolean
    ): number {
        const channelConnections = this.channels.get(channel);
        if (!channelConnections) return 0;

        let sentCount = 0;
        for (const connectionId of channelConnections) {
            const connection = this.connections.get(connectionId);
            if (!connection) continue;

            // フィルター条件が指定されている場合は適用
            if (filter && !filter(connection)) continue;

            if (this.sendToConnection(connectionId, message)) {
                sentCount++;
            }
        }

        return sentCount;
    }

    /**
     * 全チャンネルにブロードキャスト
     * @param message 送信するメッセージ
     */
    broadcastAll(message: WSMessage): number {
        let sentCount = 0;
        for (const connectionId of this.connections.keys()) {
            if (this.sendToConnection(connectionId, message)) {
                sentCount++;
            }
        }
        return sentCount;
    }

    /**
     * 特定のチャンネルのメッセージハンドラーを登録
     * @param channel チャンネル名
     * @param handler メッセージハンドラー関数
     */
    onMessage(channel: string, handler: MessageHandler): void {
        this.messageHandlers.set(channel, handler);
        console.log(`[WebSocketManager] Registered message handler for channel: ${channel}`);
    }

    /**
     * クライアントからのメッセージを処理
     */
    private async handleClientMessage(connectionId: string, data: WebSocket.RawData): Promise<void> {
        const connection = this.connections.get(connectionId);
        if (!connection) return;

        try {
            const message = JSON.parse(data.toString()) as WSMessage;

            // チャンネル固有のハンドラーを実行
            const handler = this.messageHandlers.get(connection.channel);
            if (handler) {
                await handler(connection, message);
            } else {
                console.warn(`[WebSocketManager] No handler for channel: ${connection.channel}`);
            }
        } catch (error) {
            console.error(`[WebSocketManager] Failed to handle message from ${connectionId}:`, error);
            this.sendToConnection(connectionId, {
                type: 'error',
                timestamp: Date.now(),
                payload: { error: 'Invalid message format' }
            });
        }
    }

    /**
     * 定期的なping送信を開始
     */
    private startPingInterval(): void {
        if (this.pingInterval) return;

        this.pingInterval = setInterval(() => {
            const now = Date.now();
            const timeout = this.options.connectionTimeoutMs!;

            for (const [connectionId, connection] of this.connections.entries()) {
                // タイムアウトチェック
                if (connection.lastPing && now - connection.lastPing > timeout) {
                    console.warn(`[WebSocketManager] Connection ${connectionId} timed out`);
                    this.removeConnection(connectionId);
                    continue;
                }

                // Pingを送信
                if (connection.ws.readyState === WebSocket.OPEN) {
                    try {
                        connection.ws.ping();
                    } catch (error) {
                        console.error(`[WebSocketManager] Failed to ping ${connectionId}:`, error);
                        this.removeConnection(connectionId);
                    }
                }
            }
        }, this.options.pingIntervalMs!);

        console.log('[WebSocketManager] Ping interval started');
    }

    /**
     * Ping送信を停止
     */
    private stopPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
            console.log('[WebSocketManager] Ping interval stopped');
        }
    }

    /**
     * 接続情報を取得
     */
    getConnectionInfo(connectionId: string): WSConnection | undefined {
        return this.connections.get(connectionId);
    }

    /**
     * チャンネルの接続数を取得
     */
    getChannelConnectionCount(channel: string): number {
        return this.channels.get(channel)?.size || 0;
    }

    /**
     * 統計情報を取得
     */
    getStats(): {
        totalConnections: number;
        channels: Record<string, number>;
    } {
        const stats: Record<string, number> = {};
        for (const [channel, connections] of this.channels.entries()) {
            stats[channel] = connections.size;
        }

        return {
            totalConnections: this.connections.size,
            channels: stats
        };
    }

    /**
     * すべての接続をクローズしてクリーンアップ
     */
    close(): void {
        console.log('[WebSocketManager] Closing all connections...');
        
        this.stopPingInterval();

        for (const connectionId of this.connections.keys()) {
            this.removeConnection(connectionId);
        }

        this.connections.clear();
        this.channels.clear();
        this.messageHandlers.clear();

        console.log('[WebSocketManager] All connections closed');
    }
}

// グローバルインスタンス
export const wsManager = new WebSocketManager({
    pingIntervalMs: 30000,
    connectionTimeoutMs: 60000
});
