/**
 * WebSocketメッセージの基本構造
 */
export interface WSMessage {
    type: string;
    timestamp: number;
    payload?: any;
}

/**
 * WebSocketイベントハンドラー
 */
type MessageHandler = (message: WSMessage) => void;

/**
 * WebSocketサービス
 * リアルタイム双方向通信を管理
 */
export class WebSocketService {
    private ws: WebSocket | null = null;
    private url: string;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectDelay: number = 3000;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private messageHandlers: Map<string, Set<MessageHandler>> = new Map();
    private connectionListeners: Set<(connected: boolean) => void> = new Set();
    private manualClose: boolean = false;

    constructor(url: string) {
        this.url = url;
    }

    /**
     * WebSocket接続を開始
     */
    connect(): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('[WebSocketService] Already connected');
            return;
        }

        this.manualClose = false;

        try {
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                console.log('[WebSocketService] Connected to', this.url);
                this.reconnectAttempts = 0;
                this.notifyConnectionStatus(true);
            };

            this.ws.onmessage = (event) => {
                try {
                    const message: WSMessage = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('[WebSocketService] Failed to parse message:', error);
                }
            };

            this.ws.onerror = (error) => {
                console.error('[WebSocketService] Connection error:', error);
            };

            this.ws.onclose = (event) => {
                console.log('[WebSocketService] Connection closed', event.code, event.reason);
                this.notifyConnectionStatus(false);

                // 手動でクロースした場合は再接続しない
                if (!this.manualClose) {
                    this.scheduleReconnect();
                }
            };

        } catch (error) {
            console.error('[WebSocketService] Failed to create WebSocket:', error);
            this.scheduleReconnect();
        }
    }

    /**
     * WebSocket接続を切断
     */
    disconnect(): void {
        this.manualClose = true;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.notifyConnectionStatus(false);
    }

    /**
     * メッセージを送信
     */
    send(message: WSMessage): boolean {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('[WebSocketService] Cannot send message: not connected');
            return false;
        }

        try {
            this.ws.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('[WebSocketService] Failed to send message:', error);
            return false;
        }
    }

    /**
     * 特定のメッセージタイプにハンドラーを登録
     */
    on(messageType: string, handler: MessageHandler): void {
        if (!this.messageHandlers.has(messageType)) {
            this.messageHandlers.set(messageType, new Set());
        }
        this.messageHandlers.get(messageType)!.add(handler);
    }

    /**
     * メッセージハンドラーを削除
     */
    off(messageType: string, handler: MessageHandler): void {
        const handlers = this.messageHandlers.get(messageType);
        if (handlers) {
            handlers.delete(handler);
        }
    }

    /**
     * 接続状態の変化をリスニング
     */
    onConnectionChange(listener: (connected: boolean) => void): void {
        this.connectionListeners.add(listener);
    }

    /**
     * 接続状態リスナーを削除
     */
    offConnectionChange(listener: (connected: boolean) => void): void {
        this.connectionListeners.delete(listener);
    }

    /**
     * 現在の接続状態を取得
     */
    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * メッセージを処理
     */
    private handleMessage(message: WSMessage): void {
        const handlers = this.messageHandlers.get(message.type);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(message);
                } catch (error) {
                    console.error(`[WebSocketService] Handler error for ${message.type}:`, error);
                }
            });
        }

        // 'all' ハンドラーも実行
        const allHandlers = this.messageHandlers.get('all');
        if (allHandlers) {
            allHandlers.forEach(handler => {
                try {
                    handler(message);
                } catch (error) {
                    console.error('[WebSocketService] All handler error:', error);
                }
            });
        }
    }

    /**
     * 再接続をスケジュール
     */
    private scheduleReconnect(): void {
        if (this.manualClose) return;

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[WebSocketService] Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts;

        console.log(`[WebSocketService] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, delay);
    }

    /**
     * 接続状態の変化を通知
     */
    private notifyConnectionStatus(connected: boolean): void {
        this.connectionListeners.forEach(listener => {
            try {
                listener(connected);
            } catch (error) {
                console.error('[WebSocketService] Connection listener error:', error);
            }
        });
    }

    /**
     * クリーンアップ
     */
    destroy(): void {
        this.disconnect();
        this.messageHandlers.clear();
        this.connectionListeners.clear();
    }
}

/**
 * Feedback用WebSocketサービスのシングルトンインスタンス
 */
export const feedbackWS = new WebSocketService(
    `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/feedback`
);
