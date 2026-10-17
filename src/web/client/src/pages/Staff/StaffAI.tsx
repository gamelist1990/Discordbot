import React, { useCallback, useEffect, useState } from 'react';
import './StaffAI.css';

type Guild = { id: string; name: string };
type Metrics = {
  requests: number; inputTokens: number; outputTokens: number;
  totalTokens: number; generatedSeconds: number; cacheHitTokens: number; cacheInputTokens: number;
};
type Memory = {
  id: string; kind: 'daily' | 'user'; guildId: string; userId?: string;
  day?: string; title: string; content: string; evidenceCount: number;
  updatedAt: string; editedByStaff?: boolean;
};
const zero: Metrics = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0,
  generatedSeconds: 0, cacheHitTokens: 0, cacheInputTokens: 0 };
const format = (number: number) => Math.round(number).toLocaleString('ja-JP');
async function jsonRequest(url: string, options?: RequestInit) {
  const response = await fetch(url, { credentials: 'include', ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '通信に失敗しました');
  return result;
}

const StaffAIPage: React.FC = () => {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [guildId, setGuildId] = useState('');
  const [metrics, setMetrics] = useState<Metrics>(zero);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [tab, setTab] = useState<'daily' | 'user'>('daily');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    jsonRequest('/api/staff/guilds').then(data => {
      const list = data.guilds || [];
      setGuilds(list); setGuildId(list[0]?.id || '');
    }).catch(error => setError(String(error))).finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(async () => {
    if (!guildId) return;
    try {
      const result = await jsonRequest(`/api/staff/ai/${guildId}`);
      setMetrics(result.metrics || zero); setMemories(result.memories || []); setError('');
    } catch (error) { setError(String(error)); }
  }, [guildId]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const save = async (item: Memory) => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await jsonRequest(`/api/staff/ai/${guildId}/memories/${encodeURIComponent(item.id)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      setEditing(null); await refresh();
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  const remove = async (id?: string) => {
    if (!window.confirm(id ? 'このメモリーを削除しますか？' : 'このサーバーのメモリーをすべて削除しますか？')) return;
    setBusy(true);
    try {
      await jsonRequest(`/api/staff/ai/${guildId}/memories${id ? '/' + encodeURIComponent(id) : ''}`,
        { method: 'DELETE' });
      await refresh();
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };

  const matching = memories.filter(m => m.kind === tab && [m.title, m.content, m.userId || '']
    .join(' ').toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const speed = metrics.generatedSeconds > 0 ? metrics.outputTokens / metrics.generatedSeconds : null;
  const cache = metrics.cacheInputTokens > 0 ? 100 * metrics.cacheHitTokens / metrics.cacheInputTokens : null;

  return <div className="staffAiPage">
    <header className="staffAiHero">
      <div><span className="staffAiKicker">STAFF / AI OPERATIONS</span>
        <h1>Staff AI 管理</h1>
        <p>利用状況・日次ダイジェスト・ユーザー別メモリーを安全に管理します。</p></div>
      <div className="staffAiToolbar">
        <select aria-label="管理するサーバー" value={guildId} onChange={e => setGuildId(e.target.value)}>
          {guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <button onClick={() => void refresh()} disabled={!guildId}>更新</button>
      </div>
    </header>
    {error && <div className="staffAiError" role="alert">{error}</div>}
    {loading ? <p>サーバー情報を読み込み中…</p> : !guildId ? <p>管理できるサーバーがありません。</p> : <>
      <section className="staffAiCards" aria-label="Staff AIの利用状況">
        <div><span>総処理トークン</span><strong>{format(metrics.totalTokens)}</strong><small>入力 {format(metrics.inputTokens)} / 出力 {format(metrics.outputTokens)}</small></div>
        <div><span>平均生成速度</span><strong>{speed === null ? '—' : speed.toFixed(1)}<small> tok/s</small></strong><small>推論生成時間による加重平均</small></div>
        <div><span>キャッシュヒット率</span><strong>{cache === null ? '未取得' : cache.toFixed(1) + '%'}</strong><small>APIが実測ヒット数を返した場合のみ</small></div>
        <div><span>総リクエスト</span><strong>{format(metrics.requests)}</strong><small>Staff AIコマンドの成功回数</small></div>
      </section>
      <section className="staffAiMemories">
        <div className="staffAiSectionHead"><div><h2>長期メモリー</h2>
          <p>毎日の会話から要約を保存。個人プロフィールは本人の発言を元に更新します。</p></div>
          <button className="staffAiDanger" onClick={() => void remove()} disabled={busy || !memories.length}>全件クリア</button></div>
        <div className="staffAiFilters">
          <div className="staffAiTabs">
            <button className={tab === 'daily' ? 'selected' : ''} onClick={() => setTab('daily')}>日次ダイジェスト</button>
            <button className={tab === 'user' ? 'selected' : ''} onClick={() => setTab('user')}>ユーザー別</button>
          </div>
          <input placeholder="メモリーを検索" aria-label="メモリーを検索" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="staffAiList">{matching.length ? matching.map(item =>
          <article key={item.id} className="staffAiMemory">
            <div className="staffAiMemoryHeader"><div><h3>{item.title}</h3>
              <small>{item.day || item.userId || ''} · {item.evidenceCount}件の会話 · 更新 {new Date(item.updatedAt).toLocaleString('ja-JP')}
                {item.editedByStaff ? ' · Staff編集済み' : ''}</small></div>
              <div className="staffAiActions">
                <button onClick={() => {setEditing(item.id);setDraft(item.content);}}>編集</button>
                <button className="staffAiDanger" onClick={() => void remove(item.id)} disabled={busy}>削除</button>
              </div>
            </div>
            {editing === item.id ? <div className="staffAiEditor">
              <textarea value={draft} maxLength={6000} rows={8} onChange={e => setDraft(e.target.value)} aria-label="メモリー本文"/>
              <div><button onClick={() => setEditing(null)}>キャンセル</button>
                <button className="staffAiPrimary" disabled={busy || !draft.trim()} onClick={() => void save(item)}>保存</button></div>
            </div> : <p className="staffAiBody">{item.content}</p>}
          </article>
        ) : <div className="staffAiEmpty">メモリーはまだありません。会話が蓄積されると日次の要約が作成されます。</div>}</div>
      </section>
      <p className="staffAiFootnote">メモリーはサーバー単位で分離されます。未確認の推測・健康情報・政治的属性などは自動保存しない設計です。集計はこの機能導入後の値です。</p>
    </>}
  </div>;
};
export default StaffAIPage;
