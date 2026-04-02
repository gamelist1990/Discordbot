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

type CorePanelConfig = {
  panelKind: CoreFeaturePanelKind;
  guildId: string;
  channelId: string;
  messageId: string | null;
  spectatorRoleId: string | null;
  requestCategoryName?: string | null;
  requestLabels?: string[];
  requestDoneChannelId?: string | null;
  updatedBy: string;
  updatedAt: string;
};

type CoreFeaturePanelKind = 'combined' | 'personality' | 'debate' | 'request';

const panelKindOptions: Array<{ value: CoreFeaturePanelKind; label: string; description: string }> = [
  { value: 'combined', label: '統合パネル', description: '性格診断・レスバ・リクエスト をまとめて1枚に出します。' },
  { value: 'personality', label: '性格診断だけ', description: '性格診断ボタンだけを単独で投稿します。' },
  { value: 'debate', label: 'レスバだけ', description: 'レスバボタンだけを単独で投稿します。' },
  { value: 'request', label: 'リクエストだけ', description: 'リクエストボタンだけを単独で投稿します。' },
];

const featureCardsByKind: Record<CoreFeaturePanelKind, Array<{ title: string; description: string }>> = {
  combined: [
    {
      title: '性格診断',
      description: 'AI と 1 対 1 の面談を行い、傾向タグ付きで性格ロールを判定します。',
    },
    {
      title: 'レスバ',
      description: 'AI 対戦、論破王対戦、スタッフ限定の AI vs AI 観戦マッチまでこのパネルから起動できます。',
    },
    {
      title: '自動整理',
      description: '部屋は勝負決着後 1 時間で削除され、1 時間無操作でも自動終了します。',
    },
  ],
  personality: [
    {
      title: '性格診断',
      description: 'AI と 1 対 1 の面談だけを個別パネルとして出せます。',
    },
    {
      title: '週次クールダウン',
      description: '診断完了後は 1 週間のクールダウンが付き、傾向タグも表示されます。',
    },
  ],
  debate: [
    {
      title: 'レスバ',
      description: 'AI 対戦、論破王対戦、スタッフ限定の AI vs AI 観戦マッチを単独パネル化できます。',
    },
    {
      title: '観戦設定',
      description: '観戦ロールを付けた レスバ 専用パネルとして運用できます。',
    },
  ],
  request: [
    {
      title: 'リクエスト',
      description: '機能提案・改善案・バグ報告などを投稿できる専用パネルです。',
    },
    {
      title: '進捗管理',
      description: '投稿ごとに専用チャンネルが作成され、対応ステータスで管理できます。',
    },
  ],
};

const CorePanelPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialGuildId = searchParams.get('guildId');
  const returnTo = searchParams.get('returnTo') || '/staff';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(initialGuildId);
  const [panelKind, setPanelKind] = useState<CoreFeaturePanelKind>('combined');
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [roles, setRoles] = useState<GuildRole[]>([]);
  const [config, setConfig] = useState<CorePanelConfig | null>(null);
  const [panelUrl, setPanelUrl] = useState<string | null>(null);
  const [channelId, setChannelId] = useState('');
  const [spectatorRoleId, setSpectatorRoleId] = useState('');
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
  const panelKindMeta = useMemo(
    () => panelKindOptions.find((option) => option.value === panelKind) || panelKindOptions[0],
    [panelKind]
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
      setPanelUrl(null);
      setChannelId('');
      setSpectatorRoleId('');
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
        const nextChannels = ((channelsData.channels || []) as GuildChannel[]).filter((channel) =>
          [0, 5, 15].includes(channel.type)
        );
        const nextRoles = (rolesData.roles || []) as GuildRole[];

        setConfig(nextConfig);
        setPanelUrl(configData.panelUrl || null);
        setChannels(nextChannels);
        setRoles(nextRoles);
        setChannelId(nextConfig?.channelId || nextChannels[0]?.id || '');
        setSpectatorRoleId(nextConfig?.spectatorRoleId || '');
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : 'Core パネル設定の読み込みに失敗しました。';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadGuildData();
  }, [panelKind, selectedGuildId]);

  const currentChannelName = useMemo(() => {
    return channels.find((channel) => channel.id === (channelId || config?.channelId || ''))?.name || '未設定';
  }, [channelId, channels, config?.channelId]);

  const currentRoleName = useMemo(() => {
    const targetRoleId = spectatorRoleId || config?.spectatorRoleId || '';
    return roles.find((role) => role.id === targetRoleId)?.name || (targetRoleId ? '不明なロール' : '未設定');
  }, [spectatorRoleId, roles, config?.spectatorRoleId]);

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
          spectatorRoleId: panelKind === 'personality' || panelKind === 'request' ? null : spectatorRoleId || null,
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
          spectatorRoleId: panelKind === 'personality' || panelKind === 'request' ? null : spectatorRoleId || null,
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
    return <div className={styles.statePanel}>Core 機能ページを読み込んでいます...</div>;
  }

  if (error && guilds.length === 0) {
    return <div className={styles.statePanel}>{error}</div>;
  }

  return (
    <div className={styles.page}>
      <section className={styles.header}>
        <div className={styles.headerCopy}>
          <span className={styles.eyebrow}>Core Feature Group</span>
          <h1>Core 機能パネル</h1>
          <p>Core パネルで機能をまとめて管理し、統合パネルと機能別パネル（性格診断・レスバ・リクエスト）を投稿できます。</p>
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
            <p>まずは Core 機能パネルを管理したいサーバーを選んでください。</p>
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
              <span className={styles.eyebrow}>Panel</span>
              <strong className={styles.summaryValue}>{panelKindMeta.label}</strong>
              <p className={styles.hint}>いま設定中の投稿種類です。</p>
            </div>
            <div className={styles.infoCard}>
              <span className={styles.eyebrow}>Channel</span>
              <strong className={styles.summaryValue}>#{currentChannelName}</strong>
              <p className={styles.hint}>Core 機能パネルの投稿先です。</p>
            </div>
            <div className={styles.infoCard}>
              <span className={styles.eyebrow}>Spectator</span>
              <strong className={styles.summaryValue}>{panelKind === 'personality' || panelKind === 'request' ? '未使用' : currentRoleName}</strong>
              <p className={styles.hint}>レスバ系パネルで使う任意ロールです。</p>
            </div>
          </section>

          <div className={styles.contentGrid}>
            <section className={styles.panelCard}>
              <div className={styles.sectionHeader}>
                <h2>パネル設定</h2>
                <p>投稿種類ごとに別設定として保存でき、統合・性格診断・レスバ・リクエストを別々に投稿できます。</p>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label htmlFor="corepanel-kind">パネル種類</label>
                  <select
                    id="corepanel-kind"
                    value={panelKind}
                    onChange={(event) => setPanelKind(event.target.value as CoreFeaturePanelKind)}
                  >
                    {panelKindOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className={styles.hint}>{panelKindMeta.description}</p>
                </div>

                <div className={styles.field}>
                  <label htmlFor="corepanel-channel">投稿チャンネル</label>
                  <select
                    id="corepanel-channel"
                    value={channelId}
                    onChange={(event) => setChannelId(event.target.value)}
                  >
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
                    disabled={panelKind === 'personality' || panelKind === 'request'}
                  >
                    <option value="">未設定</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                  <p className={styles.hint}>
                    {panelKind === 'personality' || panelKind === 'request'
                      ? `${panelKind === 'personality' ? '性格診断' : 'リクエスト'}専用パネルでは観戦ロールは使いません。`
                      : '未設定なら一般向け表示だけになり、観戦専用ロールは付きません。'}
                  </p>
                </div>
              </div>

              <div className={styles.actionRow}>
                <button className={styles.button} disabled={saving || posting} onClick={saveConfig} type="button">
                  <span className="material-icons">save</span>
                  <span>{saving ? '保存中...' : `${panelKindMeta.label}設定を保存`}</span>
                </button>
                <button className={styles.buttonPrimary} disabled={saving || posting} onClick={postPanel} type="button">
                  <span className="material-icons">send</span>
                  <span>{posting ? '投稿中...' : config?.messageId ? `${panelKindMeta.label}を更新` : `${panelKindMeta.label}を投稿`}</span>
                </button>
              </div>
            </section>

            <aside className={styles.infoCard}>
              <div className={styles.sectionHeader}>
                <h3>現在の状態</h3>
                <p>保存済みの構成と、投稿済みメッセージの有無をここで確認できます。</p>
              </div>

              <div className={styles.infoList}>
                <div className={styles.infoItem}>
                  <span>保存済みチャンネル</span>
                  <strong>{config?.channelId ? `#${channels.find((channel) => channel.id === config.channelId)?.name || config.channelId}` : '未保存'}</strong>
                </div>
                <div className={styles.infoItem}>
                  <span>保存済み観戦ロール</span>
                  <strong>{panelKind === 'personality' || panelKind === 'request' ? '未使用' : config?.spectatorRoleId ? roles.find((role) => role.id === config.spectatorRoleId)?.name || config.spectatorRoleId : '未設定'}</strong>
                </div>
                <div className={styles.infoItem}>
                  <span>Discord 投稿</span>
                  <strong>{config?.messageId ? '投稿済み' : '未投稿'}</strong>
                </div>
              </div>

              {panelUrl ? (
                <a className={styles.linkButton} href={panelUrl} rel="noreferrer" target="_blank">
                  <span className="material-icons">open_in_new</span>
                  <span>Discord のパネルを開く</span>
                </a>
              ) : (
                <p className={styles.hint}>この種類のパネルはまだ Discord に投稿されていません。設定後に投稿してください。</p>
              )}
            </aside>
          </div>

          <section className={styles.panelCard}>
            <div className={styles.sectionHeader}>
              <h2>{panelKindMeta.label}に含まれる機能</h2>
              <p>種類ごとに別パネルとして出せるので、必要な機能だけを見せる運用ができます。</p>
            </div>
            <div className={styles.featureList}>
              {featureCardsByKind[panelKind].map((feature) => (
                <article key={feature.title} className={styles.featureItem}>
                  <strong>{feature.title}</strong>
                  <p>{feature.description}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default CorePanelPage;
