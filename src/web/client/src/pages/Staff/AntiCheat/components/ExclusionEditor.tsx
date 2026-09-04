import { useEffect, useId, useRef, useState } from 'react';
import type { DetectorDefinition } from '../viewTypes';
import styles from './ExclusionEditor.module.css';

type Target = { id: string; name: string; kind: 'role' | 'channel'; type: string };
type Catalog = { roles: Target[]; channels: Target[] };
const ids = (text: string) => [...new Set(text.split(/[\s,]+/).filter(Boolean))];

function TargetAdder({ kind, catalog, resolve, onAdd }: {
  kind: 'role' | 'channel'; catalog: Catalog; resolve: (id: string) => Promise<Catalog>; onAdd: (id: string) => boolean;
}) {
  const label = kind === 'role' ? 'ロール' : 'チャンネル';
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const id = input.trim().replace(/^<@&(\d+)>$/, '$1').replace(/^<#(\d+)>$/, '$1');
    setError('');
    if (!/^[1-9]\d{0,19}$/.test(id)) { setError('数値のDiscord ID、または候補を選択してください。'); return; }
    setBusy(true);
    try {
      let targets = catalog;
      if (![...targets.roles, ...targets.channels].some(item => item.id === id)) targets = await resolve(id);
      const found = [...targets.roles, ...targets.channels].find(item => item.id === id);
      if (!found) throw new Error('このサーバーに対象が見つかりません。IDやBotのアクセス権を確認してください。');
      if (found.kind !== kind) throw new Error(`${found.name} は${found.type}です。${label}のIDを指定してください。`);
      if (!onAdd(id)) throw new Error('このIDは追加済みです。');
      setInput(''); setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : '確認に失敗しました。'); }
    finally { setBusy(false); }
  };
  return <div className={styles.adder}>
    {!open ? <button type="button" onClick={() => setOpen(true)} aria-label={`除外${label}のIDを追加`}>+ IDを追加</button> : <>
      <label htmlFor={listId}>{label}名で候補を検索、またはIDを入力</label>
      <div className={styles.addRow}>
        <input id={listId} list={`${listId}-list`} value={input} onChange={e => setInput(e.target.value)}
          placeholder="名前で候補を検索 / ID" disabled={busy} autoFocus
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} />
        <datalist id={`${listId}-list`}>{(kind === 'role' ? catalog.roles : catalog.channels).map(item =>
          <option key={item.id} value={item.id}>{item.name} · {item.type}</option>)}</datalist>
        <button type="button" disabled={busy} onClick={() => void add()}>{busy ? '確認中…' : '追加'}</button>
        <button type="button" disabled={busy} onClick={() => { setOpen(false); setError(''); }}>取消</button>
      </div>
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function ExclusionEditor({ guildId, rolesText, channelsText, onRoles, onChannels, policies, onPolicies, detectors }: {
  guildId: string; rolesText: string; channelsText: string; onRoles: (value: string) => void; onChannels: (value: string) => void;
  policies: Record<string, string[]>; onPolicies: (value: Record<string, string[]>) => void; detectors: DetectorDefinition[];
}) {
  const [catalog, setCatalog] = useState<Catalog>({ roles: [], channels: [] });
  const [status, setStatus] = useState('対象を確認中…');
  const alive = useRef(true);
  const request = async (id?: string) => {
    const result = await fetch(`/api/staff/anticheat/${encodeURIComponent(guildId)}/exclusion-targets${id ? `?targetId=${encodeURIComponent(id)}` : ''}`, { credentials: 'include' });
    if (!result.ok) throw new Error('ロール・チャンネルを取得できませんでした。');
    const data = await result.json() as Catalog;
    if (!alive.current) throw new Error('画面が切り替わりました。');
    setCatalog(data); setStatus(''); return data;
  };
  useEffect(() => {
    alive.current = true;
    void request().catch(e => { if (alive.current) setStatus(e.message); });
    return () => { alive.current = false; };
  }, [guildId]);
  const roles = ids(rolesText);
  const fullChannels = ids(channelsText);
  const channels = [...new Set([...fullChannels, ...Object.keys(policies)])];
  const identity = (id: string, kind: 'role' | 'channel') => {
    const target = (kind === 'role' ? catalog.roles : catalog.channels).find(item => item.id === id);
    return <div className={styles.identity}><strong>{target ? `${kind === 'role' ? '@' : '#'}${target.name}` : '対象を確認できません'}</strong>
      <span>{target?.type || '削除済み・一覧未取得・取得対象外'} · <code>{id}</code></span></div>;
  };
  const removePolicy = (id: string) => { const next = { ...policies }; delete next[id]; return next; };
  return <div className={styles.root}>
    {status && <p role="status">{status} <button type="button" onClick={() => void request().catch(e => setStatus(e.message))}>再取得</button></p>}
    <section aria-label="除外ロール"><h4>除外ロール</h4><p>このロールを持つユーザーは、すべての検知から除外します。</p>
      {roles.map(id => <div className={styles.row} key={id}>{identity(id, 'role')}
        <button type="button" aria-label={`除外ロール ${id} を削除`} onClick={() => onRoles(roles.filter(value => value !== id).join('\n'))}>削除</button></div>)}
      <TargetAdder kind="role" catalog={catalog} resolve={request} onAdd={id => { if (roles.includes(id)) return false; onRoles([...roles, id].join('\n')); return true; }} />
    </section>
    <section aria-label="除外チャンネル"><h4>除外チャンネル</h4><p>カテゴリは配下のチャンネルにも、親チャンネルは配下のスレッドにも適用します。除外は追加方向に適用されます。</p>
      {channels.map(id => <article className={styles.channel} key={id}>
        <div className={styles.row}>{identity(id, 'channel')}<button type="button" aria-label={`除外チャンネル ${id} を削除`} onClick={() => {
          onChannels(fullChannels.filter(value => value !== id).join('\n')); onPolicies(removePolicy(id));
        }}>削除</button></div>
        <label className={styles.mode}>このチャンネルの除外方法
          <select value={fullChannels.includes(id) ? 'all' : 'selected'} onChange={e => {
            if (e.target.value === 'all') { onChannels([...new Set([...fullChannels, id])].join('\n')); onPolicies(removePolicy(id)); }
            else { onChannels(fullChannels.filter(value => value !== id).join('\n')); onPolicies({ ...policies, [id]: [] }); }
          }}>
            <option value="all">すべての検知を除外</option><option value="selected">選択した検知だけ除外</option>
          </select>
        </label>
        {!fullChannels.includes(id) && <fieldset className={styles.detectors}><legend>無効にする検知</legend>
          {detectors.filter(detector => detector.key !== 'raidDetection').map(detector => <label key={detector.key}><input type="checkbox" checked={(policies[id] || []).includes(detector.key)} onChange={e => {
            const next = e.target.checked ? [...new Set([...(policies[id] || []), detector.key])] : (policies[id] || []).filter(name => name !== detector.key);
            onPolicies({ ...policies, [id]: next });
          }} />{detector.title}</label>)}
          {!policies[id]?.length && <p>未選択のため、このチャンネル固有の除外はありません。</p>}
        </fieldset>}
      </article>)}
      <TargetAdder kind="channel" catalog={catalog} resolve={request} onAdd={id => { if (channels.includes(id)) return false; onChannels([...fullChannels, id].join('\n')); return true; }} />
    </section>
    <p>変更はページの「保存」で適用されます。ロールや親チャンネルの全除外は、個別の検知設定より優先されます。参加人数を監視するアンチレイドは、チャンネル別設定の対象外です。</p>
  </div>;
}
