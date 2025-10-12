import { Response } from 'express';

/**
 * SSE接続情報
 */
interface SSEConnection {
    id: string;
    res: Response;
    channel: string;
    metadata?: Record<string, any>;
    connectedAt: number;
}

/**
 * 拡張可能なSSEマネージャークラス
 * 複数のチャンネルでリアルタイム通信を管理
 */
export class SSEManager {
    private connections: Map<string, SSEConnection> = new Map();
    private channels: Map<string, Set<string>> = new Map();

    /**
     * 新しいSSE接続を登録
     * @param connectionId 一意の接続ID
     * @param res Express Response オブジェクト
     * @param channel チャンネル名（例: 'feedback', 'privatechat'）
     * @param metadata オプションのメタデータ（ユーザーID、ギルドIDなど）
     */
    addConnection(
        connectionId: string,
        res: Response,
        channel: string,
        metadata?: Record<string, any>
    ): void {
        // SSEヘッダーを設定
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // nginxバッファリング無効化

        // 接続を登録
        const connection: SSEConnection = {
            id: connectionId,
            res,
            channel,
            metadata,
            connectedAt: Date.now()
        };

        this.connections.set(connectionId, connection);

        // チャンネルに接続を追加
        if (!this.channels.has(channel)) {
            this.channels.set(channel, new Set());
        }
        this.channels.get(channel)!.add(connectionId);

        // クライアント切断時のクリーンアップ
        res.on('close', () => {
            this.removeConnection(connectionId);
        });

        // 接続確認メッセージを送信
        this.sendToConnection(connectionId, {
            type: 'connected',
            timestamp: Date.now(),
            message: 'SSE connection established'
        });

        console.log(`[SSEManager] Connection added: ${connectionId} to channel: ${channel}`);
    }

    /**
     * 接続を削除
     * @param connectionId 接続ID
     */
    removeConnection(connectionId: string): void {
        const connection = this.connections.get(connectionId);
        if (!connection) return;

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

        console.log(`[SSEManager] Connection removed: ${connectionId} from channel: ${connection.channel}`);
    }

    /**
     * 特定の接続にデータを送信
     * @param connectionId 接続ID
     * @param data 送信するデータ
     */
    sendToConnection(connectionId: string, data: any): boolean {
        const connection = this.connections.get(connectionId);
        if (!connection) return false;

        try {
            connection.res.write(`data: ${JSON.stringify(data)}\n\n`);
            return true;
        } catch (error) {
            console.error(`[SSEManager] Failed to send to connection ${connectionId}:`, error);
            this.removeConnection(connectionId);
            return false;
        }
    }

    /**
     * チャンネル全体にブロードキャスト
     * @param channel チャンネル名
     * @param data 送信するデータ
     * @param filter オプション: 特定の条件でフィルタリング
     */
    broadcast(
        channel: string,
        data: any,
        filter?: (connection: SSEConnection) => boolean
    ): number {
        const channelConnections = this.channels.get(channel);
        if (!channelConnections) return 0;

        let sentCount = 0;
        for (const connectionId of channelConnections) {
            const connection = this.connections.get(connectionId);
            if (!connection) continue;

            // フィルター条件が指定されている場合は適用
            if (filter && !filter(connection)) continue;

            if (this.sendToConnection(connectionId, data)) {
                sentCount++;
            }
        }

        return sentCount;
    }

    /**
     * 全チャンネルにブロードキャスト
     * @param data 送信するデータ
     */
    broadcastAll(data: any): number {
        let sentCount = 0;
        for (const connectionId of this.connections.keys()) {
            if (this.sendToConnection(connectionId, data)) {
                sentCount++;
            }
        }
        return sentCount;
    }

    /**
     * チャンネル内の接続数を取得
     * @param channel チャンネル名
     */
    getConnectionCount(channel: string): number {
        return this.channels.get(channel)?.size || 0;
    }

    /**
     * 全接続数を取得
     */
    getTotalConnectionCount(): number {
        return this.connections.size;
    }

    /**
     * チャンネル一覧を取得
     */
    getChannels(): string[] {
        return Array.from(this.channels.keys());
    }

    /**
     * 接続情報を取得（デバッグ用）
     */
    getConnectionInfo(connectionId: string): SSEConnection | undefined {
        return this.connections.get(connectionId);
    }

    /**
     * Keep-aliveメッセージを送信（接続維持用）
     * 定期的に呼び出すことを推奨
     */
    sendKeepAlive(channel?: string): void {
        const data = {
            type: 'keepalive',
            timestamp: Date.now()
        };

        if (channel) {
            this.broadcast(channel, data);
        } else {
            this.broadcastAll(data);
        }
    }
}

// シングルトンインスタンス
export const sseManager = new SSEManager();
