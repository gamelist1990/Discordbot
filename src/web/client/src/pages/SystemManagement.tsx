import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppToast } from '../AppToastProvider';
import ui from './ManagementDashboard.module.css';

type FileRow = { id: string; bytes: number };
type SystemStatus = {
  uptimeSeconds: number; systemUptimeSeconds: number;
  disk: { total: number; used: number; free: number; usedPercent: number };
  ram: { total: number; used: number; free: number; usedPercent: number; botRss: number; botHeap: number };
  database: { totalBytes: number; fileCount: number; files: FileRow[]; groups: { name: string; bytes: number }[] };
};
const fmtBytes = (num: number): string => {
  if (!Number.isFinite(num)) return '—';
  if (num >= 1024 ** 4) return (num / 1024 ** 4).toFixed(2) + ' TB';
  if (num >= 1024 ** 3) return (num / 1024 ** 3).toFixed(2) + ' GB';
  if (num >= 1024 ** 2) return (num / 1024 ** 2).toFixed(1) + ' MB';
  if (num >= 1024) return (num / 1024).toFixed(1) + ' KB';
  return num + ' B';
};
const fmtTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(hours / 24);
  return days ? `${days}日 ${hours % 24}時間` : `${hours}時間 ${Math.floor(seconds / 60) % 60}分`;
};
const icon = (value: string) => <span aria-hidden="true" className={`material-icons ${ui.icon}`}>{value}</span>;
const canDelete = (id: string) => id.endsWith('.json') && !/^(system|integrations)\//.test(id);

const SystemManagementPage: React.FC = () => {
  const { addToast } = useAppToast();
  const [data, setData] = useState<SystemStatus | null>(null);
  const [error, setError] = useState('');
  const [statusCode, setStatusCode] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [query, setQuery] = useState('');
  const [fileCategory, setFileCategory] = useState('all');
  const [deleting, setDeleting] = useState<FileRow | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [pageSize, setPageSize] = useState(20);

  const refresh = useCallback(async (initial = false) => {
    if (!initial) setRefreshing(true);
    try {
      const response = await fetch('/api/system-management/status', { credentials: 'include', cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatusCode(response.status);
        throw new Error(response.status === 403 ? 'このページはBotオーナー専用です。'
          : response.status === 401 ? 'Discordでログインしてください。'
            : result.error || 'システム情報の取得に失敗しました。');
      }
      setData(result as SystemStatus);
      setStatusCode(0);
      setError('');
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'システム情報の取得に失敗しました');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const deleteFile = async () => {
    if (!deleting || confirmation !== deleting.id || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/system-management/database', {
        method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleting.id }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || '削除に失敗しました');
      setDeleting(null); setConfirmation('');
      addToast('対象ファイルを削除しました', 'success');
      await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : '削除に失敗しました';
      setError(message); addToast(message, 'error');
    } finally { setBusy(false); }
  };

  const filteredFiles = useMemo(() => (data?.database.files ?? []).filter(f =>
    (fileCategory === 'all' || f.id.startsWith(fileCategory + '/')) &&
    f.id.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())
  ), [data, fileCategory, query]);
  const groups = useMemo(() => data?.database.groups ?? [], [data]);
  const categories = [...new Set(groups.map(group => group.name.split('/')[0]))].sort();
  const biggestGroup = Math.max(...groups.map(g => g.bytes), 1);
  const warnDisk = (data?.disk.usedPercent ?? 0) >= 85;

  return <div className={ui.page}>
    <header className={ui.hero}>
      <div>
        <Link className={ui.muted} to="/">{icon('arrow_back')} ホームへ戻る</Link>
        <div style={{ marginTop: 14 }}><span className={ui.eyebrow}>{icon('shield')} Bot Owner / Operations</span></div>
        <h1>システム管理</h1>
        <p>Botとサーバーの稼働状況、ストレージの利用状況を確認できます。</p>
      </div>
      <div className={ui.heroActions}>
        <span className={`${ui.badge} ${warnDisk ? ui.badgeWarn : ui.badgeSuccess}`}>
          {icon(warnDisk ? 'warning_amber' : 'check_circle_outline')}
          {warnDisk ? 'ストレージ容量に注意' : data ? 'モニタリング中' : '接続確認中'}
        </span>
        <button type="button" className={ui.button} disabled={refreshing}
          onClick={() => void refresh()}>{icon('refresh')} {refreshing ? '更新中…' : '今すぐ更新'}</button>
      </div>
    </header>
    {error && <div role="alert" className={ui.error}>{icon('error_outline')} <span>{error}</span></div>}
    {loading ? <>
      <div className={ui.metrics}>{[0,1,2,3].map(i => <div className={ui.metric} key={i}><div className={ui.skeleton}/></div>)}</div>
      <div role="status" className={ui.state}>システムの状態を読み込んでいます…</div>
    </> : !data ? <div className={ui.state}>
      <div className={ui.emptyIcon}>{icon(statusCode === 403 ? 'lock' : 'wifi_off')}</div>
      <h3>{statusCode === 403 ? 'アクセス権限がありません' : 'システム情報を取得できません'}</h3>
      <p>{statusCode === 403 ? 'Botオーナーとして認証されたアカウントからアクセスしてください。' : '接続状態を確認して、もう一度お試しください。'}</p>
      {statusCode === 401
        ? <a className={ui.buttonPrimary} href="/api/auth/discord">Discordでログイン</a>
        : <Link className={ui.buttonPrimary} to="/">ホームへ戻る</Link>}
    </div> : <>
      <section aria-label="システム使用率">
        <div className={ui.sectionHeader} style={{ padding: '0 0 15px', border: 'none' }}>
          <div><h2>リソース概要</h2><p>OS全体の空き容量とBotプロセスの使用状況</p></div>
          <span className={ui.badge}>{icon('schedule')} {lastUpdated?.toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' })} 更新</span>
        </div>
        <div className={ui.metrics}>
          {[
            { label:'ディスク使用率', value:data.disk.usedPercent.toFixed(1) + '%',
              detail:`${fmtBytes(data.disk.used)} / ${fmtBytes(data.disk.total)}`, pict:'storage', percent:data.disk.usedPercent },
            { label:'システムメモリ', value:data.ram.usedPercent.toFixed(1) + '%',
              detail:`${fmtBytes(data.ram.used)} / ${fmtBytes(data.ram.total)}`, pict:'memory', percent:data.ram.usedPercent },
            { label:'Botプロセス', value:fmtBytes(data.ram.botRss),
              detail:`Heap ${fmtBytes(data.ram.botHeap)} · RSS使用量`, pict:'developer_board', percent:null },
            { label:'DB容量', value:fmtBytes(data.database.totalBytes),
              detail:`${data.database.fileCount.toLocaleString('ja-JP')} ファイルを保存中`, pict:'storage', percent:null },
          ].map(card => <div key={card.label} className={ui.metric}>
            <div className={ui.metricTop}><span className={ui.metricLabel}>{card.label}</span><span className={ui.metricIcon}>{icon(card.pict)}</span></div>
            <strong className={ui.metricValue}>{card.value}</strong>
            {card.percent !== null && <div className={ui.track}><i className={`${ui.trackFill} ${card.percent >= 85 ? ui.trackDanger : ''}`} style={{ width: Math.min(100,card.percent)+'%' }} /></div>}
            <span className={ui.metricMeta}>{card.detail}</span>
          </div>)}
        </div>
      </section>
      {warnDisk && <div className={ui.error} role="status">
        {icon('warning_amber')}<span>ディスク使用率が85%を超えています。容量を確認し、不要なデータの整理を検討してください。</span>
      </div>}
      <div className={ui.notice}>
        {icon('schedule')} <div><strong style={{color:'var(--app-ink)'}}>現在の稼働状況</strong>
          <p>Bot稼働時間 <strong>{fmtTime(data.uptimeSeconds)}</strong>　·　OS稼働時間 <strong>{fmtTime(data.systemUptimeSeconds)}</strong>
            <span style={{display:'block'}}>ディスク空き容量 {fmtBytes(data.disk.free)}。利用状況は30秒ごとに更新します。</span></p>
        </div>
      </div>
      <section className={ui.panel} aria-labelledby="system-database-breakdown">
        <div className={ui.sectionHeader}><div><span className={ui.eyebrow}>Storage analysis</span>
          <h2 id="system-database-breakdown" style={{ marginTop: 10 }}>データベースの内訳</h2>
          <p>容量の大きい領域から並べています。最適化の優先順位を判断できます。</p></div>
          <span className={ui.badge}>{groups.length} 領域</span>
        </div>
        <div className={ui.panelBody}>
          {groups.length ? groups.slice(0,12).map(group => <div className={ui.barRow} key={group.name}>
            <span className={ui.barLabel}>{group.name}</span>
            <div className={ui.track}><i className={ui.trackFill} style={{ width:Math.max(.5,100*group.bytes/biggestGroup)+'%' }}/></div>
            <span className={ui.barNumber}>{fmtBytes(group.bytes)}</span>
          </div>) : <div className={ui.emptyInner}><p>データベースのファイルはまだありません。</p></div>}
        </div>
      </section>
      <section className={ui.panel} aria-labelledby="system-file-explorer">
        <div className={ui.sectionHeader}>
          <div><span className={ui.eyebrow}>Database explorer</span>
            <h2 id="system-file-explorer" style={{ marginTop: 10 }}>容量の大きいファイル</h2>
            <p>ディスクを圧迫しているファイルを確認し、必要に応じて個別に削除できます。</p></div>
          <span className={ui.badge}>容量上位100ファイル</span>
        </div>
        <div className={ui.toolbar}>
          <label className={ui.searchWrap}>{icon('search')}<input aria-label="ファイルを検索" placeholder="ファイル名・保存先を検索" value={query} onChange={e => {setQuery(e.target.value);setPageSize(20);}} /></label>
          <select className={ui.select} aria-label="フォルダーで絞り込む" value={fileCategory} onChange={e=>{setFileCategory(e.target.value);setPageSize(20);}}>
            <option value="all">すべての領域</option>
            {categories.map(category => <option key={category} value={category}>{category}</option>)}
          </select>
          <span className={ui.muted}>{filteredFiles.length} 件</span>
        </div>
        {filteredFiles.length ? <>
          <div className={ui.tableScroll}>
            <table className={ui.table}>
              <thead><tr><th scope="col">ファイル / 保存先</th><th scope="col" className={ui.alignRight}>容量</th><th scope="col" className={ui.alignRight}>操作</th></tr></thead>
              <tbody>{filteredFiles.slice(0,pageSize).map(file => <tr key={file.id}>
                <td><span className={ui.pathText}>{icon('description')} {file.id}</span></td>
                <td className={ui.alignRight}><strong>{fmtBytes(file.bytes)}</strong></td>
                <td className={ui.alignRight}>
                  {canDelete(file.id)
                    ? <button type="button" className={ui.buttonDanger} disabled={busy} onClick={() => {setDeleting(file);setConfirmation('');}}>{icon('delete_outline')} 削除</button>
                    : <span className={ui.badge}>{icon('lock_outline')} 保護対象</span>}
                </td>
              </tr>)}</tbody>
            </table>
          </div>
          {filteredFiles.length > pageSize && <div className={ui.toolbar} style={{ justifyContent:'center', borderBottom:0 }}>
            <button type="button" className={ui.button} onClick={() => setPageSize(p=>p+20)}>{icon('expand_more')} さらに20件表示</button>
          </div>}
        </> : <div className={ui.emptyInner}><div className={ui.emptyIcon}>{icon('search_off')}</div><h3>一致するファイルがありません</h3><p>検索やフィルターを変更してください。</p></div>}
      </section>
      <div className={ui.notice}>{icon('info_outline')}<p>ファイル削除は取り消せません。設定やログなど必要なデータを含む場合があります。重要なディレクトリは削除できないよう保護しています。</p></div>
    </>}

    {deleting && <div className={ui.modalBackdrop} role="presentation" onMouseDown={event => {if (event.target === event.currentTarget && !busy) setDeleting(null);}}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="system-delete-title" aria-describedby="system-delete-explanation" className={ui.dialog}>
        <span className={ui.eyebrow}>{icon('warning_amber')} データの完全削除</span>
        <h2 id="system-delete-title">このファイルを削除しますか？</h2>
        <p id="system-delete-explanation">対象 <strong>{fmtBytes(deleting.bytes)}</strong> のデータは削除後に復元できません。DBが使用中の場合もあるため、削除前に必要性を確認してください。</p>
        <code>{deleting.id}</code>
        <label className={ui.label}>確認するためファイルのパスを入力
          <input className={ui.input} autoFocus value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder={deleting.id} />
        </label>
        <div className={ui.dialogActions}>
          <button type="button" className={ui.button} onClick={() => setDeleting(null)} disabled={busy}>キャンセル</button>
          <button type="button" className={ui.buttonDanger} disabled={busy || confirmation !== deleting.id} onClick={() => void deleteFile()}>
            {icon('delete_forever')} {busy ? '削除中…' : '完全に削除'}
          </button>
        </div>
      </div>
    </div>}
  </div>;
};

export default SystemManagementPage;
