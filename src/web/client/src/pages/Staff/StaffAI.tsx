import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppToast } from '../../AppToastProvider';
import ui from '../ManagementDashboard.module.css';

type Guild = { id: string; name: string };
type Metrics = {
  requests: number; inputTokens: number; outputTokens: number;
  totalTokens: number; generatedSeconds: number; cacheHitTokens: number; cacheInputTokens: number;
};
type Memory = {
  id: string; kind: 'daily' | 'user'; guildId: string; userId?: string; day?: string;
  title: string; content: string; publicInterests?: string; evidenceCount: number;
  updatedAt: string; editedByStaff?: boolean;
};
const zero: Metrics = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0,
  generatedSeconds: 0, cacheHitTokens: 0, cacheInputTokens: 0 };
const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP');
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
  const [loadingGuilds, setLoadingGuilds] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tab, setTab] = useState<'daily' | 'user'>('daily');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<Memory | 'all' | null>(null);
  const [confirmation, setConfirmation] = useState('');

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
      const data = await readJson(`/api/staff/ai/${selectedGuild}`);
      if (selectedGuild !== selectedGuildRef.current) return;
      setMetrics(data.metrics ?? zero);
      setMemories(data.memories ?? []);
      setLastUpdated(new Date());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'データの取得に失敗しました');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    if (!guildId) return;
    setMetrics(zero); setMemories([]); setEditing(null); setSearch(''); setLastUpdated(null);
    void refresh(guildId, true);
    const timer = window.setInterval(() => void refresh(guildId), 30_000);
    return () => window.clearInterval(timer);
  }, [guildId, refresh]);

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
  }), [memories]);
  const speed = metrics.generatedSeconds > 0 ? metrics.outputTokens / metrics.generatedSeconds : null;
  const cache = metrics.cacheInputTokens > 0 ? metrics.cacheHitTokens / metrics.cacheInputTokens * 100 : null;
  const selected = guilds.find(g => g.id === guildId);

  return <div className={ui.page}>
    <header className={ui.hero}>
      <div>
        <Link to="/staff" className={ui.muted}>{icon('arrow_back')} スタッフ運用に戻る</Link>
        <div style={{ marginTop: 14 }}><span className={ui.eyebrow}>{icon('auto_awesome')} AI Operations</span></div>
        <h1>Staff AI</h1>
        <p>会話の利用状況と、日々蓄積するメモリーをひとつの場所で管理。</p>
      </div>
      <div className={ui.heroActions}>
        <label className={ui.label}>対象サーバー
          <select className={ui.select} aria-label="管理対象サーバー" value={guildId}
            onChange={e => setGuildId(e.target.value)} disabled={loadingGuilds}>
            {!guildId && <option value="">サーバーを選択</option>}
            {guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <button type="button" className={ui.button} onClick={() => void refresh(guildId, true)} disabled={loading || !guildId}>
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

          <section className={ui.panel} aria-labelledby="staff-ai-memories-title">
            <div className={ui.sectionHeader}>
              <div><span className={ui.eyebrow}>Memory workspace</span><h2 id="staff-ai-memories-title" style={{ marginTop: 10 }}>メモリーライブラリ</h2>
                <p>日次の振り返りとユーザーのプロフィールを確認・編集できます。</p></div>
              <button type="button" className={ui.buttonDanger} disabled={busy || !memories.length} onClick={() => { setDeleting('all'); setConfirmation(''); }}>
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
              </div>
              <label className={ui.searchWrap}>{icon('search')}<input aria-label="メモリー検索" placeholder="タイトル・本文を検索" value={search} onChange={e => setSearch(e.target.value)} /></label>
              <span className={ui.muted}>{filtered.length} 件表示</span>
            </div>
            {loading ? <div className={ui.panelBody}><div className={ui.skeleton}/></div>
              : filtered.length ? <div className={ui.list} role="tabpanel">
                {filtered.map(item => <article className={ui.listItem} key={item.id}>
                  <div>
                    <h3 className={ui.listTitle}>{item.title}</h3>
                    <div className={ui.listMeta}>
                      <span>{item.day || (item.userId ? 'User ' + item.userId : '')}</span>
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
                <div className={ui.emptyIcon}>{icon(search ? 'search_off' : tab === 'daily' ? 'event_note' : 'person_search')}</div>
                <h3>{search ? '一致するメモリーがありません' : 'まだメモリーがありません'}</h3>
                <p>{search ? '検索条件を変えてみてください。' : tab === 'daily' ? '会話が蓄積されると、日ごとの出来事がここに保存されます。' : '会話から確認できた興味・得意分野がここに蓄積されます。'}</p>
              </div>}
          </section>
          <div className={ui.notice}>{icon('verified_user')} <div><strong style={{ color: 'var(--app-ink)' }}>メモリーの取り扱い</strong><p>サーバーごとに分離して保存します。個人プロフィール全体は本人限定、一般的な趣味のみ共有可能。要約には誤りが含まれる場合があります。</p></div></div>
        </>}

    {deleting && <div className={ui.modalBackdrop} role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setDeleting(null); }}>
      <div className={ui.dialog} role="alertdialog" aria-modal="true" aria-labelledby="staff-ai-delete-title" aria-describedby="staff-ai-delete-description">
        <span className={ui.eyebrow}>{icon('warning_amber')} 削除の確認</span>
        <h2 id="staff-ai-delete-title">{deleting === 'all' ? 'すべてのメモリーを削除しますか？' : 'このメモリーを削除しますか？'}</h2>
        <p id="staff-ai-delete-description">{deleting === 'all' ? `${memories.length} 件のメモリーが削除されます。この操作は元に戻せません。` : `「${deleting.title}」を削除します。この操作は元に戻せません。`}</p>
        {deleting === 'all' && <label className={ui.label}>確認のため「すべて削除」と入力
          <input className={ui.input} autoFocus value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder="すべて削除" />
        </label>}
        <div className={ui.dialogActions}>
          <button className={ui.button} type="button" disabled={busy} onClick={() => setDeleting(null)}>キャンセル</button>
          <button className={ui.buttonDanger} type="button" disabled={busy || (deleting === 'all' && confirmation !== 'すべて削除')} onClick={() => void remove()}>
            {busy ? '削除中…' : '削除する'}
          </button>
        </div>
      </div>
    </div>}
  </div>;
};
export default StaffAIPage;
