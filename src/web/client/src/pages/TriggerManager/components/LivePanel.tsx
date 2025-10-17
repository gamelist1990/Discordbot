import React, { useState, useEffect, useRef } from 'react';
import styles from '../TriggerManager.module.css';

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
        const wsUrl = `${protocol}//${window.location.host}`;

        try {
            wsRef.current = new WebSocket(wsUrl);

            wsRef.current.onopen = () => {
                setIsConnected(true);
            };

            wsRef.current.onmessage = event => {
                if (isPaused) return;

                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'trigger:fired') {
                        const triggerEvent: TriggerEvent = {
                            id: `event-${Date.now()}-${Math.random()}`,
                            triggerId: data.triggerId,
                            triggerName: data.triggerName || 'Unknown',
                            eventType: data.eventType || 'unknown',
                            timestamp: Date.now(),
                            success: data.success !== false,
                            presetsFired: data.presetsFired || [],
                            executionTime: data.executionTime,
                            error: data.error
                        };

                        setEvents(prev => {
                            const updated = [triggerEvent, ...prev];
                            return updated.slice(0, 100);
                        });
                    }
                } catch (err) {
                    console.error('Failed to parse WebSocket message:', err);
                }
            };

            wsRef.current.onclose = () => {
                setIsConnected(false);
                setTimeout(connectWebSocket, 3000);
            };

            wsRef.current.onerror = () => {
                setIsConnected(false);
            };
        } catch (err) {
            console.error('WebSocket connection failed:', err);
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
