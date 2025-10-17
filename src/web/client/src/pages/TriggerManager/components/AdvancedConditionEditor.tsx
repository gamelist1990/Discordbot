import React, { useState } from 'react';
import styles from './AdvancedConditionEditor.module.css';

interface Condition {
    id: string;
    type: 'messageContent' | 'authorId' | 'authorRole' | 'channelId' | 'hasAttachment' | 'mention' | 'regex' | 'custom';
    matchType: 'exactly' | 'contains' | 'regex' | 'startsWith' | 'endsWith' | 'greaterThan' | 'lessThan';
    value: string;
    negate?: boolean;
    groupId?: string;
}

// マッチ方式の日本語ラベルマッピング
const MATCH_TYPE_LABELS: Record<string, string> = {
    'exactly': '完全一致',
    'contains': '含む',
    'regex': '正規表現',
    'startsWith': '開始位置一致',
    'endsWith': '終了位置一致',
    'greaterThan': 'より大きい',
    'lessThan': 'より小さい'
};

interface AdvancedConditionEditorProps {
    conditions: Condition[];
    onConditionsChange: (conditions: Condition[]) => void;
    // controlled logic (AND / OR). If omitted, defaults to 'AND'
    conditionLogic?: 'AND' | 'OR';
    onConditionLogicChange?: (logic: 'AND' | 'OR') => void;
    eventType: string;
}

const AdvancedConditionEditor: React.FC<AdvancedConditionEditorProps> = ({
    conditions,
    onConditionsChange,
    conditionLogic: controlledLogic,
    onConditionLogicChange,
    eventType: _eventType // 将来の使用のため保持
}) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    // use controlled prop if provided, otherwise default to internal local state
    const [internalLogic, setInternalLogic] = useState<'AND' | 'OR'>('AND');
    const conditionLogic = controlledLogic ?? internalLogic;

    const conditionTypes: Record<string, { label: string; matchTypes: string[] }> = {
        messageContent: {
            label: 'メッセージ内容',
            matchTypes: ['contains', 'exactly', 'startsWith', 'endsWith', 'regex']
        },
        authorId: {
            label: 'ユーザーID',
            matchTypes: ['exactly', 'regex']
        },
        authorRole: {
            label: 'ロール',
            matchTypes: ['contains', 'exactly']
        },
        channelId: {
            label: 'チャンネルID',
            matchTypes: ['exactly', 'regex']
        },
        hasAttachment: {
            label: 'ファイル添付',
            matchTypes: ['exactly']
        },
        mention: {
            label: 'メンション',
            matchTypes: ['contains', 'exactly']
        },
        regex: {
            label: '正規表現',
            matchTypes: ['regex']
        },
        custom: {
            label: 'カスタム',
            matchTypes: ['exactly', 'contains', 'regex']
        }
    };

    const handleAddCondition = () => {
        const newCondition: Condition = {
            id: `cond-${Date.now()}`,
            type: 'messageContent',
            matchType: 'contains',
            value: '',
            negate: false,
            groupId: undefined
        };
        onConditionsChange([...conditions, newCondition]);
    };

    const handleRemoveCondition = (id: string) => {
        onConditionsChange(conditions.filter(c => c.id !== id));
    };

    const handleUpdateCondition = (id: string, updates: Partial<Condition>) => {
        onConditionsChange(
            conditions.map(c => (c.id === id ? { ...c, ...updates } : c))
        );
    };

    const handleCopyCondition = (id: string) => {
        const condition = conditions.find(c => c.id === id);
        if (!condition) return;

        const newCondition: Condition = {
            ...condition,
            id: `cond-${Date.now()}`
        };
        onConditionsChange([...conditions, newCondition]);
    };

    return (
        <div className={styles.advancedConditionEditor}>
            <div className={styles.editorHeader}>
                <h3>条件設定</h3>
                <div className={styles.logicSelector}>
                    <label>論理演算:</label>
                    <select
                        value={conditionLogic}
                        onChange={e => {
                            const v = e.target.value as 'AND' | 'OR';
                            // prefer calling parent handler if provided
                            if (onConditionLogicChange) {
                                onConditionLogicChange(v);
                            } else {
                                setInternalLogic(v);
                            }
                        }}
                        className={styles.logicSelect}
                    >
                        <option value="AND">全て満たす (AND)</option>
                        <option value="OR">いずれか満たす (OR)</option>
                    </select>
                </div>
            </div>

            <div className={styles.conditionsList}>
                {conditions.length === 0 ? (
                    <div className={styles.emptyConditions}>
                        <span className="material-icons">list_alt</span>
                        <p>条件を追加してください</p>
                    </div>
                ) : (
                    conditions.map((condition, index) => (
                        <div
                            key={condition.id}
                            className={`${styles.conditionItem} ${
                                expandedId === condition.id ? styles.expanded : ''
                            }`}
                        >
                            <div
                                className={styles.conditionHeader}
                                onClick={() =>
                                    setExpandedId(
                                        expandedId === condition.id ? null : condition.id
                                    )
                                }
                            >
                                <div className={styles.conditionIndex}>
                                    {index > 0 && (
                                        <span className={styles.logic}>{conditionLogic}</span>
                                    )}
                                    <span className={styles.number}>{index + 1}</span>
                                </div>

                                <div className={styles.conditionSummary}>
                                    <span className={styles.type}>
                                        {conditionTypes[condition.type]?.label || '不明'}
                                    </span>
                                    <span className={styles.matchType}>
                                        {MATCH_TYPE_LABELS[condition.matchType] || condition.matchType}
                                    </span>
                                    <span className={styles.value}>
                                        {condition.negate && '!'}
                                        {condition.value || '(未設定)'}
                                    </span>
                                </div>

                                <div className={styles.conditionActions}>
                                    <span
                                        className={`material-icons ${styles.icon}`}
                                    >
                                        {expandedId === condition.id
                                            ? 'expand_less'
                                            : 'expand_more'}
                                    </span>
                                </div>
                            </div>

                            {expandedId === condition.id && (
                                <div className={styles.conditionEditor}>
                                    {/* Condition Type */}
                                    <div className={styles.formGroup}>
                                        <label>条件タイプ:</label>
                                        <select
                                            value={condition.type}
                                            onChange={e =>
                                                handleUpdateCondition(condition.id, {
                                                    type: e.target.value as any
                                                })
                                            }
                                            className={styles.input}
                                        >
                                            {Object.entries(conditionTypes).map(
                                                ([key, { label }]) => (
                                                    <option key={key} value={key}>
                                                        {label}
                                                    </option>
                                                )
                                            )}
                                        </select>
                                    </div>

                                    {/* Match Type */}
                                    <div className={styles.formGroup}>
                                        <label>マッチ方式:</label>
                                        <select
                                            value={condition.matchType}
                                            onChange={e =>
                                                handleUpdateCondition(condition.id, {
                                                    matchType: e.target.value as any
                                                })
                                            }
                                            className={styles.input}
                                        >
                                            {conditionTypes[condition.type]?.matchTypes.map(
                                                type => (
                                                    <option key={type} value={type}>
                                                        {MATCH_TYPE_LABELS[type] || type}
                                                    </option>
                                                )
                                            )}
                                        </select>
                                    </div>

                                    {/* Value */}
                                    <div className={styles.formGroup}>
                                        <label>値:</label>
                                        <input
                                            type="text"
                                            value={condition.value}
                                            onChange={e =>
                                                handleUpdateCondition(condition.id, {
                                                    value: e.target.value
                                                })
                                            }
                                            placeholder="条件値を入力..."
                                            className={styles.input}
                                        />
                                    </div>

                                    {/* Negate Checkbox */}
                                    <div className={styles.formGroup}>
                                        <label className={styles.checkboxLabel}>
                                            <input
                                                type="checkbox"
                                                checked={condition.negate || false}
                                                onChange={e =>
                                                    handleUpdateCondition(condition.id, {
                                                        negate: e.target.checked
                                                    })
                                                }
                                            />
                                            <span>この条件を反転 (NOT)</span>
                                        </label>
                                    </div>

                                    {/* Actions */}
                                    <div className={styles.actionButtons}>
                                        <button
                                            className={`${styles.btn} ${styles.btnSecondary}`}
                                            onClick={() => handleCopyCondition(condition.id)}
                                            title="複製"
                                        >
                                            <span className="material-icons">content_copy</span>
                                        </button>
                                        <button
                                            className={`${styles.btn} ${styles.btnDanger}`}
                                            onClick={() =>
                                                handleRemoveCondition(condition.id)
                                            }
                                            title="削除"
                                        >
                                            <span className="material-icons">delete</span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={handleAddCondition}
            >
                <span className="material-icons">add</span>
                条件を追加
            </button>
        </div>
    );
};

export default AdvancedConditionEditor;
