import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppToast } from '../../AppToastProvider';
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

    // Modal / UI states (placeholders for future implementation)
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);
    const [saving, setSaving] = useState(false);

    // Live buffer (簡易表示用)
    const [liveBuffer, setLiveBuffer] = useState<any[]>([]);
    const [showLiveBuffer, setShowLiveBuffer] = useState(false);

    useEffect(() => {
        // セッションからギルドIDを取得（/api/auth/session を優先して使用）
        fetch('/api/auth/session', {
            credentials: 'include'
        })
            .then(res => res.json())
            .then(data => {
                // /api/auth/session のレスポンスは { authenticated, user: { guildId, guildIds, ... } } になっている想定
                const user = data?.user;
                const guildIdFromAuth =
                    user?.guildId ||
                    (user?.guildIds && user.guildIds.length > 0 && user.guildIds[0]) ||
                    (data?.guildIds && data.guildIds.length > 0 && data.guildIds[0]);

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
                const txt = await res.text();
                console.error('Failed to fetch triggers, status:', res.status, txt);
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

    const fetchLiveBuffer = async (guildId: string) => {
        try {
            const res = await fetch(`/api/triggers/live-buffer`, {
                credentials: 'include'
            });
            
            if (res.ok) {
                const data = await res.json();
                setLiveBuffer(data.buffer || []);
            }
        } catch (err) {
            console.error('Failed to fetch live buffer:', err);
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
            
            addToast?.('トリガーを更新しました', 'success');
            fetchTriggers(guildId);
        } catch (err) {
            console.error('Failed to toggle trigger:', err);
            addToast?.('トリガーの更新に失敗しました', 'error');
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
            
            addToast?.('トリガーを削除しました', 'success');
            fetchTriggers(guildId);
        } catch (err) {
            console.error('Failed to delete trigger:', err);
            addToast?.('トリガーの削除に失敗しました', 'error');
        }
    };

    const handleCreateTrigger = () => {
        setFormData({
            name: '',
            description: '',
            eventType: 'messageCreate',
            priority: 0,
            conditions: [],
            presets: []
        });
        setModalTab('basic');
        setEditingTrigger(null);
        setShowCreateModal(true);
    };

    const handleEditTrigger = (trigger: Trigger) => {
        setFormData({
            name: trigger.name,
            description: trigger.description || '',
            eventType: trigger.eventType,
            priority: trigger.priority,
            conditions: trigger.conditions || [],
            presets: trigger.presets || []
        });
        setEditingTrigger(trigger);
        setModalTab('basic');
        setShowEditModal(true);
    };

    const handleSaveTrigger = async () => {
        if (!formData.name.trim()) {
            addToast?.('トリガー名を入力してください', 'error');
            return;
        }

        setSaving(true);
        try {
            const isNew = !editingTrigger;
            const url = isNew ? '/api/triggers' : `/api/triggers/${editingTrigger!.id}`;
            const method = isNew ? 'POST' : 'PUT';

            const payload = {
                ...formData,
                guildId: guildId
            };

            const res = await fetch(url + (isNew ? '' : `?guildId=${guildId}`), {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || 'Failed to save trigger');
            }

            addToast?.(isNew ? 'トリガーを作成しました' : 'トリガーを更新しました', 'success');
            setShowCreateModal(false);
            setShowEditModal(false);
            setEditingTrigger(null);
            fetchTriggers(guildId);
        } catch (err) {
            console.error('Failed to save trigger:', err);
            addToast?.('トリガーの保存に失敗しました', 'error');
        } finally {
            setSaving(false);
        }
    };

    const addCondition = () => {
        setFormData({
            ...formData,
            conditions: [
                ...formData.conditions,
                {
                    id: `condition-${Date.now()}`,
                    type: 'messageContent',
                    matchType: 'contains',
                    value: ''
                }
            ]
        });
    };

    const updateCondition = (index: number, field: string, value: any) => {
        const newConditions = [...formData.conditions];
        newConditions[index] = { ...newConditions[index], [field]: value };
        setFormData({ ...formData, conditions: newConditions });
    };

    const removeCondition = (index: number) => {
        setFormData({
            ...formData,
            conditions: formData.conditions.filter((_, i) => i !== index)
        });
    };

    const addPreset = () => {
        setFormData({
            ...formData,
            presets: [
                ...formData.presets,
                {
                    id: `preset-${Date.now()}`,
                    triggerId: '',
                    index: formData.presets.length,
                    enabled: true,
                    type: 'Text',
                    template: ''
                }
            ]
        });
    };

    const updatePreset = (index: number, field: string, value: any) => {
        const newPresets = [...formData.presets];
        newPresets[index] = { ...newPresets[index], [field]: value };
        setFormData({ ...formData, presets: newPresets });
    };

    const removePreset = (index: number) => {
        setFormData({
            ...formData,
            presets: formData.presets.filter((_, i) => i !== index)
        });
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
