import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppToast } from '../../AppToastProvider';
import ui from '../ManagementDashboard.module.css';
import styles from './ServerBuilder.module.css';
import { ServerBuilderTree, applyPlanToStructure, type TreeStructure } from './ServerBuilderTree';

type Guild = { id: string; name: string };
type StructureChannel = { id: string; name: string; kind: string; parentId?: string; topic?: string; position: number; permissionOverwrites?: { targetKind: string; targetId: string; targetName?: string; allow: string[]; deny: string[] }[]; permissionsSynced?: boolean | null; isPrivate?: boolean; slowmodeSeconds?: number };
type Structure = TreeStructure & { channels: StructureChannel[] };
type Budget = {
  used: number; limit: number; remaining: number; windowMs: number;
  nextRecoveryAt: number | null; fullRecoveryAt: number | null;
};
type Preset = { id: string; label: string; description: string };
type Operation = { type: string; [key: string]: unknown };
type Plan = { version: number; summary: string; operations: Operation[] };
type ApplyResult = { index: number; type: string; ok: boolean; detail: string; createdId?: string };
type ChatEntry = { role: 'user' | 'ai'; text: string; at: string };

const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP');
const icon = (value: string, className = '') =>
  <span className={`material-icons ${className || ui.icon}`} aria-hidden="true">{value}</span>;

async function readJson(url: string, options?: RequestInit) {
  const r = await fetch(url, { credentials: 'include', cache: 'no-store', ...options });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(body.error || `HTTP ${r.status}`) as Error & { budget?: Budget; details?: string[] };
    err.budget = body.budget;
    err.details = body.details;
    throw err;
  }
  return body;
}

const OP_ICONS: Record<string, string> = {
  createCategory: 'create_new_folder',
  createChannel: 'add_circle',
  renameChannel: 'edit',
  renameCategory: 'drive_file_rename_outline',
  moveChannel: 'drive_file_move',
  setTopic: 'description',
  setSlowmode: 'slow_motion_video',
  setPermissions: 'lock',
  setPosition: 'swap_vert',
  syncPermissions: 'sync',
};
const OP_LABELS: Record<string, string> = {
  createCategory: 'カテゴリ作成',
  createChannel: 'チャンネル作成',
  renameChannel: 'チャンネル名変更',
  renameCategory: 'カテゴリ名変更',
  moveChannel: 'チャンネル移動',
  setTopic: 'トピック設定',
  setSlowmode: '低速モード設定',
  setPermissions: '権限設定',
  setPosition: '並び替え',
  syncPermissions: '権限同期',
};
const CHANNEL_TYPE_LABELS: Record<string, string> = { text: 'テキスト', voice: 'ボイス', announcement: 'アナウンス' };

const ServerBuilderPage: React.FC = () => {
  const { addToast } = useAppToast();
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [guildId, setGuildId] = useState('');
  const guildRef = useRef(guildId);
  guildRef.current = guildId;
  const [structure, setStructure] = useState<Structure | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [style, setStyle] = useState('plain');
  const [request, setRequest] = useState('');
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [preview, setPreview] = useState<{ previewId: string; plan: Plan } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const [error, setError] = useState('');
  const [loadingGuilds, setLoadingGuilds] = useState(true);
  const [loadingState, setLoadingState] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [manualOps, setManualOps] = useState<Operation[]>([]);
  const [manualBusy, setManualBusy] = useState(false);
  const [detailOp, setDetailOp] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editTopic, setEditTopic] = useState('');
  const [editSlow, setEditSlow] = useState('0');
  const [aiFocus, setAiFocus] = useState<{ kind: 'channel' | 'category'; id: string; name: string } | null>(null);
  const requestSectionRef = useRef<HTMLElement | null>(null);
  const requestTextareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  const refreshState = useCallback(async (target: string) => {
    if (!target) return;
    setLoadingState(true);
    try {
      const data = await readJson(`/api/staff/server-builder/${target}/state`);
      if (target !== guildRef.current) return;
      setStructure(data.structure as Structure);
      setBudget(data.budget as Budget);
      setPresets((data.presets || []) as Preset[]);
      setError('');
    } catch (e) {
      if (target === guildRef.current) setError(e instanceof Error ? e.message : 'サーバー情報の取得に失敗しました');
    } finally {
      setLoadingState(false);
    }
  }, []);

  useEffect(() => {
    setStructure(null); setBudget(null); setPreview(null); setResults(null); setChat([]); setRequest('');
    setSelectedNodeId(''); setManualOps([]); setDetailOp(null); setAiFocus(null);
    if (guildId) void refreshState(guildId);
  }, [guildId, refreshState]);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    structure?.channels.forEach(c => map.set(c.id, c.name));
    structure?.roles.forEach(r => map.set(r.id, r.name));
    return map;
  }, [structure]);

  const describeOp = useCallback((op: Operation, plan: Plan): { title: string; detail: string } => {
    const refName = (ref: unknown): string => {
      if (ref === null || ref === undefined) return 'カテゴリなし';
      if (typeof ref === 'string') return `カテゴリ「${nameById.get(ref) ?? ref}」`;
      if (typeof ref === 'object' && ref !== null && 'kind' in ref) {
        const r = ref as { kind: string; id?: string; index?: number };
        if (r.kind === 'existing' && r.id) return `カテゴリ「${nameById.get(r.id) ?? r.id}」`;
        if (r.kind === 'new' && typeof r.index === 'number') {
          const target = plan.operations[r.index];
          return `新規カテゴリ「${String(target?.name ?? '')}」`;
        }
      }
      if (typeof ref === 'object' && ref !== null && 'newIndex' in ref) {
        const target = plan.operations[(ref as { newIndex: number }).newIndex];
        return `新規カテゴリ「${String(target?.name ?? '')}」`;
      }
      return 'カテゴリ';
    };
    switch (op.type) {
      case 'createCategory':
        return { title: `カテゴリ「${String(op.name)}」を作成`, detail: '新しいカテゴリ' };
      case 'createChannel':
        return {
          title: `チャンネル「${String(op.name)}」を作成`,
          detail: `${CHANNEL_TYPE_LABELS[String(op.channelType)] ?? String(op.channelType)} / ${refName(op.categoryRef)}${op.topic ? ` / トピック: ${String(op.topic)}` : ''}${op.slowmodeSeconds ? ` / 低速 ${String(op.slowmodeSeconds)}秒` : ''}`,
        };
      case 'renameChannel':
        return { title: `「${nameById.get(String(op.channelId)) ?? String(op.channelId)}」→「${String(op.name)}」`, detail: 'チャンネルの名前を変更' };
      case 'renameCategory':
        return { title: `カテゴリ「${nameById.get(String(op.categoryId)) ?? String(op.categoryId)}」→「${String(op.name)}」`, detail: 'カテゴリの名前を変更' };
      case 'moveChannel':
        return { title: `「${nameById.get(String(op.channelId)) ?? String(op.channelId)}」を移動`, detail: `移動先: ${refName(op.categoryRef)}` };
      case 'setTopic':
        return { title: `「${nameById.get(String(op.channelId)) ?? String(op.channelId)}」のトピック設定`, detail: String(op.topic ?? '') };
      case 'setSlowmode':
        return { title: `「${nameById.get(String(op.channelId)) ?? String(op.channelId)}」の低速モード`, detail: `${String(op.seconds)} 秒` };
      case 'setPermissions': {
        const targetName = op.targetId
          ? (nameById.get(String(op.targetId)) ?? String(op.targetId))
          : `新規${op.targetKind === 'category' ? 'カテゴリ' : 'チャンネル'}「${String(plan.operations[(op.targetRef as { index: number })?.index ?? -1]?.name ?? '')}」`;
        const overwrites = Array.isArray(op.overwrites) ? op.overwrites as { targetKind: string; roleId?: string; allow?: string[]; deny?: string[] }[] : [];
        const lines = overwrites.map(o => {
          const who = o.targetKind === 'everyone' ? '@everyone' : `ロール「${o.roleId ? (nameById.get(o.roleId) ?? o.roleId) : ''}」`;
          const parts = [
            ...(o.allow ?? []).map(p => `許可: ${p}`),
            ...(o.deny ?? []).map(p => `拒否: ${p}`),
          ];
          return `${who} — ${parts.join(' / ') || '変更なし'}`;
        });
        return { title: `「${targetName}」の権限設定`, detail: lines.join('、') };
      }
      case 'setPosition':
        return { title: `「${nameById.get(String(op.targetId)) ?? String(op.targetId)}」の並び替え`, detail: `position を ${String(op.position)} に変更` };
      case 'syncPermissions':
        return { title: `「${nameById.get(String(op.channelId)) ?? String(op.channelId)}」の権限同期`, detail: '所属カテゴリの権限に同期します' };
      default:
        return { title: op.type, detail: '' };
    }
  }, [nameById]);

  const previewModel = useMemo(() => {
    if (!structure) return null;
    if (!preview) return { structure: structure as TreeStructure, changes: new Map<string, string[]>() };
    return applyPlanToStructure(structure as TreeStructure, preview.plan.operations as { type: string; [k: string]: unknown }[], selected);
  }, [structure, preview, selected]);

  const selectedNode = useMemo(() => structure?.channels.find(c => c.id === selectedNodeId) ?? null, [structure, selectedNodeId]);
  const selectedCategory = useMemo(() => structure?.categories.find(c => c.id === selectedNodeId) ?? null, [structure, selectedNodeId]);

  const askAiForSelected = useCallback(() => {
    if (!selectedNode) return;
    setAiFocus({
      kind: selectedNode.kind === 'category' ? 'category' : 'channel',
      id: selectedNode.id,
      name: selectedNode.name,
    });
    requestSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => requestTextareaRef.current?.focus(), 400);
  }, [selectedNode]);
  useEffect(() => { if (selectedNode) { setEditName(selectedNode.name); setEditTopic(selectedNode.topic ?? ''); setEditSlow(String(selectedNode.slowmodeSeconds ?? 0)); } }, [selectedNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const addManualOp = (op: Operation) => { setManualOps(prev => [...prev, op]); addToast('手動操作を追加しました。プレビューで確認してから適用してください', 'success'); };
  const submitManual = async () => {
    const target = guildId; if (!target || manualOps.length === 0 || manualBusy) return;
    setManualBusy(true); setResults(null);
    try {
      const data = await readJson(`/api/staff/server-builder/${target}/plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations: manualOps, summary: '手動編集プラン' }),
      });
      if (target !== guildRef.current) return;
      const plan = data.plan as Plan;
      setPreview({ previewId: data.previewId as string, plan });
      setSelected(new Set(plan.operations.map((_, i) => i)));
      setManualOps([]);
      if (data.budget) setBudget(data.budget as Budget);
      addToast('手動プランを作成しました。ツリーで確認して適用してください', 'success');
    } catch (e) {
      const err = e as Error & { details?: string[] };
      setError(err.details?.length ? `${err.message}（${err.details.join(' / ')}）` : err.message);
      addToast('手動プランの作成に失敗しました', 'error');
    } finally { setManualBusy(false); }
  };

  const generate = async () => {
    const target = guildId;
    const text = request.trim();
    if (!target || !text || generating) return;
    setGenerating(true);
    setResults(null);
    try {
      const data = await readJson(`/api/staff/server-builder/${target}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: text, style, ...(aiFocus ? { focus: { kind: aiFocus.kind, id: aiFocus.id } } : {}) }),
      });
      if (target !== guildRef.current) return;
      const plan = data.plan as Plan;
      setPreview({ previewId: data.previewId as string, plan });
      setSelected(new Set(plan.operations.map((_, i) => i)));
      setBudget(data.budget as Budget);
      setChat(prev => [
        ...prev,
        { role: 'user', text: aiFocus ? `【対象: ${aiFocus.kind === 'category' ? 'カテゴリ' : 'チャンネル'}「${aiFocus.name}」】${text}` : text, at: new Date().toLocaleTimeString('ja-JP') },
        { role: 'ai', text: `${plan.summary || 'プランを作成しました'}（操作 ${plan.operations.length} 件 / 使用 ${fmt(data.usage?.tokens ?? 0)} トークン${data.usage?.estimated ? '・見積り' : ''}${data.repaired ? ' / 検証エラーを自動修復しました' : ''}）`, at: new Date().toLocaleTimeString('ja-JP') },
      ]);
      setRequest('');
      addToast('プランを生成しました。内容を確認して適用してください', 'success');
    } catch (e) {
      const err = e as Error & { budget?: Budget; details?: string[] };
      if (err.budget) setBudget(err.budget);
      setError(err.details?.length ? `${err.message}（${err.details.join(' / ')}）` : err.message);
      addToast('プランの生成に失敗しました', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const apply = async () => {
    const target = guildId;
    if (!target || !preview || applying || selected.size === 0) return;
    setApplying(true);
    try {
      const data = await readJson(`/api/staff/server-builder/${target}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewId: preview.previewId, opIndexes: [...selected].sort((a, b) => a - b) }),
      });
      if (target !== guildRef.current) return;
      setResults(data.results as ApplyResult[]);
      setPreview(null);
      addToast(`適用しました（成功 ${String(data.applied)} 件 / 失敗 ${String(data.failed)} 件）`, data.failed ? 'error' : 'success');
      await refreshState(target);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'プランの適用に失敗しました');
      addToast('プランの適用に失敗しました', 'error');
    } finally {
      setApplying(false);
    }
  };

  const toggleOp = (index: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const budgetPercent = budget ? Math.min(100, (budget.used / budget.limit) * 100) : 0;
  const selectedGuild = guilds.find(g => g.id === guildId);

  return <div className={ui.page}>
    <header className={ui.hero}>
      <div>
        <Link to="/staff" className={ui.muted}>{icon('arrow_back')} スタッフ運用に戻る</Link>
        <div style={{ marginTop: 14 }}><span className={ui.eyebrow}>{icon('construction')} Server Builder</span></div>
        <h1>AIサーバー構築</h1>
        <p>作りたいサーバー構成を言葉で伝えると、AIが変更プランを作ります。内容を確認してから適用でき、削除系の操作は含まれません。</p>
      </div>
      <div className={ui.heroActions}>
        <label className={ui.label}>対象サーバー
          <select className={ui.select} aria-label="管理対象サーバー" value={guildId}
            onChange={e => setGuildId(e.target.value)} disabled={loadingGuilds}>
            {!guildId && <option value="">サーバーを選択</option>}
            {guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <button type="button" className={`${ui.button} ${ui.serverRefreshButton}`} onClick={() => void refreshState(guildId)} disabled={loadingState || !guildId}>
          {icon('refresh')} {loadingState ? '更新中…' : '更新'}
        </button>
      </div>
    </header>

    {error && <div className={ui.error} role="alert">{icon('error_outline')} <span>{error}</span></div>}
    {loadingGuilds ? <div className={ui.state} role="status">{icon('hourglass_top')}<p>サーバー情報を読み込んでいます…</p></div>
      : !guildId ? <div className={ui.state}>{icon('dns')}<h3>管理できるサーバーがありません</h3><p>Staff権限のあるサーバーでログインしてください。</p></div>
        : <>
          <section className={ui.panel} aria-label="AI予算">
            <div className={ui.sectionHeader}>
              <div><h2>AI予算（{selectedGuild?.name || 'サーバー'}）</h2>
                <p>プラン生成はギルドごとに5時間あたり{budget ? fmt(budget.limit) : '…'}トークンまで。適用（Discord変更）自体は予算を消費しません。</p></div>
              {budget && <span className={ui.badge}>{icon('schedule')} {budget.nextRecoveryAt
                ? `回復開始 ${new Date(budget.nextRecoveryAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`
                : '全量回復中'}</span>}
            </div>
            {budget ? <div className={styles.budgetBar}>
              <div className={styles.budgetNumbers}>
                <span>残り <strong>{fmt(budget.remaining)}</strong> トークン</span>
                <span className={ui.muted}>使用済み {fmt(budget.used)} / 上限 {fmt(budget.limit)}</span>
                {budget.fullRecoveryAt && <span className={ui.muted}>全回復目安 {new Date(budget.fullRecoveryAt).toLocaleString('ja-JP')}</span>}
              </div>
              <div className={ui.track}><i className={`${ui.trackFill} ${budgetPercent > 85 ? ui.trackDanger : ''}`} style={{ width: `${budgetPercent}%` }} /></div>
            </div> : <div className={ui.panelBody}><div className={ui.skeleton} /></div>}
          </section>

          <div className={styles.layout}>
            <div className={styles.leftCol}>
              <section className={ui.panel} aria-label="サーバー構造">
                <div className={ui.sectionHeader}>
                  <div><h2>{preview ? 'プレビュー（適用後の見え方）' : 'サーバー構造'}</h2>
                    <p>{preview ? '変更にはバッジが付きます。Discordのサイドバーと同じ並び順です。' : 'Discordのサイドバーと同じ並び順です。選択すると詳細とクイック編集が表示されます。'}</p></div>
                  {preview && <span className={ui.badge}>{icon('visibility')} プレビュー中</span>}
                </div>
                {previewModel && structure ? <ServerBuilderTree structure={previewModel.structure} changes={previewModel.changes} selectedId={selectedNodeId} onSelect={setSelectedNodeId} />
                  : <div className={ui.panelBody}><div className={ui.skeleton} /></div>}
              </section>

              {selectedNode && structure && <section className={ui.panel} aria-label="選択中の詳細とクイック編集">
                <div className={ui.sectionHeader}><div><h2>詳細・クイック編集</h2><p>編集は手動操作として積まれ、必ずプレビュー→適用を通ります（即時適用はしません）。</p></div></div>
                <div className={styles.detailBox}>
                  <p><strong>{selectedNode.name}</strong></p>
                  <p className={ui.muted}>種別: {CHANNEL_TYPE_LABELS[selectedNode.kind] ?? selectedNode.kind} / position: {selectedNode.position}
                    {selectedNode.parentId ? ` / 所属: ${nameById.get(selectedNode.parentId) ?? selectedNode.parentId}` : ' / カテゴリなし'}
                    {selectedNode.kind !== 'category' ? ` / 権限同期: ${selectedNode.permissionsSynced === null || selectedNode.permissionsSynced === undefined ? '—' : selectedNode.permissionsSynced ? '同期中' : '非同期'}` : ''}
                    {` / 公開状態: ${selectedNode.isPrivate ? 'プライベート' : '公開'}`}</p>
                  {selectedNode.topic && <p className={ui.muted}>トピック: {selectedNode.topic}</p>}
                  {(selectedNode.permissionOverwrites ?? []).length > 0 && <div>
                    <p className={ui.muted}>権限上書き:</p>
                    {(selectedNode.permissionOverwrites ?? []).map((o, i) => <p key={i} className={ui.muted}>{o.targetKind === 'everyone' ? '@everyone' : (o.targetName ?? o.targetId)} — 許可: {o.allow.join(', ') || 'なし'} / 拒否: {o.deny.join(', ') || 'なし'}</p>)}
                  </div>}
                  {!selectedNodeId.startsWith('new:') && <div className={styles.quickGrid}>
                    <label className={ui.label}>名前
                      <span className={styles.quickRow}><input className={ui.input} value={editName} onChange={e => setEditName(e.target.value)} aria-label="新しい名前" />
                        <button type="button" className={ui.button} disabled={!editName.trim() || editName.trim() === selectedNode.name}
                          onClick={() => addManualOp(selectedNode.kind === 'category'
                            ? { type: 'renameCategory', categoryId: selectedNode.id, name: editName.trim() }
                            : { type: 'renameChannel', channelId: selectedNode.id, name: editName.trim() })}>{icon('edit')} リネーム追加</button></span>
                    </label>
                    {selectedNode.kind !== 'category' && <>
                      <label className={ui.label}>トピック
                        <span className={styles.quickRow}><input className={ui.input} value={editTopic} onChange={e => setEditTopic(e.target.value)} aria-label="トピック" />
                          <button type="button" className={ui.button} onClick={() => addManualOp({ type: 'setTopic', channelId: selectedNode.id, topic: editTopic })}>{icon('description')} 追加</button></span>
                      </label>
                      <label className={ui.label}>低速モード（秒）
                        <span className={styles.quickRow}><input className={ui.input} type="number" min={0} max={21600} value={editSlow} onChange={e => setEditSlow(e.target.value)} aria-label="低速モード秒数" />
                          <button type="button" className={ui.button} onClick={() => addManualOp({ type: 'setSlowmode', channelId: selectedNode.id, seconds: Math.max(0, Math.min(21600, Number(editSlow) || 0)) })}>{icon('slow_motion_video')} 追加</button></span>
                      </label>
                    </>}
                    <div className={styles.quickRow}>
                      <button type="button" className={ui.button} onClick={() => addManualOp({ type: 'setPosition', targetKind: selectedNode.kind === 'category' ? 'category' : 'channel', targetId: selectedNode.id, position: Math.max(0, selectedNode.position - 1) })}>{icon('arrow_upward')} 上へ</button>
                      <button type="button" className={ui.button} onClick={() => addManualOp({ type: 'setPosition', targetKind: selectedNode.kind === 'category' ? 'category' : 'channel', targetId: selectedNode.id, position: selectedNode.position + 1 })}>{icon('arrow_downward')} 下へ</button>
                      {selectedNode.isPrivate
                        ? <button type="button" className={ui.button} onClick={() => addManualOp({ type: 'setPermissions', targetKind: selectedNode.kind === 'category' ? 'category' : 'channel', targetId: selectedNode.id, overwrites: [{ targetKind: 'everyone', allow: ['ViewChannel'], deny: [] }] })}>{icon('lock_open')} 公開にする</button>
                        : <button type="button" className={ui.button} onClick={() => addManualOp({ type: 'setPermissions', targetKind: selectedNode.kind === 'category' ? 'category' : 'channel', targetId: selectedNode.id, overwrites: [{ targetKind: 'everyone', allow: [], deny: ['ViewChannel'] }] })}>{icon('lock')} プライベートにする</button>}
                      {selectedNode.kind !== 'category' && selectedNode.parentId && selectedNode.permissionsSynced === false &&
                        <button type="button" className={ui.button} onClick={() => addManualOp({ type: 'syncPermissions', channelId: selectedNode.id })}>{icon('sync')} カテゴリに権限同期</button>}
                    </div>
                    {selectedCategory && <p className={ui.muted}>カテゴリの権限は「プライベートにする/公開にする」で @everyone の ViewChannel を編集できます（配下の非同期チャンネルには自動では広がりません）。ロール別の細かい権限は、下の「AIに依頼」からこのカテゴリを対象に指定して頼めます。</p>}
                    <div className={styles.quickRow}>
                      <button type="button" className={ui.button} onClick={askAiForSelected}>{icon('smart_toy')} この{selectedNode.kind === 'category' ? 'カテゴリ' : 'チャンネル'}についてAIに依頼</button>
                      <span className={ui.muted}>対象を固定して、権限の細かい編集などをAIに頼めます</span>
                    </div>
                  </div>}
                  {manualOps.length > 0 && <div className={styles.manualList}>
                    <p><strong>手動操作（{manualOps.length}件）</strong> — プレビューを作成するとAI予算は消費されません</p>
                    {manualOps.map((op, i) => <div key={i} className={styles.manualItem}>
                      <span>{OP_LABELS[op.type] ?? op.type}: {describeOp(op, { version: 1, summary: '', operations: manualOps }).title}</span>
                      <button type="button" className={ui.button} onClick={() => setManualOps(prev => prev.filter((_, x) => x !== i))}>{icon('close')} 除外</button>
                    </div>)}
                    <button type="button" className={ui.buttonPrimary} disabled={manualBusy} onClick={() => void submitManual()}>{icon('visibility')} {manualBusy ? '作成中…' : '手動プランをプレビュー'}</button>
                  </div>}
                </div>
              </section>}
            </div>

            <div className={styles.rightCol}>
            <section className={ui.panel} aria-label="AIへの依頼" ref={requestSectionRef}>
              <div className={ui.sectionHeader}>
                <div><h2>依頼する</h2><p>例: 「ゲーム募集用のカテゴリとテキストVCを作って」「スタッフだけ見える報告チャンネルが欲しい」</p></div>
              </div>
              {chat.length > 0 && <div className={styles.chatLog}>
                {chat.map((entry, i) => <div key={i} className={`${styles.chatEntry} ${entry.role === 'ai' ? styles.chatAi : ''}`}>
                  <small>{entry.role === 'user' ? 'あなた' : 'AI'} ・ {entry.at}</small>
                  <p>{entry.text}</p>
                </div>)}
              </div>}
              <div className={styles.formBody}>
                {aiFocus && <div className={styles.focusChip} role="status">
                  {icon('gps_fixed')}
                  <span>対象: {aiFocus.kind === 'category' ? 'カテゴリ' : 'チャンネル'}「{aiFocus.name}」について依頼します</span>
                  <button type="button" onClick={() => setAiFocus(null)} aria-label="対象指定を解除">{icon('close')}</button>
                </div>}
                <label className={ui.label}>命名スタイル
                  <select className={ui.select} value={style} onChange={e => setStyle(e.target.value)}>
                    {presets.map(p => <option key={p.id} value={p.id}>{p.label} — {p.description}</option>)}
                  </select>
                </label>
                <label className={ui.label}>依頼文
                  <textarea className={ui.textarea} rows={4} maxLength={1000} value={request} ref={requestTextareaRef}
                    placeholder={aiFocus ? `例: 「${aiFocus.name}」の権限をスタッフだけ見えるようにして` : '作りたい構成や変更したいことを具体的に書いてください'}
                    onChange={e => setRequest(e.target.value)} />
                  <span className={ui.muted}>{request.length} / 1000文字</span>
                </label>
                <button type="button" className={ui.buttonPrimary} disabled={generating || !request.trim()} onClick={() => void generate()}>
                  {icon('auto_awesome')} {generating ? 'プラン生成中…' : 'プランを生成'}
                </button>
              </div>
            </section>

            <section className={ui.panel} aria-label="プランプレビュー">
              <div className={ui.sectionHeader}>
                <div><h2>プラン操作一覧</h2><p>左のツリーが適用後の見え方です。操作を選ぶと詳細が表示され、チェックした操作だけが適用されます。プレビューは10分間有効です。</p></div>
                {preview && <span className={ui.badge}>{selected.size} / {preview.plan.operations.length} 件を選択中</span>}
              </div>
              {results ? <>
                <div className={styles.formBody}><p><strong>適用結果</strong></p></div>
                <div className={styles.resultList}>
                  {results.map(r => <div key={r.index} className={styles.resultItem}>
                    {icon(r.ok ? 'check_circle' : 'error', r.ok ? styles.resultOk : styles.resultNg)}
                    <span><b>{OP_LABELS[r.type] ?? r.type}</b> — {r.detail}</span>
                  </div>)}
                </div>
              </> : preview ? <>
                {preview.plan.summary && <div className={styles.formBody}><p>{preview.plan.summary}</p></div>}
                <div className={styles.opList}>
                  {preview.plan.operations.map((op, i) => {
                    const described = describeOp(op, preview.plan);
                    return <div key={i} className={`${styles.opCard} ${selected.has(i) ? '' : styles.opCardOff} ${detailOp === i ? styles.opCardSel : ''}`}>
                      <input type="checkbox" checked={selected.has(i)} onChange={() => toggleOp(i)} aria-label={`操作${i + 1}を適用する`} />
                      <button type="button" className={styles.opMain} onClick={() => setDetailOp(detailOp === i ? null : i)}>
                        <span className={styles.opIcon}>{icon(OP_ICONS[op.type] ?? 'extension')}</span>
                        <span><strong>{described.title}</strong>
                          <small>{OP_LABELS[op.type] ?? op.type}{described.detail ? ` — ${described.detail}` : ''}</small>
                          {detailOp === i && <small className={styles.opDetail}>{JSON.stringify(op)}</small>}</span>
                      </button>
                    </div>;
                  })}
                </div>
                <div className={styles.formBody}>
                  <button type="button" className={ui.buttonPrimary} disabled={applying || selected.size === 0} onClick={() => void apply()}>
                    {icon('check')} {applying ? '適用中…' : `選択した ${selected.size} 件を適用`}
                  </button>
                  <button type="button" className={ui.button} disabled={applying} onClick={() => setPreview(null)}>
                    {icon('close')} プレビューを破棄
                  </button>
                </div>
              </> : <div className={ui.emptyInner}>
                <div className={ui.emptyIcon}>{icon('fact_check')}</div>
                <h3>まだプランがありません</h3>
                <p>依頼フォームか、ツリーで選択した対象のクイック編集からプランを作れます。適用するまでサーバーは変更されません。</p>
              </div>}
            </section>
            </div>
          </div>

          <div className={ui.notice}>{icon('verified_user')} <div><strong style={{ color: 'var(--app-ink)' }}>安全設計</strong>
            <p>このパネルで実行できるのは作成・名前変更・移動・トピック/低速モード・権限上書きのみで、削除系の操作は含まれません。適用にはサーバー管理者権限が必要で、プレビューは発行した本人のみ・1回だけ使えます。</p></div></div>
        </>}
  </div>;
};

export default ServerBuilderPage;
