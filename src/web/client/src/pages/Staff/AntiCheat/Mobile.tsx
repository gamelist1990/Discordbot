import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAntiCheatSettings, useDetectionLogs, useAntiCheatActions } from './hooks';
import Layout from '../../../components/Layout/Layout';
import styles from './Mobile.module.css';

/**
 * Mobile AntiCheat Management Interface
 * Features: Card-based list, one-tap enable/disable, essential settings only
 */
const AntiCheatMobile: React.FC = () => {
    const { guildId } = useParams<{ guildId: string }>();
    const navigate = useNavigate();
    const { settings, loading, error, updateSettings } = useAntiCheatSettings(guildId!);
    const { logs, loading: logsLoading, refetch: refetchLogs } = useDetectionLogs(guildId!, 20);
    const { revokeTimeout, executing } = useAntiCheatActions(guildId!);

    const [activeView, setActiveView] = useState<'overview' | 'logs'>('overview');

    if (!guildId) {
        navigate('/404');
        return null;
    }

    if (loading) {
        return (
            <Layout activeTab={activeView} onTabChange={(t) => setActiveView(t as any)}>
                <div className={styles.container}>
                    <div className={styles.loading}>読み込み中...</div>
                </div>
            </Layout>
        );
    }

    if (error) {
        return (
            <Layout activeTab={activeView} onTabChange={(t) => setActiveView(t as any)}>
                <div className={styles.container}>
                    <div className={styles.error}>エラー: {error}</div>
                </div>
            </Layout>
        );
    }

    if (!settings) {
        return (
            <Layout activeTab={activeView} onTabChange={(t) => setActiveView(t as any)}>
                <div className={styles.container}>
                    <div className={styles.error}>設定が見つかりません</div>
                </div>
            </Layout>
        );
    }

    const handleToggleEnabled = async () => {
        await updateSettings({ enabled: !settings.enabled });
    };

    const handleRevokeTimeout = async (userId: string) => {
        const resetTrust = window.confirm('信頼スコアもリセットしますか？');
        const success = await revokeTimeout(userId, resetTrust);
        if (success) {
            alert('タイムアウトを解除しました');
            refetchLogs();
        }
    };

    return (
        <Layout activeTab={activeView} onTabChange={(t) => setActiveView(t as any)}>
            <div className={styles.container}>
                {/* Header */}
                <div className={styles.header}>
                    <h1>🛡️ AntiCheat</h1>
                    <button
                        className={`${styles.toggleBtn} ${settings.enabled ? styles.toggleActive : ''}`}
                        onClick={handleToggleEnabled}
                    >
                        {settings.enabled ? 'ON' : 'OFF'}
                    </button>
                </div>

                {/* Navigation */}
                <div className={styles.nav}>
                    <button
                        className={`${styles.navBtn} ${activeView === 'overview' ? styles.navBtnActive : ''}`}
                        onClick={() => setActiveView('overview')}
                    >
                        概要
                    </button>
                    <button
                        className={`${styles.navBtn} ${activeView === 'logs' ? styles.navBtnActive : ''}`}
                        onClick={() => setActiveView('logs')}
                    >
                        ログ
                    </button>
                </div>

                {/* Overview View */}
                {activeView === 'overview' && (
                    <div className={styles.content}>
                        {/* Status Card */}
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <h2>ステータス</h2>
                            </div>
                            <div className={styles.cardBody}>
                                <div className={styles.statusItem}>
                                    <span>システム</span>
                                    <span className={settings.enabled ? styles.statusOn : styles.statusOff}>
                                        {settings.enabled ? '有効' : '無効'}
                                    </span>
                                </div>
                                <div className={styles.statusItem}>
                                    <span>自動処罰</span>
                                    <span className={settings.punishments.length > 0 ? styles.statusOn : styles.statusOff}>
                                        {settings.punishments.length > 0 ? '有効' : '無効'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Detectors Card */}
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <h2>検知器</h2>
                            </div>
                            <div className={styles.cardBody}>
                                {Object.entries(settings.detectors).map(([name, config]) => (
                                    <div key={name} className={styles.detectorRow}>
                                        <span className={styles.detectorName}>{name}</span>
                                        <label className={styles.switch}>
                                            <input
                                                type="checkbox"
                                                checked={config.enabled}
                                                onChange={async (e) => {
                                                    await updateSettings({
                                                        detectors: {
                                                            ...settings.detectors,
                                                            [name]: { ...config, enabled: e.target.checked }
                                                        }
                                                    });
                                                }}
                                            />
                                            <span className={styles.slider}></span>
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Punishments Card */}
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <h2>自動処罰</h2>
                            </div>
                            <div className={styles.cardBody}>
                                {settings.punishments.length === 0 ? (
                                    <p className={styles.noPunishments}>
                                        処罰ルールなし（ログのみ）
                                    </p>
                                ) : (
                                    settings.punishments.map((punishment, index) => (
                                        <div key={index} className={styles.punishmentRow}>
                                            <div className={styles.punishmentInfo}>
                                                <strong>しきい値: {punishment.threshold}</strong>
                                                <div className={styles.punishmentActions}>
                                                    {punishment.actions.map((action, aIdx) => (
                                                        <span key={aIdx} className={styles.actionTag}>
                                                            {action.type}
                                                            {action.durationSeconds && ` ${action.durationSeconds}s`}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Logs View */}
                {activeView === 'logs' && (
                    <div className={styles.content}>
                        <div className={styles.logsHeader}>
                            <button
                                className={styles.refreshBtn}
                                onClick={() => refetchLogs()}
                                disabled={logsLoading}
                            >
                                🔄 更新
                            </button>
                        </div>

                        {logsLoading ? (
                            <div className={styles.loading}>読み込み中...</div>
                        ) : logs.length === 0 ? (
                            <div className={styles.noLogs}>検知ログがありません</div>
                        ) : (
                            <div className={styles.logsList}>
                                {logs.map((log) => (
                                    <div key={log.messageId} className={styles.logCard}>
                                        <div className={styles.logHeader}>
                                            <span className={styles.logTime}>
                                                {new Date(log.timestamp).toLocaleString('ja-JP', {
                                                    month: 'short',
                                                    day: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </span>
                                            <span className={styles.logScore}>+{log.scoreDelta}</span>
                                        </div>
                                        <div className={styles.logBody}>
                                            <div className={styles.logUser}>
                                                ユーザー: <code>{log.userId}</code>
                                            </div>
                                            <div className={styles.logDetector}>
                                                検知器: <span className={styles.detectorTag}>{log.detector}</span>
                                            </div>
                                            <div className={styles.logReason}>{log.reason}</div>
                                        </div>
                                        <div className={styles.logActions}>
                                            <button
                                                className={styles.revokeBtn}
                                                onClick={() => handleRevokeTimeout(log.userId)}
                                                disabled={executing}
                                            >
                                                解除
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Layout>
    );
};

export default AntiCheatMobile;
