import React, { useState, useEffect } from 'react';
import styles from './TriggerEditor.module.css';
import AdvancedConditionEditor from './AdvancedConditionEditor.js';
import AdvancedPresetEditor from './AdvancedPresetEditor.js';

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
    // optional: logic connecting conditions
    conditionLogic?: 'AND' | 'OR';
    // execution mode for presets
    runMode?: 'all' | 'random' | 'single' | 'pinned-random';
    randomCount?: number;
}

interface TriggerEditorProps {
    trigger: Trigger | null;
    isCreating: boolean;
    onSave: (trigger: Trigger) => void;
    onDelete: (triggerId: string) => void;
    onCancel: () => void;
    guildId?: string;
}

type EditorTab = 'basic' | 'conditions' | 'presets';

const TriggerEditor: React.FC<TriggerEditorProps> = ({
    trigger,
    isCreating,
    onSave,
    onDelete,
    onCancel
    , guildId
}) => {
    const [tab, setTab] = useState<EditorTab>('basic');
    const [saving, setSaving] = useState(false);
    const [formData, setFormData] = useState<Partial<Trigger>>({
        name: '',
        description: '',
        enabled: true,
        eventType: 'messageCreate',
        priority: 0,
        conditions: [],
        // 新しく追加: 条件の論理 (AND / OR)
        // 保存時に trigger.conditionLogic として送信される
        // 型は any で受け取るが 'AND'|'OR' の文字列を期待
        conditionLogic: 'AND' as any,
        // presets execution mode
        runMode: 'all' as any,
        randomCount: 1,
        presets: []
    });

    useEffect(() => {
        if (trigger) {
            setFormData({
                ...trigger,
                // ensure defaults for fields that may be missing
                conditionLogic: (trigger as any).conditionLogic || 'AND',
                runMode: (trigger as any).runMode || 'all',
                randomCount: (trigger as any).randomCount || 1
            });
        }
    }, [trigger, isCreating]);

    const handleSave = async () => {
        if (!formData.name?.trim()) {
            alert('トリガー名を入力してください');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                id: trigger?.id || `trigger-${Date.now()}`,
                name: formData.name!,
                description: formData.description || '',
                enabled: formData.enabled ?? true,
                eventType: formData.eventType || 'messageCreate',
                priority: formData.priority ?? 0,
                conditions: formData.conditions || [],
                // persist condition logic (AND/OR)
                conditionLogic: (formData as any).conditionLogic || 'AND',
                // persist preset execution mode
                runMode: (formData as any).runMode || 'all',
                randomCount: (formData as any).randomCount || 1,
                presets: formData.presets || [],
                createdAt: trigger?.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            } as any;

            // debug: show payload to console before sending
            // eslint-disable-next-line no-console
            console.log('DEBUG_SAVE_PAYLOAD', payload);

            await onSave(payload);
        } finally {
            setSaving(false);
        }
    };

    if (!trigger && !isCreating) {
        return (
            <div className={styles.editorPanel}>
                <div className={styles.editorEmpty}>
                    <span className="material-icons">note</span>
                    <p>トリガーを選択してください</p>
                </div>
            </div>
        );
    }

    const eventTypes = [
        { value: 'messageCreate', label: 'メッセージ作成' },
        { value: 'messageUpdate', label: 'メッセージ編集' },
        { value: 'messageDelete', label: 'メッセージ削除' },
        { value: 'guildMemberAdd', label: 'メンバー参加' },
        { value: 'guildMemberRemove', label: 'メンバー退出' },
        { value: 'interactionCreate', label: 'インタラクション' },
        { value: 'messageReactionAdd', label: 'リアクション追加' },
        { value: 'voiceStateUpdate', label: 'ボイス更新' }
    ];

    return (
        <div className={styles.editorPanel}>
            <div className={styles.editorHeader}>
                <h2>{isCreating ? '新規トリガー' : 'トリガー編集'}</h2>
                <button
                    className={styles.closeBtn}
                    onClick={onCancel}
                    title="キャンセル"
                >
                    <span className="material-icons">close</span>
                </button>
            </div>

            {/* Tabs */}
            <div className={styles.editorTabs}>
                <button
                    className={`${styles.tabBtn} ${tab === 'basic' ? styles.active : ''}`}
                    onClick={() => setTab('basic')}
                >
                    基本設定
                </button>
                <button
                    className={`${styles.tabBtn} ${tab === 'conditions' ? styles.active : ''}`}
                    onClick={() => setTab('conditions')}
                >
                    条件 ({formData.conditions?.length || 0})
                </button>
                <button
                    className={`${styles.tabBtn} ${tab === 'presets' ? styles.active : ''}`}
                    onClick={() => setTab('presets')}
                >
                    プリセット ({formData.presets?.length || 0})
                </button>
            </div>

            <div className={styles.editorContent}>
                {/* Basic Tab */}
                {tab === 'basic' && (
                    <div className={styles.formSection}>
                        <div className={styles.formGroup}>
                            <label>トリガー名 *</label>
                            <input
                                type="text"
                                value={formData.name || ''}
                                onChange={e =>
                                    setFormData({ ...formData, name: e.target.value })
                                }
                                placeholder="例: ウェルカムメッセージ"
                                className={styles.input}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label>説明</label>
                            <textarea
                                value={formData.description || ''}
                                onChange={e =>
                                    setFormData({
                                        ...formData,
                                        description: e.target.value
                                    })
                                }
                                placeholder="このトリガーの説明を入力"
                                className={styles.textarea}
                                rows={3}
                            />
                        </div>

                        <div className={styles.formRow}>
                            <div className={styles.formGroup}>
                                <label>イベントタイプ *</label>
                                <select
                                    value={formData.eventType || 'messageCreate'}
                                    onChange={e =>
                                        setFormData({
                                            ...formData,
                                            eventType: e.target.value
                                        })
                                    }
                                    className={styles.select}
                                >
                                    {eventTypes.map(type => (
                                        <option key={type.value} value={type.value}>
                                            {type.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className={styles.formGroup}>
                                <label>優先度</label>
                                <input
                                    type="number"
                                    value={formData.priority ?? 0}
                                    onChange={e =>
                                        setFormData({
                                            ...formData,
                                            priority: parseInt(e.target.value) || 0
                                        })
                                    }
                                    min="0"
                                    max="100"
                                    className={styles.input}
                                />
                            </div>
                        </div>

                        <div className={styles.formGroup}>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={formData.enabled ?? true}
                                    onChange={e =>
                                        setFormData({
                                            ...formData,
                                            enabled: e.target.checked
                                        })
                                    }
                                />
                                {' '}有効
                            </label>
                        </div>
                    </div>
                )}

                {/* Conditions Tab */}
                {tab === 'conditions' && (
                    <AdvancedConditionEditor
                        conditions={formData.conditions || []}
                        onConditionsChange={(conditions: any[]) =>
                            setFormData({ ...formData, conditions })
                        }
                        // pass and control the logic so it becomes part of formData
                        conditionLogic={(formData as any).conditionLogic || 'AND'}
                        onConditionLogicChange={(logic: 'AND' | 'OR') =>
                            setFormData({ ...formData, conditionLogic: logic })
                        }
                        eventType={formData.eventType || 'messageCreate'}
                    />
                )}

                {/* Presets Tab */}
                {tab === 'presets' && (
                    <AdvancedPresetEditor
                        presets={formData.presets || []}
                        onPresetsChange={(presets: any[]) => setFormData({ ...formData, presets })}
                        // pass guildId so EmojiPicker can fetch guild emojis
                        guildId={guildId}
                        runMode={(formData as any).runMode || 'all'}
                        onRunModeChange={(mode: 'all' | 'random' | 'single' | 'pinned-random') =>
                            setFormData({ ...formData, runMode: mode })
                        }
                        randomCount={(formData as any).randomCount || 1}
                        onRandomCountChange={(count: number) =>
                            setFormData({ ...formData, randomCount: count })
                        }
                    />
                )}
            </div>

            {/* Footer */}
            <div className={styles.editorFooter}>
                <button
                    className={styles.cancelBtn}
                    onClick={onCancel}
                    disabled={saving}
                >
                    キャンセル
                </button>
                {trigger && !isCreating && (
                    <button
                        className={styles.deleteBtn}
                        onClick={() => {
                            if (trigger) {
                                onDelete(trigger.id);
                            }
                        }}
                        disabled={saving}
                    >
                        削除
                    </button>
                )}
                <button
                    className={styles.saveBtn}
                    onClick={handleSave}
                    disabled={saving}
                >
                    {saving ? '保存中...' : '保存'}
                </button>
            </div>
        </div>
    );
};

export default TriggerEditor;
