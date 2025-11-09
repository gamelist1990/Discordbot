import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAntiCheatSettings, useDetectionLogs, useAntiCheatActions } from './hooks';
import Layout from '../../../components/Layout/Layout';
import styles from './Desktop.module.css';

/**
 * Desktop AntiCheat Management Interface
 * Features: Table view, detailed settings panel, bulk operations, search/filter
 */
const AntiCheatDesktop: React.FC = () => {
    const { guildId } = useParams<{ guildId: string }>();
    const navigate = useNavigate();
    const { settings, loading, error, updateSettings } = useAntiCheatSettings(guildId!);
    const { logs, loading: logsLoading, refetch: refetchLogs } = useDetectionLogs(guildId!, 50);
    const { revokeTimeout, executing } = useAntiCheatActions(guildId!);

    const [activeTab, setActiveTab] = useState<'settings' | 'logs' | 'trust'>('settings');
    const [searchTerm, setSearchTerm] = useState('');

    if (!guildId) {
        navigate('/404');
        return null;
    }

    if (loading) {
        return (
            <Layout activeTab={activeTab} onTabChange={(t) => setActiveTab(t as 'settings' | 'logs' | 'trust')}>
                <div className={styles.container}>
                    <div className={styles.loading}>読み込み中...</div>
                </div>
            </Layout>
        );
    }

    if (error) {
        return (
            <Layout activeTab={activeTab} onTabChange={(t) => setActiveTab(t as 'settings' | 'logs' | 'trust')}>
                <div className={styles.container}>
                    <div className={styles.error}>エラー: {error}</div>
                </div>
            </Layout>
        );
    }

    if (!settings) {
        return (
            <Layout activeTab={activeTab} onTabChange={(t) => setActiveTab(t as 'settings' | 'logs' | 'trust')}>
                <div className={styles.container}>
                    <div className={styles.error}>設定が見つかりません</div>
                </div>
            </Layout>
        );
    }

    const handleToggleEnabled = async () => {
        await updateSettings({ enabled: !settings.enabled });
    };

    const handleAddPunishment = async () => {
        const threshold = parseInt(prompt('しきい値を入力してください (例: 5)') || '0');
        const duration = parseInt(prompt('タイムアウト時間（秒）を入力してください (例: 300)') || '0');
        
        if (threshold > 0 && duration > 0) {
            const newPunishments = [
                ...settings.punishments,
                {
                    threshold,
                    actions: [{
                        type: 'timeout' as const,
                        durationSeconds: duration,
                        reasonTemplate: 'AntiCheat violation: Trust score reached {threshold}',
                        notify: true
                    }]
                }
            ];
            await updateSettings({ punishments: newPunishments });
        }
    };

    const handleRemovePunishment = async (index: number) => {
        const newPunishments = settings.punishments.filter((_, i) => i !== index);
        await updateSettings({ punishments: newPunishments });
    };

    const handleRevokeTimeout = async (userId: string) => {
        const resetTrust = window.confirm('信頼スコアもリセットしますか？');
        const success = await revokeTimeout(userId, resetTrust);
        if (success) {
            alert('タイムアウトを解除しました');
            refetchLogs();
        }
    };

    const filteredLogs = logs.filter(log =>
        log.userId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.reason.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <Layout activeTab={activeTab} onTabChange={(t) => setActiveTab(t as 'settings' | 'logs' | 'trust')}>
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1>🛡️ AntiCheat 管理</h1>
                    <div className={styles.headerActions}>
                        <button
                            className={`${styles.btn} ${settings.enabled ? styles.btnDanger : styles.btnSuccess}`}
                            onClick={handleToggleEnabled}
                        >
                            {settings.enabled ? '無効化' : '有効化'}
                        </button>
                    </div>
                </div>

                <div className={styles.tabs}>
                    <button
                        className={`${styles.tab} ${activeTab === 'settings' ? styles.tabActive : ''}`}
                        onClick={() => setActiveTab('settings')}
                    >
                        設定
                    </button>
                    <button
                        className={`${styles.tab} ${activeTab === 'logs' ? styles.tabActive : ''}`}
                        onClick={() => setActiveTab('logs')}
                    >
                        検知ログ
                    </button>
                    <button
                        className={`${styles.tab} ${activeTab === 'trust' ? styles.tabActive : ''}`}
                        onClick={() => setActiveTab('trust')}
                    >
                        信頼スコア
                    </button>
                </div>

                {activeTab === 'settings' && (
                    <div className={styles.content}>
                        <div className={styles.section}>
                            <h2>検知器</h2>
                            <div className={styles.detectorsList}>
                                {Object.entries(settings.detectors).map(([name, config]) => (
                                    <div key={name} className={styles.detectorItem}>
                                        <label>
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
                                            <span className={styles.detectorName}>{name}</span>
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className={styles.section}>
                            <h2>自動処罰設定</h2>
                            <p className={styles.hint}>
                                信頼スコアがしきい値に達した場合の自動処罰を設定します。
                                デフォルトでは無効です。
                            </p>
                            <button className={styles.btnPrimary} onClick={handleAddPunishment}>
                                + 処罰ルールを追加
                            </button>
                            <div className={styles.punishmentsList}>
                                {settings.punishments.length === 0 ? (
                                    <p className={styles.noPunishments}>
                                        処罰ルールが設定されていません（ログのみモード）
                                    </p>
                                ) : (
                                    settings.punishments.map((punishment, index) => (
                                        <div key={index} className={styles.punishmentItem}>
                                            <div className={styles.punishmentInfo}>
                                                <strong>しきい値: {punishment.threshold}</strong>
                                                <div>
                                                    {punishment.actions.map((action, aIdx) => (
                                                        <span key={aIdx} className={styles.actionBadge}>
                                                            {action.type}
                                                            {action.durationSeconds && ` (${action.durationSeconds}s)`}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                            <button
                                                className={styles.btnDanger}
                                                onClick={() => handleRemovePunishment(index)}
                                            >
                                                削除
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        <div className={styles.section}>
                            <h2>除外設定</h2>
                            <div className={styles.excludeInfo}>
                                <p>除外されたロール数: {settings.excludedRoles.length}</p>
                                <p>除外されたチャンネル数: {settings.excludedChannels.length}</p>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'logs' && (
                    <div className={styles.content}>
                        <div className={styles.logsHeader}>
                            <input
                                type="text"
                                placeholder="ユーザーIDまたは理由で検索..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className={styles.searchInput}
                            />
                            <button className={styles.btnSecondary} onClick={() => refetchLogs()}>
                                🔄 更新
                            </button>
                        </div>

                        {logsLoading ? (
                            <div className={styles.loading}>読み込み中...</div>
                        ) : filteredLogs.length === 0 ? (
                            <div className={styles.noLogs}>検知ログがありません</div>
                        ) : (
                            <div className={styles.logsTable}>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>時刻</th>
                                            <th>ユーザーID</th>
                                            <th>検知器</th>
                                            <th>スコア増加</th>
                                            <th>理由</th>
                                            <th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredLogs.map((log) => (
                                            <tr key={log.messageId}>
                                                <td>{new Date(log.timestamp).toLocaleString('ja-JP')}</td>
                                                <td className={styles.userId}>{log.userId}</td>
                                                <td>
                                                    <span className={styles.detectorBadge}>{log.detector}</span>
                                                </td>
                                                <td className={styles.scoreDelta}>+{log.scoreDelta}</td>
                                                <td className={styles.reason}>{log.reason}</td>
                                                <td>
                                                    <button
                                                        className={styles.btnSmall}
                                                        onClick={() => handleRevokeTimeout(log.userId)}
                                                        disabled={executing}
                                                    >
                                                        解除
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'trust' && (
                    <div className={styles.content}>
                        <div className={styles.trustInfo}>
                            <p>信頼スコア機能は実装中です</p>
                        </div>
                    </div>
                )}
            </div>
        </Layout>
    );
};

export default AntiCheatDesktop;
