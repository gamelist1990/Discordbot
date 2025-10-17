import React from 'react';
import styles from './TriggerList.module.css';

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

interface TriggerListProps {
    triggers: Trigger[];
    selectedTrigger: Trigger | null;
    searchQuery: string;
    filterEventType: string;
    onSearchChange: (query: string) => void;
    onFilterEventTypeChange: (type: string) => void;
    onSelectTrigger: (trigger: Trigger) => void;
    onCreateNew: () => void;
}

const TriggerList: React.FC<TriggerListProps> = ({
    triggers,
    selectedTrigger,
    searchQuery,
    filterEventType,
    onSearchChange,
    onFilterEventTypeChange,
    onSelectTrigger,
    onCreateNew
}) => {
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
        <div className={styles.listPanel}>
            <div className={styles.listHeader}>
                <h2>トリガー一覧</h2>
                <button
                    className={styles.createBtn}
                    onClick={onCreateNew}
                    title="新規作成"
                >
                    <span className="material-icons">add</span>
                </button>
            </div>

            {/* Search Bar */}
            <div className={styles.searchBar}>
                <span className="material-icons">search</span>
                <input
                    type="text"
                    placeholder="トリガー名で検索..."
                    value={searchQuery}
                    onChange={e => onSearchChange(e.target.value)}
                    className={styles.searchInput}
                />
            </div>

            {/* Filter */}
            <div className={styles.filterGroup}>
                <label>イベントタイプ:</label>
                <select
                    value={filterEventType}
                    onChange={e => onFilterEventTypeChange(e.target.value)}
                    className={styles.filterSelect}
                >
                    <option value="">すべて</option>
                    {eventTypes.map(type => (
                        <option key={type.value} value={type.value}>
                            {type.label}
                        </option>
                    ))}
                </select>
            </div>

            {/* List Items */}
            <div className={styles.triggerListContainer}>
                {triggers.length === 0 ? (
                    <div className={styles.emptyState}>
                        <span className="material-icons">inbox</span>
                        <p>トリガーがありません</p>
                        <button
                            className={styles.createBtnPrimary}
                            onClick={onCreateNew}
                        >
                            <span className="material-icons">add</span>
                            新規作成
                        </button>
                    </div>
                ) : (
                    triggers.map(trigger => (
                        <div
                            key={trigger.id}
                            className={`${styles.triggerListItem} ${
                                selectedTrigger?.id === trigger.id ? styles.selected : ''
                            }`}
                            onClick={() => onSelectTrigger(trigger)}
                        >
                            <div className={styles.itemHeader}>
                                <h4>{trigger.name}</h4>
                                <span
                                    className={`${styles.badge} ${
                                        trigger.enabled ? styles.enabled : styles.disabled
                                    }`}
                                >
                                    {trigger.enabled ? '有効' : '無効'}
                                </span>
                            </div>
                            <p className={styles.itemDescription}>
                                {trigger.description || '説明なし'}
                            </p>
                            <div className={styles.itemMeta}>
                                <span className={styles.eventType}>
                                    {trigger.eventType}
                                </span>
                                <span className={styles.priority}>
                                    優先度: {trigger.priority}
                                </span>
                                <span className={styles.presetCount}>
                                    {trigger.presets?.length || 0} プリセット
                                </span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default TriggerList;
