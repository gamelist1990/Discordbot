import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchGuildInfo } from '../../../services/api';
import {
  useAntiCheatActions,
  useAntiCheatSettings,
  useDetectionLogs,
  useInterviewActions,
  useInterviewRooms,
  useUserTrust,
} from './hooks';
import styles from './AntiCheat.module.css';
import type {
  AntiCheatSettings,
  DetectionLog,
  DetectorConfig,
  InterviewRoomSession,
  PunishmentAction,
  PunishmentThreshold,
  UserTrustDataWithUser,
  WordFilterRule,
} from './types';

type ConfigField = {
  kind: 'number' | 'list';
  key: string;
  label: string;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  wide?: boolean;
  placeholder?: string;
};

type DetectorEntry = {
  key: string;
  title: string;
  description: string;
  icon: string;
  fields?: ConfigField[];
};

const DETECTORS: DetectorEntry[] = [
  { key: 'textSpam', title: 'テキストスパム', description: '大量投稿と大文字スパムを検知します。', icon: 'sms', fields: [
    { kind: 'number', key: 'windowSeconds', label: '監視秒数', defaultValue: 5, min: 1 },
    { kind: 'number', key: 'rapidMessageCount', label: '大量投稿回数', defaultValue: 6, min: 1 },
    { kind: 'number', key: 'duplicateThreshold', label: '重複しきい値', defaultValue: 3, min: 1 },
    { kind: 'number', key: 'capsRatio', label: '大文字比率', defaultValue: 0.88, min: 0, max: 1, step: 0.01 },
  ] },
  { key: 'inviteReferral', title: '広告防止 / 紹介', description: '招待リンクと紹介パターンを止めます。', icon: 'campaign', fields: [
    { kind: 'list', key: 'blockedDomains', label: 'ブロックドメイン', wide: true, placeholder: 'example.com' },
    { kind: 'list', key: 'blockedPatterns', label: '紹介 / 広告パターン', wide: true, placeholder: 'promo|affiliate' },
  ] },
  { key: 'redirectLink', title: 'リンク解決', description: '危険な転送系リンクだけを止めます。', icon: 'link', fields: [
    { kind: 'list', key: 'allowDomains', label: '許可ドメイン', wide: true, placeholder: 'discord.com' },
    { kind: 'number', key: 'maxDepth', label: '最大追跡段数', defaultValue: 5, min: 1 },
    { kind: 'number', key: 'timeoutMs', label: 'タイムアウト(ms)', defaultValue: 2500, min: 500, step: 100 },
  ] },
  { key: 'copyPaste', title: 'アンチコピーペースト', description: '詐欺コピペと装飾文字を抑えます。', icon: 'content_paste_off', fields: [
    { kind: 'number', key: 'minLength', label: '最小文字数', defaultValue: 80, min: 1 },
    { kind: 'list', key: 'suspiciousTerms', label: '疑わしい語句', wide: true, placeholder: 'free nitro' },
  ] },
  { key: 'everyoneMention', title: 'アンチ Everyone', description: '大量通知を防ぎます。', icon: 'alternate_email' },
  { key: 'duplicateMessage', title: 'アンチ重複', description: '同じ文面の連投を止めます。', icon: 'content_copy', fields: [
    { kind: 'number', key: 'windowSeconds', label: '監視秒数', defaultValue: 180, min: 1 },
    { kind: 'number', key: 'deleteFrom', label: '削除開始回数', defaultValue: 2, min: 1 },
    { kind: 'number', key: 'scoreFrom', label: 'スコア開始回数', defaultValue: 4, min: 1 },
  ] },
  { key: 'mentionLimit', title: '最大言及', description: 'ユーザー / ロールの大量メンションを制御します。', icon: 'groups', fields: [
    { kind: 'number', key: 'maxUserMentions', label: 'ユーザー言及上限', defaultValue: 200, min: 1 },
    { kind: 'number', key: 'maxRoleMentions', label: 'ロール言及上限', defaultValue: 200, min: 1 },
  ] },
  { key: 'maxLines', title: '最大行数', description: '長文スパムを行数で見ます。', icon: 'format_line_spacing', fields: [
    { kind: 'number', key: 'maxLines', label: '最大行数', defaultValue: 10, min: 1 },
  ] },
  { key: 'wordFilter', title: 'フィルター', description: '単語と正規表現の個別ルールです。', icon: 'filter_alt' },
  { key: 'raidDetection', title: '自動アンチレイド', description: '参加急増時に保護を強めます。', icon: 'security', fields: [
    { kind: 'number', key: 'joinsPerHour', label: '1時間あたりの参加数', defaultValue: 25, min: 1 },
    { kind: 'number', key: 'burstCount', label: '短時間バースト数', defaultValue: 10, min: 1 },
    { kind: 'number', key: 'burstWindowSeconds', label: 'バースト監視秒数', defaultValue: 10, min: 1 },
    { kind: 'number', key: 'cooldownMinutes', label: '再発動待機(分)', defaultValue: 60, min: 1 },
  ] },
];

const EMPTY_ACTION: PunishmentAction = {
  type: 'timeout',
  durationSeconds: 600,
  reasonTemplate: 'AntiCheat violation: threshold {threshold}',
  notify: true,
};

const cloneSettings = (settings: AntiCheatSettings) => JSON.parse(JSON.stringify(settings)) as AntiCheatSettings;
const parseListText = (value: string) => value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
const toTextList = (value: unknown) => Array.isArray(value) ? value.join('\n') : '';
const readNumber = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('ja-JP') : '未設定';
const createWordFilterRule = (): WordFilterRule => ({
  id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  label: '',
  pattern: '',
  mode: 'contains',
  score: 1,
  deleteMessage: true,
  enabled: true,
});

const statusText = (session: InterviewRoomSession) => {
  switch (session.status) {
    case 'active':
      return '進行中';
    case 'approved':
      return '承認';
    case 'rejected':
      return '棄却';
    case 'terminated':
      return '打ち切り';
    default:
      return '終了';
  }
};

const AntiCheatUnified: React.FC = () => {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate = useNavigate();
  const { settings, loading, error, updateSettings } = useAntiCheatSettings(guildId || '');
  const { logs, loading: logsLoading, error: logsError, refetch: refetchLogs } = useDetectionLogs(guildId || '', 40);
  const { trust, loading: trustLoading, error: trustError, refetch: refetchTrust } = useUserTrust(guildId || '');
  const { revokeTimeout, resetTrust, executing, error: actionError } = useAntiCheatActions(guildId || '');
  const { interviews, loading: interviewsLoading, error: interviewsError, refetch: refetchInterviews } = useInterviewRooms(guildId || '');
  const { createInterviewRoom, closeInterviewRoom, executing: interviewExecuting, error: interviewActionError } = useInterviewActions(guildId || '');

  const [guildName, setGuildName] = useState('AntiCheat');
  const [draft, setDraft] = useState<AntiCheatSettings | null>(null);
  const [excludedRolesText, setExcludedRolesText] = useState('');
  const [excludedChannelsText, setExcludedChannelsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [interviewNotice, setInterviewNotice] = useState<string | null>(null);
  const [interviewUserId, setInterviewUserId] = useState('');
  const [interviewTitle, setInterviewTitle] = useState('');

  useEffect(() => {
    if (!settings) return;
    const next = cloneSettings(settings);
    setDraft(next);
    setExcludedRolesText(next.excludedRoles.join('\n'));
    setExcludedChannelsText(next.excludedChannels.join('\n'));
  }, [settings]);

  useEffect(() => {
    if (!guildId) return;
    fetchGuildInfo(guildId).then((info) => setGuildName(info.name)).catch(() => setGuildName(guildId));
  }, [guildId]);

  const trustEntries = useMemo(() => {
    if (!trust || Array.isArray(trust) || 'score' in (trust as Record<string, unknown>)) return [];
    return Object.entries(trust as Record<string, UserTrustDataWithUser>)
      .map(([userId, value]) => ({ userId, ...value }))
      .sort((left, right) => right.score - left.score);
  }, [trust]);

  const activeInterviews = useMemo(() => interviews.filter((entry) => entry.status === 'active'), [interviews]);

  if (!guildId) return null;

  const updateDraft = (updater: (current: AntiCheatSettings) => AntiCheatSettings) => {
    setDraft((current) => current ? updater(current) : current);
  };

  const updateDetector = (detectorKey: string, patch: Partial<DetectorConfig>) => {
    updateDraft((current) => ({
      ...current,
      detectors: {
        ...current.detectors,
        [detectorKey]: { ...current.detectors[detectorKey], ...patch },
      },
    }));
  };

  const updateDetectorConfig = (detectorKey: string, field: string, value: unknown) => {
    updateDraft((current) => ({
      ...current,
      detectors: {
        ...current.detectors,
        [detectorKey]: {
          ...current.detectors[detectorKey],
          config: { ...(current.detectors[detectorKey]?.config || {}), [field]: value },
        },
      },
    }));
  };

  const updateListDetectorConfig = (detectorKey: string, field: string, value: string) => {
    updateDetectorConfig(detectorKey, field, parseListText(value));
  };

  const addPunishment = () => {
    updateDraft((current) => ({
      ...current,
      punishments: [
        ...current.punishments,
        {
          threshold: (current.punishments[current.punishments.length - 1]?.threshold || 0) + 10,
          actions: [{ ...EMPTY_ACTION }],
        },
      ],
    }));
  };

  const updatePunishment = (index: number, patch: Partial<PunishmentThreshold>) => {
    updateDraft((current) => ({
      ...current,
      punishments: current.punishments.map((item, currentIndex) => currentIndex === index ? { ...item, ...patch } : item),
    }));
  };

  const removePunishment = (index: number) => {
    updateDraft((current) => ({
      ...current,
      punishments: current.punishments.filter((_, currentIndex) => currentIndex !== index),
    }));
  };

  const addAction = (index: number) => {
    updateDraft((current) => ({
      ...current,
      punishments: current.punishments.map((item, currentIndex) => (
        currentIndex === index ? { ...item, actions: [...item.actions, { ...EMPTY_ACTION }] } : item
      )),
    }));
  };

  const updateAction = (thresholdIndex: number, actionIndex: number, patch: Partial<PunishmentAction>) => {
    updateDraft((current) => ({
      ...current,
      punishments: current.punishments.map((item, currentIndex) => (
        currentIndex === thresholdIndex
          ? {
            ...item,
            actions: item.actions.map((action, currentActionIndex) => (
              currentActionIndex === actionIndex ? { ...action, ...patch } : action
            )),
          }
          : item
      )),
    }));
  };

  const removeAction = (thresholdIndex: number, actionIndex: number) => {
    updateDraft((current) => ({
      ...current,
      punishments: current.punishments.map((item, currentIndex) => (
        currentIndex === thresholdIndex
          ? { ...item, actions: item.actions.filter((_, currentActionIndex) => currentActionIndex !== actionIndex) }
          : item
      )),
    }));
  };

  const wordFilterRules = ((draft?.detectors.wordFilter?.config?.rules as WordFilterRule[] | undefined) || []);
  const addWordRule = () => updateDetectorConfig('wordFilter', 'rules', [...wordFilterRules, createWordFilterRule()]);
  const updateWordRule = (ruleId: string, patch: Partial<WordFilterRule>) => {
    updateDetectorConfig('wordFilter', 'rules', wordFilterRules.map((rule) => rule.id === ruleId ? { ...rule, ...patch } : rule));
  };
  const removeWordRule = (ruleId: string) => {
    updateDetectorConfig('wordFilter', 'rules', wordFilterRules.filter((rule) => rule.id !== ruleId));
  };

  const commitDraft = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveNotice(null);
    const success = await updateSettings({
      ...draft,
      excludedRoles: parseListText(excludedRolesText),
      excludedChannels: parseListText(excludedChannelsText),
    });
    setSaving(false);
    if (success) setSaveNotice('AntiCheat 設定を保存しました');
  };

  const onResetTrust = async (userId: string) => {
    if (!window.confirm('このユーザーの信頼スコアをリセットしますか？')) return;
    if (await resetTrust(userId)) {
      await refetchTrust();
      await refetchLogs();
    }
  };

  const onRevokeTimeout = async (log: DetectionLog) => {
    if (!window.confirm('このタイムアウトを解除しますか？')) return;
    if (await revokeTimeout(log.userId, false, log.messageId)) {
      await refetchLogs();
      await refetchTrust();
    }
  };

  const handleCreateInterview = async (userId: string, title?: string) => {
    setInterviewNotice(null);
    const result = await createInterviewRoom(userId, title);
    if (!result?.interview) return;
    setInterviewNotice(`面接室を作成しました: ${result.interview.title}`);
    setInterviewUserId('');
    setInterviewTitle('');
    await refetchInterviews();
  };

  const handleCloseInterview = async (session: InterviewRoomSession) => {
    if (!window.confirm(`面接室「${session.title}」を終了しますか？`)) return;
    const success = await closeInterviewRoom(session.sessionId, 'スタッフが手動で終了');
    if (!success) return;
    setInterviewNotice(`面接室を終了しました: ${session.title}`);
    await refetchInterviews();
  };

  const renderField = (detectorKey: string, detector: DetectorConfig, field: ConfigField) => {
    const config = detector.config || {};
    if (field.kind === 'list') {
      return (
        <label key={field.key} className={`${styles.field} ${field.wide ? styles.fieldWide : ''}`}>
          <span>{field.label}</span>
          <textarea
            className={styles.textarea}
            value={toTextList(config[field.key])}
            onChange={(event) => updateListDetectorConfig(detectorKey, field.key, event.target.value)}
            disabled={!detector.enabled}
            placeholder={field.placeholder}
          />
        </label>
      );
    }

    return (
      <label key={field.key} className={styles.field}>
        <span>{field.label}</span>
        <input
          className={styles.input}
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          value={readNumber(config[field.key], field.defaultValue || 0)}
          onChange={(event) => updateDetectorConfig(detectorKey, field.key, Number(event.target.value))}
          disabled={!detector.enabled}
        />
      </label>
    );
  };

  const renderWordRules = (detector: DetectorConfig) => (
    <div className={styles.fieldWide}>
      <div className={styles.inlineHeader}>
        <strong>フィルタールール</strong>
        <button className={styles.secondaryButton} onClick={addWordRule} type="button" disabled={!detector.enabled}>
          <span className="material-icons">add</span>
          <span>ルール追加</span>
        </button>
      </div>
      {wordFilterRules.length === 0 ? (
        <div className={styles.emptyPanel}>ルールはまだありません。</div>
      ) : wordFilterRules.map((rule) => (
        <div key={rule.id} className={styles.ruleCard}>
          <div className={styles.detectorGrid}>
            <label className={styles.field}>
              <span>ラベル</span>
              <input className={styles.input} type="text" value={rule.label} onChange={(event) => updateWordRule(rule.id, { label: event.target.value })} disabled={!detector.enabled} />
            </label>
            <label className={styles.field}>
              <span>判定モード</span>
              <select className={styles.select} value={rule.mode} onChange={(event) => updateWordRule(rule.id, { mode: event.target.value as WordFilterRule['mode'] })} disabled={!detector.enabled}>
                <option value="contains">contains</option>
                <option value="exact">exact</option>
                <option value="regex">regex</option>
              </select>
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>パターン</span>
              <input className={styles.input} type="text" value={rule.pattern} onChange={(event) => updateWordRule(rule.id, { pattern: event.target.value })} disabled={!detector.enabled} />
            </label>
            <label className={styles.field}>
              <span>加算スコア</span>
              <input className={styles.input} type="number" min={0} value={rule.score} onChange={(event) => updateWordRule(rule.id, { score: Number(event.target.value) })} disabled={!detector.enabled} />
            </label>
            <label className={styles.checkField}>
              <input type="checkbox" checked={rule.enabled} onChange={(event) => updateWordRule(rule.id, { enabled: event.target.checked })} disabled={!detector.enabled} />
              <span>有効</span>
            </label>
            <label className={styles.checkField}>
              <input type="checkbox" checked={Boolean(rule.deleteMessage)} onChange={(event) => updateWordRule(rule.id, { deleteMessage: event.target.checked })} disabled={!detector.enabled} />
              <span>メッセージを削除</span>
            </label>
          </div>
          <button className={styles.dangerButton} onClick={() => removeWordRule(rule.id)} type="button" disabled={!detector.enabled}>
            <span className="material-icons">delete</span>
            <span>削除</span>
          </button>
        </div>
      ))}
    </div>
  );

  if (loading) {
    return <div className={styles.page}><div className={styles.statePanel}>AntiCheat 設定を読み込んでいます...</div></div>;
  }

  if (error || !draft) {
    return (
      <div className={styles.page}>
        <div className={styles.statePanel}>
          <h2>エラー</h2>
          <p>{error || '設定の取得に失敗しました'}</p>
          <button className={styles.secondaryButton} onClick={() => navigate(`/settings/${guildId}`)} type="button">サーバー管理へ戻る</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <section className={styles.pageHeader}>
        <div className={styles.pageHeaderCopy}>
          <span className={styles.pageEyebrow}>AntiCheat</span>
          <h1>{guildName} の保護設定</h1>
          <p>全体設定、検知、信頼スコア、面接室までをまとめて管理する画面です。</p>
        </div>

        <div className={styles.pageHeaderActions}>
          <button className={styles.secondaryButton} onClick={() => navigate(`/settings/${guildId}`)} type="button">
            <span className="material-icons">arrow_back</span>
            <span>サーバー管理へ</span>
          </button>
          <button className={styles.primaryButton} onClick={commitDraft} type="button" disabled={saving}>
            <span className="material-icons">{saving ? 'sync' : 'save'}</span>
            <span>{saving ? '保存中...' : '設定を保存'}</span>
          </button>
        </div>

        <div className={styles.pageMeta}>
          <span className={styles.metaChip}>{draft.enabled ? '保護有効' : '保護停止'}</span>
          <span className={styles.metaChip}>{Object.values(draft.detectors).filter((detector) => detector.enabled).length} detectors active</span>
          <span className={styles.metaChip}>{draft.punishments.length} thresholds</span>
          <span className={styles.metaChip}>{activeInterviews.length} interviews active</span>
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Status</span>
            <strong>{draft.enabled ? 'Active' : 'Paused'}</strong>
            <p>AntiCheat 全体の状態です。</p>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Raid mode</span>
            <strong>{draft.raidMode.active ? 'Triggered' : 'Standby'}</strong>
            <p>{draft.raidMode.reason || '待機中です。'}</p>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Interviews</span>
            <strong>{interviews.length}</strong>
            <p>進行中と履歴を含む面接室件数です。</p>
          </div>
        </div>
      </section>

      <div>
        {saveNotice ? <div className={styles.noticeSuccess}>{saveNotice}</div> : null}
        {actionError ? <div className={styles.noticeError}>{actionError}</div> : null}
        {interviewActionError ? <div className={styles.noticeError}>{interviewActionError}</div> : null}
        {interviewNotice ? <div className={styles.noticeSuccess}>{interviewNotice}</div> : null}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Overview</span>
              <h2>全体設定</h2>
            </div>
            <p>保護スイッチ、ログ出力先、自動処理を先に固めます。</p>
          </div>
          <div className={styles.panelGrid}>
            <article className={styles.panel}>
              <div className={styles.inlineHeader}>
                <div>
                  <strong>保護スイッチ</strong>
                  <p>サーバー全体で AntiCheat を有効化します。</p>
                </div>
                <label className={styles.checkField}>
                  <input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft((current) => ({ ...current, enabled: event.target.checked }))} />
                  <span>{draft.enabled ? '有効' : '無効'}</span>
                </label>
              </div>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>検知ログチャンネル ID</span>
                  <input className={styles.input} type="text" value={draft.logChannelId || ''} onChange={(event) => updateDraft((current) => ({ ...current, logChannelId: event.target.value || null }))} placeholder="123456789012345678" />
                </label>
                <label className={styles.field}>
                  <span>アバターログチャンネル ID</span>
                  <input className={styles.input} type="text" value={draft.avatarLogChannelId || ''} onChange={(event) => updateDraft((current) => ({ ...current, avatarLogChannelId: event.target.value || null }))} placeholder="123456789012345678" />
                </label>
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.inlineHeader}>
                <div>
                  <strong>自動処理</strong>
                  <p>削除対象の秒数と自動タイムアウトを管理します。</p>
                </div>
                <div className={`${styles.statusPill} ${draft.raidMode.active ? styles.statusDanger : styles.statusNeutral}`}>
                  {draft.raidMode.active ? 'Raid active' : 'Raid standby'}
                </div>
              </div>
              <div className={styles.formGrid}>
                <label className={styles.checkField}>
                  <input type="checkbox" checked={draft.autoDelete.enabled} onChange={(event) => updateDraft((current) => ({ ...current, autoDelete: { ...current.autoDelete, enabled: event.target.checked } }))} />
                  <span>直近メッセージを削除</span>
                </label>
                <label className={styles.field}>
                  <span>削除対象の秒数</span>
                  <input className={styles.input} type="number" min={1} value={draft.autoDelete.windowSeconds} onChange={(event) => updateDraft((current) => ({ ...current, autoDelete: { ...current.autoDelete, windowSeconds: Number(event.target.value) } }))} />
                </label>
                <label className={styles.checkField}>
                  <input type="checkbox" checked={draft.autoTimeout.enabled} onChange={(event) => updateDraft((current) => ({ ...current, autoTimeout: { ...current.autoTimeout, enabled: event.target.checked } }))} />
                  <span>自動タイムアウト</span>
                </label>
                <label className={styles.field}>
                  <span>タイムアウト秒数</span>
                  <input className={styles.input} type="number" min={1} value={draft.autoTimeout.durationSeconds} onChange={(event) => updateDraft((current) => ({ ...current, autoTimeout: { ...current.autoTimeout, durationSeconds: Number(event.target.value) } }))} />
                </label>
              </div>
              <div className={styles.raidSummary}>
                <div>
                  <span>最新発動</span>
                  <strong>{formatDate(draft.raidMode.activatedAt)}</strong>
                </div>
                <div>
                  <span>最近の参加数</span>
                  <strong>{draft.raidMode.recentJoinCount}</strong>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Detectors</span>
              <h2>検知ルール</h2>
            </div>
            <p>各ルールのスコア、削除、通知、しきい値を定義します。</p>
          </div>
          <div className={styles.detectorList}>
            {DETECTORS.map((entry) => {
              const detector = draft.detectors[entry.key];
              if (!detector) return null;

              return (
                <article key={entry.key} className={styles.detectorCard}>
                  <div className={styles.detectorHeader}>
                    <div className={styles.iconTitle}>
                      <span className={styles.leadingIcon}><span className="material-icons">{entry.icon}</span></span>
                      <div>
                        <strong>{entry.title}</strong>
                        <p>{entry.description}</p>
                      </div>
                    </div>
                    <label className={styles.checkField}>
                      <input type="checkbox" checked={detector.enabled} onChange={(event) => updateDetector(entry.key, { enabled: event.target.checked })} />
                      <span>{detector.enabled ? '有効' : '無効'}</span>
                    </label>
                  </div>
                  <div className={styles.detectorGrid}>
                    <label className={styles.field}>
                      <span>加算スコア</span>
                      <input className={styles.input} type="number" min={0} value={detector.score} onChange={(event) => updateDetector(entry.key, { score: Number(event.target.value) })} disabled={!detector.enabled} />
                    </label>
                    <label className={styles.checkField}>
                      <input type="checkbox" checked={Boolean(detector.deleteMessage)} onChange={(event) => updateDetector(entry.key, { deleteMessage: event.target.checked })} disabled={!detector.enabled} />
                      <span>メッセージを削除</span>
                    </label>
                    <label className={styles.checkField}>
                      <input type="checkbox" checked={Boolean(detector.notifyChannel)} onChange={(event) => updateDetector(entry.key, { notifyChannel: event.target.checked })} disabled={!detector.enabled} />
                      <span>公開通知を送る</span>
                    </label>
                    {entry.key === 'wordFilter'
                      ? renderWordRules(detector)
                      : (entry.fields?.map((field) => renderField(entry.key, detector, field)) || <p className={styles.note}>追加の詳細設定はありません。</p>)}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Policies</span>
              <h2>除外設定と処罰</h2>
            </div>
            <p>誤検知を避ける対象と、しきい値到達時の処理を定義します。</p>
          </div>
          <div className={styles.panelGrid}>
            <article className={styles.panel}>
              <div className={styles.inlineHeader}>
                <div>
                  <strong>除外対象</strong>
                  <p>ロール ID とチャンネル ID を改行またはカンマ区切りで入力します。</p>
                </div>
              </div>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>除外ロール</span>
                  <textarea className={styles.textarea} value={excludedRolesText} onChange={(event) => setExcludedRolesText(event.target.value)} placeholder="123456789012345678" />
                </label>
                <label className={styles.field}>
                  <span>除外チャンネル</span>
                  <textarea className={styles.textarea} value={excludedChannelsText} onChange={(event) => setExcludedChannelsText(event.target.value)} placeholder="123456789012345678" />
                </label>
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.inlineHeader}>
                <div>
                  <strong>スコア到達時の処置</strong>
                  <p>しきい値ごとに timeout / kick / ban を並べます。</p>
                </div>
                <button className={styles.secondaryButton} onClick={addPunishment} type="button">
                  <span className="material-icons">add</span>
                  <span>しきい値追加</span>
                </button>
              </div>
              {draft.punishments.length === 0 ? (
                <div className={styles.emptyPanel}>処罰ポリシーはまだありません。</div>
              ) : (
                <div className={styles.policyList}>
                  {draft.punishments.map((punishment, thresholdIndex) => (
                    <div key={`${punishment.threshold}-${thresholdIndex}`} className={styles.ruleCard}>
                      <div className={styles.inlineHeader}>
                        <label className={styles.field}>
                          <span>しきい値</span>
                          <input className={styles.input} type="number" min={0} value={punishment.threshold} onChange={(event) => updatePunishment(thresholdIndex, { threshold: Number(event.target.value) })} />
                        </label>
                        <button className={styles.dangerButton} onClick={() => removePunishment(thresholdIndex)} type="button">
                          <span className="material-icons">delete</span>
                          <span>削除</span>
                        </button>
                      </div>

                      <div className={styles.actionStack}>
                        {punishment.actions.map((action, actionIndex) => (
                          <div key={`${thresholdIndex}-${actionIndex}`} className={styles.actionCard}>
                            <div className={styles.formGrid}>
                              <label className={styles.field}>
                                <span>処置</span>
                                <select className={styles.select} value={action.type} onChange={(event) => updateAction(thresholdIndex, actionIndex, { type: event.target.value as PunishmentAction['type'] })}>
                                  <option value="timeout">timeout</option>
                                  <option value="kick">kick</option>
                                  <option value="ban">ban</option>
                                </select>
                              </label>
                              <label className={styles.field}>
                                <span>秒数(timeout用)</span>
                                <input className={styles.input} type="number" min={1} value={action.durationSeconds || 600} onChange={(event) => updateAction(thresholdIndex, actionIndex, { durationSeconds: Number(event.target.value) })} disabled={action.type !== 'timeout'} />
                              </label>
                              <label className={`${styles.field} ${styles.fieldWide}`}>
                                <span>理由テンプレート</span>
                                <input className={styles.input} type="text" value={action.reasonTemplate || ''} onChange={(event) => updateAction(thresholdIndex, actionIndex, { reasonTemplate: event.target.value })} />
                              </label>
                              <label className={styles.checkField}>
                                <input type="checkbox" checked={Boolean(action.notify)} onChange={(event) => updateAction(thresholdIndex, actionIndex, { notify: event.target.checked })} />
                                <span>通知を送る</span>
                              </label>
                            </div>
                            <div className={styles.actionToolbar}>
                              <button className={styles.secondaryButton} onClick={() => addAction(thresholdIndex)} type="button">
                                <span className="material-icons">add</span>
                                <span>処置追加</span>
                              </button>
                              {punishment.actions.length > 1 ? (
                                <button className={styles.dangerButton} onClick={() => removeAction(thresholdIndex, actionIndex)} type="button">
                                  <span className="material-icons">remove</span>
                                  <span>この処置を削除</span>
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Interviews</span>
              <h2>面接室</h2>
            </div>
            <p>信頼スコアの再審査用に AI 面接室を作成します。24時間クールダウンがあり、ふざけた応答は即終了です。</p>
          </div>

          <div className={styles.panelGrid}>
            <article className={styles.panel}>
              <div className={styles.inlineHeader}>
                <div>
                  <strong>面接室を作成</strong>
                  <p>ユーザー ID を指定して手動作成します。タイトルは任意です。</p>
                </div>
                <button className={styles.secondaryButton} onClick={() => refetchInterviews()} type="button">
                  <span className="material-icons">refresh</span>
                  <span>再取得</span>
                </button>
              </div>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>対象ユーザー ID</span>
                  <input className={styles.input} type="text" value={interviewUserId} onChange={(event) => setInterviewUserId(event.target.value)} placeholder="123456789012345678" />
                </label>
                <label className={styles.field}>
                  <span>部屋タイトル</span>
                  <input className={styles.input} type="text" value={interviewTitle} onChange={(event) => setInterviewTitle(event.target.value)} placeholder="appeal-username" />
                </label>
              </div>
              <div className={styles.buttonRow}>
                <button className={styles.primaryButton} onClick={() => handleCreateInterview(interviewUserId, interviewTitle || undefined)} type="button" disabled={interviewExecuting || !interviewUserId.trim()}>
                  <span className="material-icons">forum</span>
                  <span>{interviewExecuting ? '作成中...' : '面接室を作成'}</span>
                </button>
              </div>
              <div className={styles.raidSummary}>
                <div>
                  <span>進行中</span>
                  <strong>{activeInterviews.length}</strong>
                </div>
                <div>
                  <span>総件数</span>
                  <strong>{interviews.length}</strong>
                </div>
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.inlineHeader}>
                <div>
                  <strong>面接室一覧</strong>
                  <p>{interviewsLoading ? '面接室一覧を更新しています...' : `${interviews.length} 件を表示中`}</p>
                </div>
              </div>
              {interviewsError ? <div className={styles.noticeError}>{interviewsError}</div> : null}
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>対象</th>
                      <th>状態</th>
                      <th>更新</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interviews.length === 0 ? (
                      <tr>
                        <td colSpan={4} className={styles.emptyCell}>まだ面接室はありません。</td>
                      </tr>
                    ) : interviews.map((session) => (
                      <tr key={session.sessionId}>
                        <td>
                          <div className={styles.logPrimary}>{session.userDisplayName || session.userName}</div>
                          <div className={styles.logSecondary}>{session.title}</div>
                          <div className={styles.logSecondary}>{session.userId}</div>
                        </td>
                        <td>
                          <div className={styles.logPrimary}>{statusText(session)}</div>
                          <div className={styles.logSecondary}>次回: {formatDate(session.cooldownUntil)}</div>
                        </td>
                        <td>
                          <div>{formatDate(session.updatedAt)}</div>
                          {session.decision ? <div className={styles.logSecondary}>{session.decision.reason}</div> : null}
                        </td>
                        <td>
                          <div className={styles.inlineButtonGroup}>
                            <button className={styles.inlineButton} onClick={() => window.open(session.channelUrl, '_blank', 'noopener,noreferrer')} type="button">
                              開く
                            </button>
                            {session.status === 'active' ? (
                              <button className={styles.dangerButton} onClick={() => handleCloseInterview(session)} type="button" disabled={interviewExecuting}>
                                終了
                              </button>
                            ) : null}
                          </div>
                          {session.warnings?.length ? <div className={styles.logSecondary}>{session.warnings.join(' / ')}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Activity</span>
              <h2>ログと信頼スコア</h2>
            </div>
            <p>直近の検知と、現在スコアが高いユーザーを確認します。</p>
          </div>

          <div className={styles.panelGrid}>
            <article className={styles.panel}>
              <div className={styles.inlineHeader}>
                <div>
                  <strong>最新ログ</strong>
                  <p>{logsLoading ? 'ログを更新しています...' : `${logs.length} 件を表示中`}</p>
                </div>
                <button className={styles.secondaryButton} onClick={() => refetchLogs()} type="button">
                  <span className="material-icons">refresh</span>
                  <span>再取得</span>
                </button>
              </div>
              {logsError ? <div className={styles.noticeError}>{logsError}</div> : null}
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>検知</th>
                      <th>スコア</th>
                      <th>日時</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className={styles.emptyCell}>まだ検知ログはありません。</td>
                      </tr>
                    ) : logs.map((log) => (
                      <tr key={`${log.messageId}-${log.timestamp}`}>
                        <td>
                          <div className={styles.logPrimary}>{log.detector}</div>
                          <div className={styles.logSecondary}>{log.reason}</div>
                        </td>
                        <td>{log.scoreDelta}</td>
                        <td>{formatDate(log.timestamp)}</td>
                        <td>
                          {log.metadata?.isTimedOut ? (
                            <button className={styles.inlineButton} onClick={() => onRevokeTimeout(log)} type="button" disabled={executing}>タイムアウト解除</button>
                          ) : (
                            <span className={styles.logSecondary}>-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.inlineHeader}>
                <div>
                  <strong>信頼スコア</strong>
                  <p>{trustLoading ? '信頼スコアを更新しています...' : `${trustEntries.length} 人を表示中`}</p>
                </div>
                <button className={styles.secondaryButton} onClick={() => refetchTrust()} type="button">
                  <span className="material-icons">refresh</span>
                  <span>再取得</span>
                </button>
              </div>
              {trustError ? <div className={styles.noticeError}>{trustError}</div> : null}
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>ユーザー</th>
                      <th>スコア</th>
                      <th>更新</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trustEntries.length === 0 ? (
                      <tr>
                        <td colSpan={4} className={styles.emptyCell}>監視中のユーザーはいません。</td>
                      </tr>
                    ) : trustEntries.map((entry) => (
                      <tr key={entry.userId}>
                        <td>
                          <div className={styles.userCell}>
                            {entry.avatar ? (
                              <img className={styles.userAvatar} src={entry.avatar} alt={entry.displayName || entry.username} />
                            ) : (
                              <div className={styles.userFallback}>{(entry.displayName || entry.username).charAt(0).toUpperCase()}</div>
                            )}
                            <div>
                              <div className={styles.logPrimary}>{entry.displayName || entry.username}</div>
                              <div className={styles.logSecondary}>{entry.userId}</div>
                            </div>
                          </div>
                        </td>
                        <td>{entry.score}</td>
                        <td>{formatDate(entry.lastUpdated)}</td>
                        <td>
                          <div className={styles.inlineButtonGroup}>
                            <button className={styles.inlineButton} onClick={() => onResetTrust(entry.userId)} type="button" disabled={executing}>スコアをリセット</button>
                            <button className={styles.secondaryButton} onClick={() => handleCreateInterview(entry.userId)} type="button" disabled={interviewExecuting}>面接室作成</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>
  );
};

export default AntiCheatUnified;
