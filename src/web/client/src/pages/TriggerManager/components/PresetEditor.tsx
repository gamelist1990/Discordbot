import React from 'react';
import styles from './PresetEditor.module.css';

interface Preset {
    id: string;
    index: number;
    enabled: boolean;
    type: string;
    template: string;
    // cooldownSeconds: time before reused; removeAfterSeconds: auto-delete sent message
    cooldownSeconds?: number;
    removeAfterSeconds?: number;
}

interface PresetEditorProps {
    presets: Preset[];
    onChange: (presets: Preset[]) => void;
}

const PresetEditor: React.FC<PresetEditorProps> = ({ presets, onChange }) => {
    const presetTypes = [
        { value: 'Text', label: 'テキスト応答' },
        { value: 'Embed', label: '埋め込みメッセージ' },
        { value: 'Reply', label: '返信' },
        { value: 'Modal', label: 'モーダル' },
        { value: 'Webhook', label: 'Webhook' },
        { value: 'DM', label: 'ダイレクトメッセージ' },
        { value: 'React', label: 'リアクション' }
    ];

    const addPreset = () => {
        if (presets.length >= 5) {
            try { (window as any).web?.notify?.('プリセットは最大5個までです', 'error', '上限エラー', 4000); } catch {}
            return;
        }
        onChange([
            ...presets,
            {
                id: `preset-${Date.now()}`,
                index: presets.length,
                enabled: true,
                type: 'Text',
                template: '',
                cooldownSeconds: 0,
                removeAfterSeconds: 0
            }
        ]);
    };

    const updatePreset = (index: number, field: string, value: any) => {
        const updated = [...presets];
        updated[index] = { ...updated[index], [field]: value };
        onChange(updated);
    };

    const removePreset = (index: number) => {
        onChange(presets.filter((_, i) => i !== index));
    };

    const togglePreset = (index: number) => {
        const updated = [...presets];
        updated[index].enabled = !updated[index].enabled;
        onChange(updated);
    };

    return (
        <div className={styles.formSection}>
            <p className={styles.sectionDescription}>
                アクション/レスポンスプリセットを追加します（最大5個）
            </p>

            {presets.length === 0 ? (
                <div className={styles.emptySection}>
                    <p>プリセットがまだ追加されていません</p>
                </div>
            ) : (
                <div className={styles.presetsList}>
                    {presets.map((preset, index) => (
                        <div key={preset.id} className={styles.presetItem}>
                            <div className={styles.presetHeader}>
                                <span className={styles.presetIndex}>#{index + 1}</span>

                                <select
                                    value={preset.type}
                                    onChange={e =>
                                        updatePreset(index, 'type', e.target.value)
                                    }
                                    className={styles.select}
                                >
                                    {presetTypes.map(type => (
                                        <option key={type.value} value={type.value}>
                                            {type.label}
                                        </option>
                                    ))}
                                </select>

                                <button
                                    className={`${styles.toggleBtn} ${
                                        preset.enabled ? styles.enabled : ''
                                    }`}
                                    onClick={() => togglePreset(index)}
                                    title={
                                        preset.enabled ? '無効にする' : '有効にする'
                                    }
                                >
                                    <span className="material-icons">
                                        {preset.enabled
                                            ? 'check_circle'
                                            : 'radio_button_unchecked'}
                                    </span>
                                </button>

                                <button
                                    className={styles.removeBtn}
                                    onClick={() => removePreset(index)}
                                    title="削除"
                                >
                                    <span className="material-icons">delete</span>
                                </button>
                            </div>

                            <textarea
                                value={preset.template}
                                onChange={e =>
                                    updatePreset(index, 'template', e.target.value)
                                }
                                placeholder="テンプレート内容を入力"
                                className={styles.textarea}
                                rows={4}
                            />

                            <div className={styles.formGroup}>
                                <label>クールダウン（秒）</label>
                                <input
                                    type="number"
                                    value={preset.cooldownSeconds ?? 0}
                                    onChange={e =>
                                        updatePreset(
                                            index,
                                            'cooldownSeconds',
                                            parseInt(e.target.value) || 0
                                        )
                                    }
                                    min="0"
                                    className={styles.input}
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>自動削除時間（秒）</label>
                                <input
                                    type="number"
                                    value={preset.removeAfterSeconds ?? 0}
                                    onChange={e =>
                                        updatePreset(
                                            index,
                                            'removeAfterSeconds',
                                            parseInt(e.target.value) || 0
                                        )
                                    }
                                    min="0"
                                    className={styles.input}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {presets.length < 5 && (
                <button className={styles.addBtn} onClick={addPreset}>
                    <span className="material-icons">add</span>
                    プリセットを追加
                </button>
            )}
        </div>
    );
};

export default PresetEditor;
