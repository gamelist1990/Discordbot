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
  staffRoleId: string | null;
  trackingChannelId: string | null;
  cooldownSeconds: number;
  description: string;
  instructions: string;
  updatedBy: string;
  updatedAt: string;
};
type GuildRole = {
  id: string;
  name: string;
  color: number;
  position: number;
};
type RequestItemSummary = {
  id: string;
  title: string;
  label: string;
  status: string;
  createdAt: string | null;
  channelId: string | null;
  exists: boolean;
  url: string | null;
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
  const [roles, setRoles] = useState<GuildRole[]>([]);
  const [items, setItems] = useState<RequestItemSummary[]>([]);
  const [config, setConfig] = useState<RequestConfig | null>(null);
  const [categoryName, setCategoryName] = useState('Request');
  const [labels, setLabels] = useState('機能リクエスト,バグ修正,その他');
  const [doneChannelId, setDoneChannelId] = useState('');
  const [staffRoleId, setStaffRoleId] = useState('');
  const [trackingChannelId, setTrackingChannelId] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(300);
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
      setRoles([]);
      setItems([]);
      setCategoryName('Request');
      setLabels('機能リクエスト,バグ修正,その他');
      setDoneChannelId('');
      setStaffRoleId('');
      setTrackingChannelId('');
      setCooldownSeconds(300);
      setDescription(DEFAULT_DESCRIPTION);
      setInstructions(DEFAULT_INSTRUCTIONS);
      return;
    }

    const loadGuildData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [configRes, channelsRes, rolesRes, itemsRes] = await Promise.all([
          fetch(`/api/staff/requestmanager/${selectedGuildId}`, { credentials: 'include' }),
          fetch(`/api/staff/guilds/${selectedGuildId}/channels`, { credentials: 'include' }),
          fetch(`/api/staff/guilds/${selectedGuildId}/roles`, { credentials: 'include' }),
          fetch(`/api/staff/requestmanager/${selectedGuildId}/items`, { credentials: 'include' }),
        ]);

        if (!configRes.ok || !channelsRes.ok || !rolesRes.ok || !itemsRes.ok) {
          throw new Error('Request 設定の読み込みに失敗しました。');
        }

        const [configData, channelsData, rolesData, itemsData] = await Promise.all([
          configRes.json(),
          channelsRes.json(),
          rolesRes.json(),
          itemsRes.json(),
        ]);

        const nextConfig = (configData.config || null) as RequestConfig | null;
        const nextChannels = ((channelsData.channels || []) as GuildChannel[]).filter((channel) =>
          [0, 5, 15].includes(channel.type)
        );
        const nextRoles = (rolesData.roles || []) as GuildRole[];
        const nextItems = (itemsData.items || []) as RequestItemSummary[];

        setConfig(nextConfig);
        setChannels(nextChannels);
        setRoles(nextRoles);
        setItems(nextItems);
        setCategoryName(nextConfig?.categoryName || 'Request');
        setLabels((nextConfig?.labels || ['機能リクエスト', 'バグ修正', 'その他']).join(','));
        setDoneChannelId(nextConfig?.doneChannelId || '');
        setStaffRoleId(nextConfig?.staffRoleId || '');
        setTrackingChannelId(nextConfig?.trackingChannelId || '');
        setCooldownSeconds(nextConfig?.cooldownSeconds || 300);
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
          labels: labels.split(',').map((l) => l.trim().slice(0, 10)).filter(Boolean),
          doneChannelId: doneChannelId || null,
          staffRoleId: staffRoleId || null,
          trackingChannelId: trackingChannelId || null,
          cooldownSeconds: Number.isFinite(cooldownSeconds) ? cooldownSeconds : 300,
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

  const cleanupMissingItems = async () => {
    if (!selectedGuildId) return;
    try {
      const response = await fetch(`/api/staff/requestmanager/${selectedGuildId}/items/cleanup-missing`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'クリーンアップに失敗しました。');
      }
      addToast?.(`存在しないパネルを ${data.removed || 0} 件削除しました`, 'success');
      const refresh = await fetch(`/api/staff/requestmanager/${selectedGuildId}/items`, { credentials: 'include' });
      if (refresh.ok) {
        const payload = await refresh.json();
        setItems((payload.items || []) as RequestItemSummary[]);
      }
    } catch (cleanupError) {
      addToast?.(cleanupError instanceof Error ? cleanupError.message : 'クリーンアップに失敗しました。', 'error');
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
            <div className={styles.infoCard}>
              <span className={styles.eyebrow}>Panels</span>
              <strong className={styles.summaryValue}>{items.length}件</strong>
              <p className={styles.hint}>保存済みのリクエストパネル一覧です。</p>
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
                  <p className={styles.hint}>カンマ区切りで最大20個まで設定できます（各ラベル最大10文字）。</p>
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
                <div className={styles.field}>
                  <label htmlFor="request-staff-role">対応スタッフロール</label>
                  <select id="request-staff-role" value={staffRoleId} onChange={(event) => setStaffRoleId(event.target.value)}>
                    <option value="">未設定</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                  <p className={styles.hint}>リクエストチャンネルを閲覧・対応できるスタッフロールです。</p>
                </div>
                <div className={styles.field}>
                  <label htmlFor="request-tracking-channel">追跡一覧チャンネル</label>
                  <select id="request-tracking-channel" value={trackingChannelId} onChange={(event) => setTrackingChannelId(event.target.value)}>
                    <option value="">未設定</option>
                    {channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        #{channel.name}
                      </option>
                    ))}
                  </select>
                  <p className={styles.hint}>スタッフ向けにリクエストURLを一覧表示するチャンネルです。</p>
                </div>
                <div className={styles.field}>
                  <label htmlFor="request-cooldown-seconds">クールダウン(秒)</label>
                  <input
                    id="request-cooldown-seconds"
                    type="number"
                    min={30}
                    max={86400}
                    value={cooldownSeconds}
                    onChange={(event) => setCooldownSeconds(Number(event.target.value))}
                  />
                  <p className={styles.hint}>同一ユーザーが連続投稿できないよう制限します。</p>
                </div>
              </div>

              <div className={styles.actionRow}>
                <button className={styles.buttonPrimary} disabled={saving} onClick={saveConfig} type="button">
                  <span className="material-icons">save</span>
                  <span>{saving ? '保存中...' : '設定を保存'}</span>
                </button>
                <button className={styles.buttonGhost} onClick={cleanupMissingItems} type="button">
                  <span className="material-icons">cleaning_services</span>
                  <span>存在しないパネルを削除</span>
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

            <section className={styles.panelCard}>
              <div className={styles.sectionHeader}>
                <h2>投稿済みパネル一覧</h2>
                <p>Discord上に存在するリクエストチャンネルを確認できます。</p>
              </div>
              <div className={styles.infoList}>
                {items.length === 0 ? (
                  <p className={styles.hint}>まだリクエストパネルはありません。</p>
                ) : (
                  items.map((item) => (
                    <div key={item.id} className={styles.infoItem}>
                      <span>#{item.id} / {item.status}</span>
                      <strong>{item.title || '無題'}</strong>
                      <p className={styles.hint}>{item.exists ? '存在中' : '削除済み'} / ラベル: {item.label || '未設定'}</p>
                      {item.url ? (
                        <a className={styles.linkButton} href={item.url} rel="noreferrer" target="_blank">
                          <span className="material-icons">open_in_new</span>
                          <span>Discordで開く</span>
                        </a>
                      ) : null}
                    </div>
                  ))
                )}
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
                  <span>スタッフロール</span>
                  <strong>{config?.staffRoleId ? '設定済み' : '未設定'}</strong>
                </div>
                <div className={styles.infoItem}>
                  <span>追跡チャンネル</span>
                  <strong>{config?.trackingChannelId ? '設定済み' : '未設定'}</strong>
                </div>
                <div className={styles.infoItem}>
                  <span>クールダウン</span>
                  <strong>{config?.cooldownSeconds || 300}秒</strong>
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
