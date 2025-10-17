import React, { useState } from 'react';
import styles from './AdvancedPresetEditor.module.css';
import PlaceholderHint from './PlaceholderHint.js';
import EmojiPicker from './EmojiPicker.js';
import { handleTabCompletion } from '../utils/tabCompletion.js';

interface Preset {
    id: string;
    triggerId: string;
    index: number;
    enabled: boolean;
    type: 'Embed' | 'Text' | 'Reply' | 'Webhook' | 'DM' | 'React';
    template?: string;
    targetChannelId?: string;
    cooldownSeconds?: number;
    embedConfig?: {
        title?: string;
        description?: string;
        color?: string;
        fields?: Array<{ name: string; value: string; inline?: boolean }>;
        imageUrl?: string;
        thumbnailUrl?: string;
        footer?: { text: string; iconUrl?: string };
        timestamp?: boolean;
    };
    replyTemplate?: string;
    replyWithMention?: boolean;
    webhookConfig?: {
        url?: string;
        method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
        headers?: Record<string, string>;
        bodyTemplate?: string;
    };
    dmTargetUserId?: string;
    reactEmoji?: string;
    removeAfterSeconds?: number;
}

interface AdvancedPresetEditorProps {
    presets: Preset[];
    onPresetsChange: (presets: Preset[]) => void;
}

const AdvancedPresetEditor: React.FC<AdvancedPresetEditorProps> = ({
    presets,
    onPresetsChange
}) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const presetTypes: Record<string, string> = {
        Text: 'テキスト応答',
        Embed: '埋め込みメッセージ',
        Reply: 'リプライ応答',
        Webhook: 'Webhook通知',
        DM: 'ダイレクトメッセージ',
        React: 'リアクション追加'
    };

    const handleAddPreset = () => {
        const newPreset: Preset = {
            id: `preset-${Date.now()}`,
            triggerId: '',
            index: presets.length,
            enabled: true,
            type: 'Text',
            template: '',
            cooldownSeconds: 0
        };
        onPresetsChange([...presets, newPreset]);
    };

    const handleRemovePreset = (id: string) => {
        onPresetsChange(presets.filter(p => p.id !== id));
    };

    const handleUpdatePreset = (id: string, updates: Partial<Preset>) => {
        onPresetsChange(
            presets.map(p => (p.id === id ? { ...p, ...updates } : p))
        );
    };

    // タイプ変更時に不要なフィールドをクリア/初期化して混在を防ぐ
    const handleChangePresetType = (id: string, newType: Preset['type']) => {
        const preset = presets.find(p => p.id === id);
        if (!preset) return;

        const base: Preset = { ...preset, type: newType } as Preset;

        switch (newType) {
            case 'React':
                // リアクションは絵文字のみ
                base.template = undefined;
                base.replyTemplate = undefined;
                base.webhookConfig = undefined;
                base.dmTargetUserId = undefined;
                base.embedConfig = undefined;
                base.reactEmoji = preset.reactEmoji || '';
                base.removeAfterSeconds = preset.removeAfterSeconds || 0;
                break;
            case 'Text':
                base.template = preset.template || '';
                base.replyTemplate = undefined;
                base.webhookConfig = undefined;
                base.embedConfig = undefined;
                base.reactEmoji = undefined;
                break;
            case 'Embed':
                base.embedConfig = preset.embedConfig || { title: '', description: '', color: '' };
                base.template = undefined;
                base.replyTemplate = undefined;
                base.webhookConfig = undefined;
                base.reactEmoji = undefined;
                break;
            case 'Reply':
                base.replyTemplate = preset.replyTemplate || '';
                base.replyWithMention = preset.replyWithMention || false;
                base.template = undefined;
                base.webhookConfig = undefined;
                base.embedConfig = undefined;
                base.reactEmoji = undefined;
                break;
            case 'Webhook':
                base.webhookConfig = preset.webhookConfig || { url: '', method: 'POST', headers: {}, bodyTemplate: '' };
                base.template = undefined;
                base.replyTemplate = undefined;
                base.embedConfig = undefined;
                base.reactEmoji = undefined;
                break;
            case 'DM':
                base.template = preset.template || '';
                base.dmTargetUserId = preset.dmTargetUserId || '{author}';
                base.replyTemplate = undefined;
                base.embedConfig = undefined;
                base.reactEmoji = undefined;
                break;
            default:
                break;
        }

        handleUpdatePreset(id, base);
    };

    const handleMovePreset = (id: string, direction: 'up' | 'down') => {
        const index = presets.findIndex(p => p.id === id);
        if (
            (direction === 'up' && index === 0) ||
            (direction === 'down' && index === presets.length - 1)
        ) {
            return;
        }

        const newPresets = [...presets];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        [newPresets[index], newPresets[targetIndex]] = [
            newPresets[targetIndex],
            newPresets[index]
        ];

        newPresets.forEach((p, i) => {
            p.index = i;
        });

        onPresetsChange(newPresets);
    };

    return (
        <div className={styles.advancedPresetEditor}>
            <div className={styles.editorHeader}>
                <h3>実行アクション (最大5個)</h3>
                <span className={styles.badge}>{presets.length}/5</span>
            </div>

            <div className={styles.presetsList}>
                {presets.length === 0 ? (
                    <div className={styles.emptyPresets}>
                        <span className="material-icons">extension</span>
                        <p>アクションを追加してください</p>
                    </div>
                ) : (
                    presets.map((preset, index) => (
                        <div
                            key={preset.id}
                            className={`${styles.presetItem} ${
                                expandedId === preset.id ? styles.expanded : ''
                            }`}
                        >
                            <div
                                className={styles.presetHeader}
                                onClick={() =>
                                    setExpandedId(
                                        expandedId === preset.id ? null : preset.id
                                    )
                                }
                            >
                                <div className={styles.presetIndex}>
                                    <span className={styles.number}>{index + 1}</span>
                                    <label className={styles.checkboxLabel}>
                                        <input
                                            type="checkbox"
                                            checked={preset.enabled}
                                            onChange={e => {
                                                e.stopPropagation();
                                                handleUpdatePreset(preset.id, {
                                                    enabled: e.target.checked
                                                });
                                            }}
                                        />
                                    </label>
                                </div>

                                <div className={styles.presetInfo}>
                                    <span className={styles.type}>
                                        {presetTypes[preset.type] || preset.type}
                                    </span>
                                    <span className={styles.description}>
                                        {preset.template ||
                                            preset.embedConfig?.title ||
                                            preset.replyTemplate ||
                                            preset.webhookConfig?.url ||
                                            preset.reactEmoji ||
                                            '(未設定)'}
                                    </span>
                                </div>

                                <div className={styles.presetActions}>
                                    <span
                                        className={`material-icons ${styles.icon}`}
                                    >
                                        {expandedId === preset.id
                                            ? 'expand_less'
                                            : 'expand_more'}
                                    </span>
                                </div>
                            </div>

                            {expandedId === preset.id && (
                                <div className={styles.presetEditor}>
                                    {/* Preset Type */}
                                    <div className={styles.formGroup}>
                                        <label>アクションタイプ:</label>
                                        <select
                                            value={preset.type}
                                            onChange={e =>
                                                handleChangePresetType(
                                                    preset.id,
                                                    e.target.value as Preset['type']
                                                )
                                            }
                                            className={styles.input}
                                        >
                                            {Object.entries(presetTypes).map(
                                                ([key, label]) => (
                                                    <option key={key} value={key}>
                                                        {label}
                                                    </option>
                                                )
                                            )}
                                        </select>
                                    </div>

                                    {/* Text Preset */}
                                    {preset.type === 'Text' && (
                                        <>
                                            <div className={styles.formGroup}>
                                                <label>メッセージテンプレート:</label>
                                                <textarea
                                                    value={preset.template || ''}
                                                    onChange={e =>
                                                        handleUpdatePreset(preset.id, {
                                                            template: e.target.value
                                                        })
                                                    }
                                                    onKeyDown={e => {
                                                        if (e.key === 'Tab') {
                                                            e.preventDefault();
                                                            const textarea = e.currentTarget;
                                                            const result = handleTabCompletion(textarea, e);
                                                            if (result) {
                                                                if (result.completed || result.newValue !== textarea.value) {
                                                                    handleUpdatePreset(preset.id, {
                                                                        template: result.newValue
                                                                    });
                                                                    setTimeout(() => {
                                                                        textarea.setSelectionRange(result.newCursorPos, result.newCursorPos);
                                                                    }, 0);
                                                                }
                                                            }
                                                        }
                                                    }}
                                                    placeholder="例: こんにちは {author.mention}！ (Tabで補完)"
                                                    rows={4}
                                                    className={styles.textarea}
                                                />
                                                <PlaceholderHint />
                                            </div>

                                            <div className={styles.formGroup}>
                                                <label>送信先チャンネルID (省略時: 同じチャンネル):</label>
                                                <input
                                                    type="text"
                                                    value={preset.targetChannelId || ''}
                                                    onChange={e =>
                                                        handleUpdatePreset(preset.id, {
                                                            targetChannelId: e.target.value
                                                        })
                                                    }
                                                    placeholder="チャンネルID"
                                                    className={styles.input}
                                                />
                                            </div>
                                        </>
                                    )}

                                    {/* Embed Preset */}
                                    {preset.type === 'Embed' && (
                                        <>
                                            <div className={styles.formGroup}>
                                                <label>タイトル:</label>
                                                <input
                                                    type="text"
                                                    value={preset.embedConfig?.title || ''}
                                                    onChange={e =>
                                                        handleUpdatePreset(preset.id, {
                                                            embedConfig: {
                                                                ...(preset.embedConfig || {}),
                                                                title: e.target.value
                                                            }
                                                        })
                                                    }
                                                    placeholder="埋め込みのタイトル"
                                                    className={styles.input}
                                                />
                                            </div>

                                            <div className={styles.formGroup}>
                                                <label>説明:</label>
                                                <textarea
                                                    value={preset.embedConfig?.description || ''}
                                                    onChange={e =>
                                                        handleUpdatePreset(preset.id, {
                                                            embedConfig: {
                                                                ...(preset.embedConfig || {}),
                                                                description: e.target.value
                                                            }
                                                        })
                                                    }
                                                    onKeyDown={e => {
                                                        if (e.key === 'Tab') {
                                                            e.preventDefault();
                                                            const textarea = e.currentTarget;
                                                            const result = handleTabCompletion(textarea, e);
                                                            if (result) {
                                                                if (result.completed || result.newValue !== textarea.value) {
                                                                    handleUpdatePreset(preset.id, {
                                                                        embedConfig: {
                                                                            ...(preset.embedConfig || {}),
                                                                            description: result.newValue
                                                                        }
                                                                    });
                                                                    setTimeout(() => {
                                                                        textarea.setSelectionRange(result.newCursorPos, result.newCursorPos);
                                                                    }, 0);
                                                                }
                                                            }
                                                        }
                                                    }}
                                                    placeholder="埋め込みの説明 (Tabで補完)"
                                                    rows={4}
                                                    className={styles.textarea}
                                                />
                                                <PlaceholderHint />
                                            </div>

                                            <div className={styles.formGroup}>
                                                <label>色 (16進数):</label>
                                                <input
                                                    type="text"
                                                    value={preset.embedConfig?.color || ''}
                                                    onChange={e =>
                                                        handleUpdatePreset(preset.id, {
                                                            embedConfig: {
                                                                ...(preset.embedConfig || {}),
                                                                color: e.target.value
                                                            }
                                                        })
                                                    }
                                                    placeholder="#5865F2"
                                                    className={styles.input}
                                                />
                                            </div>

                                            <div className={styles.formGroup}>
                                                <label>画像URL:</label>
                                                <input
                                                    type="url"
                                                    value={preset.embedConfig?.imageUrl || ''}
                                                    onChange={e =>
                                                        handleUpdatePreset(preset.id, {
                                                            embedConfig: {
                                                                ...(preset.embedConfig || {}),
                                                                imageUrl: e.target.value
                                                            }
                                                        })
                                                    }
                                                    placeholder="https://..."
                                                    className={styles.input}
                                                />
                                            </div>

                                            <div className={styles.formGroup}>
                                                <label>
                                                    <input
                                                        type="checkbox"
                                                        checked={preset.embedConfig?.timestamp || false}
                                                        onChange={e =>
                                                            handleUpdatePreset(preset.id, {
                                                                embedConfig: {
                                                                    ...(preset.embedConfig || {}),
                                                                    timestamp: e.target.checked
                                                                }
                                                            })
                                                        }
                                                    />
                                                    <span className={styles.checkboxText}>タイムスタンプを表示</span>
                                                </label>
                                            </div>
                                        </>
                                    )}

                                    {/* Reply Preset */}
                                    {preset.type === 'Reply' && (
                                        <>
                                            <div className={styles.formGroup}>
                                                <label>リプライメッセージ:</label>
                                                <textarea
                                                    value={preset.replyTemplate || ''}
                                                    onChange={e =>
                                                        handleUpdatePreset(preset.id, {
                                                            replyTemplate: e.target.value
                                                        })
                                                    }
                                                    onKeyDown={e => {
                                                        if (e.key === 'Tab') {
                                                            e.preventDefault();
                                                            const textarea = e.currentTarget;
                                                            const result = handleTabCompletion(textarea, e);
                                                            if (result) {
                                                                if (result.completed || result.newValue !== textarea.value) {
                                                                    handleUpdatePreset(preset.id, {
                                                                        replyTemplate: result.newValue
                                                                    });
                                                                    setTimeout(() => {
                                                                        textarea.setSelectionRange(result.newCursorPos, result.newCursorPos);
                                                                    }, 0);
                                                                }
                                                            }
                                                        }
                                                    }}
                                                    placeholder="リプライの内容を入力 (Tabで補完)"
                                                    rows={4}
                                                    className={styles.textarea}
                                                />
                                                <PlaceholderHint />
                                            </div>

                                            <div className={styles.formGroup}>
                                                <label>
                                                    <input
                                                        type="checkbox"
                                                        checked={preset.replyWithMention || false}
                                                        onChange={e =>
                                                            handleUpdatePreset(preset.id, {
                                                                replyWithMention: e.target.checked
                                                            })
                                                        }
                                                    />
                                                    <span className={styles.checkboxText}>返信元のユーザーをメンションする</span>
                                                </label>
                                            </div>
                                        </>
                                    )}

                                    {/* React Preset */}
                                    {preset.type === 'React' && (
                                        <>
                                            <div className={styles.formGroup}>
                                                <label>リアクション絵文字:</label>
                                                <EmojiPicker
                                                    value={preset.reactEmoji || ''}
                                                    onChange={(emoji) =>
                                                        handleUpdatePreset(preset.id, {
                                                            reactEmoji: emoji
                                                        })
                                                    }
                                                />
                                            </div>

                                            <div className={styles.formGroup}>
                                                <label>自動削除 (秒) - 0で無効:</label>
                                                <input
                                                    type="number"
                                                    value={preset.removeAfterSeconds || 0}
                                                    onChange={e =>
                                                        handleUpdatePreset(preset.id, {
                                                            removeAfterSeconds: parseInt(
                                                                e.target.value
                                                            )
                                                        })
                                                    }
                                                    min="0"
                                                    className={styles.input}
                                                />
                                            </div>
                                        </>
                                    )}

                                    {/* Webhook Preset */}
                                    {preset.type === 'Webhook' && (
                                        <>
                                            <div className={styles.formGroup}>
                                                <label>Webhook URL:</label>
                                                <input
                                                    type="text"
                                                    value={preset.webhookConfig?.url || ''}
                                                    onChange={e =>
                                                        handleUpdatePreset(preset.id, {
                                                            webhookConfig: {
                                                                ...(preset.webhookConfig || { method: 'POST', headers: {}, bodyTemplate: '' }),
                                                                url: e.target.value
                                                            }
                                                        })
                                                    }
                                                    placeholder="https://webhook.example.com/..."
                                                    className={styles.input}
                                                />
                                            </div>

                                            <div className={styles.formGroup}>
                                                <label>HTTPメソッド:</label>
                                                <select
                                                    value={preset.webhookConfig?.method || 'POST'}
                                                    onChange={e => {
                                                        const newConfig = { ...preset.webhookConfig };
                                                        newConfig.method = e.target.value as 'GET' | 'POST' | 'PUT' | 'DELETE';
                                                        handleUpdatePreset(preset.id, {
                                                            webhookConfig: newConfig
                                                        });
                                                    }}
                                                    className={styles.input}
                                                >
                                                    <option value="GET">GET</option>
                                                    <option value="POST">POST</option>
                                                    <option value="PUT">PUT</option>
                                                    <option value="DELETE">DELETE</option>
                                                </select>
                                            </div>

                                            <div className={styles.formGroup}>
                                                <label>リクエストボディテンプレート (JSON):</label>
                                                <textarea
                                                    value={preset.webhookConfig?.bodyTemplate || ''}
                                                    onChange={e => {
                                                        const newConfig = { ...preset.webhookConfig };
                                                        newConfig.bodyTemplate = e.target.value;
                                                        handleUpdatePreset(preset.id, {
                                                            webhookConfig: newConfig
                                                        });
                                                    }}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Tab') {
                                                            e.preventDefault();
                                                            const textarea = e.currentTarget;
                                                            const result = handleTabCompletion(textarea, e);
                                                            if (result) {
                                                                if (result.completed || result.newValue !== textarea.value) {
                                                                    const newConfig = { ...preset.webhookConfig };
                                                                    newConfig.bodyTemplate = result.newValue;
                                                                    handleUpdatePreset(preset.id, {
                                                                        webhookConfig: newConfig
                                                                    });
                                                                    setTimeout(() => {
                                                                        textarea.setSelectionRange(result.newCursorPos, result.newCursorPos);
                                                                    }, 0);
                                                                }
                                                            }
                                                        }
                                                    }}
                                                    placeholder='{"event": "trigger", "author": "{author.id}", "message": "{template}"} (Tabで補完)'
                                                    rows={4}
                                                    className={styles.textarea}
                                                />
                                            </div>

                                            <div className={styles.formGroup}>
                                                <label>カスタムヘッダー (JSON):</label>
                                                <textarea
                                                    value={JSON.stringify(preset.webhookConfig?.headers || {}, null, 2)}
                                                    onChange={e => {
                                                        try {
                                                            const headers = JSON.parse(e.target.value);
                                                            const newConfig = { ...preset.webhookConfig };
                                                            newConfig.headers = headers;
                                                            handleUpdatePreset(preset.id, {
                                                                webhookConfig: newConfig
                                                            });
                                                        } catch {
                                                            // JSON解析失敗時は無視
                                                        }
                                                    }}
                                                    placeholder='{"Authorization": "Bearer token", "Content-Type": "application/json"}'
                                                    rows={3}
                                                    className={styles.textarea}
                                                />
                                            </div>
                                        </>
                                    )}

                                    {/* DM Preset */}
                                    {preset.type === 'DM' && (
                                        <>
                                            <div className={styles.formGroup}>
                                                <label>メッセージ:</label>
                                                <textarea
                                                    value={preset.template || ''}
                                                    onChange={e =>
                                                        handleUpdatePreset(preset.id, {
                                                            template: e.target.value
                                                        })
                                                    }
                                                    onKeyDown={e => {
                                                        if (e.key === 'Tab') {
                                                            e.preventDefault();
                                                            const textarea = e.currentTarget;
                                                            const result = handleTabCompletion(textarea, e);
                                                            if (result) {
                                                                if (result.completed || result.newValue !== textarea.value) {
                                                                    handleUpdatePreset(preset.id, {
                                                                        template: result.newValue
                                                                    });
                                                                    setTimeout(() => {
                                                                        textarea.setSelectionRange(result.newCursorPos, result.newCursorPos);
                                                                    }, 0);
                                                                }
                                                            }
                                                        }
                                                    }}
                                                    placeholder="DM内容を入力 (Tabで補完)"
                                                    rows={4}
                                                    className={styles.textarea}
                                                />
                                                <PlaceholderHint />
                                            </div>

                                            <div className={styles.formGroup}>
                                                <label>対象ユーザーID (デフォルト: メッセージ作者):</label>
                                                <input
                                                    type="text"
                                                    value={preset.dmTargetUserId || ''}
                                                    onChange={e =>
                                                        handleUpdatePreset(preset.id, {
                                                            dmTargetUserId: e.target.value
                                                        })
                                                    }
                                                    placeholder="{author} または ユーザーID"
                                                    className={styles.input}
                                                />
                                            </div>
                                        </>
                                    )}

                                    {/* Common Cooldown */}
                                    <div className={styles.formGroup}>
                                        <label>クールダウン (秒):</label>
                                        <input
                                            type="number"
                                            value={preset.cooldownSeconds || 0}
                                            onChange={e =>
                                                handleUpdatePreset(preset.id, {
                                                    cooldownSeconds: parseInt(e.target.value)
                                                })
                                            }
                                            min="0"
                                            className={styles.input}
                                        />
                                    </div>

                                    {/* Actions */}
                                    <div className={styles.actionButtons}>
                                        <button
                                            className={`${styles.btn} ${styles.btnSmall}`}
                                            onClick={() => handleMovePreset(preset.id, 'up')}
                                            disabled={index === 0}
                                            title="上へ移動"
                                        >
                                            <span className="material-icons">arrow_upward</span>
                                        </button>
                                        <button
                                            className={`${styles.btn} ${styles.btnSmall}`}
                                            onClick={() => handleMovePreset(preset.id, 'down')}
                                            disabled={index === presets.length - 1}
                                            title="下へ移動"
                                        >
                                            <span className="material-icons">arrow_downward</span>
                                        </button>
                                        <button
                                            className={`${styles.btn} ${styles.btnDanger}`}
                                            onClick={() => handleRemovePreset(preset.id)}
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

            {presets.length < 5 && (
                <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={handleAddPreset}
                >
                    <span className="material-icons">add</span>
                    アクションを追加
                </button>
            )}
        </div>
    );
};

export default AdvancedPresetEditor;
