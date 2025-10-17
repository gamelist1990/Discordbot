import React, { useState, useEffect, useRef } from 'react';
import styles from './LivePanel.module.css';

interface TriggerEvent {
    id: string;
    triggerId: string;
    triggerName: string;
    eventType: string;
    timestamp: number;
    success: boolean;
    presetsFired: Array<{
        presetId: string;
        presetIndex: number;
        presetType: string;
        output?: string;
        error?: string;
    }>;
    executionTime?: number;
    error?: string;
}

interface LivePanelProps {
    selectedTriggerId?: string;
}

const LivePanel: React.FC<LivePanelProps> = ({ selectedTriggerId }) => {
    const [events, setEvents] = useState<TriggerEvent[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [filterEventType, setFilterEventType] = useState<string>('all');
    const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
    const eventsEndRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [debugLogs, setDebugLogs] = useState<string[]>([]);

    useEffect(() => {
        connectWebSocket();
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);

    useEffect(() => {
        if (eventsEndRef.current && !isPaused) {
            eventsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [events, isPaused]);

    const connectWebSocket = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/trigger`;

        try {
            wsRef.current = new WebSocket(wsUrl);

            wsRef.current.onopen = () => {
                console.log('[LivePanel] WebSocket connected to /ws/trigger');
                setDebugLogs(l => [`OPEN ${new Date().toISOString()}`, ...l].slice(0, 50));
                setIsConnected(true);

                // 少し待ってから subscribe を送る（接続ハンドシェイクの安定化）
                setTimeout(() => {
                    try {
                        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                            const subscribeMsg = { type: 'subscribe', payload: { channel: 'trigger' } };
                            console.log('[LivePanel] Sending subscribe message:', subscribeMsg);
                            setDebugLogs(l => [`SEND ${new Date().toISOString()} ${JSON.stringify(subscribeMsg)}`, ...l].slice(0, 50));
                            wsRef.current.send(JSON.stringify(subscribeMsg));
                        }
                    } catch (e) {
                        console.warn('[LivePanel] Failed to send subscribe:', e);
                        setDebugLogs(l => [`ERROR SEND ${new Date().toISOString()} ${String(e)}`, ...l].slice(0, 50));
                    }
                }, 200);
            };

            wsRef.current.onmessage = event => {
                // Log raw frame for debugging (visible in-page)
                const raw = String(event.data);
                console.log('[LivePanel] Raw WS frame received:', raw);
                setDebugLogs(l => [`RECV ${new Date().toISOString()} ${raw}`, ...l].slice(0, 50));

                if (isPaused) return;

                try {
                    const data = JSON.parse(event.data);

                    // ハートビート/pong メッセージは無視
                    if (data.type === 'pong') {
                        console.log('[LivePanel] Received pong');
                        setDebugLogs(l => [`PONG ${new Date().toISOString()}`, ...l].slice(0, 50));
                        return;
                    }

                    // triggerUpdate メッセージを処理
                    if (data.type === 'triggerUpdate' && data.payload) {
                        console.log('[LivePanel] Received triggerUpdate');
                        setDebugLogs(l => [`UPDATE ${new Date().toISOString()} ${JSON.stringify(data.payload)}`, ...l].slice(0, 50));
                        const { triggerId, triggerName, eventType, presetsFired, success, error, executionTime } = data.payload;
                        
                        const triggerEvent: TriggerEvent = {
                            id: `event-${Date.now()}-${Math.random()}`,
                            triggerId: triggerId || 'unknown',
                            triggerName: triggerName || 'Unknown',
                            eventType: eventType || 'unknown',
                            timestamp: data.timestamp || Date.now(),
                            success: success !== false,
                            presetsFired: presetsFired || [],
                            executionTime,
                            error
                        };

                        setEvents(prev => {
                            const updated = [triggerEvent, ...prev];
                            return updated.slice(0, 100);
                        });
                        return;
                    }
                    
                    // 後方互換性: trigger:fired メッセージ
                    if (data.type === 'trigger:fired') {
                        console.log('[LivePanel] Received trigger:fired');
                        setDebugLogs(l => [`FIRED ${new Date().toISOString()} ${JSON.stringify(data)}`, ...l].slice(0, 50));
                        // サーバー側は payload にイベントを入れて送る場合がある
                        const payload = data.payload || data;

                        const triggerEvent: TriggerEvent = {
                            id: `event-${Date.now()}-${Math.random()}`,
                            triggerId: payload.triggerId || payload.id || 'unknown',
                            triggerName: payload.triggerName || payload.summary || 'Unknown',
                            eventType: payload.eventType || 'unknown',
                            timestamp: data.timestamp || payload.timestamp || Date.now(),
                            success: payload.success !== false,
                            presetsFired: payload.presetsFired || payload.presets || [],
                            executionTime: payload.executionTime,
                            error: payload.error
                        };

                        setEvents(prev => {
                            const updated = [triggerEvent, ...prev];
                            return updated.slice(0, 100);
                        });
                        return;
                    }

                    // その他のメッセージ型のデバッグ出力
                    console.log('[LivePanel] Unhandled WS message type:', data.type || '(no type)', data);
                    setDebugLogs(l => [`UNHANDLED ${new Date().toISOString()} ${JSON.stringify(data)}`, ...l].slice(0, 50));
                } catch (err) {
                    console.error('[LivePanel] Failed to parse WebSocket message:', err, 'raw:', event.data);
                    setDebugLogs(l => [`PARSE_ERR ${new Date().toISOString()} ${String(err)} raw:${String(event.data)}`, ...l].slice(0, 50));
                }
            };

            wsRef.current.onclose = (ev) => {
                const code = (ev && (ev as CloseEvent).code) || null;
                const reason = (ev && (ev as CloseEvent).reason) || null;
                console.log('[LivePanel] WebSocket disconnected', { code, reason });
                setDebugLogs(l => [`CLOSE ${new Date().toISOString()} code:${code} reason:${reason}`, ...l].slice(0, 50));
                setIsConnected(false);
                // 少し遅めに再接続（バックオフ）
                setTimeout(() => connectWebSocket(), 3000 + Math.floor(Math.random() * 2000));
            };

            wsRef.current.onerror = (err) => {
                console.error('[LivePanel] WebSocket error:', err);
                setIsConnected(false);
            };
        } catch (err) {
            console.error('[LivePanel] WebSocket connection failed:', err);
            setIsConnected(false);
        }
    };

    const clearEvents = () => {
        setEvents([]);
        setExpandedEventId(null);
    };

    const filteredEvents = events.filter(event => {
        if (selectedTriggerId && event.triggerId !== selectedTriggerId) {
            return false;
        }
        if (filterEventType !== 'all' && event.eventType !== filterEventType) {
            return false;
        }
        return true;
    });

    const eventTypes = [
        'messageCreate',
        'messageUpdate',
        'messageDelete',
        'guildMemberAdd',
        'guildMemberRemove',
        'interactionCreate',
        'messageReactionAdd',
        'voiceStateUpdate'
    ];

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('ja-JP');
    };

    const getStatusIcon = (success: boolean) => {
        return success ? 'check_circle' : 'error';
    };

    const getStatusColor = (success: boolean) => {
        return success ? '#4CAF50' : '#F44336';
    };

    return (
        <div className={styles.livePanel}>
            <div className={styles.livePanelHeader}>
                <h3>ライブ実行ログ</h3>
                <div className={styles.statusBadge}>
                    <span
                        className="material-icons"
                        style={{
                            color: isConnected ? '#4CAF50' : '#999',
                            fontSize: '14px',
                            animation: isConnected
                                ? 'pulse 2s infinite'
                                : 'none'
                        }}
                    >
                        {isConnected ? 'fiber_manual_record' : 'cloud_off'}
                    </span>
                    {isConnected ? 'オンライン' : 'オフライン'}
                </div>
            </div>

            <div className={styles.livePanelControls}>
                <select
                    value={filterEventType}
                    onChange={e => setFilterEventType(e.target.value)}
                    className={styles.select}
                >
                    <option value="all">すべてのイベント</option>
                    {eventTypes.map(type => (
                        <option key={type} value={type}>
                            {type}
                        </option>
                    ))}
                </select>

                <button
                    className={`${styles.pauseBtn} ${isPaused ? styles.paused : ''}`}
                    onClick={() => setIsPaused(!isPaused)}
                    title={isPaused ? '再開' : '一時停止'}
                >
                    <span className="material-icons">
                        {isPaused ? 'play_arrow' : 'pause'}
                    </span>
                </button>

                <button
                    className={styles.clearBtn}
                    onClick={clearEvents}
                    title="クリア"
                >
                    <span className="material-icons">clear_all</span>
                </button>
            </div>

            <div className={styles.eventsContainer}>
                {/* On-page WS debug logs */}
                <div style={{ marginBottom: 8 }}>
                    <div className={styles.wsDebug}>
                        {debugLogs.length === 0 ? (
                            <div className={styles.wsDebugItem}>WS デバッグ: まだログがありません</div>
                        ) : (
                            debugLogs.map((l, idx) => (
                                <div key={idx} className={styles.wsDebugItem}>{l}</div>
                            ))
                        )}
                    </div>
                </div>
                {filteredEvents.length === 0 ? (
                    <div className={styles.emptyEvents}>
                        <p>イベントはまだ表示されていません</p>
                    </div>
                ) : (
                    <div className={styles.eventsList}>
                        {filteredEvents.map(event => (
                            <div
                                key={event.id}
                                className={`${styles.eventItem} ${
                                    event.success
                                        ? styles.eventSuccess
                                        : styles.eventError
                                }`}
                            >
                                <div
                                    className={styles.eventItemHeader}
                                    onClick={() =>
                                        setExpandedEventId(
                                            expandedEventId === event.id
                                                ? null
                                                : event.id
                                        )
                                    }
                                >
                                    <span
                                        className="material-icons"
                                        style={{
                                            color: getStatusColor(event.success)
                                        }}
                                    >
                                        {getStatusIcon(event.success)}
                                    </span>

                                    <div className={styles.eventSummary}>
                                        <strong>{event.triggerName}</strong>
                                        <span className={styles.eventMeta}>
                                            {event.eventType} •{' '}
                                            {formatTime(event.timestamp)}
                                        </span>
                                    </div>

                                    <span className={styles.expandIcon}>
                                        <span className="material-icons">
                                            {expandedEventId === event.id
                                                ? 'expand_less'
                                                : 'expand_more'}
                                        </span>
                                    </span>
                                </div>

                                {expandedEventId === event.id && (
                                    <div className={styles.eventDetails}>
                                        {event.executionTime !== undefined && (
                                            <p>
                                                <strong>実行時間:</strong>{' '}
                                                {event.executionTime}ms
                                            </p>
                                        )}

                                        {event.presetsFired.length > 0 && (
                                            <div>
                                                <strong>
                                                    実行プリセット (
                                                    {event.presetsFired.length}
                                                    ):
                                                </strong>
                                                <ul>
                                                    {event.presetsFired.map(
                                                        (preset, idx) => (
                                                            <li key={idx}>
                                                                <span className={styles.badge}>
                                                                    {preset.presetType}
                                                                </span>
                                                                {preset.error ? (
                                                                    <span className={styles.errorText}>
                                                                        エラー:{' '}
                                                                        {
                                                                            preset.error
                                                                        }
                                                                    </span>
                                                                ) : (
                                                                    <span className={styles.successText}>
                                                                        成功
                                                                    </span>
                                                                )}
                                                                {preset.output && (
                                                                    <pre className={styles.output}>
                                                                        {preset.output.substring(
                                                                            0,
                                                                            200
                                                                        )}
                                                                        {preset.output
                                                                            .length >
                                                                            200 &&
                                                                            '...'}
                                                                    </pre>
                                                                )}
                                                            </li>
                                                        )
                                                    )}
                                                </ul>
                                            </div>
                                        )}

                                        {event.error && (
                                            <p className={styles.errorText}>
                                                <strong>エラー:</strong>{' '}
                                                {event.error}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                <div ref={eventsEndRef} />
            </div>
        </div>
    );
};

export default LivePanel;
