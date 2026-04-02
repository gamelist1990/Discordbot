import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppToast } from '../../../AppToastProvider';
import styles from './CorePanel.module.css';

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

type GuildRole = {
  id: string;
  name: string;
  color: number;
  position: number;
};

type CoreFeaturePanelKind = 'combined' | 'personality' | 'debate' | 'request';

type CorePanelConfig = {
  panelKind: CoreFeaturePanelKind;
  guildId: string;
  channelId: string;
  messageId: string | null;
  spectatorRoleId: string | null;
  requestDoneChannelId?: string | null;
  requestCategoryName?: string | null;
  requestLabels?: string[];
  requestStaffRoleId?: string | null;
  requestTrackingChannelId?: string | null;
  updatedBy: string;
  updatedAt: string;
};

const panelKindOptions: Array<{ value: CoreFeaturePanelKind; label: string; description: string }> = [
  { value: 'combined', label: '統合パネル', description: '性格診断・レスバ・リクエスト をまとめて投稿します。' },
  { value: 'personality', label: '性格診断だけ', description: '性格診断ボタンだけを投稿します。' },
  { value: 'debate', label: 'レスバだけ', description: 'レスバボタンだけを投稿します。' },
  { value: 'request', label: 'リクエストだけ', description: 'リクエストボタンだけを投稿します。' },
];

const CorePanelPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialGuildId = searchParams.get('guildId');
  const returnTo = searchParams.get('returnTo') || '/staff';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(initialGuildId);
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [roles, setRoles] = useState<GuildRole[]>([]);
  const [config, setConfig] = useState<CorePanelConfig | null>(null);
  const [panelUrl, setPanelUrl] = useState<string | null>(null);

  const [panelKind, setPanelKind] = useState<CoreFeaturePanelKind>('combined');
  const [channelId, setChannelId] = useState('');
  const [spectatorRoleId, setSpectatorRoleId] = useState('');
  const [requestDoneChannelId, setRequestDoneChannelId] = useState('');
  const [requestCategoryName, setRequestCategoryName] = useState('');
  const [requestLabels, setRequestLabels] = useState('');
  const [requestStaffRoleId, setRequestStaffRoleId] = useState('');
  const [requestTrackingChannelId, setRequestTrackingChannelId] = useState('');

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
  const panelKindMeta = useMemo(
    () => panelKindOptions.find((option) => option.value === panelKind) || panelKindOptions[0],
    [panelKind]
  );
  const currentChannelName = useMemo(() => {
    const activeChannelId = channelId || config?.channelId || '';
    return channels.find((channel) => channel.id === activeChannelId)?.name || '未設定';
  }, [channelId, channels, config?.channelId]);
  const currentRoleName = useMemo(() => {
    const roleId = spectatorRoleId || config?.spectatorRoleId || '';
    return roles.find((role) => role.id === roleId)?.name || (roleId ? '不明なロール' : '未設定');
  }, [config?.spectatorRoleId, roles, spectatorRoleId]);
  const currentRequestStaffRoleName = useMemo(() => {
    const roleId = requestStaffRoleId || config?.requestStaffRoleId || '';
    return roles.find((role) => role.id === roleId)?.name || (roleId ? '不明なロール' : '未設定');
  }, [config?.requestStaffRoleId, requestStaffRoleId, roles]);
  const savedDoneChannelDisplay = useMemo(() => {
    const doneChannelId = requestDoneChannelId || config?.requestDoneChannelId || '';
    if (!doneChannelId) {
      return '未設定';
    }
    const doneChannel = channels.find((channel) => channel.id === doneChannelId);
    return doneChannel?.name ? `#${doneChannel.name}` : doneChannelId;
  }, [channels, config?.requestDoneChannelId, requestDoneChannelId]);
  const currentRequestCategoryName = useMemo(
    () => requestCategoryName || config?.requestCategoryName || '未設定',
    [config?.requestCategoryName, requestCategoryName]
  );
  const currentRequestLabels = useMemo(
    () => requestLabels || (config?.requestLabels || []).join(',') || '未設定',
    [config?.requestLabels, requestLabels]
  );
  const savedTrackingChannelDisplay = useMemo(() => {
    const trackingChannelId = requestTrackingChannelId || config?.requestTrackingChannelId || '';
    if (!trackingChannelId) {
      return '未設定';
    }
    const trackingChannel = channels.find((channel) => channel.id === trackingChannelId);
    return trackingChannel?.name ? `#${trackingChannel.name}` : trackingChannelId;
  }, [channels, config?.requestTrackingChannelId, requestTrackingChannelId]);
  const usesRequestSettings = panelKind === 'combined' || panelKind === 'request';
  const usesSpectatorRole = panelKind === 'combined' || panelKind === 'debate';

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
      setPanelUrl(null);
      setChannelId('');
      setSpectatorRoleId('');
      setRequestDoneChannelId('');
      setRequestCategoryName('');
      setRequestLabels('');
      setRequestStaffRoleId('');
      setRequestTrackingChannelId('');
      setPanelKind('combined');
      return;
    }

    const loadGuildData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [configRes, channelsRes, rolesRes] = await Promise.all([
          fetch(`/api/staff/corepanel/${selectedGuildId}?panelKind=${panelKind}`, { credentials: 'include' }),
          fetch(`/api/staff/guilds/${selectedGuildId}/channels`, { credentials: 'include' }),
          fetch(`/api/staff/guilds/${selectedGuildId}/roles`, { credentials: 'include' }),
        ]);

        if (!configRes.ok || !channelsRes.ok || !rolesRes.ok) {
          throw new Error('Core パネル設定の読み込みに失敗しました。');
        }

        const [configData, channelsData, rolesData] = await Promise.all([
          configRes.json(),
          channelsRes.json(),
          rolesRes.json(),
        ]);

        const nextConfig = (configData.config || null) as CorePanelConfig | null;
        const nextChannels = ((channelsData.channels || []) as GuildChannel[]).filter((channel) => [0, 5, 15].includes(channel.type));
        const nextRoles = (rolesData.roles || []) as GuildRole[];

        setConfig(nextConfig);
        setPanelUrl(configData.panelUrl || null);
        setChannels(nextChannels);
        setRoles(nextRoles);
        setChannelId(nextConfig?.channelId || nextChannels[0]?.id || '');
        setSpectatorRoleId(nextConfig?.spectatorRoleId || '');
        setRequestDoneChannelId(nextConfig?.requestDoneChannelId || '');
        setRequestCategoryName(nextConfig?.requestCategoryName || 'Request');
        setRequestLabels((nextConfig?.requestLabels || []).join(','));
        setRequestStaffRoleId(nextConfig?.requestStaffRoleId || '');
        setRequestTrackingChannelId(nextConfig?.requestTrackingChannelId || '');
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : 'Core パネル設定の読み込みに失敗しました。';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadGuildData();
  }, [panelKind, selectedGuildId]);

  const saveConfig = async () => {
    if (!selectedGuildId || !channelId) {
      addToast?.('投稿先チャンネルを選択してください', 'warning');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/staff/corepanel/${selectedGuildId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          panelKind,
          channelId,
          spectatorRoleId: usesSpectatorRole ? spectatorRoleId || null : null,
          requestDoneChannelId: usesRequestSettings ? requestDoneChannelId || null : null,
          requestCategoryName: usesRequestSettings ? requestCategoryName.trim() || null : null,
          requestLabels: usesRequestSettings ? requestLabels.split(',').map((entry) => entry.trim().slice(0, 10)).filter(Boolean) : [],
          requestStaffRoleId: usesRequestSettings ? requestStaffRoleId || null : null,
          requestTrackingChannelId: usesRequestSettings ? requestTrackingChannelId || null : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '設定の保存に失敗しました。');
      }
      setConfig(data.config || null);
      setPanelUrl(data.panelUrl || null);
      addToast?.('Core パネル設定を保存しました', 'success');
    } catch (saveError) {
      addToast?.(saveError instanceof Error ? saveError.message : '設定の保存に失敗しました。', 'error');
    } finally {
      setSaving(false);
    }
  };

  const postPanel = async () => {
    if (!selectedGuildId || !channelId) {
      addToast?.('投稿先チャンネルを選択してください', 'warning');
      return;
    }

    setPosting(true);
    try {
      const response = await fetch(`/api/staff/corepanel/${selectedGuildId}/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          panelKind,
          channelId,
          spectatorRoleId: usesSpectatorRole ? spectatorRoleId || null : null,
          requestDoneChannelId: usesRequestSettings ? requestDoneChannelId || null : null,
          requestCategoryName: usesRequestSettings ? requestCategoryName.trim() || null : null,
          requestLabels: usesRequestSettings ? requestLabels.split(',').map((entry) => entry.trim().slice(0, 10)).filter(Boolean) : [],
          requestStaffRoleId: usesRequestSettings ? requestStaffRoleId || null : null,
          requestTrackingChannelId: usesRequestSettings ? requestTrackingChannelId || null : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'パネル投稿に失敗しました。');
      }
      setConfig(data.config || null);
      setPanelUrl(data.panelUrl || null);
      addToast?.('Core パネルを Discord に投稿しました', 'success');
    } catch (postError) {
      addToast?.(postError instanceof Error ? postError.message : 'パネル投稿に失敗しました。', 'error');
    } finally {
      setPosting(false);
    }
  };

  if (loading && guilds.length === 0) {
    return <div className={styles.loading}>Core 機能ページを読み込んでいます...</div>;
  }

  if (error && guilds.length === 0) {
    return <div className={styles.loading}>{error}</div>;
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <div className={styles.headerTitle}>
            <i className="material-icons">dashboard</i>
            <h1>Core 機能パネル管理</h1>
          </div>
          <button className={styles.backButton} onClick={() => navigate(returnTo)} type="button">
            <i className="material-icons">arrow_back</i>
            戻る
          </button>
        </div>
      </header>

      {!selectedGuildId ? (
        <div className={styles.guildSelector}>
          <h2>サーバーを選択</h2>
          {guilds.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="material-icons">visibility_off</i>
              <p>アクセス可能なサーバーがありません</p>
            </div>
          ) : (
            <div className={styles.guildGrid}>
              {guilds.map((guild) => (
                <button key={guild.id} className={styles.guildCard} onClick={() => setSelectedGuildId(guild.id)} type="button">
                  {guild.icon ? (
                    <img src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`} alt={guild.name} className={styles.guildIcon} />
                  ) : (
                    <div className={styles.guildIconFallback}>
                      <i className="material-icons">group</i>
                    </div>
                  )}
                  <span className={styles.guildName}>{guild.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className={styles.content}>
          {loading ? <div className={styles.loading}>設定を読み込んでいます...</div> : null}
          {error ? <div className={styles.emptyState}><p>{error}</p></div> : null}

          <div className={styles.toolbar}>
            <div className={styles.toolbarMeta}>
              <div className={styles.toolbarTitle}>{selectedGuild?.name || selectedGuildId}</div>
              <div className={styles.toolbarSub}>現在の種類: {panelKindMeta.label}</div>
            </div>
            <button className={styles.changeGuildButton} onClick={() => setSelectedGuildId(null)} type="button">
              <i className="material-icons">swap_horiz</i>
              サーバー変更
            </button>
          </div>

          <div className={styles.mainGrid}>
            <section className={styles.card}>
              <h2>パネル設定</h2>
              <p className={styles.hint}>{panelKindMeta.description}</p>

              <div className={styles.field}>
                <label htmlFor="corepanel-kind">パネル種類</label>
                <select id="corepanel-kind" value={panelKind} onChange={(event) => setPanelKind(event.target.value as CoreFeaturePanelKind)}>
                  {panelKindOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.field}>
                <label htmlFor="corepanel-channel">投稿チャンネル</label>
                <select id="corepanel-channel" value={channelId} onChange={(event) => setChannelId(event.target.value)}>
                  <option value="">チャンネルを選択</option>
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      #{channel.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.field}>
                <label htmlFor="corepanel-spectator-role">観戦ロール</label>
                <select
                  id="corepanel-spectator-role"
                  value={spectatorRoleId}
                  onChange={(event) => setSpectatorRoleId(event.target.value)}
                  disabled={!usesSpectatorRole}
                >
                  <option value="">未設定</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>

              {usesRequestSettings ? (
                <div className={styles.subsection}>
                  <div className={styles.subsectionHeader}>
                    <h3>Request 設定</h3>
                    <p className={styles.hint}>
                      {panelKind === 'combined' ? '統合パネル内の Request に適用されます。' : 'Request 専用パネルで使う設定です。'}
                    </p>
                  </div>

                  <div className={styles.field}>
                    <label htmlFor="corepanel-request-category">作成カテゴリ名</label>
                    <input
                      id="corepanel-request-category"
                      value={requestCategoryName}
                      onChange={(event) => setRequestCategoryName(event.target.value)}
                      placeholder="Request"
                    />
                  </div>

                  <div className={styles.field}>
                    <label htmlFor="corepanel-request-labels">ラベル設定</label>
                    <input
                      id="corepanel-request-labels"
                      value={requestLabels}
                      onChange={(event) => setRequestLabels(event.target.value)}
                      placeholder="未設定でも可。必要なら機能リクエスト,バグ修正,その他"
                    />
                    <p className={styles.hint}>未設定のままでも使えます。設定する場合はカンマ区切りで入力してください。</p>
                  </div>

                  <div className={styles.field}>
                    <label htmlFor="corepanel-request-staff-role">対応スタッフロール</label>
                    <select
                      id="corepanel-request-staff-role"
                      value={requestStaffRoleId}
                      onChange={(event) => setRequestStaffRoleId(event.target.value)}
                    >
                      <option value="">未設定</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.field}>
                    <label htmlFor="corepanel-request-done-channel">完了通知チャンネル</label>
                    <select
                      id="corepanel-request-done-channel"
                      value={requestDoneChannelId}
                      onChange={(event) => setRequestDoneChannelId(event.target.value)}
                    >
                      <option value="">未設定</option>
                      {channels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          #{channel.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.field}>
                    <label htmlFor="corepanel-request-tracking-channel">追跡一覧チャンネル</label>
                    <select
                      id="corepanel-request-tracking-channel"
                      value={requestTrackingChannelId}
                      onChange={(event) => setRequestTrackingChannelId(event.target.value)}
                    >
                      <option value="">未設定</option>
                      {channels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          #{channel.name}
                        </option>
                      ))}
                    </select>
                    <p className={styles.hint}>スタッフが Request 一覧を追跡する専用チャンネルです。各 Embed から元の Request に移動できます。</p>
                  </div>
                </div>
              ) : null}

              <div className={styles.actionRow}>
                <button className={styles.secondaryButton} disabled={saving || posting} onClick={saveConfig} type="button">
                  <i className="material-icons">save</i>
                  {saving ? '保存中...' : '設定を保存'}
                </button>
                <button className={styles.primaryButton} disabled={saving || posting} onClick={postPanel} type="button">
                  <i className="material-icons">send</i>
                  {posting ? '投稿中...' : config?.messageId ? 'パネルを更新' : 'パネルを投稿'}
                </button>
              </div>
            </section>

            <aside className={styles.card}>
              <h2>現在の状態</h2>
              <div className={styles.infoList}>
                <div className={styles.infoItem}>
                  <span>投稿先チャンネル</span>
                  <strong>#{currentChannelName}</strong>
                </div>
                <div className={styles.infoItem}>
                  <span>観戦ロール</span>
                  <strong>{usesSpectatorRole ? currentRoleName : '未使用'}</strong>
                </div>
                <div className={styles.infoItem}>
                  <span>Request カテゴリ</span>
                  <strong>{usesRequestSettings ? currentRequestCategoryName : '未使用'}</strong>
                </div>
                <div className={styles.infoItem}>
                  <span>Request ラベル</span>
                  <strong>{usesRequestSettings ? currentRequestLabels : '未使用'}</strong>
                </div>
                <div className={styles.infoItem}>
                  <span>対応スタッフロール</span>
                  <strong>{usesRequestSettings ? currentRequestStaffRoleName : '未使用'}</strong>
                </div>
                <div className={styles.infoItem}>
                  <span>完了通知チャンネル</span>
                  <strong>{usesRequestSettings ? savedDoneChannelDisplay : '未使用'}</strong>
                </div>
                <div className={styles.infoItem}>
                  <span>追跡一覧チャンネル</span>
                  <strong>{usesRequestSettings ? savedTrackingChannelDisplay : '未使用'}</strong>
                </div>
                <div className={styles.infoItem}>
                  <span>Discord 投稿</span>
                  <strong>{config?.messageId ? '投稿済み' : '未投稿'}</strong>
                </div>
              </div>

              {panelUrl ? (
                <a className={styles.linkButton} href={panelUrl} rel="noreferrer" target="_blank">
                  <i className="material-icons">open_in_new</i>
                  Discord のパネルを開く
                </a>
              ) : (
                <p className={styles.hint}>この種類のパネルはまだ投稿されていません。</p>
              )}
            </aside>
          </div>
        </div>
      )}
    </div>
  );
};

export default CorePanelPage;
