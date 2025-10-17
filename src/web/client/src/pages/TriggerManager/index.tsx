import React, { useState, useEffect } from 'react';
import { useAppToast } from '../../AppToastProvider';
import styles from './TriggerManager.module.css';
import TriggerList from './components/TriggerList';
import TriggerEditor from './components/TriggerEditor';
import LivePanel from './components/LivePanel';

interface Trigger {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    eventType: string;
    priority: number;
    conditions: any[];
    presets: any[];
    createdAt: string;
    updatedAt: string;
}

const TriggerManager: React.FC = () => {
    const { addToast } = (() => {
        try {
            return useAppToast();
        } catch {
            return { addToast: undefined } as any;
        }
    })();

    const [triggers, setTriggers] = useState<Trigger[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [guildId, setGuildId] = useState<string>('');

    // Editor state
    const [selectedTrigger, setSelectedTrigger] = useState<Trigger | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    // Search and filters
    const [searchQuery, setSearchQuery] = useState('');
    const [filterEventType, setFilterEventType] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'enabled' | 'disabled'>('all');


    useEffect(() => {
        // Get session info
        fetch('/api/auth/session', {
            credentials: 'include'
        })
            .then(res => res.json())
            .then(data => {
                let guildIdFromAuth: string | undefined;

                if (data.user) {
                    guildIdFromAuth =
                        data.user.guildId ||
                        (data.user.guildIds?.length > 0 && data.user.guildIds[0]);
                } else if (data.guildIds?.length > 0) {
                    guildIdFromAuth = data.guildIds[0];
                }

                if (guildIdFromAuth) {
                    setGuildId(guildIdFromAuth);
                    fetchTriggers(guildIdFromAuth);
                } else {
                    setError('ギルド情報が取得できません');
                    setLoading(false);
                }
            })
            .catch(err => {
                console.error('Failed to fetch auth session:', err);
                setError('セッション情報の取得に失敗しました');
                setLoading(false);
            });
    }, []);

    const fetchTriggers = async (guildId: string) => {
        try {
            setLoading(true);
            setError(null);

            const res = await fetch(`/api/triggers?guildId=${guildId}`, {
                credentials: 'include'
            });

            if (!res.ok) {
                throw new Error('Failed to fetch triggers');
            }

            const data = await res.json();
            setTriggers(data.triggers || []);
        } catch (err) {
            console.error('Failed to fetch triggers:', err);
            setError('トリガーの取得に失敗しました');
            addToast?.('トリガーの読み込みに失敗しました', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateNew = () => {
        setIsCreating(true);
        setSelectedTrigger(null);
        // モバイルではサイドバーを自動的に閉じる
        if (window.innerWidth <= 768) {
            setSidebarCollapsed(true);
        }
    };

    const toggleSidebar = () => setSidebarCollapsed(s => !s);

    const handleSelectTrigger = (trigger: Trigger) => {
        setIsCreating(false);
        setSelectedTrigger(trigger);
        // モバイルではサイドバーを自動的に閉じる
        if (window.innerWidth <= 768) {
            setSidebarCollapsed(true);
        }
    };

    const handleSave = async (trigger: Trigger) => {
        try {
            const isNew = !selectedTrigger || isCreating;
            const url = isNew ? '/api/triggers' : `/api/triggers/${trigger.id}`;
            const method = isNew ? 'POST' : 'PUT';

            const payload = {
                ...trigger,
                guildId
            };

            const res = await fetch(url + (isNew ? '' : `?guildId=${guildId}`), {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Save failed');
            }

            addToast?.(isNew ? 'トリガーを作成しました' : 'トリガーを更新しました', 'success');
            setIsCreating(false);
            setSelectedTrigger(null);
            // モバイルではサイドバーを開く
            if (window.innerWidth <= 768) {
                setSidebarCollapsed(false);
            }
            await fetchTriggers(guildId);
        } catch (err) {
            console.error('Failed to save trigger:', err);
            addToast?.('トリガーの保存に失敗しました', 'error');
        }
    };

    const handleDelete = async (triggerId: string) => {
        if (!confirm('本当にこのトリガーを削除しますか？')) {
            return;
        }

        try {
            const res = await fetch(`/api/triggers/${triggerId}?guildId=${guildId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (!res.ok) {
                throw new Error('Delete failed');
            }

            addToast?.('トリガーを削除しました', 'success');
            setSelectedTrigger(null);
            setIsCreating(false);
            // モバイルではサイドバーを開く
            if (window.innerWidth <= 768) {
                setSidebarCollapsed(false);
            }
            await fetchTriggers(guildId);
        } catch (err) {
            console.error('Failed to delete trigger:', err);
            addToast?.('トリガーの削除に失敗しました', 'error');
        }
    };

    const handleToggleTrigger = async (trigger: Trigger) => {
        try {
            const updated = { ...trigger, enabled: !trigger.enabled };
            const res = await fetch(
                `/api/triggers/${trigger.id}?guildId=${guildId}`,
                {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify(updated)
                }
            );

            if (!res.ok) {
                throw new Error('Failed to toggle trigger');
            }

            await fetchTriggers(guildId);
        } catch (err) {
            console.error('Failed to toggle trigger:', err);
            addToast?.('トグルに失敗しました', 'error');
        }
    };

    const filteredTriggers = triggers.filter(t => {
        const matchesSearch =
            t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (t.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
        const matchesEventType =
            !filterEventType || t.eventType === filterEventType;
        const matchesStatus =
            filterStatus === 'all' || (filterStatus === 'enabled' ? t.enabled : !t.enabled);
        return matchesSearch && matchesEventType && matchesStatus;
    });

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingContainer}>
                    <div className={styles.spinner}></div>
                    <p>読み込み中...</p>
                </div>
            </div>
        );
    }

    if (error && !guildId) {
        return (
            <div className={styles.container}>
                <div className={styles.errorContainer}>
                    <span className="material-icons">error</span>
                    <h2>エラー</h2>
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerContent}>
                    <div>
                        <h1>🎯 トリガー管理</h1>
                        <p>Discord イベントに応じて自動アクションを実行</p>
                    </div>
                    <button className={styles.hamburger} onClick={toggleSidebar} title="サイドバーを切り替え">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="3" y1="6" x2="21" y2="6" />
                            <line x1="3" y1="12" x2="21" y2="12" />
                            <line x1="3" y1="18" x2="21" y2="18" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Main Layout: Sidebar + Content Grid + LivePanel */}
            <div className={styles.mainLayout}>
                {/* Left Column: Trigger List (collapsible sidebar) */}
                <div className={`${styles.leftColumn} ${sidebarCollapsed ? styles.collapsed : ''}`}>
                    <TriggerList
                        triggers={filteredTriggers}
                        selectedTrigger={selectedTrigger}
                        searchQuery={searchQuery}
                        filterEventType={filterEventType}
                        filterStatus={filterStatus}
                        onSearchChange={setSearchQuery}
                        onFilterEventTypeChange={setFilterEventType}
                        onFilterStatusChange={setFilterStatus}
                        onSelectTrigger={handleSelectTrigger}
                        onCreateNew={handleCreateNew}
                        onToggleTrigger={handleToggleTrigger}
                    />
                </div>

                {/* Middle Column: Grid of cards OR Editor when editing/creating */}
                <div className={styles.middleColumn}>
                    {selectedTrigger || isCreating ? (
                        <TriggerEditor
                            trigger={selectedTrigger}
                            isCreating={isCreating}
                            onSave={handleSave}
                            onDelete={handleDelete}
                            onCancel={() => {
                                setSelectedTrigger(null);
                                setIsCreating(false);
                                // モバイルではサイドバーを開く
                                if (window.innerWidth <= 768) {
                                    setSidebarCollapsed(false);
                                }
                            }}
                        />
                    ) : (
                        <div className={styles.cardGrid}>
                            <div className={styles.gridHeader}>
                                <h2>トリガー一覧</h2>
                                <button className={styles.btnPrimary} onClick={handleCreateNew}>
                                    + 新規トリガー
                                </button>
                            </div>

                            <div className={styles.grid}>
                                {filteredTriggers.length === 0 ? (
                                    <div className={styles.emptyState}>トリガーが見つかりません</div>
                                ) : (
                                    filteredTriggers.map(t => (
                                        <div key={t.id} className={styles.card}>
                                            <div className={styles.cardHeader}>
                                                <div className={styles.cardTitle}>{t.name}</div>
                                                <div
                                                    className={`${styles.cardBadge} ${
                                                        t.enabled ? styles.badgeEnabled : styles.badgeDisabled
                                                    }`}
                                                >
                                                    {t.enabled ? '有効' : '無効'}
                                                </div>
                                            </div>
                                            <div className={styles.cardBody}>
                                                <div className={styles.cardDesc}>{t.description || '説明なし'}</div>
                                                <div className={styles.cardMeta}>{t.eventType} • 優先度 {t.priority}</div>
                                            </div>
                                            <div className={styles.cardActions}>
                                                <button className={styles.actionBtn} onClick={() => handleSelectTrigger(t)}>
                                                    編集
                                                </button>
                                                <button
                                                    className={`${styles.actionBtn} ${styles.toggleBtn}`}
                                                    onClick={() => handleToggleTrigger(t)}
                                                >
                                                    {t.enabled ? '無効化' : '有効化'}
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Column: Live Panel */}
                <div className={styles.rightColumn}>
                    <LivePanel selectedTriggerId={selectedTrigger?.id} />
                </div>
            </div>
        </div>
    );
};

export default TriggerManager;
