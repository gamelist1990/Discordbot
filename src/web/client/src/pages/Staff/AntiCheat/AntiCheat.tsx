import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAntiCheatSettings, useDetectionLogs, useAntiCheatActions, useUserTrust } from './hooks';
import AntiCheatLayout from './AntiCheatLayout';
import styles from './AntiCheat.module.css';
import { UserTrustData, UserTrustDataWithUser } from './types';

const detectorDescriptions: Record<string, string> = {
    textSpam: 'テキストメッセージのスパム検知。短時間に大量のメッセージを送信するユーザーを検知します。',
    mentionSpam: 'メンションの過度な使用を検知。過剰な@メンションを防ぎます。',
    linkSpam: 'リンクのスパム検知。短時間に大量のリンクを送信するユーザーを検知します。',
    capsSpam: '大文字の過度な使用を検知。すべて大文字のメッセージを防ぎます。',
    emojiSpam: '絵文字の過度な使用を検知。過剰な絵文字使用を防ぎます。',
    raidDetection: 'サーバー襲撃の検知。新規ユーザーの大量参加を監視します。',
    duplicateMessage: '重複メッセージの検知。同じメッセージの繰り返し送信を防ぎます。',
    wordFilter: '単語フィルター。禁止された単語やフレーズを含むメッセージを検知します。',
    inviteFilter: '招待リンクフィルター。Discord招待リンクの送信を防ぎます。',
    imageSpam: '画像スパムの検知。短時間    に大量の画像を送信するユーザーを検知します。'
};

const humanizeDetectorName = (key: string) => {
    // camelCase -> Title Case + spaces
    const parts = key.replace(/([A-Z])/g, ' $1').split(/_|\s+/).filter(Boolean);
    return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
};


const useIsMobile = (breakpoint = 768) => {
    const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < breakpoint : false);
    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < breakpoint);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [breakpoint]);
    return isMobile;
};

// Parse duration strings like '1d', '2h', '30m', '45s' or plain seconds '300'
function parseDurationToSeconds(input: string | number | undefined): number {
    if (input === undefined || input === null) return 0;
    if (typeof input === 'number') return Math.max(0, Math.floor(input));
    const s = String(input).trim().toLowerCase();
    if (!s) return 0;
    const m = s.match(/^(\d+)\s*([smhd])$/i);
    if (m) {
        const n = parseInt(m[1], 10);
        const unit = m[2];
        switch (unit) {
            case 'd': return n * 86400;
            case 'h': return n * 3600;
            case 'm': return n * 60;
            case 's': return n;
        }
    }
    // fallback: numeric seconds
    const asNum = parseInt(s, 10);
    return isNaN(asNum) ? 0 : asNum;
}

function secondsToInputString(sec: number): string {
    if (!sec || sec <= 0) return '';
    if (sec % 86400 === 0) return `${sec / 86400}d`;
    if (sec % 3600 === 0) return `${sec / 3600}h`;
    if (sec % 60 === 0) return `${sec / 60}m`;
    return `${sec}s`;
}

const AntiCheatUnified: React.FC = () => {
    const { guildId } = useParams<{ guildId: string }>();
    const navigate = useNavigate();
    const isMobile = useIsMobile(880);

    const { settings, loading, error, updateSettings } = useAntiCheatSettings(guildId!);
    const { logs, loading: logsLoading, refetch: refetchLogs } = useDetectionLogs(guildId!, isMobile ? 20 : 50);
    const { revokeTimeout, resetTrust, executing, error: actionError } = useAntiCheatActions(guildId!);
    const { trust: userTrustData, loading: trustLoading, error: trustError, refetch: refetchTrust } = useUserTrust(guildId!);

    const [activeView, setActiveView] = useState<'settings' | 'logs' | 'trust' | 'overview'>('settings');
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});
    const [severityFilter, setSeverityFilter] = useState<'all'|'low'|'medium'|'high'>('all');
    const [trustSearchTerm, setTrustSearchTerm] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [editIndex, setEditIndex] = useState<number | null>(null);
    const [newThreshold, setNewThreshold] = useState('');
    const [newDuration, setNewDuration] = useState('');
    const [newActionType, setNewActionType] = useState<'timeout' | 'kick' | 'ban'>('timeout');
    const [autoTimeoutInput, setAutoTimeoutInput] = useState('');
    const [autoDeleteInput, setAutoDeleteInput] = useState('');
    const [confirmModalOpen, setConfirmModalOpen] = useState(false);
    const [confirmModalType, setConfirmModalType] = useState<'revokeTimeout' | 'resetTrust' | null>(null);
    const [confirmModalData, setConfirmModalData] = useState<any>(null);
    const [confirmModalMessage, setConfirmModalMessage] = useState('');
    const [confirmModalCallback, setConfirmModalCallback] = useState<(() => void) | null>(null);

    useEffect(() => {
        setActiveView(isMobile ? 'overview' : 'settings');
    }, [isMobile]);

    // sync autoTimeout / autoDelete inputs with settings whenever settings change
    useEffect(() => {
        if (!settings) return;
        setAutoTimeoutInput(secondsToInputString(settings.autoTimeout?.durationSeconds || 0) || String(settings.autoTimeout?.durationSeconds || ''));
        setAutoDeleteInput(secondsToInputString(settings.autoDelete?.windowSeconds || 0) || String(settings.autoDelete?.windowSeconds || ''));
    }, [settings]);

    // Auto-refresh logs while viewing logs so timed-out entries disappear when timeout ends
    useEffect(() => {
        if (activeView !== 'logs') return;
        const iv = setInterval(() => {
            refetchLogs();
        }, 8000);
        return () => clearInterval(iv);
    }, [activeView, refetchLogs]);

    if (!guildId) {
        navigate('/404');
        return null;
    }

    if (loading) {
        return (
            <AntiCheatLayout activeTab={activeView} onTabChange={(t) => setActiveView(t as any)}>
                <div className={isMobile ? styles.container : styles.layout}>
                    <div className={isMobile ? styles.loading : styles.header}>読み込み中...</div>
                </div>
            </AntiCheatLayout>
        );
    }

    if (error) {
        return (
            <AntiCheatLayout activeTab={activeView} onTabChange={(t) => setActiveView(t as any)}>
                <div className={isMobile ? styles.container : styles.layout}>
                    <div className={isMobile ? styles.error : styles.header}>エラー: {error}</div>
                </div>
            </AntiCheatLayout>
        );
    }

    if (!settings) {
        return (
            <AntiCheatLayout activeTab={activeView} onTabChange={(t) => setActiveView(t as any)}>
                <div className={isMobile ? styles.container : styles.layout}>
                    <div className={isMobile ? styles.error : styles.header}>設定が見つかりません</div>
                </div>
            </AntiCheatLayout>
        );
    }

    const handleToggleEnabled = async () => {
        await updateSettings({ enabled: !settings.enabled });
    };

    const enabledDetectorsCount = Object.values(settings.detectors || {}).filter((d: any) => d?.enabled).length;

    const handleAddPunishment = () => {
        setEditIndex(null);
        setNewThreshold('');
        setNewDuration('');
        setNewActionType('timeout');
        setModalOpen(true);
    };

    const handleEditPunishment = (index: number) => {
        const p = (settings.punishments || [])[index];
        if (!p) return;
        setEditIndex(index);
        setNewThreshold(String(p.threshold));
        const action = p.actions && p.actions[0];
        if (action) {
            setNewActionType(action.type as any || 'timeout');
            setNewDuration(action.durationSeconds ? String(action.durationSeconds) : '');
        } else {
            setNewActionType('timeout');
            setNewDuration('');
        }
        setModalOpen(true);
    };

    const handleSavePunishment = async () => {
        const threshold = parseInt(newThreshold);
        const duration = parseDurationToSeconds(newDuration);

        if (threshold > 0 && (newActionType !== 'timeout' || duration > 0)) {
            // Build action according to selected type
            const action = newActionType === 'timeout'
                ? ({ type: 'timeout' as const, durationSeconds: duration, reasonTemplate: 'AntiCheat violation: Trust score reached {threshold}', notify: true })
                : newActionType === 'ban'
                    ? ({ type: 'ban' as const, durationSeconds: duration || undefined, reasonTemplate: 'AntiCheat violation: Trust score reached {threshold}', notify: true })
                    : ({ type: 'kick' as const, reasonTemplate: 'AntiCheat violation: Trust score reached {threshold}', notify: true });

            let newPunishments = (settings.punishments || []).slice();
            if (editIndex !== null && editIndex >= 0 && editIndex < newPunishments.length) {
                // replace existing
                newPunishments[editIndex] = { threshold, actions: [action] };
            } else {
                // append
                newPunishments = [...newPunishments, { threshold, actions: [action] }];
            }
            await updateSettings({ punishments: newPunishments });
            setModalOpen(false);
            setNewThreshold('');
            setNewDuration('');
            setNewActionType('timeout');
            setEditIndex(null);
        }
    };

    const handleRemovePunishment = async (index: number) => {
        const newPunishments = (settings.punishments || []).filter((_, i) => i !== index);
        await updateSettings({ punishments: newPunishments });
    };

    const openConfirmModal = (type: 'revokeTimeout' | 'resetTrust', data: any, message: string, callback: () => void) => {
        setConfirmModalType(type);
        setConfirmModalData(data);
        setConfirmModalMessage(message);
        setConfirmModalCallback(() => callback);
        setConfirmModalOpen(true);
    };

    const toggleAllDetectors = async (enable: boolean) => {
        const newDetectors = Object.entries(settings.detectors || {}).reduce((acc, [k, v]) => ({ ...acc, [k]: { ...(v || {}), enabled: enable } }), {} as any);
        await updateSettings({ detectors: newDetectors });
    };

    // iOS-like switch component (small, self-contained)
    const IOSCheckbox: React.FC<{
        checked?: boolean;
        onChange?: (checked: boolean) => void;
        id?: string;
    }> = ({ checked = false, onChange, id }) => {
        return (
            <button
                id={id}
                aria-pressed={checked}
                onClick={() => onChange?.(!checked)}
                className={styles.iosSwitch}
                type="button"
            >
                <span className={`${styles.iosSwitchTrack} ${checked ? styles.iosOn : ''}`} />
                <span className={`${styles.iosSwitchThumb} ${checked ? styles.iosThumbOn : ''}`} />
            </button>
        );
    };

    const closeConfirmModal = () => {
        setConfirmModalOpen(false);
        setConfirmModalType(null);
        setConfirmModalData(null);
        setConfirmModalMessage('');
        setConfirmModalCallback(null);
    };

    const handleConfirmModalConfirm = async () => {
        if (confirmModalCallback) {
            if (confirmModalType === 'revokeTimeout') {
                // revokeTimeoutの場合、チェックボックスの状態に基づいて処理
                const resetTrustChecked = !!confirmModalData?.resetTrust; // デフォルトはfalse
                try {
                    const success = await revokeTimeout(confirmModalData.userId, resetTrustChecked, confirmModalData?.messageId);
                    if (success) {
                        try { (window as any).web?.notify?.('タイムアウトを解除しました', 'success', 'タイムアウト解除', 4000); } catch {}
                    } else {
                        try { (window as any).web?.notify?.('タイムアウトの解除に失敗しました', 'error', 'エラー', 4000); } catch {}
                    }
                    // ログがrevokeされている可能性があるので、常に再取得
                    refetchLogs();
                } catch (error) {
                    console.error('Error revoking timeout:', error);
                    try { (window as any).web?.notify?.('タイムアウトの解除中にエラーが発生しました', 'error', 'エラー', 4000); } catch {}
                    // エラー時もログがrevokeされている可能性があるので、再取得
                    refetchLogs();
                }
            } else {
                // その他の場合は通常のコールバックを実行
                try {
                    await confirmModalCallback();
                } catch (error) {
                    console.error('Error in confirm modal callback:', error);
                    try { (window as any).web?.notify?.('操作中にエラーが発生しました', 'error', 'エラー', 4000); } catch {}
                }
            }
        }
        closeConfirmModal();
    };

    const handleRevokeTimeout = async (userId: string, messageId?: string) => {
        try {
            // Always show confirmation modal before revoking.
            // Still attempt to read current timeout state for context, but do not auto-revoke.
            let isTimedOut = false;
            try {
                const response = await fetch(`/api/staff/anticheat/${guildId}/user-timeout/${userId}`, { credentials: 'include' });
                if (response.ok) {
                    const data = await response.json();
                    isTimedOut = !!data?.isTimedOut;
                }
            } catch (e) {
                // ignore individual check errors; we'll still show modal
            }

            openConfirmModal(
                'revokeTimeout',
                { userId, messageId, isTimedOut, resetTrust: false },
                isTimedOut ? 'ユーザーは現在タイムアウト中です。タイムアウトを解除しますか？（信頼スコアもリセットしますか）' : '信頼スコアもリセットしますか？',
                async () => {
                    const success = await revokeTimeout(userId, false, messageId);
                    if (success) {
                        try { (window as any).web?.notify?.('タイムアウトを解除しました', 'success', 'タイムアウト解除', 4000); } catch {}
                        refetchLogs();
                    }
                }
            );
        } catch (error) {
            console.error('Error preparing revoke modal:', error);
            // As a last resort, still open the modal without additional context
            openConfirmModal(
                'revokeTimeout',
                { userId, messageId, resetTrust: false },
                '信頼スコアもリセットしますか？',
                async () => {
                    const success = await revokeTimeout(userId, false, messageId);
                    if (success) {
                        try { (window as any).web?.notify?.('タイムアウトを解除しました', 'success', 'タイムアウト解除', 4000); } catch {}
                        refetchLogs();
                    }
                }
            );
        }
    };

    const handleResetTrust = async (userId: string) => {
        // Prefer display name or username for nicer confirmation message
        const trustEntry = (userTrustData as any) || {};
        const userInfo = trustEntry[userId];
        const display = userInfo?.displayName || userInfo?.username || userId;

        openConfirmModal(
            'resetTrust',
            { userId },
            `${display}（${userId}）の信頼スコアをリセットしますか？`,
            async () => {
                const success = await resetTrust(userId);
                if (success) {
                    try { (window as any).web?.notify?.('信頼スコアをリセットしました', 'success', '信頼スコアリセット', 4000); } catch {}
                    refetchTrust();
                } else {
                    try { (window as any).web?.notify?.(`信頼スコアのリセットに失敗しました: ${actionError || '不明なエラー'}`, 'error', 'エラー', 4000); } catch {}
                }
            }
        );
    };

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            try { (window as any).web?.notify?.('コピーしました', 'success', 'クリップボード', 1500); } catch {}
        } catch (e) {
            try { (window as any).web?.notify?.('コピーに失敗しました', 'error', 'エラー', 1500); } catch {}
        }
    };

    // Show only currently timed-out users in the logs view and apply search
    const filteredLogs = logs && Array.isArray(logs)
        ? logs.filter((log) => {
            const isTimedOut = !!(log.metadata && log.metadata.isTimedOut);
            if (!isTimedOut) return false;
            const q = (searchTerm || '').toLowerCase();
            const username = (log.metadata && ((log.metadata.username || log.metadata.displayName) || '')) as string;
            return (log.userId || '').toLowerCase().includes(q) || (log.reason || '').toLowerCase().includes(q) || (username || '').toLowerCase().includes(q);
        })
        : [];

            const severityForLog = (log: any) => {
                const sc = Math.abs(log.scoreDelta || 0);
                if (sc >= 10) return 'high';
                if (sc >= 4) return 'medium';
                return 'low';
            };

    const filteredTrustData = userTrustData && typeof userTrustData === 'object' && !Array.isArray(userTrustData)
        ? Object.entries(userTrustData as Record<string, UserTrustDataWithUser>).filter(([userId]) =>
            userId.toLowerCase().includes(trustSearchTerm.toLowerCase()) ||
            ((userTrustData as Record<string, UserTrustDataWithUser>)[userId])?.username?.toLowerCase().includes(trustSearchTerm.toLowerCase()) ||
            ((userTrustData as Record<string, UserTrustDataWithUser>)[userId])?.displayName?.toLowerCase().includes(trustSearchTerm.toLowerCase())
        )
        : [];

    // Render mobile layout
    if (isMobile) {
        return (
            <AntiCheatLayout activeTab={activeView} onTabChange={(t) => setActiveView(t as any)}>
                <div className={styles.container}>
                    <div className={styles.header}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <h1><span className={`${styles.statusDot} ${settings.enabled ? styles.statusDotOn : styles.statusDotOff}`} />🛡️ AntiCheat</h1>
                            <div style={{ fontSize: '0.85rem', color: 'var(--ac-muted)' }}>有効な検知: {enabledDetectorsCount}</div>
                        </div>
                        <button
                            className={`${styles.toggleBtn} ${settings.enabled ? styles.toggleActive : ''}`}
                            onClick={handleToggleEnabled}
                        >
                            {settings.enabled ? 'ON' : 'OFF'}
                        </button>
                    </div>

                    <div className={styles.nav}>
                        <button className={`${styles.navBtn} ${activeView === 'overview' ? styles.navBtnActive : ''}`} onClick={() => setActiveView('overview')}>概要</button>
                        <button className={`${styles.navBtn} ${activeView === 'logs' ? styles.navBtnActive : ''}`} onClick={() => setActiveView('logs')}>ログ</button>
                        <button className={`${styles.navBtn} ${activeView === 'trust' ? styles.navBtnActive : ''}`} onClick={() => setActiveView('trust')}>信頼</button>
                    </div>

                    {activeView === 'overview' && (
                        <div className={styles.content}>
                            {/* Status, detectors, punishments similar to Mobile.tsx */}
                            <div className={styles.card}>
                                <div className={styles.cardHeader}><h2>ステータス</h2></div>
                                <div className={styles.cardBody}>
                                    <div className={styles.detectorControls}>
                                        <div className={styles.detectorLabel}>一括操作:</div>
                                        <button className={styles.toggleAllBtn} onClick={() => toggleAllDetectors(true)}>すべて有効</button>
                                        <button className={styles.toggleAllBtn} onClick={() => toggleAllDetectors(false)}>すべて無効</button>
                                    </div>
                                    <div className={styles.statusItem}>
                                        <span>システム</span>
                                        <span className={settings.enabled ? styles.statusOn : styles.statusOff}>{settings.enabled ? '有効' : '無効'}</span>
                                    </div>
                                    <div className={styles.statusItem}>
                                        <span>自動処罰</span>
                                        <span className={(settings.punishments?.length || 0) > 0 ? styles.statusOn : styles.statusOff}>{(settings.punishments?.length || 0) > 0 ? '有効' : '無効'}</span>
                                    </div>
                                </div>
                            </div>

                            <div className={styles.card}>
                                <div className={styles.cardHeader}><h2>検知</h2></div>
                                <div className={styles.cardBody}>
                                    {Object.entries(settings.detectors || {}).map(([name, config]) => (
                                        <div key={name} className={`${styles.detectorRow} ${config?.enabled ? styles.detectorEnabled : ''}`}>
                                            <div className={styles.detectorInfo}>
                                                <span className={styles.detectorName}>{humanizeDetectorName(name)}</span>
                                                {detectorDescriptions[name] && (
                                                    <div className={styles.detectorDescription}>{detectorDescriptions[name]}</div>
                                                )}
                                            </div>
                                            <label className={styles.switch}>
                                                <IOSCheckbox checked={!!config?.enabled} onChange={async (v) => { await updateSettings({ detectors: { ...(settings.detectors || {}), [name]: { ...config, enabled: v } } }); }} />
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className={styles.card}>
                                <div className={styles.cardHeader}><h2>通知設定</h2></div>
                                <div className={styles.cardBody}>
                                    <div className={styles.formGroup}>
                                        <label htmlFor="mobileLogChannel">ログチャンネルID</label>
                                        <input
                                            id="mobileLogChannel"
                                            type="text"
                                            placeholder="例: 123456789012345678"
                                            value={settings.logChannelId || ''}
                                            onChange={async (e) => {
                                                await updateSettings({ logChannelId: e.target.value || null });
                                            }}
                                            className={styles.input}
                                        />
                                        <p className={styles.inputHint}>検知ログを送信するチャンネルID</p>
                                    </div>
                                </div>
                            </div>

                            <div className={styles.card}>
                                <div className={styles.cardHeader}><h2>自動タイムアウト設定</h2></div>
                                <div className={styles.cardBody}>
                                    <div className={styles.formGroup}>
                                            <label className={styles.checkboxLabel}>
                                            <IOSCheckbox
                                                checked={!!settings.autoTimeout?.enabled}
                                                onChange={async (v) => {
                                                    await updateSettings({
                                                        autoTimeout: {
                                                            enabled: v,
                                                            durationSeconds: settings.autoTimeout?.durationSeconds || 180
                                                        }
                                                    });
                                                }}
                                            />
                                            自動タイムアウトを有効化
                                        </label>
                                    </div>
                                    {settings.autoTimeout?.enabled && (
                                        <div className={styles.formGroup}>
                                            <label>タイムアウト時間</label>
                                            <input
                                                id="mobileAutoTimeoutInput"
                                                type="text"
                                                placeholder="例: 1h / 30m / 300"
                                                value={autoTimeoutInput}
                                                onChange={(e) => setAutoTimeoutInput(e.target.value)}
                                                onBlur={async () => {
                                                    const seconds = parseDurationToSeconds(autoTimeoutInput) || 180;
                                                    await updateSettings({ autoTimeout: { enabled: true, durationSeconds: seconds } });
                                                }}
                                                className={styles.input}
                                            />
                                            <p className={styles.inputHint}>例: `1d` `1h` `30m` `45s` または秒数（自動的に保存はフォーカス外で反映）</p>
                                        </div>
                                    )}
                                    <div className={styles.cardHeader}><h3>自動メッセージ削除</h3></div>
                                    <div className={styles.cardBody}>
                                        <div className={styles.formGroup}>
                                            <label className={styles.checkboxLabel}>
                                                <IOSCheckbox
                                                    checked={!!settings.autoDelete?.enabled}
                                                    onChange={async (v) => {
                                                        await updateSettings({
                                                            autoDelete: {
                                                                enabled: v,
                                                                windowSeconds: settings.autoDelete?.windowSeconds || 600
                                                            }
                                                        });
                                                    }}
                                                />
                                                自動メッセージ削除を有効化
                                            </label>
                                        </div>
                                        {settings.autoDelete?.enabled && (
                                            <div className={styles.formGroup}>
                                                <label>削除対象の過去時間</label>
                                                <input
                                                    id="mobileAutoDeleteInput"
                                                    type="text"
                                                    placeholder="例: 10m / 600 / 1h"
                                                    value={autoDeleteInput}
                                                    onChange={(e) => setAutoDeleteInput(e.target.value)}
                                                    onBlur={async () => {
                                                        const seconds = parseDurationToSeconds(autoDeleteInput) || 600;
                                                        await updateSettings({ autoDelete: { enabled: true, windowSeconds: seconds } });
                                                    }}
                                                    className={styles.input}
                                                />
                                                <p className={styles.inputHint}>検知時に遡って削除する時間（例: `10m` は10分前まで全て削除）</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Mobile: allow adding/listing punishment rules */}
                            <div className={styles.card}>
                                <div className={styles.cardHeader}><h2>処罰ルール</h2></div>
                                <div className={styles.cardBody}>
                                    <button className={styles.btnPrimary} onClick={handleAddPunishment}>+ 処罰ルールを追加</button>
                                    <div className={styles.punishmentsList} style={{ marginTop: '8px' }}>
                                        {(settings.punishments?.length || 0) === 0 ? (
                                            <p className={styles.noPunishments}>処罰ルールが設定されていません</p>
                                        ) : (
                                            settings.punishments.map((punishment, index) => (
                                                <div key={index} className={styles.punishmentItem} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                                                    <div>
                                                        <div><strong>しきい値: {punishment.threshold}</strong></div>
                                                        <div>{punishment.actions.map((action, aIdx) => (<span key={aIdx} className={styles.actionBadge}>{action.type}{action.durationSeconds && ` (${action.durationSeconds}s)`}</span>))}</div>
                                                    </div>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <button className={styles.btn} onClick={() => handleEditPunishment(index)}>編集</button>
                                                                <button className={styles.btnDanger} onClick={() => handleRemovePunishment(index)}>削除</button>
                                                            </div>
                                                </div>
                                            ))
                                        )}
                                
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeView === 'logs' && (
                        <div className={styles.content}>
                            <div className={styles.logsHeader}>
                                <input type="text" placeholder="ユーザーIDまたは理由で検索..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className={styles.searchInput} />
                                <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as any)} className={styles.input} style={{ width: '40%' }}>
                                    <option value="all">すべて</option>
                                    <option value="low">低</option>
                                    <option value="medium">中</option>
                                    <option value="high">高</option>
                                </select>
                                <button className={styles.refreshBtn} onClick={() => refetchLogs()} disabled={logsLoading}>🔄 更新</button>
                            </div>
                            {logsLoading ? <div className={styles.loading}>読み込み中...</div> : filteredLogs.length === 0 ? <div className={styles.noLogs}>検知ログがありません</div> : (
                                <div className={styles.logsList}>
                                    {filteredLogs.filter(log => severityFilter === 'all' ? true : severityForLog(log) === severityFilter).map((log) => (
                                        <div key={log.messageId} className={`${styles.logCard} ${severityForLog(log) === 'high' ? styles.logRowHigh : severityForLog(log) === 'medium' ? styles.logRowMedium : styles.logRowLow}`}>
                                            <div className={styles.logHeader}>
                                                <span className={styles.logTime}>{new Date(log.timestamp).toLocaleString('ja-JP')}</span>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    <span className={styles.logScore}>+{log.scoreDelta}</span>
                                                    <span className={`${styles.severityBadge} ${severityForLog(log) === 'high' ? styles.severityHigh : severityForLog(log) === 'medium' ? styles.severityMedium : styles.severityLow}`}>{severityForLog(log).toUpperCase()}</span>
                                                    <button aria-label="詳細" className={styles.expandArrow + (expandedLogIds[log.messageId] ? ' ' + styles.expandOpen : '')} onClick={() => setExpandedLogIds(prev => ({ ...prev, [log.messageId]: !prev[log.messageId] }))}>▸</button>
                                                </div>
                                            </div>
                                            <div className={styles.logBody}>
                                                {(() => {
                                                    const displayName = (log.metadata && (log.metadata.displayName || log.metadata.username)) || '';
                                                    return (
                                                        <div className={styles.logUser}>
                                                            <div className={styles.userInfo}>
                                                                <div className={styles.displayName}>{displayName || '不明'}</div>
                                                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                                        <div className={styles.userId}><code>{log.userId}</code></div>
                                                                        <button className={styles.btnIcon} onClick={() => copyToClipboard(log.userId)}>コピー</button>
                                                                    </div>
                                                                    <button className={styles.btnIcon} onClick={() => copyToClipboard(log.userId)} aria-label="コピー">コピー</button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                                <div className={styles.logDetector}>検知: <span className={styles.detectorTag}>{log.detector}</span></div>
                                                <div className={styles.logReason}>{log.reason}</div>
                                            </div>
                                            <div className={styles.logActions}><button className={styles.revokeBtn} onClick={() => handleRevokeTimeout(log.userId, log.messageId)} disabled={executing}>解除</button></div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeView === 'trust' && (
                        <div className={styles.content}>
                            <div className={styles.trustHeader}>
                                <input
                                    type="text"
                                    placeholder="ユーザーID、ユーザー名、表示名で検索..."
                                    value={trustSearchTerm}
                                    onChange={(e) => setTrustSearchTerm(e.target.value)}
                                    className={styles.searchInput}
                                />
                                <button className={styles.refreshBtn} onClick={() => refetchTrust()} disabled={trustLoading}>
                                    🔄 更新
                                </button>
                            </div>
                            {trustLoading ? (
                                <div className={styles.loading}>読み込み中...</div>
                            ) : trustError ? (
                                <div className={styles.error}>エラー: {trustError}</div>
                            ) : filteredTrustData.length === 0 ? (
                                <div className={styles.noTrustData}>
                                    {trustSearchTerm ? '検索結果がありません' : '信頼スコアデータがありません'}
                                </div>
                            ) : (
                                <div className={styles.trustList}>
                                    {filteredTrustData.map(([userId, trustData]) => (
                                        <div key={userId} className={styles.trustCard}>
                                            <div className={styles.trustCardHeader}>
                                                <div className={styles.userInfo}>
                                                    <span className={styles.displayName}>
                                                        {(trustData as UserTrustDataWithUser).displayName || (trustData as UserTrustDataWithUser).username || '不明'}
                                                    </span>
                                                    <span className={styles.userId}>{userId}</span>
                                                </div>
                                                <span className={styles.trustScore}>
                                                    <span className={(trustData as UserTrustData).score >= 0 ? styles.scorePositive : styles.scoreNegative}>
                                                        {(trustData as UserTrustData).score}
                                                    </span>
                                                </span>
                                            </div>
                                            <div className={styles.trustCardBody}>
                                                <div>最終更新: {new Date((trustData as UserTrustData).lastUpdated).toLocaleString('ja-JP')}</div>
                                                <div>履歴件数: {(trustData as UserTrustData).history?.length || 0}</div>
                                            </div>
                                            <div className={styles.trustCardActions}>
                                                <button
                                                    className={styles.revokeBtn}
                                                    onClick={() => handleResetTrust(userId)}
                                                    disabled={executing}
                                                >
                                                    リセット
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Punishment Modal */}
                {modalOpen && (
                    <div className={styles.modalOverlay} onClick={() => setModalOpen(false)}>
                        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                            <div className={styles.modalHeader}>
                                <h2>{editIndex !== null ? '処罰ルールを編集' : '処罰ルールを追加'}</h2>
                                <button className={styles.modalClose} onClick={() => setModalOpen(false)}>✕</button>
                            </div>
                            <div className={styles.modalBody}>
                                <div className={styles.formGroup}>
                                    <label htmlFor="threshold">しきい値</label>
                                    <input
                                        id="threshold"
                                        type="number"
                                        placeholder="例: 5"
                                        value={newThreshold}
                                        onChange={(e) => setNewThreshold(e.target.value)}
                                        className={styles.input}
                                    />
                                    <p className={styles.inputHint}>信頼スコアがこの値に達すると処罰が実行されます</p>
                                </div>

                                <div className={styles.formGroup}>
                                    <label htmlFor="actionType">処罰タイプ</label>
                                    <select id="actionType" className={styles.input} value={newActionType} onChange={(e) => setNewActionType(e.target.value as any)}>
                                        <option value="timeout">Timeout（タイムアウト）</option>
                                        <option value="kick">Kick（キック）</option>
                                        <option value="ban">Ban（BAN）</option>
                                    </select>
                                    <p className={styles.inputHint}>実行する処罰の種類を選択してください</p>
                                </div>

                                {newActionType === 'timeout' && (
                                    <div className={styles.formGroup}>
                                        <label htmlFor="duration">タイムアウト時間（秒）</label>
                                        <input
                                            id="duration"
                                            type="text"
                                            placeholder="例: 300 / 1s / 5h"
                                            value={newDuration}
                                            onChange={(e) => setNewDuration(e.target.value)}
                                            className={styles.input}
                                        />
                                        <p className={styles.inputHint}>ユーザーがタイムアウトされる時間（秒単位） 例: 1s, 5h, 30m, 1d</p>
                                    </div>
                                )}
                            </div>
                            <div className={styles.modalFooter}>
                                <button className={styles.btnSecondary} onClick={() => setModalOpen(false)}>キャンセル</button>
                                <button
                                    className={styles.btnPrimary}
                                    onClick={handleSavePunishment}
                                    disabled={
                                        !newThreshold || parseInt(newThreshold) <= 0 || (
                                            newActionType === 'timeout' && (!newDuration || parseDurationToSeconds(newDuration) <= 0)
                                        )
                                    }
                                >
                                    {editIndex !== null ? '保存' : '追加'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Confirmation Modal */}
                {confirmModalOpen && (
                    <div className={styles.modalOverlay} onClick={closeConfirmModal}>
                        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                            <div className={styles.modalHeader}>
                                <h2>確認</h2>
                                <button className={styles.modalClose} onClick={closeConfirmModal}>✕</button>
                            </div>
                            <div className={styles.modalBody}>
                                <p className={styles.confirmMessage}>{confirmModalMessage}</p>
                                {confirmModalType === 'revokeTimeout' && (
                                    <div className={styles.confirmOptions}>
                                        <div className={styles.iosCheckboxRow}>
                                            <IOSCheckbox
                                                checked={!!confirmModalData?.resetTrust}
                                                onChange={(v) => setConfirmModalData((prev: any) => ({ ...prev, resetTrust: v }))}
                                            />
                                            <button
                                                type="button"
                                                className={styles.iosCheckboxLabelText}
                                                onClick={() => setConfirmModalData((prev: any) => ({ ...prev, resetTrust: !prev?.resetTrust }))}
                                            >
                                                信頼スコアもリセットする
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className={styles.modalFooter}>
                                <button className={styles.btnSecondary} onClick={closeConfirmModal}>キャンセル</button>
                                <button
                                    className={styles.btnDanger}
                                    onClick={handleConfirmModalConfirm}
                                    disabled={executing}
                                >
                                    実行
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </AntiCheatLayout>
        );
    }

    // Desktop layout
    return (
        <AntiCheatLayout activeTab={activeView} onTabChange={(t) => setActiveView(t as any)}>
            <div className={styles.layout}>
                <div className={styles.header}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <h1 className={styles.title}><span className={`${styles.statusDot} ${settings.enabled ? styles.statusDotOn : styles.statusDotOff}`} />🛡️ AntiCheat 管理</h1>
                        <div style={{ fontSize: '0.9rem', color: 'var(--ac-muted)' }}>有効な検知: {enabledDetectorsCount}</div>
                    </div>
                    <div className={styles.headerActions}>
                        <button className={`${styles.btn} ${settings.enabled ? styles.btnDanger : styles.btnSuccess}`} onClick={handleToggleEnabled}>{settings.enabled ? '無効化' : '有効化'}</button>
                    </div>
                </div>

                <div className={styles.tabs}>
                    <button className={`${styles.tab} ${activeView === 'settings' ? styles.tabActive : ''}`} onClick={() => setActiveView('settings')}>設定</button>
                    <button className={`${styles.tab} ${activeView === 'logs' ? styles.tabActive : ''}`} onClick={() => setActiveView('logs')}>検知ログ</button>
                    <button className={`${styles.tab} ${activeView === 'trust' ? styles.tabActive : ''}`} onClick={() => setActiveView('trust')}>信頼スコア</button>
                </div>

                {activeView === 'settings' && (
                    <div className={styles.content}>
                        <div className={styles.section}>
                            <h2>検知リスト</h2>
                            <div className={styles.detectorControls}>
                                <div className={styles.detectorLabel}>一括操作:</div>
                                <button className={styles.toggleAllBtn} onClick={() => toggleAllDetectors(true)}>すべて有効</button>
                                <button className={styles.toggleAllBtn} onClick={() => toggleAllDetectors(false)}>すべて無効</button>
                            </div>
                            <div className={styles.detectorsList}>
                                {Object.entries(settings.detectors || {}).map(([name, config]) => (
                                    <div key={name} className={`${styles.detectorItem} ${config?.enabled ? styles.detectorEnabled : ''}`}>
                                            <div className={styles.detectorHeader}>
                                                <label className={styles.switch}>
                                                    <IOSCheckbox checked={!!config?.enabled} onChange={async (v) => { await updateSettings({ detectors: { ...(settings.detectors || {}), [name]: { ...config, enabled: v } } }); }} />
                                                </label>
                                                <div className={styles.detectorInfo}>
                                                    <span className={styles.detectorName}>{humanizeDetectorName(name)}</span>
                                                    {detectorDescriptions[name] && (
                                                        <div className={styles.detectorDescription}>
                                                            {detectorDescriptions[name]}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className={styles.section}>
                            <h2>通知設定</h2>
                            <p className={styles.hint}>検知ログの送信先チャンネルを設定します（チャンネルID）。</p>
                            <div className={styles.formGroup}>
                                <label htmlFor="logChannelId">ログチャンネルID</label>
                                <input
                                    id="logChannelId"
                                    type="text"
                                    placeholder="例: 123456789012345678"
                                    value={settings.logChannelId || ''}
                                    onChange={async (e) => {
                                        await updateSettings({ logChannelId: e.target.value || null });
                                    }}
                                    className={styles.input}
                                />
                                <p className={styles.inputHint}>検知ログを送信するチャンネルID（空にすると無効）</p>
                            </div>
                        </div>

                        <div className={styles.section}>
                            <h2>自動処罰設定</h2>
                            <p className={styles.hint}>信頼スコアがしきい値に達した場合の自動処罰を設定します。デフォルトでは無効です。</p>
                            <button className={styles.btnPrimary} onClick={handleAddPunishment}>+ 処罰ルールを追加</button>
                            <div className={styles.punishmentsList}>
                                {(settings.punishments?.length || 0) === 0 ? (
                                    <p className={styles.noPunishments}>処罰ルールが設定されていません（ログのみモード）</p>
                                        ) : (
                                    settings.punishments.map((punishment, index) => (
                                        <div key={index} className={styles.punishmentItem}>
                                            <div className={styles.punishmentInfo}>
                                                <strong>しきい値: {punishment.threshold}</strong>
                                                <div>{punishment.actions.map((action, aIdx) => (<span key={aIdx} className={styles.actionBadge}>{action.type}{action.durationSeconds && ` (${action.durationSeconds}s)`}</span>))}</div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button className={styles.btn} onClick={() => handleEditPunishment(index)}>編集</button>
                                                <button className={styles.btnDanger} onClick={() => handleRemovePunishment(index)}>削除</button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        <div className={styles.section}>
                            <h2>自動タイムアウト設定</h2>
                            <p className={styles.hint}>違反検知時に自動でタイムアウトをかける設定です。</p>
                            <div className={styles.formGroup}>
                                            <label className={styles.checkboxLabel}>
                                    <IOSCheckbox
                                        checked={!!settings.autoTimeout?.enabled}
                                        onChange={async (v) => {
                                            await updateSettings({
                                                autoTimeout: {
                                                    enabled: v,
                                                    durationSeconds: settings.autoTimeout?.durationSeconds || 180
                                                }
                                            });
                                        }}
                                    />
                                    自動タイムアウトを有効化
                                </label>
                            </div>
                            {settings.autoTimeout?.enabled && (
                                <div className={styles.formGroup}>
                                    <label htmlFor="autoTimeoutDuration">タイムアウト時間</label>
                                    <input
                                        id="autoTimeoutDuration"
                                        type="text"
                                        placeholder="例: 1h / 30m / 300"
                                        value={autoTimeoutInput}
                                        onChange={(e) => setAutoTimeoutInput(e.target.value)}
                                        onBlur={async () => {
                                            const seconds = parseDurationToSeconds(autoTimeoutInput) || 180;
                                            await updateSettings({ autoTimeout: { enabled: true, durationSeconds: seconds } });
                                        }}
                                        className={styles.input}
                                    />
                                    <p className={styles.inputHint}>例: `1d` `1h` `30m` `45s` または秒数（最大7日）</p>
                                </div>
                            )}

                            <div className={styles.formGroup}>
                                <label className={styles.checkboxLabel}>
                                    <IOSCheckbox
                                        checked={!!settings.autoDelete?.enabled}
                                        onChange={async (v) => {
                                            await updateSettings({
                                                autoDelete: {
                                                    enabled: v,
                                                    windowSeconds: settings.autoDelete?.windowSeconds || 600
                                                }
                                            });
                                        }}
                                    />
                                    自動メッセージ削除を有効化
                                </label>
                            </div>
                            {settings.autoDelete?.enabled && (
                                <div className={styles.formGroup}>
                                    <label htmlFor="autoDeleteDuration">削除対象の過去時間</label>
                                    <input
                                        id="autoDeleteDuration"
                                        type="text"
                                        placeholder="例: 10m / 600 / 1h"
                                        value={autoDeleteInput}
                                        onChange={(e) => setAutoDeleteInput(e.target.value)}
                                        onBlur={async () => {
                                            const seconds = parseDurationToSeconds(autoDeleteInput) || 600;
                                            await updateSettings({ autoDelete: { enabled: true, windowSeconds: seconds } });
                                        }}
                                        className={styles.input}
                                    />
                                    <p className={styles.inputHint}>例: `10m` は検知時に10分前までのメッセージを削除します</p>
                                </div>
                            )}
                        </div>

                        <div className={styles.section}>
                            <h2>除外設定</h2>
                            <p className={styles.hint}>AntiCheatの対象外とするロール、チャンネル、ユーザーを設定します。</p>
                            <div className={styles.exclusionSection}>
                                <div className={styles.formGroup}>
                                    <label>除外ロールID（カンマ区切り）</label>
                                    <input
                                        type="text"
                                        placeholder="例: 123456789012345678, 876543210987654321"
                                        value={(settings.excludedRoles || []).join(', ')}
                                        onChange={async (e) => {
                                            const roles = e.target.value.split(',').map(r => r.trim()).filter(r => r);
                                            await updateSettings({ excludedRoles: roles });
                                        }}
                                        className={styles.input}
                                    />
                                    <p className={styles.inputHint}>これらのロールを持つユーザーはAntiCheatの対象外になります。</p>
                                </div>
                                <div className={styles.formGroup}>
                                    <label>除外チャンネルID（カンマ区切り）</label>
                                    <input
                                        type="text"
                                        placeholder="例: 123456789012345678, 876543210987654321"
                                        value={(settings.excludedChannels || []).join(', ')}
                                        onChange={async (e) => {
                                            const channels = e.target.value.split(',').map(c => c.trim()).filter(c => c);
                                            await updateSettings({ excludedChannels: channels });
                                        }}
                                        className={styles.input}
                                    />
                                    <p className={styles.inputHint}>これらのチャンネルでのメッセージはAntiCheatの対象外になります。</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeView === 'logs' && (
                    <div className={styles.content}>
                        <div className={styles.logsHeader}>
                            <input type="text" placeholder="ユーザーIDまたは理由で検索..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className={styles.searchInput} />
                            <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as any)} className={styles.input} style={{ width: '160px' }}>
                                <option value="all">すべての重大度</option>
                                <option value="low">低</option>
                                <option value="medium">中</option>
                                <option value="high">高</option>
                            </select>
                            <button className={styles.btnSecondary} onClick={() => refetchLogs()}>🔄 更新</button>
                        </div>

                        {logsLoading ? (<div className={styles.loading}>読み込み中...</div>) : filteredLogs.length === 0 ? (<div className={styles.noLogs}>検知ログがありません</div>) : (
                            <div className={styles.logsTable}>
                                <table>
                                    <thead>
                                        <tr><th>時刻</th><th>ユーザーID</th><th>検知</th><th>スコア増加</th><th>理由</th><th>操作</th></tr>
                                    </thead>
                                    <tbody>
                                        {filteredLogs.filter(log => severityFilter === 'all' ? true : severityForLog(log) === severityFilter).map((log) => (
                                            <tr key={log.messageId} className={severityForLog(log) === 'high' ? styles.highlightRow : ''}>
                                                <td>{new Date(log.timestamp).toLocaleString('ja-JP')}</td>
                                                <td className={styles.userCell}>
                                                    <div className={styles.userInfo}>
                                                        <div className={styles.userName}>{(log.metadata && (log.metadata.displayName || log.metadata.username)) || '不明'}</div>
                                                        <div className={styles.userId}><code>{log.userId}</code></div>
                                                    </div>
                                                </td>
                                                <td><span className={styles.detectorBadge}>{log.detector}</span></td>
                                                <td className={styles.scoreDelta}>+{log.scoreDelta} <span className={`${styles.severityBadge} ${severityForLog(log) === 'high' ? styles.severityHigh : severityForLog(log) === 'medium' ? styles.severityMedium : styles.severityLow}`} style={{ marginLeft: 8 }}>{severityForLog(log).toUpperCase()}</span></td>
                                                <td className={styles.reason} title={log.reason}>{log.reason}</td>
                                                <td><button className={styles.btnSmall} onClick={() => handleRevokeTimeout(log.userId, log.messageId)} disabled={executing}>解除</button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {activeView === 'trust' && (
                    <div className={styles.content}>
                        <div className={styles.trustHeader}>
                            <input
                                type="text"
                                placeholder="ユーザーID、ユーザー名、表示名で検索..."
                                value={trustSearchTerm}
                                onChange={(e) => setTrustSearchTerm(e.target.value)}
                                className={styles.searchInput}
                            />
                            <button className={styles.btnSecondary} onClick={() => refetchTrust()}>
                                🔄 更新
                            </button>
                        </div>

                        {trustLoading ? (
                            <div className={styles.loading}>読み込み中...</div>
                        ) : trustError ? (
                            <div className={styles.error}>エラー: {trustError}</div>
                        ) : filteredTrustData.length === 0 ? (
                            <div className={styles.noTrustData}>
                                {trustSearchTerm ? '検索結果がありません' : '信頼スコアデータがありません'}
                            </div>
                        ) : (
                            <div className={styles.trustTable}>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>ユーザー</th>
                                            <th>信頼スコア</th>
                                            <th>最終更新</th>
                                            <th>履歴件数</th>
                                            <th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredTrustData.map(([userId, trustData]) => (
                                            <tr key={userId}>
                                                <td className={styles.userCell}>
                                                    <div className={styles.userInfo}>
                                                        <div className={styles.userName}>
                                                            {(trustData as UserTrustDataWithUser).displayName || (trustData as UserTrustDataWithUser).username || '不明'}
                                                        </div>
                                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                            <div className={styles.userId}>{userId}</div>
                                                            <button className={styles.btnIcon} onClick={() => copyToClipboard(userId)}>コピー</button>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className={styles.trustScore}>
                                                    <span className={trustData.score >= 0 ? styles.scorePositive : styles.scoreNegative}>
                                                        {trustData.score}
                                                    </span>
                                                </td>
                                                <td>{new Date(trustData.lastUpdated).toLocaleString('ja-JP')}</td>
                                                <td>{trustData.history?.length || 0}</td>
                                                <td>
                                                    <button
                                                        className={styles.btnSmall}
                                                        onClick={() => handleResetTrust(userId)}
                                                        disabled={executing}
                                                    >
                                                        リセット
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
            </div>

            {/* Punishment Modal */}
            {modalOpen && (
                <div className={styles.modalOverlay} onClick={() => setModalOpen(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2>{editIndex !== null ? '処罰ルールを編集' : '処罰ルールを追加'}</h2>
                            <button className={styles.modalClose} onClick={() => setModalOpen(false)}>✕</button>
                        </div>
                        <div className={styles.modalBody}>
                                        <div className={styles.formGroup}>
                                            <label htmlFor="threshold">しきい値</label>
                                            <input
                                                id="threshold"
                                                type="number"
                                                placeholder="例: 5"
                                                value={newThreshold}
                                                onChange={(e) => setNewThreshold(e.target.value)}
                                                className={styles.input}
                                            />
                                            <p className={styles.inputHint}>信頼スコアがこの値に達すると処罰が実行されます</p>
                                        </div>

                                        <div className={styles.formGroup}>
                                            <label htmlFor="actionType">処罰タイプ</label>
                                            <select id="actionType" className={styles.input} value={newActionType} onChange={(e) => setNewActionType(e.target.value as any)}>
                                                <option value="timeout">Timeout（タイムアウト）</option>
                                                <option value="kick">Kick（キック）</option>
                                                <option value="ban">Ban（BAN）</option>
                                            </select>
                                            <p className={styles.inputHint}>実行する処罰の種類を選択してください</p>
                                        </div>

                                        {newActionType === 'timeout' && (
                                            <div className={styles.formGroup}>
                                                <label htmlFor="duration">タイムアウト時間（秒）</label>
                                                <input
                                                    id="duration"
                                                    type="text"
                                                    placeholder="例: 300 / 1s / 5h"
                                                    value={newDuration}
                                                    onChange={(e) => setNewDuration(e.target.value)}
                                                    className={styles.input}
                                                />
                                                <p className={styles.inputHint}>ユーザーがタイムアウトされる時間（秒単位） 例: 1s, 5h, 30m, 1d</p>
                                            </div>
                                        )}
                                    </div>
                                    <div className={styles.modalFooter}>
                                        <button className={styles.btnSecondary} onClick={() => setModalOpen(false)}>キャンセル</button>
                                        <button
                                            className={styles.btnPrimary}
                                            onClick={handleSavePunishment}
                                            disabled={
                                                !newThreshold || parseInt(newThreshold) <= 0 || (
                                                    newActionType === 'timeout' && (!newDuration || parseDurationToSeconds(newDuration) <= 0)
                                                )
                                            }
                                        >
                                            追加
                                        </button>
                                    </div>
                    </div>
                </div>
            )}

            {/* Confirmation Modal */}
            {confirmModalOpen && (
                <div className={styles.modalOverlay} onClick={closeConfirmModal}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2>確認</h2>
                            <button className={styles.modalClose} onClick={closeConfirmModal}>✕</button>
                        </div>
                        <div className={styles.modalBody}>
                            <p className={styles.confirmMessage}>{confirmModalMessage}</p>
                            {confirmModalType === 'revokeTimeout' && (
                                    <div className={styles.confirmOptions}>
                                        <div className={styles.iosCheckboxRow}>
                                            <IOSCheckbox
                                                checked={!!confirmModalData?.resetTrust}
                                                onChange={(v) => setConfirmModalData((prev: any) => ({ ...prev, resetTrust: v }))}
                                            />
                                            <button
                                                type="button"
                                                className={styles.iosCheckboxLabelText}
                                                onClick={() => setConfirmModalData((prev: any) => ({ ...prev, resetTrust: !prev?.resetTrust }))}
                                            >
                                                信頼スコアもリセットする
                                            </button>
                                        </div>
                                    </div>
                            )}
                        </div>
                        <div className={styles.modalFooter}>
                            <button className={styles.btnSecondary} onClick={closeConfirmModal}>キャンセル</button>
                            <button
                                className={styles.btnDanger}
                                onClick={handleConfirmModalConfirm}
                                disabled={executing}
                            >
                                実行
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AntiCheatLayout>
    );
};

export default AntiCheatUnified;
