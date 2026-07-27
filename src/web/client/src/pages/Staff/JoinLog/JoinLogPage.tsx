import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppToast } from '../../../AppToastProvider';
import styles from './JoinLogPage.module.css';

type GuildSummary = {
  id: string;
  name: string;
  icon?: string | null;
};

type ChannelSummary = {
  id: string;
  name: string;
  position: number;
};

type JoinLogSettings = {
  enabled: boolean;
  channelId: string | null;
  logBots: boolean;
  joinTitle: string;
  joinDescription: string;
  leaveTitle: string;
  leaveDescription: string;
  joinColor: number;
  leaveColor: number;
};

type JoinLogState = {
  guild: GuildSummary;
  settings: JoinLogSettings;
  defaults: JoinLogSettings;
  channels: ChannelSummary[];
  placeholders: string[];
};

const numberToHex = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;

const JoinLogPage: React.FC = () => {
  const params = useParams();
  const initialGuildId = params.guildId || '';
  const { addToast } = useAppToast();
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState(initialGuildId);
  const [state, setState] = useState<JoinLogState | null>(null);
  const [form, setForm] = useState<JoinLogSettings | null>(null);
  const [loadingGuilds, setLoadingGuilds] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === selectedGuildId) || state?.guild || null,
    [guilds, selectedGuildId, state]
  );

  useEffect(() => {
    const loadGuilds = async () => {
      setLoadingGuilds(true);
      try {
        const response = await fetch('/api/staff/guilds', { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'サーバー一覧の取得に失敗しました。');
        const nextGuilds = (data.guilds || []) as GuildSummary[];
        setGuilds(nextGuilds);
        setSelectedGuildId((current) => {
          if (initialGuildId && nextGuilds.some((guild) => guild.id === initialGuildId)) return initialGuildId;
          if (nextGuilds.some((guild) => guild.id === current)) return current;
          return nextGuilds[0]?.id || '';
        });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'サーバー一覧の取得に失敗しました。');
      } finally {
        setLoadingGuilds(false);
      }
    };
    loadGuilds();
  }, [initialGuildId]);

  const loadState = useCallback(async (guildId: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/join-log/${guildId}`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '参加・退出ログ設定の取得に失敗しました。');
      const nextState = data as JoinLogState;
      setState(nextState);
      setForm(nextState.settings);
    } catch (loadError) {
      setState(null);
      setForm(null);
      setError(loadError instanceof Error ? loadError.message : '参加・退出ログ設定の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedGuildId) loadState(selectedGuildId);
    else {
      setState(null);
      setForm(null);
    }
  }, [loadState, selectedGuildId]);

  const patchForm = (patch: Partial<JoinLogSettings>) => {
    setForm((current) => current ? { ...current, ...patch } : current);
  };

  const save = async () => {
    if (!selectedGuildId || !form) return;
    if (form.enabled && !form.channelId) {
      setError('有効化するには送信先チャンネルを選択してください。');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/join-log/${selectedGuildId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          joinColor: numberToHex(form.joinColor),
          leaveColor: numberToHex(form.leaveColor),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '設定の保存に失敗しました。');
      setForm(data.settings as JoinLogSettings);
      setState((current) => current ? { ...current, settings: data.settings } : current);
      addToast?.('参加・退出ログ設定を保存しました', 'success');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '設定の保存に失敗しました。';
      setError(message);
      addToast?.(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetTemplates = async () => {
    if (!selectedGuildId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/join-log/${selectedGuildId}/reset`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '初期値への復元に失敗しました。');
      setForm(data.settings as JoinLogSettings);
      setState((current) => current ? { ...current, settings: data.settings } : current);
      addToast?.('タイトル・本文・カラーを初期値へ戻しました', 'success');
    } catch (resetError) {
      const message = resetError instanceof Error ? resetError.message : '初期値への復元に失敗しました。';
      setError(message);
      addToast?.(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loadingGuilds) return <div className={styles.statePanel}>サーバー情報を読み込んでいます...</div>;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Staff Join Log</span>
          <h1>参加・退出ログ</h1>
          <p>参加・退出通知の送信先、Botの記録、Embedのタイトル・本文・カラーをサーバーごとに設定します。</p>
        </div>
        <div className={styles.heroActions}>
          <button className={styles.secondaryButton} type="button" onClick={resetTemplates} disabled={!form || saving}>テンプレートを初期化</button>
          <button className={styles.primaryButton} type="button" onClick={save} disabled={!form || saving}>{saving ? '保存中...' : '設定を保存'}</button>
        </div>
      </header>

      {error && <div className={styles.errorBox}>{error}</div>}

      <section className={styles.selectorCard}>
        <label className={styles.field}>
          <span>設定するサーバー</span>
          <select value={selectedGuildId} onChange={(event) => setSelectedGuildId(event.target.value)}>
            <option value="">サーバーを選択</option>
            {guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
          </select>
        </label>
        <div className={styles.guildInfo}>
          <strong>{selectedGuild?.name || '未選択'}</strong>
          <span>{selectedGuildId || 'サーバーを選択してください'}</span>
        </div>
      </section>

      {loading ? (
        <div className={styles.statePanel}>参加・退出ログ設定を読み込んでいます...</div>
      ) : form && state ? (
        <>
          <section className={styles.settingsCard}>
            <div className={styles.sectionHeader}>
              <div><span className={styles.sectionEyebrow}>Delivery</span><h2>基本設定</h2></div>
              <label className={styles.switchLabel}>
                <input type="checkbox" checked={form.enabled} onChange={(event) => patchForm({ enabled: event.target.checked })} />
                <span>参加・退出ログを有効化</span>
              </label>
            </div>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>送信先テキストチャンネル</span>
                <select value={form.channelId || ''} onChange={(event) => patchForm({ channelId: event.target.value || null })}>
                  <option value="">送信先を選択</option>
                  {state.channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
                </select>
              </label>
              <label className={styles.checkboxCard}>
                <input type="checkbox" checked={form.logBots} onChange={(event) => patchForm({ logBots: event.target.checked })} />
                <span><strong>Botも記録する</strong><small>Botアカウントの参加・退出も通知します。</small></span>
              </label>
            </div>
          </section>

          <div className={styles.messageGrid}>
            <section className={styles.settingsCard}>
              <div className={styles.sectionHeader}><div><span className={styles.sectionEyebrow}>Member Join</span><h2>参加メッセージ</h2></div><input className={styles.colorInput} type="color" value={numberToHex(form.joinColor)} onChange={(event) => patchForm({ joinColor: Number.parseInt(event.target.value.slice(1), 16) })} /></div>
              <label className={styles.field}><span>タイトル</span><input maxLength={256} value={form.joinTitle} onChange={(event) => patchForm({ joinTitle: event.target.value })} /></label>
              <label className={styles.field}><span>本文</span><textarea maxLength={4096} value={form.joinDescription} onChange={(event) => patchForm({ joinDescription: event.target.value })} /></label>
            </section>

            <section className={styles.settingsCard}>
              <div className={styles.sectionHeader}><div><span className={styles.sectionEyebrow}>Member Leave</span><h2>退出メッセージ</h2></div><input className={styles.colorInput} type="color" value={numberToHex(form.leaveColor)} onChange={(event) => patchForm({ leaveColor: Number.parseInt(event.target.value.slice(1), 16) })} /></div>
              <label className={styles.field}><span>タイトル</span><input maxLength={256} value={form.leaveTitle} onChange={(event) => patchForm({ leaveTitle: event.target.value })} /></label>
              <label className={styles.field}><span>本文</span><textarea maxLength={4096} value={form.leaveDescription} onChange={(event) => patchForm({ leaveDescription: event.target.value })} /></label>
            </section>
          </div>

          <section className={styles.settingsCard}>
            <div className={styles.sectionHeader}><div><span className={styles.sectionEyebrow}>Variables</span><h2>使用できる置換文字</h2></div></div>
            <div className={styles.placeholderList}>
              {state.placeholders.map((placeholder) => <code key={placeholder}>{placeholder}</code>)}
            </div>
            <p className={styles.helpText}>タイトルまたは本文へ入力すると、通知時にユーザー名・メンション・ロール・参加期間などへ自動置換されます。</p>
          </section>
        </>
      ) : (
        <div className={styles.statePanel}>設定するサーバーを選択してください。</div>
      )}
    </div>
  );
};

export default JoinLogPage;
