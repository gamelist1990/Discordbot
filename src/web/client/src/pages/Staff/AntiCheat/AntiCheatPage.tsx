import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchGuildInfo } from '../../../services/api';
import {
  useActiveTimeouts,
  useAntiCheatActions,
  useAntiCheatSettings,
  useDetectionLogs,
  useUserTrust,
} from './hooks';
import AntiCheatDesktop from './desktop/AntiCheatDesktop';
import AntiCheatMobile from './mobile/AntiCheatMobile';
import { cloneSettings, createWordFilterRule, DETECTORS, parseListText } from './model';
import type {
  ActiveTimeoutEntry,
  AntiCheatSettings,
  DetectionLog,
  DetectorConfig,
  PunishmentAction,
  PunishmentThreshold,
  UserTrustDataWithUser,
  WordFilterRule,
} from './types';
import { useResponsiveVariant } from './useResponsiveVariant';
import type { AntiCheatViewProps } from './viewTypes';
import styles from './AntiCheatPage.module.css';

const EMPTY_ACTION: PunishmentAction = {
  type: 'timeout',
  durationSeconds: 600,
  reasonTemplate: 'AntiCheat violation: threshold {threshold}',
  notify: true,
};

export default function AntiCheatPage() {
  const { guildId = '' } = useParams<{ guildId: string }>();
  const navigate = useNavigate();
  const variant = useResponsiveVariant();

  const { settings, loading, error, updateSettings } = useAntiCheatSettings(guildId);
  const { logs, loading: logsLoading, error: logsError, refetch: refetchLogs } = useDetectionLogs(guildId, 40);
  const { trust, loading: trustLoading, error: trustError, refetch: refetchTrust } = useUserTrust(guildId);
  const { activeTimeouts, loading: timeoutsLoading, error: timeoutsError, refetch: refetchTimeouts } = useActiveTimeouts(guildId);
  const { revokeTimeout, resetTrust, executing, error: actionError } = useAntiCheatActions(guildId);

  const [guildName, setGuildName] = useState('AntiCheat');
  const [draft, setDraft] = useState<AntiCheatSettings | null>(null);
  const [excludedRolesText, setExcludedRolesTextState] = useState('');
  const [excludedChannelsText, setExcludedChannelsTextState] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    const next = cloneSettings(settings);
    setDraft(next);
    setExcludedRolesTextState(next.excludedRoles.join('\n'));
    setExcludedChannelsTextState(next.excludedChannels.join('\n'));
    setDirty(false);
  }, [settings]);

  useEffect(() => {
    if (!guildId) return;
    fetchGuildInfo(guildId)
      .then((info) => setGuildName(info.name))
      .catch(() => setGuildName(guildId));
  }, [guildId]);

  const trustEntries = useMemo(() => {
    if (!trust || Array.isArray(trust) || 'score' in (trust as Record<string, unknown>)) return [];
    return Object.entries(trust as Record<string, UserTrustDataWithUser>)
      .map(([userId, value]) => ({ userId, ...value }))
      .sort((left, right) => right.score - left.score);
  }, [trust]);

  const updateDraft = (updater: (current: AntiCheatSettings) => AntiCheatSettings) => {
    setDraft((current) => current ? updater(current) : current);
    setDirty(true);
    setSaveNotice(null);
  };

  const setExcludedRolesText = (value: string) => {
    setExcludedRolesTextState(value);
    setDirty(true);
    setSaveNotice(null);
  };

  const setExcludedChannelsText = (value: string) => {
    setExcludedChannelsTextState(value);
    setDirty(true);
    setSaveNotice(null);
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
          config: {
            ...(current.detectors[detectorKey]?.config || {}),
            [field]: value,
          },
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
          threshold: (current.punishments.at(-1)?.threshold || 0) + 10,
          actions: [{ ...EMPTY_ACTION }],
        },
      ],
    }));
  };

  const updatePunishment = (index: number, patch: Partial<PunishmentThreshold>) => {
    updateDraft((current) => ({
      ...current,
      punishments: current.punishments.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      ),
    }));
  };

  const removePunishment = (index: number) => {
    updateDraft((current) => ({
      ...current,
      punishments: current.punishments.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const addAction = (index: number) => {
    updateDraft((current) => ({
      ...current,
      punishments: current.punishments.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, actions: [...item.actions, { ...EMPTY_ACTION }] }
          : item
      ),
    }));
  };

  const updateAction = (
    thresholdIndex: number,
    actionIndex: number,
    patch: Partial<PunishmentAction>,
  ) => {
    updateDraft((current) => ({
      ...current,
      punishments: current.punishments.map((item, itemIndex) =>
        itemIndex === thresholdIndex
          ? {
              ...item,
              actions: item.actions.map((action, currentActionIndex) =>
                currentActionIndex === actionIndex ? { ...action, ...patch } : action
              ),
            }
          : item
      ),
    }));
  };

  const removeAction = (thresholdIndex: number, actionIndex: number) => {
    updateDraft((current) => ({
      ...current,
      punishments: current.punishments.map((item, itemIndex) =>
        itemIndex === thresholdIndex
          ? {
              ...item,
              actions: item.actions.filter((_, currentActionIndex) =>
                currentActionIndex !== actionIndex
              ),
            }
          : item
      ),
    }));
  };

  const wordFilterRules =
    (draft?.detectors.wordFilter?.config?.rules as WordFilterRule[] | undefined) || [];

  const addWordRule = () => {
    updateDetectorConfig('wordFilter', 'rules', [
      ...wordFilterRules,
      createWordFilterRule(),
    ]);
  };

  const updateWordRule = (ruleId: string, patch: Partial<WordFilterRule>) => {
    updateDetectorConfig(
      'wordFilter',
      'rules',
      wordFilterRules.map((rule) => rule.id === ruleId ? { ...rule, ...patch } : rule),
    );
  };

  const removeWordRule = (ruleId: string) => {
    updateDetectorConfig(
      'wordFilter',
      'rules',
      wordFilterRules.filter((rule) => rule.id !== ruleId),
    );
  };

  const commitDraft = async () => {
    if (!draft || !dirty) return;
    setSaving(true);
    setSaveNotice(null);
    const payload: AntiCheatSettings = {
      ...draft,
      excludedRoles: parseListText(excludedRolesText),
      excludedChannels: parseListText(excludedChannelsText),
    };
    const success = await updateSettings(payload);
    setSaving(false);
    if (!success) return;
    setDraft(cloneSettings(payload));
    setExcludedRolesTextState(payload.excludedRoles.join('\n'));
    setExcludedChannelsTextState(payload.excludedChannels.join('\n'));
    setDirty(false);
    setSaveNotice('AntiCheat設定を保存しました。');
  };

  const onResetTrust = async (userId: string) => {
    if (!window.confirm('このユーザーの信頼スコアをリセットしますか？')) return;
    if (await resetTrust(userId)) {
      await Promise.all([refetchTrust(), refetchLogs()]);
    }
  };

  const onRevokeLogTimeout = async (log: DetectionLog) => {
    if (!window.confirm('このタイムアウトを解除しますか？')) return;
    if (await revokeTimeout(log.userId, false, log.messageId)) {
      await Promise.all([refetchLogs(), refetchTrust(), refetchTimeouts()]);
    }
  };

  const onRevokeActiveTimeout = async (entry: ActiveTimeoutEntry) => {
    if (!window.confirm(`${entry.displayName || entry.username}のタイムアウトを解除しますか？`)) return;
    if (await revokeTimeout(entry.userId, false, entry.sourceMessageId || undefined)) {
      await Promise.all([refetchLogs(), refetchTrust(), refetchTimeouts()]);
    }
  };

  if (!guildId) return null;

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.statePanel}>AntiCheat設定を読み込んでいます...</div>
      </div>
    );
  }

  if (error || !draft) {
    return (
      <div className={styles.page}>
        <div className={styles.statePanel}>
          <h2>設定を取得できませんでした</h2>
          <p>{error || '不明なエラーが発生しました。'}</p>
          <button type="button" onClick={() => navigate(`/settings/${guildId}`)}>
            サーバー管理へ戻る
          </button>
        </div>
      </div>
    );
  }

  const viewProps: AntiCheatViewProps = {
    guildId,
    guildName,
    draft,
    dirty,
    saving,
    executing,
    logs,
    trustEntries,
    activeTimeouts,
    logsLoading,
    trustLoading,
    timeoutsLoading,
    logsError,
    trustError,
    timeoutsError,
    actionError,
    saveNotice,
    excludedRolesText,
    excludedChannelsText,
    detectors: DETECTORS,
    wordFilterRules,
    onBack: () => navigate(`/settings/${guildId}`),
    onSave: commitDraft,
    onRefreshLogs: () => { void refetchLogs(); },
    onRefreshTrust: () => { void refetchTrust(); },
    onRefreshTimeouts: () => { void refetchTimeouts(); },
    onRevokeLogTimeout: (log) => { void onRevokeLogTimeout(log); },
    onRevokeActiveTimeout: (entry) => { void onRevokeActiveTimeout(entry); },
    onResetTrust: (userId) => { void onResetTrust(userId); },
    setExcludedRolesText,
    setExcludedChannelsText,
    updateDraft,
    updateDetector,
    updateDetectorConfig,
    updateListDetectorConfig,
    addWordRule,
    updateWordRule,
    removeWordRule,
    addPunishment,
    updatePunishment,
    removePunishment,
    addAction,
    updateAction,
    removeAction,
  };

  return variant === 'mobile'
    ? <AntiCheatMobile {...viewProps} />
    : <AntiCheatDesktop {...viewProps} />;
}
