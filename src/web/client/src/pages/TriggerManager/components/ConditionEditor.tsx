import React from 'react';
import styles from './ConditionEditor.module.css';

interface Condition {
    id: string;
    type: string;
    matchType: string;
    value: string;
    negate?: boolean;
}

interface ConditionEditorProps {
    conditions: Condition[];
    onChange: (conditions: Condition[]) => void;
}

const ConditionEditor: React.FC<ConditionEditorProps> = ({ conditions, onChange }) => {
    const conditionTypes = [
        { value: 'messageContent', label: 'メッセージ内容' },
        { value: 'authorId', label: 'ユーザーID' },
        { value: 'channelId', label: 'チャンネルID' },
        { value: 'roleId', label: 'ロールID' },
        { value: 'hasAttachment', label: 'ファイル添付' },
        { value: 'mention', label: 'メンション' }
    ];

    const matchTypes = [
        { value: 'contains', label: '含む' },
        { value: 'equals', label: '完全一致' },
        { value: 'startsWith', label: '始まる' },
        { value: 'endsWith', label: '終わる' },
        { value: 'regex', label: '正規表現' }
    ];

    const addCondition = () => {
        onChange([
            ...conditions,
            {
                id: `cond-${Date.now()}`,
                type: 'messageContent',
                matchType: 'contains',
                value: ''
            }
        ]);
    };

    const updateCondition = (index: number, field: string, value: any) => {
        const updated = [...conditions];
        updated[index] = { ...updated[index], [field]: value };
        onChange(updated);
    };

    const removeCondition = (index: number) => {
        onChange(conditions.filter((_, i) => i !== index));
    };

    return (
        <div className={styles.formSection}>
            <p className={styles.sectionDescription}>
                条件を追加して、トリガーが発火する場合を制限します。複数の条件を追加できます。
            </p>

            {conditions.length === 0 ? (
                <div className={styles.emptySection}>
                    <p>条件がまだ追加されていません</p>
                </div>
            ) : (
                <div className={styles.conditionsList}>
                    {conditions.map((condition, index) => (
                        <div key={condition.id} className={styles.conditionItem}>
                            <div className={styles.conditionRow}>
                                <select
                                    value={condition.type}
                                    onChange={e =>
                                        updateCondition(index, 'type', e.target.value)
                                    }
                                    className={styles.select}
                                >
                                    {conditionTypes.map(type => (
                                        <option key={type.value} value={type.value}>
                                            {type.label}
                                        </option>
                                    ))}
                                </select>

                                <select
                                    value={condition.matchType}
                                    onChange={e =>
                                        updateCondition(index, 'matchType', e.target.value)
                                    }
                                    className={styles.select}
                                >
                                    {matchTypes.map(type => (
                                        <option key={type.value} value={type.value}>
                                            {type.label}
                                        </option>
                                    ))}
                                </select>

                                <input
                                    type="text"
                                    value={condition.value}
                                    onChange={e =>
                                        updateCondition(index, 'value', e.target.value)
                                    }
                                    placeholder="値を入力"
                                    className={styles.input}
                                />

                                <button
                                    className={styles.removeBtn}
                                    onClick={() => removeCondition(index)}
                                    title="削除"
                                >
                                    <span className="material-icons">delete</span>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <button className={styles.addBtn} onClick={addCondition}>
                <span className="material-icons">add</span>
                条件を追加
            </button>
        </div>
    );
};

export default ConditionEditor;
