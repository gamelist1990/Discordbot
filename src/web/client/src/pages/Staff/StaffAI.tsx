import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppToast } from '../../AppToastProvider';
import ui from '../ManagementDashboard.module.css';

type Guild = { id: string; name: string };
type GuildChannel = { id: string; name: string; type: number; position: number };
type ChannelImport = {
  id: string; channelId: string; channelName: string; status: 'queued' | 'processing' | 'completed' | 'failed';
  messageCount: number; totalUsers: number; processedUsers: number; totalDays: number; processedDays: number;
  createdAt: string; updatedAt: string; error?: string;
};
type Metrics = {
  requests: number; inputTokens: number; outputTokens: number;
  totalTokens: number; generatedSeconds: number; cacheHitTokens: number; cacheInputTokens: number;
};
type Memory = {
  id: string; kind: 'daily' | 'user' | 'ai' | 'ai_channel'; guildId: string; userId?: string; day?: string;
  title: string; content: string; publicInterests?: string; evidenceCount: number;
  updatedAt: string; editedByStaff?: boolean;
};
type PersonalitySettings = {
  learningEnabled: boolean;
  tone: 'auto' | 'casual' | 'balanced' | 'polite';
  humor: 'auto' | 'low' | 'medium' | 'high';
  emoji: 'auto' | 'low' | 'medium' | 'high';
  verbosity: 'auto' | 'brief' | 'normal' | 'detailed';
  customInstructions: string;
};
type Personality = PersonalitySettings & {
  learnedSummary: string; learnedMessageCount: number; learningRevision: number; updatedAt: string;
};
const defaultPersonality: Personality = {
  learningEnabled: true, tone: 'auto', humor: 'auto', emoji: 'auto', verbosity: 'auto',
  customInstructions: '', learnedSummary: '', learnedMessageCount: 0, learningRevision: 0, updatedAt: '',
};
const zero: Metrics = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0,
  generatedSeconds: 0, cacheHitTokens: 0, cacheInputTokens: 0 };
const fmt = (n: number) => {
  const value = Math.round(n);
  const absolute = Math.abs(value);
  const compact = (scaled: number, suffix: 'K' | 'M') =>
    scaled.toFixed(2).replace(/\.?0+$/, '') + suffix;
  if (absolute >= 999_995) return compact(value / 1_000_000, 'M');
  if (absolute >= 1_000) return compact(value / 1_000, 'K');
  return value.toLocaleString('ja-JP');
};
const icon = (value: string, className = '') =>
  <span className={`material-icons ${className || ui.icon}`} aria-hidden="true">{value}</span>;

async function readJson(url: string, options?: RequestInit) {
  const r = await fetch(url, { credentials: 'include', cache: 'no-store', ...options });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

const StaffAIPage: React.FC = () => {
  const { addToast } = useAppToast();
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [guildId, setGuildId] = useState('');
  const selectedGuildRef = useRef(guildId);
  selectedGuildRef.current = guildId;
  const [metrics, setMetrics] = useState<Metrics>(zero);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [channelImports, setChannelImports] = useState<ChannelImport[]>([]);
  const [personality, setPersonality] = useState<Personality>(defaultPersonality);
  const [personalityDraft, setPersonalityDraft] = useState<PersonalitySettings>(defaultPersonality);
  const [personalityDirty, setPersonalityDirty] = useState(false);
  const personalityDirtyRef = useRef(false);
  const [loadingGuilds, setLoadingGuilds] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [personalityBusy, setPersonalityBusy] = useState(false);
  const [channelImportBusy, setChannelImportBusy] = useState(false);
  const [resetPersonalityConfirm, setResetPersonalityConfirm] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tab, setTab] = useState<'daily' | 'user' | 'ai' | 'ai_channel'>('daily');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<Memory | 'all' | null>(null);
  const [confirmation, setConfirmation] = useState('');

  const updatePersonalityDraft = (next: PersonalitySettings) => {
    personalityDirtyRef.current = true;
    setPersonalityDirty(true);
    setPersonalityDraft(next);
  };

  useEffect(() => {
    let active = true;
    void readJson('/api/staff/guilds')
      .then(data => {
        if (!active) return;
        const list = (data.guilds || []) as Guild[];
        setGuilds(list);
        setGuildId(list[0]?.id ?? '');
      })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'サーバー一覧の取得に失敗しました'); })
      .finally(() => { if (active) setLoadingGuilds(false); });
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async (selectedGuild: string, showLoading = false) => {
    if (!selectedGuild) return;
    if (showLoading) setLoading(true);
    try {
      const [data, importData] = await Promise.all([
        readJson(`/api/staff/ai/${selectedGuild}`),
        readJson(`/api/staff/ai/${selectedGuild}/memories/channel-imports`),
      ]);
      if (selectedGuild !== selectedGuildRef.current) return;
      setMetrics(data.metrics ?? zero);
      setMemories(data.memories ?? []);
      setChannelImports(importData.imports ?? []);
      const nextPersonality = data.personality ?? defaultPersonality;
      setPersonality(nextPersonality);
      if (showLoading || !personalityDirtyRef.current) {
        personalityDirtyRef.current = false;
        setPersonalityDirty(false);
        setPersonalityDraft({
          learningEnabled: nextPersonality.learningEnabled,
          tone: nextPersonality.tone,
          humor: nextPersonality.humor,
          emoji: nextPersonality.emoji,
          verbosity: nextPersonality.verbosity,
          customInstructions: nextPersonality.customInstructions,
        });
      }
      setLastUpdated(new Date());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'データの取得に失敗しました');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    if (!guildId) { setChannels([]); setSelectedChannelId(''); return; }
    let active = true;
    void readJson(`/api/staff/ai/${guildId}/channels`)
      .then(data => {
        if (!active || guildId !== selectedGuildRef.current) return;
        const next = (data.channels || []) as GuildChannel[];
        setChannels(next);
        setSelectedChannelId(current => next.some(channel => channel.id === current) ? current : next[0]?.id || '');
      })
      .catch(error => {
        if (active) setError(error instanceof Error ? error.message : 'チャンネル一覧を取得できませんでした');
      });
    return () => { active = false; };
  }, [guildId]);

  const savePersonality = async () => {
    const selectedGuild = guildId;
    if (!selectedGuild || personalityBusy) return;
    setPersonalityBusy(true);
    try {
      const data = await readJson(`/api/staff/ai/${selectedGuild}/personality`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(personalityDraft),
      });
      if (selectedGuild === selectedGuildRef.current) {
        const next = data.personality as Personality;
        setPersonality(next);
        personalityDirtyRef.current = false; setPersonalityDirty(false);
        setPersonalityDraft({
          learningEnabled: next.learningEnabled, tone: next.tone, humor: next.humor,
          emoji: next.emoji, verbosity: next.verbosity, customInstructions: next.customInstructions,
        });
        addToast('AIの話し方を保存しました', 'success');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AIの話し方を保存できませんでした');
      addToast('AIの話し方を保存できませんでした', 'error');
    } finally { setPersonalityBusy(false); }
  };

  const resetPersonality = async () => {
    const selectedGuild = guildId;
    if (!selectedGuild || personalityBusy) return;
    setPersonalityBusy(true);
    try {
      const data = await readJson(`/api/staff/ai/${selectedGuild}/personality/reset`, { method: 'POST' });
      if (selectedGuild === selectedGuildRef.current) {
        const next = data.personality as Personality;
        setPersonality(next);
        personalityDirtyRef.current = false; setPersonalityDirty(false);
        setPersonalityDraft({
          learningEnabled: next.learningEnabled, tone: next.tone, humor: next.humor,
          emoji: next.emoji, verbosity: next.verbosity, customInstructions: next.customInstructions,
        });
        setResetPersonalityConfirm(false);
        addToast('AIの性格設定を初期状態に戻しました', 'success');
        await refresh(selectedGuild);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AIの性格設定を初期化できませんでした');
      addToast('AIの性格設定を初期化できませんでした', 'error');
    } finally { setPersonalityBusy(false); }
  };

  useEffect(() => {
    if (!guildId) return;
    setMetrics(zero); setMemories([]); setEditing(null); setSearch(''); setLastUpdated(null);
    personalityDirtyRef.current = false; setPersonalityDirty(false);
    void refresh(guildId, true);
    const timer = window.setInterval(() => void refresh(guildId), 30_000);
    return () => window.clearInterval(timer);
  }, [guildId, refresh]);

  const hasActiveChannelImport = channelImports.some(job => job.status === 'queued' || job.status === 'processing');
  useEffect(() => {
    if (!guildId || !hasActiveChannelImport) return;
    let wasActive = true;
    const poll = () => {
      const selectedGuild = guildId;
      void readJson(`/api/staff/ai/${selectedGuild}/memories/channel-imports`)
        .then(data => {
          if (selectedGuild !== selectedGuildRef.current) return;
          const next = (data.imports || []) as ChannelImport[];
          const stillActive = next.some(job => job.status === 'queued' || job.status === 'processing');
          setChannelImports(next);
          if (wasActive && !stillActive) void refresh(selectedGuild);
          wasActive = stillActive;
        }).catch(() => undefined);
    };
    const timer = window.setInterval(poll, 3000);
    return () => window.clearInterval(timer);
  }, [guildId, hasActiveChannelImport, refresh]);

  const startChannelImport = async () => {
    if (!guildId || !selectedChannelId || channelImportBusy) return;
    setChannelImportBusy(true);
    try {
      const data = await readJson(`/api/staff/ai/${guildId}/memories/import-channel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: selectedChannelId }),
      });
      const job = data.job as ChannelImport;
      setChannelImports(current => [...current.filter(item => item.id !== job.id), job]);
      addToast(job.status === 'completed' ? 'このチャンネルの履歴は取り込み済みです' : '履歴をバックグラウンドで取り込みます', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '履歴を取り込めませんでした';
      setError(message); addToast(message, 'error');
    } finally { setChannelImportBusy(false); }
  };

  const save = async (item: Memory) => {
    if (!draft.trim() || busy || draft.length > 6000) return;
    setBusy(true);
    try {
      await readJson(`/api/staff/ai/${guildId}/memories/${encodeURIComponent(item.id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft.trim() }),
      });
      setEditing(null);
      addToast('メモリーを保存しました', 'success');
      await refresh(guildId);
    } catch (e) { setError(String(e)); addToast('保存に失敗しました', 'error'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!deleting || busy || (deleting === 'all' && confirmation !== 'すべて削除')) return;
    const target = deleting;
    setBusy(true);
    try {
      await readJson(`/api/staff/ai/${guildId}/memories${target === 'all' ? '' : '/' + encodeURIComponent(target.id)}`, {
        method: 'DELETE',
      });
      setDeleting(null); setConfirmation(''); setEditing(null);
      addToast(target === 'all' ? 'メモリーをすべて削除しました' : 'メモリーを削除しました', 'success');
      await refresh(guildId);
    } catch (e) { setError(String(e)); addToast('削除に失敗しました', 'error'); }
    finally { setBusy(false); }
  };

  const filtered = useMemo(() => memories
    .filter(item => item.kind === tab && [item.title, item.content, item.userId || '', item.day || '']
      .join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [memories, search, tab]);
  const counts = useMemo(() => ({
    daily: memories.filter(item => item.kind === 'daily').length,
    user: memories.filter(item => item.kind === 'user').length,
    ai: memories.filter(item => item.kind === 'ai').length,
    ai_channel: memories.filter(item => item.kind === 'ai_channel').length,
  }), [memories]);
  const speed = metrics.generatedSeconds > 0 ? metrics.outputTokens / metrics.generatedSeconds : null;
  const cache = metrics.cacheInputTokens > 0 ? metrics.cacheHitTokens / metrics.cacheInputTokens * 100 : null;
  const selected = guilds.find(g => g.id === guildId);
  const selectedChannelImport = [...channelImports].reverse().find(job => job.channelId === selectedChannelId);
  const selectedChannelImported = selectedChannelImport?.status === 'completed' && selectedChannelImport.totalUsers > 0;
  const channelImportJobsForSelectedChannel = channelImports.filter(job => job.channelId === selectedChannelId).slice(-1);

  return <div className={ui.page}>
    <header className={ui.hero}>
      <div>
        <Link to="/staff" className={ui.muted}>{icon('arrow_back')} スタッフ運用に戻る</Link>
        <div style={{ marginTop: 14 }}><span className={ui.eyebrow}>{icon('auto_awesome')} AI Operations</span></div>
        <h1>Staff AI</h1>
        <p>会話の利用状況、AI自身の経験、日々の振り返りやプロフィールをまとめて管理。</p>
      </div>
      <div className={ui.heroActions}>
        <label className={ui.label}>対象サーバー
          <select className={ui.select} aria-label="管理対象サーバー" value={guildId}
            onChange={e => setGuildId(e.target.value)} disabled={loadingGuilds}>
            {!guildId && <option value="">サーバーを選択</option>}
            {guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <button type="button" className={`${ui.button} ${ui.serverRefreshButton}`} onClick={() => void refresh(guildId, true)} disabled={loading || !guildId}>
          {icon('refresh')} {loading ? '更新中…' : '更新'}
        </button>
      </div>
    </header>

    {error && <div className={ui.error} role="alert">{icon('error_outline')} <span>{error}</span></div>}
    {loadingGuilds ? <div className={ui.state} role="status">{icon('hourglass_top')}<p>サーバー情報を読み込んでいます…</p></div>
      : !guildId ? <div className={ui.state}>{icon('dns')}<h3>管理できるサーバーがありません</h3><p>Staff権限のあるサーバーでログインしてください。</p></div>
        : <>
          <section aria-label="Staff AIの累計利用統計">
            <div className={ui.sectionHeader} style={{ padding: '0 0 15px', borderBottom: 0 }}>
              <div><h2>利用状況</h2><p>{selected?.name || 'サーバー'} の累計統計</p></div>
              <span className={ui.badge}>{icon('schedule')} {lastUpdated ? `更新 ${lastUpdated.toLocaleTimeString('ja-JP', {hour:'2-digit',minute:'2-digit'})}` : '集計中'}</span>
            </div>
            <div className={ui.metrics}>
              {[
                { label: '総トークン', value: fmt(metrics.totalTokens), meta: `入力 ${fmt(metrics.inputTokens)} / 出力 ${fmt(metrics.outputTokens)}`, pict: 'analytics' },
                { label: '生成速度', value: speed === null ? '—' : speed.toFixed(1), suffix: speed === null ? '' : 'tok/s', meta: '出力トークン数 ÷ 生成時間', pict: 'speed' },
                { label: 'KVヒット率', value: cache === null ? '—' : cache.toFixed(1) + '%', meta: cache === null ? '取得可能なヒット統計はありません' : `${fmt(metrics.cacheHitTokens)} / ${fmt(metrics.cacheInputTokens)} トークン`, pict: 'memory', percent: cache },
                { label: 'リクエスト数', value: fmt(metrics.requests), meta: 'この機能の導入以降', pict: 'forum' },
              ].map(m => <div className={ui.metric} key={m.label}>
                <div className={ui.metricTop}><span className={ui.metricLabel}>{m.label}</span><span className={ui.metricIcon}>{icon(m.pict)}</span></div>
                <strong className={ui.metricValue}>{m.value} {m.suffix && <small>{m.suffix}</small>}</strong>
                {'percent' in m && m.percent !== null && <div className={ui.track}><i className={ui.trackFill} style={{ width: Math.min(100, Math.max(0,m.percent || 0)) + '%' }} /></div>}
                <span className={ui.metricMeta}>{m.meta}</span>
              </div>)}
            </div>
          </section>

          <section className={ui.panel} aria-labelledby="staff-ai-personality-title">
            <div className={ui.sectionHeader}>
              <div>
                <span className={ui.eyebrow}>{icon('psychology')} AIChannelの学習 / 共通の話し方</span>
                <h2 id="staff-ai-personality-title" style={{ marginTop: 10 }}>サーバーになじむAI</h2>
                <p>口調・ユーモア・絵文字・回答の詳しさ・追加調整はAIChannelと /staff ai で共通です。サーバーの雰囲気はAIChannelの会話から学び、その傾向も両方の返答に反映します。会話の学習元とメモリーは機能ごとに分けて管理します。</p>
              </div>
              <span className={`${ui.badge} ${personalityDraft.learningEnabled ? ui.badgeSuccess : ui.badgeWarn}`}>
                {icon(personalityDraft.learningEnabled ? 'auto_awesome' : 'pause_circle')}
                {personalityDraft.learningEnabled ? 'AIChannelで学習中' : 'AIChannelの自動学習停止中'}
              </span>
            </div>
            <div className={ui.personalityBody}>
              <div className={ui.personalityGrid}>
                <label className={ui.label}>基本の口調
                  <select className={ui.select} value={personalityDraft.tone} onChange={e => updatePersonalityDraft({ ...personalityDraft, tone: e.target.value as PersonalitySettings['tone'] })}>
                    <option value="auto">サーバーに合わせる</option><option value="casual">親しみやすく</option>
                    <option value="balanced">自然で中立</option><option value="polite">丁寧に</option>
                  </select>
                </label>
                <label className={ui.label}>ユーモア
                  <select className={ui.select} value={personalityDraft.humor} onChange={e => updatePersonalityDraft({ ...personalityDraft, humor: e.target.value as PersonalitySettings['humor'] })}>
                    <option value="auto">学習に合わせる</option><option value="low">控えめ</option>
                    <option value="medium">ほどよく</option><option value="high">多め</option>
                  </select>
                </label>
                <label className={ui.label}>絵文字
                  <select className={ui.select} value={personalityDraft.emoji} onChange={e => updatePersonalityDraft({ ...personalityDraft, emoji: e.target.value as PersonalitySettings['emoji'] })}>
                    <option value="auto">学習に合わせる</option><option value="low">控えめ</option>
                    <option value="medium">ほどよく</option><option value="high">多め</option>
                  </select>
                </label>
                <label className={ui.label}>回答の詳しさ
                  <select className={ui.select} value={personalityDraft.verbosity} onChange={e => updatePersonalityDraft({ ...personalityDraft, verbosity: e.target.value as PersonalitySettings['verbosity'] })}>
                    <option value="auto">会話に合わせる</option><option value="brief">短く</option>
                    <option value="normal">標準</option><option value="detailed">詳しく</option>
                  </select>
                </label>
              </div>
              <label className={ui.label}>Staffからの追加調整
                <textarea className={ui.textarea} maxLength={1200} rows={3} value={personalityDraft.customInstructions}
                  placeholder="例: Minecraftの話題では少しくだけた口調にする。結論を先に伝える。"
                  onChange={e => updatePersonalityDraft({ ...personalityDraft, customInstructions: e.target.value })} />
                <span className={ui.muted}>{personalityDraft.customInstructions.length} / 1200文字</span>
              </label>
              <div className={ui.personalityInsight}>
                <strong>{icon('auto_awesome')} AIChannelで学んだサーバーの雰囲気</strong>
                <p>{personality.learnedSummary || 'まだ十分な傾向はありません。AIChannelで会話が増えると、複数人に共通する話題や口調だけを少しずつ学びます。'}</p>
                <span className={ui.muted}>AIChannelで観測した発言: {fmt(personality.learnedMessageCount)} 件</span>
              </div>
              <div className={ui.personalityFooter}>
                <label className={ui.personalityToggle}>
                  <input type="checkbox" checked={personalityDraft.learningEnabled}
                    onChange={e => updatePersonalityDraft({ ...personalityDraft, learningEnabled: e.target.checked })} />
                  AIChannelの会話から自動で学ぶ
                </label>
                <div className={ui.personalityActions}>
                  <button type="button" className={ui.button} disabled={personalityBusy} onClick={() => setResetPersonalityConfirm(true)}>
                    {icon('restart_alt')} 初期状態に戻す
                  </button>
                  <button type="button" className={ui.buttonPrimary} disabled={personalityBusy || !personalityDirty} onClick={() => void savePersonality()}>
                    {icon('save')} {personalityBusy ? '保存中…' : '話し方を保存'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className={ui.panel} aria-labelledby="staff-ai-memories-title">
            <div className={ui.sectionHeader}>
              <div><span className={ui.eyebrow}>Memory workspace</span><h2 id="staff-ai-memories-title" style={{ marginTop: 10 }}>メモリーライブラリ</h2>
                <p>選んだチャンネルの直近15日分から参加者全員のプロフィールと日次記録を初期作成し、その後は/staff aiの会話やAI自身の経験もバックグラウンドで蓄積します。口調設定はAIChannelと共通で、記憶データは用途ごとに分けて保存します。</p></div>
              <button type="button" className={ui.buttonDanger} disabled={busy || hasActiveChannelImport || (!memories.length && !personality.learnedSummary)} onClick={() => { setDeleting('all'); setConfirmation(''); }}>
                {icon('delete_outline')} 全件削除
              </button>
            </div>
            <div className={ui.toolbar}>
              <div className={ui.tabs} role="tablist" aria-label="メモリー種別">
                <button role="tab" aria-selected={tab === 'daily'} type="button" className={`${ui.tab} ${tab === 'daily' ? ui.tabActive : ''}`} onClick={() => setTab('daily')}>
                  日次ダイジェスト <small>{counts.daily}</small>
                </button>
                <button role="tab" aria-selected={tab === 'user'} type="button" className={`${ui.tab} ${tab === 'user' ? ui.tabActive : ''}`} onClick={() => setTab('user')}>
                  ユーザー別 <small>{counts.user}</small>
                </button>
                <button role="tab" aria-selected={tab === 'ai'} type="button" className={`${ui.tab} ${tab === 'ai' ? ui.tabActive : ''}`} onClick={() => setTab('ai')}>
                  Staff AI自身 <small>{counts.ai}</small>
                </button>
                <button role="tab" aria-selected={tab === 'ai_channel'} type="button" className={`${ui.tab} ${tab === 'ai_channel' ? ui.tabActive : ''}`} onClick={() => setTab('ai_channel')}>
                  AIChannel自身 <small>{counts.ai_channel}</small>
                </button>
              </div>
              <label className={ui.searchWrap}>{icon('search')}<input aria-label="メモリー検索" placeholder="タイトル・本文を検索" value={search} onChange={e => setSearch(e.target.value)} /></label>
              <span className={ui.muted}>{filtered.length} 件表示</span>
            </div>
            {tab === 'user' && !search && <div className={ui.panelBody}>
              <div className={ui.personalityInsight}>
                <strong>{icon('history')} チャンネル履歴からプロフィールを初期作成</strong>
                <p>{counts.user === 0 ? 'チャンネルを選ぶと、過去15日分の発言から参加ユーザー全員の興味・活動・繰り返し見られる話し方を初期作成します。' : '別チャンネルの会話を追加して、参加者全員のプロフィールを補強できます。'}発言内の命令は実行せず、観測できた内容だけを記録します。取り込みと要約はAIへのリクエストを優先して、何も処理していない時間に進みます。</p>
                <div className={ui.channelImportGrid}>
                  <label className={ui.label}>会話履歴を読むチャンネル
                    <select className={ui.select} value={selectedChannelId} onChange={event => setSelectedChannelId(event.target.value)} disabled={!channels.length || channelImportBusy}>
                      {!channels.length && <option value="">利用できるテキストチャンネルがありません</option>}
                      {channels.map(channel => <option value={channel.id} key={channel.id}>#{channel.name}</option>)}
                    </select>
                  </label>
                  <div className={ui.label}>
                    <span>取り込み範囲</span><span className={ui.muted}>過去15日 / 最大5,000件</span>
                    <button type="button" className={ui.buttonPrimary} style={{ marginTop: 8, width: 'fit-content' }}
                      disabled={!selectedChannelId || channelImportBusy || hasActiveChannelImport || selectedChannelImported} onClick={() => void startChannelImport()}>
                      {icon('auto_awesome')} {channelImportBusy ? '登録中…' : selectedChannelImported ? 'このチャンネルは取り込み済み' : counts.user === 0 ? '初期メモリーを作成' : '履歴からプロフィールを追加'}
                    </button>
                  </div>
                </div>
                {channelImportJobsForSelectedChannel.map(job => <p className={ui.muted} key={job.id} style={{ marginTop: 12 }}>
                  {job.status === 'queued' ? '待機中：AIリクエストが落ち着いてから開始します。' : job.status === 'processing'
                    ? `作成中：発言 ${fmt(job.messageCount)} 件 / 日次 ${job.processedDays}・${job.totalDays} 日 / ユーザー ${job.processedUsers}・${job.totalUsers} 人`
                    : job.status === 'failed' ? `失敗：${job.error || '履歴を読み込めませんでした'}`
                      : `完了：発言 ${fmt(job.messageCount)} 件から ${job.totalUsers} 人分を確認しました。`}
                </p>)}
              </div>
            </div>}
            {loading ? <div className={ui.panelBody}><div className={ui.skeleton}/></div>
              : filtered.length ? <div className={ui.list} role="tabpanel">
                {filtered.map(item => <article className={ui.listItem} key={item.id}>
                  <div>
                    <h3 className={ui.listTitle}>{item.title}</h3>
                    <div className={ui.listMeta}>
                      <span>{item.kind === 'ai' ? 'Staff AI自身の経験' : item.kind === 'ai_channel' ? 'AIChannel自身の経験' : item.day || (item.userId ? 'User ' + item.userId : '')}</span>
                      {item.kind === 'ai_channel' ? <span>AIChannel専用メモリー</span> : item.sourceChannelName && <span>#{item.sourceChannelName} の履歴</span>}
                      <span>{fmt(item.evidenceCount)} 件の会話</span>
                      <span>更新 {new Date(item.updatedAt).toLocaleDateString('ja-JP')}</span>
                      {item.editedByStaff && <span className={`${ui.badge} ${ui.badgeSuccess}`}>Staff編集済み</span>}
                    </div>
                    {editing === item.id ? <>
                      <label className={ui.label} style={{ marginTop: 15 }}>メモリー本文
                        <textarea className={ui.textarea} maxLength={6000} value={draft} rows={7} onChange={e => setDraft(e.target.value)} />
                      </label>
                      <div className={ui.editorActions}>
                        <span className={ui.muted} style={{ marginRight: 'auto', alignSelf: 'center' }}>{draft.length} / 6000文字</span>
                        <button type="button" className={ui.button} onClick={() => setEditing(null)}>キャンセル</button>
                        <button type="button" className={ui.buttonPrimary} disabled={busy || !draft.trim()} onClick={() => void save(item)}>{icon('save')} 保存</button>
                      </div>
                    </> : <>
                      <p className={ui.listBody}>{item.content}</p>
                      {item.kind === 'user' && item.publicInterests && <p className={ui.muted} style={{ marginTop: 12 }}>
                        {icon('public')} 公開可能な趣味: {item.publicInterests}
                      </p>}
                    </>}
                  </div>
                  <div className={ui.listActions}>
                    <button className={ui.button} type="button" disabled={busy || editing === item.id}
                      onClick={() => { setEditing(item.id); setDraft(item.content); }}>{icon('edit')} 編集</button>
                    <button className={ui.buttonDanger} type="button" disabled={busy} onClick={() => { setDeleting(item); setConfirmation(''); }} aria-label={item.title + 'を削除'}>{icon('delete_outline')}</button>
                  </div>
                </article>)}
              </div> : <div className={ui.emptyInner}>
                <div className={ui.emptyIcon}>{icon(search ? 'search_off' : tab === 'daily' ? 'event_note' : tab === 'user' ? 'person_search' : 'psychology')}</div>
                <h3>{search ? '一致するメモリーがありません' : 'まだメモリーがありません'}</h3>
                <p>{search ? '検索条件を変えてみてください。' : tab === 'daily' ? 'チャンネル履歴や/staff aiの会話から、日々の振り返りをバックグラウンドで作成します。' : tab === 'ai' ? '/staff aiでの具体的な相談、共同作業、問題解決、約束や学びを記録します。' : tab === 'ai_channel' ? 'AIChannelで実際に経験した相談や作業を、AIChannel専用の経験として記録します。' : 'チャンネル履歴から参加者全員のプロフィールを初期作成できます。その後は/staff aiで話したユーザーのプロフィールも更新されます。'}</p>
              </div>}
          </section>
          <div className={ui.notice}>{icon('verified_user')} <div><strong style={{ color: 'var(--app-ink)' }}>メモリーの取り扱い</strong><p>メモリーはサーバーごとに分離して保存します。初期プロフィールはStaffが選んだチャンネルの履歴から参加者全員について作ります。興味・活動・話し方は会話で観測できる範囲に限り、私的情報や性格診断は保存しません。AIChannelとStaff AIは共通の話し方設定を使い、会話・経験メモリーは別に管理します。</p></div></div>
        </>}

    {deleting && <div className={ui.modalBackdrop} role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setDeleting(null); }}>
      <div className={ui.dialog} role="alertdialog" aria-modal="true" aria-labelledby="staff-ai-delete-title" aria-describedby="staff-ai-delete-description">
        <span className={ui.eyebrow}>{icon('warning_amber')} 削除の確認</span>
        <h2 id="staff-ai-delete-title">{deleting === 'all' ? 'すべてのメモリーを削除しますか？' : 'このメモリーを削除しますか？'}</h2>
        <p id="staff-ai-delete-description">{deleting === 'all' ? `${memories.length} 件の記憶と、学習したサーバーの雰囲気を削除します。Staffが設定した口調は残ります。この操作は元に戻せません。` : `「${deleting.title}」を削除します。この操作は元に戻せません。`}</p>
        {deleting === 'all' && <label className={ui.label}>確認のため「すべて削除」と入力
          <input className={ui.input} autoFocus value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder="すべて削除" />
        </label>}
        <div className={ui.dialogActions}>
          <button className={ui.button} type="button" disabled={busy} onClick={() => setDeleting(null)}>キャンセル</button>
          <button className={ui.buttonDanger} type="button" disabled={busy || (deleting === 'all' && (confirmation !== 'すべて削除' || hasActiveChannelImport))} onClick={() => void remove()}>
            {busy ? '削除中…' : '削除する'}
          </button>
        </div>
      </div>
    </div>}
    {resetPersonalityConfirm && <div className={ui.modalBackdrop} role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !personalityBusy) setResetPersonalityConfirm(false); }}>
      <div className={ui.dialog} role="alertdialog" aria-modal="true" aria-labelledby="staff-ai-personality-reset-title">
        <span className={ui.eyebrow}>{icon('restart_alt')} 性格設定の初期化</span>
        <h2 id="staff-ai-personality-reset-title">このサーバーのAI設定を初期状態に戻しますか？</h2>
        <p>Staffが調整した共通の話し方と学習済みの雰囲気、Staff AI自身の経験メモリーを初期化します。ユーザー別プロフィール、日次ダイジェスト、AIChannel専用メモリーは残ります。</p>
        <div className={ui.dialogActions}>
          <button className={ui.button} type="button" disabled={personalityBusy} onClick={() => setResetPersonalityConfirm(false)}>キャンセル</button>
          <button className={ui.buttonDanger} type="button" disabled={personalityBusy} onClick={() => void resetPersonality()}>
            {personalityBusy ? '初期化中…' : '初期状態に戻す'}
          </button>
        </div>
      </div>
    </div>}
  </div>;
};
export default StaffAIPage;
