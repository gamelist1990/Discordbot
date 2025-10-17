import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './TriggerManager.module.css';

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
    const navigate = useNavigate();
    const [triggers, setTriggers] = useState<Trigger[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [guildId, setGuildId] = useState<string>('');

    useEffect(() => {
        // セッションからギルドIDを取得
        fetch('/api/session/current', {
            credentials: 'include'
        })
            .then(res => res.json())
            .then(data => {
                if (data.guildId) {
                    setGuildId(data.guildId);
                    fetchTriggers(data.guildId);
                } else {
                    setError('ギルド情報が取得できません');
                    setLoading(false);
                }
            })
            .catch(err => {
                console.error('Failed to fetch session:', err);
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
        } finally {
            setLoading(false);
        }
    };

    const toggleTrigger = async (triggerId: string, enabled: boolean) => {
        try {
            const res = await fetch(`/api/triggers/${triggerId}?guildId=${guildId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ enabled: !enabled })
            });
            
            if (!res.ok) {
                throw new Error('Failed to update trigger');
            }
            
            // リロード
            fetchTriggers(guildId);
        } catch (err) {
            console.error('Failed to toggle trigger:', err);
            alert('トリガーの更新に失敗しました');
        }
    };

    const deleteTrigger = async (triggerId: string) => {
        if (!confirm('本当にこのトリガーを削除しますか？')) {
            return;
        }
        
        try {
            const res = await fetch(`/api/triggers/${triggerId}?guildId=${guildId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            if (!res.ok) {
                throw new Error('Failed to delete trigger');
            }
            
            // リロード
            fetchTriggers(guildId);
        } catch (err) {
            console.error('Failed to delete trigger:', err);
            alert('トリガーの削除に失敗しました');
        }
    };

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.loading}>
                    <div className={styles.spinner}></div>
                    <p>読み込み中...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.container}>
                <div className={styles.error}>
                    <span className="material-icons">error</span>
                    <h2>エラー</h2>
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1>🎯 トリガー管理</h1>
                <p>Discord イベントに応じて自動アクションを実行</p>
            </div>

            <div className={styles.content}>
                <div className={styles.toolbar}>
                    <button className={styles.createButton} onClick={() => alert('作成機能は今後実装予定です')}>
                        <span className="material-icons">add</span>
                        新規作成
                    </button>
                    <button className={styles.refreshButton} onClick={() => fetchTriggers(guildId)}>
                        <span className="material-icons">refresh</span>
                        更新
                    </button>
                </div>

                {triggers.length === 0 ? (
                    <div className={styles.empty}>
                        <span className="material-icons">inbox</span>
                        <p>トリガーがまだ作成されていません</p>
                        <button className={styles.createFirstButton} onClick={() => alert('作成機能は今後実装予定です')}>
                            最初のトリガーを作成
                        </button>
                    </div>
                ) : (
                    <div className={styles.triggerList}>
                        {triggers.map(trigger => (
                            <div key={trigger.id} className={styles.triggerCard}>
                                <div className={styles.triggerHeader}>
                                    <h3>{trigger.name}</h3>
                                    <div className={styles.actions}>
                                        <button 
                                            className={trigger.enabled ? styles.toggleEnabled : styles.toggleDisabled}
                                            onClick={() => toggleTrigger(trigger.id, trigger.enabled)}
                                        >
                                            {trigger.enabled ? '有効' : '無効'}
                                        </button>
                                        <button 
                                            className={styles.deleteButton}
                                            onClick={() => deleteTrigger(trigger.id)}
                                        >
                                            <span className="material-icons">delete</span>
                                        </button>
                                    </div>
                                </div>
                                <div className={styles.triggerBody}>
                                    <p className={styles.description}>{trigger.description || '説明なし'}</p>
                                    <div className={styles.meta}>
                                        <span className={styles.badge}>{trigger.eventType}</span>
                                        <span className={styles.presetCount}>{trigger.presets.length} プリセット</span>
                                        <span className={styles.priority}>優先度: {trigger.priority}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TriggerManager;
