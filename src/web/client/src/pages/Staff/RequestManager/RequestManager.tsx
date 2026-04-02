import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppToast } from '../../../AppToastProvider';
import styles from './RequestManager.module.css';

type GuildSummary = {
  id: string;
  name: string;
  icon?: string | null;
};

type GuildChannel = {
  id: string;
  name: string;
  type: number;
  position: number;
};

type RequestConfig = {
  guildId: string;
  categoryName: string;
  labels: string[];
  doneChannelId: string | null;
  description: string;
  instructions: string;
  updatedBy: string;
  updatedAt: string;
};

const DEFAULT_DESCRIPTION = 'このパネルから機能リクエスト、バグ報告、その他の要望を送信できます。';
const DEFAULT_INSTRUCTIONS = '1. ラベルを選択してください\n2. 件名を入力してください\n3. 詳細な内容を記述してください';

const RequestManagerPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialGuildId = searchParams.get('guildId');
  const returnTo = searchParams.get('returnTo') || '/staff';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(initialGuildId);
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [config, setConfig] = useState<RequestConfig | null>(null);
  const [categoryName, setCategoryName] = useState('Request');
  const [labels, setLabels] = useState('機能リクエスト,バグ修正,その他');
  const [doneChannelId, setDoneChannelId] = useState('');
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [instructions, setInstructions] = useState(DEFAULT_INSTRUCTIONS);
  const [error, setError] = useState<string | null>(null);

  const { addToast } = (() => {
    try {
      return useAppToast();
    } catch {
      return { addToast: undefined } as any;
    }
  })();

  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === selectedGuildId) || null,
    [guilds, selectedGuildId]
  );

  useEffect(() => {
    const loadGuilds = async () => {
      try {
        const response = await fetch('/api/staff/guilds', { credentials: 'include' });
        if (!response.ok) {
          throw new Error('アクセス可能なサーバーを取得できませんでした。');
        }

        const data = await response.json();
        const nextGuilds = (data.guilds || []) as GuildSummary[];
        setGuilds(nextGuilds);

        if (initialGuildId && nextGuilds.some((guild) => guild.id === initialGuildId)) {
          setSelectedGuildId(initialGuildId);
        } else if (!initialGuildId) {
          setSelectedGuildId(null);
        } else {
          setSelectedGuildId(null);
        }
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : 'サーバー一覧の取得に失敗しました。';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadGuilds();
  }, [initialGuildId]);

  useEffect(() => {
    if (!selectedGuildId) {
      setConfig(null);
      setChannels([]);
      setCategoryName('Request');
      setLabels('機能リクエスト,バグ修正,その他');
      setDoneChannelId('');
      setDescription(DEFAULT_DESCRIPTION);
      setInstructions(DEFAULT_INSTRUCTIONS);
      return;
    }

    const loadGuildData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [configRes, channelsRes] = await Promise.all([
          fetch(`/api/staff/requestmanager/${selectedGuildId}`, { credentials: 'include' }),
          fetch(`/api/staff/guilds/${selectedGuildId}/channels`, { credentials: 'include' }),
        ]);

        if (!configRes.ok || !channelsRes.ok) {
          throw new Error('Request 設定の読み込みに失敗しました。');
        }

        const [configData, channelsData] = await Promise.all([
          configRes.json(),
          channelsRes.json(),
        ]);

        const nextConfig = (configData.config || null) as RequestConfig | null;
        const nextChannels = ((channelsData.channels || []) as GuildChannel[]).filter((channel) =>
          [0, 5, 15].includes(channel.type)
        );

        setConfig(nextConfig);
        setChannels(nextChannels);
        setCategoryName(nextConfig?.categoryName || 'Request');
        setLabels((nextConfig?.labels || ['機能リクエスト', 'バグ修正', 'その他']).join(','));
        setDoneChannelId(nextConfig?.doneChannelId || '');
        setDescription(nextConfig?.description || DEFAULT_DESCRIPTION);
        setInstructions(nextConfig?.instructions || DEFAULT_INSTRUCTIONS);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : 'Request 設定の読み込みに失敗しました。';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadGuildData();
  }, [selectedGuildId]);

  const currentDoneChannelName = useMemo(() => {
    const targetChannelId = doneChannelId || config?.doneChannelId || '';
    return channels.find((channel) => channel.id === targetChannelId)?.name || (targetChannelId ? '不明なチャンネル' : '未設定');
  }, [doneChannelId, channels, config?.doneChannelId]);

  const saveConfig = async () => {
    if (!selectedGuildId) {
      addToast?.('サーバーを選択してください', 'warning');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/staff/requestmanager/${selectedGuildId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          categoryName,
          labels: labels.split(',').map((l) => l.trim()).filter(Boolean),
          doneChannelId: doneChannelId || null,
          description,
          instructions,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '設定の保存に失敗しました。');
      }

      setConfig(data.config || null);
      addToast?.('Request 設定を保存しました', 'success');
    } catch (saveError) {
      addToast?.(saveError instanceof Error ? saveError.message : '設定の保存に失敗しました。', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading && guilds.length === 0) {
    return <div className={styles.statePanel}>Request 管理ページを読み込んでいます...</div>;
  }

  if (error && guilds.length === 0) {
    return <div className={styles.statePanel}>{error}</div>;
  }

  return (
    <div className={styles.page}>
      <section className={styles.header}>
        <div className={styles.headerCopy}>
          <span className={styles.eyebrow}>Request Management</span>
          <h1>Request 管理</h1>
          <p>ユーザーからのリクエストを受け付けるための設定を管理します。カテゴリ名、ラベル、説明文などをカスタマイズできます。</p>
        </div>

        <div className={styles.headerActions}>
          <button className={styles.buttonGhost} onClick={() => navigate(returnTo)} type="button">
            <span className="material-icons">arrow_back</span>
            <span>戻る</span>
          </button>
          {selectedGuildId ? (
            <button className={styles.button} onClick={() => setSelectedGuildId(null)} type="button">
              <span className="material-icons">swap_horiz</span>
              <span>サーバー変更</span>
            </button>
          ) : null}
        </div>
      </section>

      {!selectedGuildId ? (
        <section className={styles.guildSelector}>
          <div className={styles.sectionHeader}>
            <h2>サーバーを選択</h2>
            <p>まずは Request 機能を管理したいサーバーを選んでください。</p>
          </div>
          <div className={styles.guildGrid}>
            {guilds.map((guild) => (
              <button
                key={guild.id}
                className={styles.guildCard}
                onClick={() => setSelectedGuildId(guild.id)}
                type="button"
              >
                <div className={styles.guildIdentity}>
                  {guild.icon ? (
                    <span className={styles.guildIcon}>
                      <img src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`} alt={guild.name} />
                    </span>
                  ) : (
                    <span className={styles.guildIconFallback}>{guild.name.charAt(0).toUpperCase()}</span>
                  )}
                  <div>
                    <strong>{guild.name}</strong>
                    <p className={styles.hint}>ID {guild.id}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className={styles.layout}>
          {loading ? <div className={styles.statePanel}>設定を読み込んでいます...</div> : null}
          {error ? <div className={styles.statePanel}>{error}</div> : null}

          <section className={styles.summaryGrid}>
            <div className={styles.infoCard}>
              <span className={styles.eyebrow}>Guild</span>
              <strong className={styles.summaryValue}>{selectedGuild?.name || selectedGuildId}</strong>
              <p className={styles.hint}>現在編集中のサーバーです。</p>
            </div>
            <div className={styles.infoCard}>
              <span className={styles.eyebrow}>Category</span>
              <strong className={styles.summaryValue}>{categoryName}</strong>
              <p className={styles.hint}>リクエストチャンネルを作成するカテゴリ名です。</p>
            </div>
            <div className={styles.infoCard}>
              <span className={styles.eyebrow}>Labels</span>
              <strong className={styles.summaryValue}>{labels.split(',').length}個</strong>
              <p className={styles.hint}>利用可能なラベルの数です。</p>
            </div>
            <div className={styles.infoCard}>
              <span className={styles.eyebrow}>Done Channel</span>
              <strong className={styles.summaryValue}>{currentDoneChannelName}</strong>
              <p className={styles.hint}>完了報告を投稿するチャンネルです。</p>
            </div>
          </section>

          <div className={styles.contentGrid}>
            <section className={styles.panelCard}>
              <div className={styles.sectionHeader}>
                <h2>基本設定</h2>
                <p>リクエスト機能の基本的な設定を行います。</p>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label htmlFor="request-category">カテゴリ名</label>
                  <input
                    id="request-category"
                    value={categoryName}
                    onChange={(event) => setCategoryName(event.target.value)}
                    placeholder="Request"
                  />
                  <p className={styles.hint}>リクエストチャンネルを作成するDiscordカテゴリの名前です。</p>
                </div>

                <div className={styles.field}>
                  <label htmlFor="request-labels">ラベル一覧</label>
                  <input
                    id="request-labels"
                    value={labels}
                    onChange={(event) => setLabels(event.target.value)}
                    placeholder="機能リクエスト,バグ修正,その他"
                  />
                  <p className={styles.hint}>カンマ区切りで最大20個まで設定できます。</p>
                </div>

                <div className={styles.field}>
                  <label htmlFor="request-done-channel">完了投稿先チャンネル</label>
                  <select
                    id="request-done-channel"
                    value={doneChannelId}
                    onChange={(event) => setDoneChannelId(event.target.value)}
                  >
                    <option value="">未設定</option>
                    {channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        #{channel.name}
                      </option>
                    ))}
                  </select>
                  <p className={styles.hint}>リクエストが完了したときの報告を投稿するチャンネルです。</p>
                </div>
              </div>

              <div className={styles.actionRow}>
                <button className={styles.buttonPrimary} disabled={saving} onClick={saveConfig} type="button">
                  <span className="material-icons">save</span>
                  <span>{saving ? '保存中...' : '設定を保存'}</span>
                </button>
              </div>
            </section>

            <section className={styles.panelCard}>
              <div className={styles.sectionHeader}>
                <h2>カスタム説明</h2>
                <p>リクエストパネルに表示される説明文や使い方を自由にカスタマイズできます。</p>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label htmlFor="request-description">パネル説明文</label>
                  <textarea
                    id="request-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={DEFAULT_DESCRIPTION}
                    rows={3}
                  />
                  <p className={styles.hint}>リクエストボタンの説明として表示されます。</p>
                </div>

                <div className={styles.field}>
                  <label htmlFor="request-instructions">使い方ガイド</label>
                  <textarea
                    id="request-instructions"
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    placeholder={DEFAULT_INSTRUCTIONS}
                    rows={5}
                  />
                  <p className={styles.hint}>ユーザーへの操作手順を記述できます。改行が反映されます。</p>
                </div>
              </div>
            </section>

            <aside className={styles.infoCard}>
              <div className={styles.sectionHeader}>
                <h3>現在の状態</h3>
                <p>保存済みの構成を確認できます。</p>
              </div>

              <div className={styles.infoList}>
                <div className={styles.infoItem}>
                  <span>カテゴリ名</span>
                  <strong>{config?.categoryName || '未保存'}</strong>
                </div>
                <div className={styles.infoItem}>
                  <span>ラベル数</span>
                  <strong>{config?.labels ? `${config.labels.length}個` : '未保存'}</strong>
                </div>
                <div className={styles.infoItem}>
                  <span>完了通知</span>
                  <strong>{config?.doneChannelId ? '設定済み' : '未設定'}</strong>
                </div>
                <div className={styles.infoItem}>
                  <span>カスタム説明</span>
                  <strong>{config?.description ? '設定済み' : '未設定'}</strong>
                </div>
              </div>

              <p className={styles.hint}>
                この設定は Core パネルの Request ボタンで使用されます。Core パネルから投稿してください。
              </p>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
};

export default RequestManagerPage;
