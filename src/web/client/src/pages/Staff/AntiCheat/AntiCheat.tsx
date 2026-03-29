import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageShell from '../../../components/PageShell';
import { useAntiCheatActions, useAntiCheatSettings, useDetectionLogs, useUserTrust } from './hooks';
import styles from './AntiCheat.module.css';
import {
    AntiCheatSettings,
    DetectionLog,
    DetectorConfig,
    PunishmentAction,
    PunishmentThreshold,
    UserTrustDataWithUser,
    WordFilterRule
} from './types';

type TabKey = 'overview' | 'rules' | 'punishments' | 'logs' | 'trust';

const DETECTOR_CATALOG = [
    { key: 'textSpam', title: 'テキストスパム', icon: 'sms', description: '短時間の大量投稿、重複投稿、大文字比率の高い投稿を検知します。' },
    { key: 'inviteReferral', title: '広告防止 / 紹介', icon: 'campaign', description: 'Discord招待や紹介・広告用のリンクパターンを削除対象として扱います。' },
    { key: 'redirectLink', title: 'リンク解決', icon: 'link', description: '未知のリダイレクトドメインを解析し、裏のURLと危険性を公開します。' },
    { key: 'copyPaste', title: 'アンチコピーペースト', icon: 'content_paste_off', description: '詐欺コピペや装飾Unicodeを含む迷惑文面を検知します。' },
    { key: 'everyoneMention', title: 'アンチ Everyone', icon: 'alternate_email', description: '@everyone / @here と、同名ロールを使った通知を防ぎます。' },
    { key: 'duplicateMessage', title: 'アンチ重複', icon: 'content_copy', description: '重複投稿の回数に応じて削除とスコア加算を行います。' },
    { key: 'mentionLimit', title: '最大言及', icon: 'groups', description: 'ユーザー・ロールへの大量メンションを閾値ベースで抑制します。' },
    { key: 'maxLines', title: '最大行数', icon: 'format_line_spacing', description: '長文スパムを行数単位で抑制し、倍数ごとにスコアを積みます。' },
    { key: 'wordFilter', title: 'フィルター', icon: 'filter_alt', description: '単語、フレーズ、正規表現ごとに個別スコアを設定できます。' },
    { key: 'raidDetection', title: '自動アンチレイド', icon: 'security', description: '参加頻度を監視し、短時間参加が増えた時にレイドモードを有効化します。' }
] as const;

const TAB_LABELS: Record<TabKey, string> = {
    overview: '概要',
    rules: '検知ルール',
    punishments: '処罰',
    logs: 'ログ',
    trust: '信頼スコア'
};

const EMPTY_PUNISHMENT_ACTION: PunishmentAction = {
    type: 'timeout',
    durationSeconds: 600,
    reasonTemplate: 'AntiCheat violation: threshold {threshold}',
    notify: true
};

function cloneSettings(settings: AntiCheatSettings): AntiCheatSettings {
    return JSON.parse(JSON.stringify(settings)) as AntiCheatSettings;
}

function formatDate(value?: string | null): string {
    if (!value) return '未設定';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '未設定' : date.toLocaleString('ja-JP');
}

function toMultiline(values: string[]): string {
    return values.join('\n');
}

function parseListText(value: string): string[] {
    return value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
}

function createWordFilterRule(): WordFilterRule {
    return {
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: '',
        pattern: '',
        mode: 'contains',
        score: 1,
        deleteMessage: true,
        enabled: true
    };
}

const AntiCheatUnified: React.FC = () => {
    const { guildId } = useParams<{ guildId: string }>();
    const navigate = useNavigate();
    const { settings, loading, error, updateSettings } = useAntiCheatSettings(guildId || '');
    const { logs, loading: logsLoading, error: logsError, refetch: refetchLogs } = useDetectionLogs(guildId || '', 60);
    const { trust, loading: trustLoading, error: trustError, refetch: refetchTrust } = useUserTrust(guildId || '');
    const { revokeTimeout, resetTrust, executing, error: actionError } = useAntiCheatActions(guildId || '');
    const [activeTab, setActiveTab] = useState<TabKey>('overview');
    const [draft, setDraft] = useState<AntiCheatSettings | null>(null);
    const [excludedRolesText, setExcludedRolesText] = useState('');
    const [excludedChannelsText, setExcludedChannelsText] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveNotice, setSaveNotice] = useState<string | null>(null);
    const [punishmentDraft, setPunishmentDraft] = useState<PunishmentThreshold>({
        threshold: 10,
        actions: [{ ...EMPTY_PUNISHMENT_ACTION }]
    });

    useEffect(() => {
        if (!settings) return;
        const nextDraft = cloneSettings(settings);
        setDraft(nextDraft);
        setExcludedRolesText(toMultiline(nextDraft.excludedRoles));
        setExcludedChannelsText(toMultiline(nextDraft.excludedChannels));
    }, [settings]);

    const trustEntries = useMemo(() => {
        if (!trust || Array.isArray(trust)) return [];
        return Object.entries(trust as Record<string, UserTrustDataWithUser>)
            .map(([userId, value]) => ({ userId, ...value }))
            .sort((left, right) => right.score - left.score);
    }, [trust]);

    const enabledDetectorCount = useMemo(
        () => Object.values(draft?.detectors || {}).filter((detector) => detector.enabled).length,
        [draft]
    );

    if (!guildId) {
        return null;
    }

    const commitDraft = async (message: string) => {
        if (!draft) return;
        setSaving(true);
        setSaveNotice(null);
        const payload: AntiCheatSettings = {
            ...draft,
            excludedRoles: parseListText(excludedRolesText),
            excludedChannels: parseListText(excludedChannelsText)
        };
        const success = await updateSettings(payload);
        setSaving(false);
        if (success) setSaveNotice(message);
    };

    const updateDraft = (updater: (current: AntiCheatSettings) => AntiCheatSettings) => {
        setDraft((current) => (current ? updater(current) : current));
    };

    const updateDetector = (detectorKey: string, patch: Partial<DetectorConfig>) => {
        updateDraft((current) => ({
            ...current,
            detectors: {
                ...current.detectors,
                [detectorKey]: {
                    ...current.detectors[detectorKey],
                    ...patch
                }
            }
        }));
    };

    const updateDetectorConfig = (detectorKey: string, field: string, value: unknown) => {
        updateDraft((current) => ({
            ...current,
            detectors: {
                ...current.detectors,
                [detectorKey]: {
                    ...current.detectors[detectorKey],
                    config: {
                        ...(current.detectors[detectorKey]?.config || {}),
                        [field]: value
                    }
                }
            }
        }));
    };

    const wordFilterRules = useMemo(
        () => ((draft?.detectors.wordFilter?.config?.rules as WordFilterRule[] | undefined) || []),
        [draft]
    );

    const addWordFilterRule = () => {
        updateDetectorConfig('wordFilter', 'rules', [...wordFilterRules, createWordFilterRule()]);
    };

    const updateWordFilterRule = (ruleId: string, patch: Partial<WordFilterRule>) => {
        updateDetectorConfig(
            'wordFilter',
            'rules',
            wordFilterRules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule))
        );
    };

    const removeWordFilterRule = (ruleId: string) => {
        updateDetectorConfig(
            'wordFilter',
            'rules',
            wordFilterRules.filter((rule) => rule.id !== ruleId)
        );
    };

    const addPunishment = () => {
        if (!draft) return;
        updateDraft((current) => ({
            ...current,
            punishments: [...current.punishments, punishmentDraft]
        }));
        setPunishmentDraft({
            threshold: punishmentDraft.threshold + 10,
            actions: [{ ...EMPTY_PUNISHMENT_ACTION }]
        });
    };

    const removePunishment = (index: number) => {
        updateDraft((current) => ({
            ...current,
            punishments: current.punishments.filter((_, currentIndex) => currentIndex !== index)
        }));
    };

    const updatePunishment = (index: number, patch: Partial<PunishmentThreshold>) => {
        updateDraft((current) => ({
            ...current,
            punishments: current.punishments.map((item, currentIndex) => (
                currentIndex === index ? { ...item, ...patch } : item
            ))
        }));
    };

    const updatePunishmentAction = (index: number, patch: Partial<PunishmentAction>) => {
        updateDraft((current) => ({
            ...current,
            punishments: current.punishments.map((item, currentIndex) => {
                if (currentIndex !== index) {
                    return item;
                }

                const currentAction = item.actions[0] || { ...EMPTY_PUNISHMENT_ACTION };
                return {
                    ...item,
                    actions: [{ ...currentAction, ...patch }]
                };
            })
        }));
    };

    const handleResetTrust = async (userId: string) => {
        if (!window.confirm('このユーザーの信頼スコアをリセットしますか？')) return;
        const success = await resetTrust(userId);
        if (success) {
            await refetchTrust();
            await refetchLogs();
        }
    };

    const handleRevokeTimeout = async (log: DetectionLog) => {
        if (!window.confirm('このタイムアウトを解除しますか？')) return;
        const success = await revokeTimeout(log.userId, false, log.messageId);
        if (success) {
            await refetchLogs();
            await refetchTrust();
        }
    };

    const renderDetectorConfig = (detectorKey: string) => {
        const detector = draft?.detectors[detectorKey];
        if (!detector) {
            return null;
        }

        switch (detectorKey) {
            case 'textSpam':
                return (
                    <div className={styles.inlineFields}>
                        <label className={styles.field}>
                            <span>監視秒数</span>
                            <input type="number" value={detector.config?.windowSeconds ?? 5} onChange={(event) => updateDetectorConfig(detectorKey, 'windowSeconds', Number(event.target.value))} />
                        </label>
                        <label className={styles.field}>
                            <span>大量投稿件数</span>
                            <input type="number" value={detector.config?.rapidMessageCount ?? 6} onChange={(event) => updateDetectorConfig(detectorKey, 'rapidMessageCount', Number(event.target.value))} />
                        </label>
                        <label className={styles.field}>
                            <span>重複回数</span>
                            <input type="number" value={detector.config?.duplicateThreshold ?? 3} onChange={(event) => updateDetectorConfig(detectorKey, 'duplicateThreshold', Number(event.target.value))} />
                        </label>
                    </div>
                );
            case 'inviteReferral':
                return (
                    <div className={styles.stack}>
                        <label className={styles.field}>
                            <span>追加ブロックドメイン</span>
                            <textarea value={toMultiline((detector.config?.blockedDomains as string[] | undefined) || [])} onChange={(event) => updateDetectorConfig(detectorKey, 'blockedDomains', parseListText(event.target.value))} placeholder={'example.com\nbad-link.test'} />
                        </label>
                        <label className={styles.field}>
                            <span>追加ブロックパターン</span>
                            <textarea value={toMultiline((detector.config?.blockedPatterns as string[] | undefined) || [])} onChange={(event) => updateDetectorConfig(detectorKey, 'blockedPatterns', parseListText(event.target.value))} placeholder={'ref=\ninvite_code='} />
                        </label>
                    </div>
                );
            case 'redirectLink':
                return (
                    <div className={styles.inlineFields}>
                        <label className={styles.field}>
                            <span>許可リダイレクトドメイン</span>
                            <textarea value={toMultiline((detector.config?.allowDomains as string[] | undefined) || [])} onChange={(event) => updateDetectorConfig(detectorKey, 'allowDomains', parseListText(event.target.value))} placeholder={'google.com\nx.com\nt.co'} />
                        </label>
                        <label className={styles.field}>
                            <span>最大解決段数</span>
                            <input type="number" value={detector.config?.maxDepth ?? 5} onChange={(event) => updateDetectorConfig(detectorKey, 'maxDepth', Number(event.target.value))} />
                        </label>
                        <label className={styles.field}>
                            <span>タイムアウト(ms)</span>
                            <input type="number" value={detector.config?.timeoutMs ?? 2500} onChange={(event) => updateDetectorConfig(detectorKey, 'timeoutMs', Number(event.target.value))} />
                        </label>
                    </div>
                );
            case 'copyPaste':
                return (
                    <div className={styles.inlineFields}>
                        <label className={styles.field}>
                            <span>最小文字数</span>
                            <input type="number" value={detector.config?.minLength ?? 80} onChange={(event) => updateDetectorConfig(detectorKey, 'minLength', Number(event.target.value))} />
                        </label>
                        <label className={styles.field}>
                            <span>追加キーワード</span>
                            <textarea value={toMultiline((detector.config?.suspiciousTerms as string[] | undefined) || [])} onChange={(event) => updateDetectorConfig(detectorKey, 'suspiciousTerms', parseListText(event.target.value))} placeholder={'free nitro\nsteam gift'} />
                        </label>
                    </div>
                );
            case 'duplicateMessage':
                return (
                    <div className={styles.inlineFields}>
                        <label className={styles.field}>
                            <span>監視秒数</span>
                            <input type="number" value={detector.config?.windowSeconds ?? 180} onChange={(event) => updateDetectorConfig(detectorKey, 'windowSeconds', Number(event.target.value))} />
                        </label>
                        <label className={styles.field}>
                            <span>削除開始回数</span>
                            <input type="number" value={detector.config?.deleteFrom ?? 2} onChange={(event) => updateDetectorConfig(detectorKey, 'deleteFrom', Number(event.target.value))} />
                        </label>
                        <label className={styles.field}>
                            <span>スコア開始回数</span>
                            <input type="number" value={detector.config?.scoreFrom ?? 4} onChange={(event) => updateDetectorConfig(detectorKey, 'scoreFrom', Number(event.target.value))} />
                        </label>
                    </div>
                );
            case 'mentionLimit':
                return (
                    <div className={styles.inlineFields}>
                        <label className={styles.field}>
                            <span>ユーザー最大言及</span>
                            <input type="number" value={detector.config?.maxUserMentions ?? 200} onChange={(event) => updateDetectorConfig(detectorKey, 'maxUserMentions', Number(event.target.value))} />
                        </label>
                        <label className={styles.field}>
                            <span>ロール最大言及</span>
                            <input type="number" value={detector.config?.maxRoleMentions ?? 200} onChange={(event) => updateDetectorConfig(detectorKey, 'maxRoleMentions', Number(event.target.value))} />
                        </label>
                    </div>
                );
            case 'maxLines':
                return (
                    <div className={styles.inlineFields}>
                        <label className={styles.field}>
                            <span>最大行数</span>
                            <input type="number" value={detector.config?.maxLines ?? 10} onChange={(event) => updateDetectorConfig(detectorKey, 'maxLines', Number(event.target.value))} />
                        </label>
                    </div>
                );
            case 'wordFilter':
                return (
                    <div className={styles.stack}>
                        <div className={styles.ruleToolbar}>
                            <span className={styles.sectionLabel}>ルール</span>
                            <button className={styles.secondaryButton} onClick={addWordFilterRule} type="button">
                                <span className="material-icons">add</span>
                                ルール追加
                            </button>
                        </div>
                        {wordFilterRules.length === 0 ? (
                            <div className={styles.emptyPanel}>ルールがまだありません。</div>
                        ) : (
                            <div className={styles.ruleList}>
                                {wordFilterRules.map((rule) => (
                                    <article key={rule.id} className={styles.ruleCard}>
                                        <div className={styles.inlineFields}>
                                            <label className={styles.field}>
                                                <span>表示名</span>
                                                <input type="text" value={rule.label} onChange={(event) => updateWordFilterRule(rule.id, { label: event.target.value })} />
                                            </label>
                                            <label className={styles.field}>
                                                <span>パターン</span>
                                                <input type="text" value={rule.pattern} onChange={(event) => updateWordFilterRule(rule.id, { pattern: event.target.value })} />
                                            </label>
                                            <label className={styles.field}>
                                                <span>モード</span>
                                                <select value={rule.mode} onChange={(event) => updateWordFilterRule(rule.id, { mode: event.target.value as WordFilterRule['mode'] })}>
                                                    <option value="contains">contains</option>
                                                    <option value="exact">exact</option>
                                                    <option value="regex">regex</option>
                                                </select>
                                            </label>
                                            <label className={styles.field}>
                                                <span>スコア</span>
                                                <input type="number" value={rule.score} onChange={(event) => updateWordFilterRule(rule.id, { score: Number(event.target.value) })} />
                                            </label>
                                        </div>
                                        <div className={styles.inlineActions}>
                                            <label className={styles.toggle}>
                                                <input type="checkbox" checked={rule.enabled} onChange={(event) => updateWordFilterRule(rule.id, { enabled: event.target.checked })} />
                                                <span>有効</span>
                                            </label>
                                            <label className={styles.toggle}>
                                                <input type="checkbox" checked={rule.deleteMessage !== false} onChange={(event) => updateWordFilterRule(rule.id, { deleteMessage: event.target.checked })} />
                                                <span>削除</span>
                                            </label>
                                            <button className={styles.dangerButton} onClick={() => removeWordFilterRule(rule.id)} type="button">
                                                削除
                                            </button>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                    </div>
                );
            case 'raidDetection':
                return (
                    <div className={styles.inlineFields}>
                        <label className={styles.field}>
                            <span>1時間あたり参加数</span>
                            <input type="number" value={detector.config?.joinsPerHour ?? 25} onChange={(event) => updateDetectorConfig(detectorKey, 'joinsPerHour', Number(event.target.value))} />
                        </label>
                        <label className={styles.field}>
                            <span>短時間参加数</span>
                            <input type="number" value={detector.config?.burstCount ?? 10} onChange={(event) => updateDetectorConfig(detectorKey, 'burstCount', Number(event.target.value))} />
                        </label>
                        <label className={styles.field}>
                            <span>短時間監視秒数</span>
                            <input type="number" value={detector.config?.burstWindowSeconds ?? 10} onChange={(event) => updateDetectorConfig(detectorKey, 'burstWindowSeconds', Number(event.target.value))} />
                        </label>
                        <label className={styles.field}>
                            <span>再発動待機(分)</span>
                            <input type="number" value={detector.config?.cooldownMinutes ?? 60} onChange={(event) => updateDetectorConfig(detectorKey, 'cooldownMinutes', Number(event.target.value))} />
                        </label>
                    </div>
                );
            default:
                return null;
        }
    };

    const renderOverview = () => {
        if (!draft) return null;

        return (
            <section className={styles.section}>
                <div className={styles.metricsGrid}>
                    <article className={styles.metricCard}>
                        <span className={styles.sectionLabel}>Status</span>
                        <strong>{draft.enabled ? 'Enabled' : 'Disabled'}</strong>
                        <p>AntiCheat 全体の有効状態です。</p>
                    </article>
                    <article className={styles.metricCard}>
                        <span className={styles.sectionLabel}>Detectors</span>
                        <strong>{enabledDetectorCount}</strong>
                        <p>現在有効な検知器数です。</p>
                    </article>
                    <article className={styles.metricCard}>
                        <span className={styles.sectionLabel}>Raid Mode</span>
                        <strong>{draft.raidMode.active ? 'Active' : 'Standby'}</strong>
                        <p>{draft.raidMode.reason || '現在は通常監視モードです。'}</p>
                    </article>
                    <article className={styles.metricCard}>
                        <span className={styles.sectionLabel}>Avatar Log</span>
                        <strong>{draft.avatarLogChannelId || 'Unset'}</strong>
                        <p>アバター変更を記録するログ先です。</p>
                    </article>
                </div>

                <div className={styles.formGrid}>
                    <label className={styles.toggleCard}>
                        <span className={styles.toggleTitle}>AntiCheat を有効化</span>
                        <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
                    </label>
                    <label className={styles.field}>
                        <span>検知ログチャンネルID</span>
                        <input type="text" value={draft.logChannelId || ''} onChange={(event) => setDraft({ ...draft, logChannelId: event.target.value || null })} placeholder="123456789012345678" />
                    </label>
                    <label className={styles.field}>
                        <span>アバターログチャンネルID</span>
                        <input type="text" value={draft.avatarLogChannelId || ''} onChange={(event) => setDraft({ ...draft, avatarLogChannelId: event.target.value || null })} placeholder="123456789012345678" />
                    </label>
                    <label className={styles.toggleCard}>
                        <span className={styles.toggleTitle}>自動タイムアウト</span>
                        <input type="checkbox" checked={draft.autoTimeout.enabled} onChange={(event) => setDraft({ ...draft, autoTimeout: { ...draft.autoTimeout, enabled: event.target.checked } })} />
                    </label>
                    <label className={styles.field}>
                        <span>自動タイムアウト秒数</span>
                        <input type="number" value={draft.autoTimeout.durationSeconds} onChange={(event) => setDraft({ ...draft, autoTimeout: { ...draft.autoTimeout, durationSeconds: Number(event.target.value) } })} />
                    </label>
                    <label className={styles.toggleCard}>
                        <span className={styles.toggleTitle}>自動メッセージ削除</span>
                        <input type="checkbox" checked={draft.autoDelete.enabled} onChange={(event) => setDraft({ ...draft, autoDelete: { ...draft.autoDelete, enabled: event.target.checked } })} />
                    </label>
                    <label className={styles.field}>
                        <span>自動削除の監視秒数</span>
                        <input type="number" value={draft.autoDelete.windowSeconds} onChange={(event) => setDraft({ ...draft, autoDelete: { ...draft.autoDelete, windowSeconds: Number(event.target.value) } })} />
                    </label>
                </div>

                <div className={styles.formGrid}>
                    <label className={styles.field}>
                        <span>除外ロールID</span>
                        <textarea value={excludedRolesText} onChange={(event) => setExcludedRolesText(event.target.value)} placeholder="1行またはカンマ区切りで入力" />
                    </label>
                    <label className={styles.field}>
                        <span>除外チャンネルID</span>
                        <textarea value={excludedChannelsText} onChange={(event) => setExcludedChannelsText(event.target.value)} placeholder="1行またはカンマ区切りで入力" />
                    </label>
                </div>

                <div className={styles.inlineActions}>
                    <button className={styles.primaryButton} onClick={() => commitDraft('概要設定を保存しました。')} type="button" disabled={saving}>
                        {saving ? '保存中...' : '概要を保存'}
                    </button>
                    {draft.raidMode.active ? (
                        <button className={styles.secondaryButton} onClick={() => setDraft({ ...draft, raidMode: { ...draft.raidMode, active: false, reason: null } })} type="button">
                            レイドモード状態をクリア
                        </button>
                    ) : null}
                </div>
            </section>
        );
    };

    const renderRules = () => (
        <section className={styles.section}>
            <div className={styles.detectorGrid}>
                {DETECTOR_CATALOG.map((catalog) => {
                    const detector = draft?.detectors[catalog.key];
                    if (!detector) return null;

                    return (
                        <article key={catalog.key} className={styles.detectorCard}>
                            <div className={styles.detectorHead}>
                                <div className={styles.detectorInfo}>
                                    <span className={`material-icons ${styles.detectorIcon}`}>{catalog.icon}</span>
                                    <div>
                                        <h3>{catalog.title}</h3>
                                        <p>{catalog.description}</p>
                                    </div>
                                </div>
                                <label className={styles.toggle}>
                                    <input type="checkbox" checked={detector.enabled} onChange={(event) => updateDetector(catalog.key, { enabled: event.target.checked })} />
                                    <span>有効</span>
                                </label>
                            </div>

                            <div className={styles.inlineFields}>
                                <label className={styles.field}>
                                    <span>スコア</span>
                                    <input type="number" value={detector.score} onChange={(event) => updateDetector(catalog.key, { score: Number(event.target.value) })} />
                                </label>
                                <label className={styles.toggleCard}>
                                    <span className={styles.toggleTitle}>メッセージ削除</span>
                                    <input type="checkbox" checked={detector.deleteMessage !== false} onChange={(event) => updateDetector(catalog.key, { deleteMessage: event.target.checked })} />
                                </label>
                                <label className={styles.toggleCard}>
                                    <span className={styles.toggleTitle}>チャンネル通知</span>
                                    <input type="checkbox" checked={!!detector.notifyChannel} onChange={(event) => updateDetector(catalog.key, { notifyChannel: event.target.checked })} />
                                </label>
                            </div>

                            {renderDetectorConfig(catalog.key)}
                        </article>
                    );
                })}
            </div>

            <div className={styles.inlineActions}>
                <button className={styles.primaryButton} onClick={() => commitDraft('検知ルールを保存しました。')} type="button" disabled={saving}>
                    {saving ? '保存中...' : 'ルールを保存'}
                </button>
            </div>
        </section>
    );

    const renderPunishments = () => (
        <section className={styles.section}>
            <div className={styles.stack}>
                <div className={styles.ruleToolbar}>
                    <span className={styles.sectionLabel}>Threshold Actions</span>
                    <button className={styles.secondaryButton} onClick={addPunishment} type="button">
                        <span className="material-icons">add</span>
                        閾値を追加
                    </button>
                </div>
                {draft?.punishments.length ? (
                    <div className={styles.policyList}>
                        {draft.punishments.map((punishment, index) => {
                            const action = punishment.actions[0] || EMPTY_PUNISHMENT_ACTION;
                            return (
                                <article key={`${punishment.threshold}-${index}`} className={styles.policyCard}>
                                    <div className={styles.inlineFields}>
                                        <label className={styles.field}>
                                            <span>閾値スコア</span>
                                            <input type="number" value={punishment.threshold} onChange={(event) => updatePunishment(index, { threshold: Number(event.target.value) })} />
                                        </label>
                                        <label className={styles.field}>
                                            <span>処置</span>
                                            <select value={action.type} onChange={(event) => updatePunishmentAction(index, { type: event.target.value as PunishmentAction['type'] })}>
                                                <option value="timeout">timeout</option>
                                                <option value="kick">kick</option>
                                                <option value="ban">ban</option>
                                            </select>
                                        </label>
                                        <label className={styles.field}>
                                            <span>秒数</span>
                                            <input type="number" value={action.durationSeconds || 0} onChange={(event) => updatePunishmentAction(index, { durationSeconds: Number(event.target.value) })} />
                                        </label>
                                        <label className={styles.toggle}>
                                            <input type="checkbox" checked={action.notify !== false} onChange={(event) => updatePunishmentAction(index, { notify: event.target.checked })} />
                                            <span>ログ通知</span>
                                        </label>
                                    </div>
                                    <label className={styles.field}>
                                        <span>理由テンプレート</span>
                                        <input type="text" value={action.reasonTemplate || ''} onChange={(event) => updatePunishmentAction(index, { reasonTemplate: event.target.value })} />
                                    </label>
                                    <div className={styles.inlineActions}>
                                        <button className={styles.dangerButton} onClick={() => removePunishment(index)} type="button">
                                            閾値を削除
                                        </button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                ) : (
                    <div className={styles.emptyPanel}>まだ処罰閾値がありません。</div>
                )}
            </div>
            <article className={styles.policyCard}>
                <h3>新しい閾値の初期値</h3>
                <div className={styles.inlineFields}>
                    <label className={styles.field}>
                        <span>閾値スコア</span>
                        <input type="number" value={punishmentDraft.threshold} onChange={(event) => setPunishmentDraft({ ...punishmentDraft, threshold: Number(event.target.value) })} />
                    </label>
                    <label className={styles.field}>
                        <span>処置</span>
                        <select value={punishmentDraft.actions[0]?.type || 'timeout'} onChange={(event) => setPunishmentDraft({ ...punishmentDraft, actions: [{ ...(punishmentDraft.actions[0] || EMPTY_PUNISHMENT_ACTION), type: event.target.value as PunishmentAction['type'] }] })}>
                            <option value="timeout">timeout</option>
                            <option value="kick">kick</option>
                            <option value="ban">ban</option>
                        </select>
                    </label>
                    <label className={styles.field}>
                        <span>秒数</span>
                        <input type="number" value={punishmentDraft.actions[0]?.durationSeconds || 0} onChange={(event) => setPunishmentDraft({ ...punishmentDraft, actions: [{ ...(punishmentDraft.actions[0] || EMPTY_PUNISHMENT_ACTION), durationSeconds: Number(event.target.value) }] })} />
                    </label>
                </div>
            </article>

            <div className={styles.inlineActions}>
                <button className={styles.primaryButton} onClick={() => commitDraft('処罰設定を保存しました。')} type="button" disabled={saving}>
                    {saving ? '保存中...' : '処罰を保存'}
                </button>
            </div>
        </section>
    );

    const renderLogs = () => (
        <section className={styles.section}>
            {logsLoading ? (
                <div className={styles.loadingPanel}>ログを読み込んでいます...</div>
            ) : logs.length === 0 ? (
                <div className={styles.emptyPanel}>まだ検知ログはありません。</div>
            ) : (
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>検知器</th>
                                <th>スコア</th>
                                <th>理由</th>
                                <th>時刻</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map((log) => (
                                <tr key={`${log.messageId}-${log.timestamp}`}>
                                    <td>{log.detector}</td>
                                    <td>{log.scoreDelta}</td>
                                    <td>
                                        <div className={styles.logReason}>{log.reason}</div>
                                        {log.metadata?.finalUrl ? <div className={styles.subtleText}>到達先: {String(log.metadata.finalUrl)}</div> : null}
                                    </td>
                                    <td>{formatDate(log.timestamp)}</td>
                                    <td>
                                        <div className={styles.inlineActions}>
                                            {log.metadata?.isTimedOut ? (
                                                <button className={styles.secondaryButton} onClick={() => handleRevokeTimeout(log)} type="button" disabled={executing}>
                                                    解除
                                                </button>
                                            ) : null}
                                            <button className={styles.dangerButton} onClick={() => handleResetTrust(log.userId)} type="button" disabled={executing}>
                                                スコア初期化
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );

    const renderTrust = () => (
        <section className={styles.section}>
            {trustLoading ? (
                <div className={styles.loadingPanel}>信頼スコアを読み込んでいます...</div>
            ) : trustEntries.length === 0 ? (
                <div className={styles.emptyPanel}>信頼スコアが付与されたユーザーはいません。</div>
            ) : (
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>ユーザー</th>
                                <th>スコア</th>
                                <th>最終更新</th>
                                <th>最新理由</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {trustEntries.map((entry) => (
                                <tr key={entry.userId}>
                                    <td>
                                        <div className={styles.userCell}>
                                            {entry.avatar ? <img src={entry.avatar} alt={entry.username} className={styles.avatar} /> : null}
                                            <div>
                                                <strong>{entry.displayName || entry.username}</strong>
                                                <div className={styles.subtleText}>{entry.userId}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>{entry.score}</td>
                                    <td>{formatDate(entry.lastUpdated)}</td>
                                    <td>{entry.history[entry.history.length - 1]?.reason || '履歴なし'}</td>
                                    <td>
                                        <button className={styles.dangerButton} onClick={() => handleResetTrust(entry.userId)} type="button" disabled={executing}>
                                            リセット
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );

    const renderContent = () => {
        switch (activeTab) {
            case 'rules':
                return renderRules();
            case 'punishments':
                return renderPunishments();
            case 'logs':
                return renderLogs();
            case 'trust':
                return renderTrust();
            case 'overview':
            default:
                return renderOverview();
        }
    };

    return (
        <div className={styles.page}>
            <PageShell
                eyebrow="AntiCheat Workspace"
                title="AntiCheat 管理"
                description={`ギルド単位で検知スコア、削除方針、レイド監視、アバターログまで一元管理します。対象: ${guildId}`}
                actions={
                    <>
                        <button className={styles.secondaryButton} onClick={() => navigate('/staff/anticheat')} type="button">
                            <span className="material-icons">arrow_back</span>
                            サーバー選択へ
                        </button>
                        <button className={styles.primaryButton} onClick={() => commitDraft('現在の変更を保存しました。')} type="button" disabled={saving || !draft}>
                            <span className="material-icons">save</span>
                            {saving ? '保存中...' : '変更を保存'}
                        </button>
                    </>
                }
                meta={
                    <>
                        <span className={styles.metaChip}>スコア制裁</span>
                        <span className={styles.metaChip}>リダイレクト解析</span>
                        <span className={styles.metaChip}>アバターログ</span>
                    </>
                }
                aside={
                    <div className={styles.summary}>
                        <div className={styles.summaryCard}>
                            <span className={styles.summaryLabel}>Service</span>
                            <strong>{draft?.enabled ? 'Online' : 'Paused'}</strong>
                            <p>{draft?.enabled ? '検知器が稼働しています。' : '現在は停止しています。'}</p>
                        </div>
                        <div className={styles.summaryCard}>
                            <span className={styles.summaryLabel}>Detectors</span>
                            <strong>{enabledDetectorCount}</strong>
                            <p>有効化されている検知器の数です。</p>
                        </div>
                        <div className={styles.summaryCard}>
                            <span className={styles.summaryLabel}>Raid Mode</span>
                            <strong>{draft?.raidMode.active ? 'Active' : 'Standby'}</strong>
                            <p>{draft?.raidMode.reason || 'レイドモードは待機中です。'}</p>
                        </div>
                    </div>
                }
            >
                {loading || !draft ? (
                    <div className={styles.loadingPanel}>AntiCheat 設定を読み込んでいます...</div>
                ) : error ? (
                    <div className={styles.errorPanel}>{error}</div>
                ) : (
                    <>
                        {(saveNotice || actionError || logsError || trustError) ? (
                            <div className={styles.statusRow}>
                                {saveNotice ? <div className={styles.noticeSuccess}>{saveNotice}</div> : null}
                                {actionError ? <div className={styles.noticeError}>{actionError}</div> : null}
                                {logsError ? <div className={styles.noticeError}>{logsError}</div> : null}
                                {trustError ? <div className={styles.noticeError}>{trustError}</div> : null}
                            </div>
                        ) : null}

                        <div className={styles.tabBar}>
                            {(Object.keys(TAB_LABELS) as TabKey[]).map((tab) => (
                                <button key={tab} className={`${styles.tabButton} ${activeTab === tab ? styles.tabButtonActive : ''}`} onClick={() => setActiveTab(tab)} type="button">
                                    {TAB_LABELS[tab]}
                                </button>
                            ))}
                        </div>

                        {renderContent()}
                    </>
                )}
            </PageShell>
        </div>
    );
};

export default AntiCheatUnified;
