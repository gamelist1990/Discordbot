import React, { useMemo, useState } from 'react';
import styles from './ServerBuilder.module.css';

export type TreeChannel = {
  id: string; name: string; kind: string; parentId?: string; topic?: string;
  position: number; permissionOverwrites?: { targetKind: string; targetId: string; targetName?: string; allow: string[]; deny: string[] }[];
  permissionsSynced?: boolean | null; isPrivate?: boolean; slowmodeSeconds?: number;
};
export type TreeStructure = {
  guildId: string; guildName: string;
  categories: { id: string; name: string; position: number; permissionOverwrites?: TreeChannel['permissionOverwrites']; isPrivate?: boolean }[];
  channels: TreeChannel[]; roles: { id: string; name: string }[]; channelCount: number;
};
export type TreeOperation = { type: string; [key: string]: unknown };

export const CHANGE_LABELS: Record<string, string> = {
  create: '新規', rename: '名前変更', move: '移動', permissions: '権限', position: '並び替え', sync: '同期', topic: 'トピック', slowmode: '低速',
};

function resolveRefId(ref: unknown, planOps: TreeOperation[]): string | undefined {
  if (ref === null || ref === undefined) return undefined;
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'object') {
    const r = ref as { kind?: string; id?: string; index?: number; newIndex?: number };
    if (r.kind === 'existing' && r.id) return r.id;
    if (r.kind === 'new' && typeof r.index === 'number') return `new:${r.index}`;
    if (typeof r.newIndex === 'number') return `new:${r.newIndex}`;
  }
  void planOps;
  return undefined;
}

/** プラン（選択中操作のみ）を構造に適用したプレビュー用構造と、ノードID→変更種別の対応を返す。 */
export function applyPlanToStructure(
  base: TreeStructure, operations: TreeOperation[], selected: Set<number>,
): { structure: TreeStructure; changes: Map<string, string[]> } {
  const structure: TreeStructure = JSON.parse(JSON.stringify(base)) as TreeStructure;
  const changes = new Map<string, string[]>();
  const mark = (id: string, label: string) => {
    const arr = changes.get(id) ?? []; if (!arr.includes(label)) arr.push(label); changes.set(id, arr);
  };
  const findCh = (id: string) => structure.channels.find(c => c.id === id);
  operations.forEach((op, i) => {
    if (!selected.has(i)) return;
    switch (op.type) {
      case 'createCategory': {
        const id = `new:${i}`;
        const pos = Math.max(-1, ...structure.categories.map(c => c.position)) + 1;
        structure.categories.push({ id, name: String(op.name), position: pos, permissionOverwrites: [], isPrivate: false });
        structure.channels.push({ id, name: String(op.name), kind: 'category', position: pos, permissionOverwrites: [], permissionsSynced: null, isPrivate: false });
        mark(id, 'create'); break;
      }
      case 'createChannel': {
        const id = `new:${i}`;
        const parentId = resolveRefId(op.categoryRef, operations);
        const siblings = structure.channels.filter(c => c.kind !== 'category' && c.parentId === parentId);
        const pos = Math.max(-1, ...siblings.map(c => c.position)) + 1;
        structure.channels.push({
          id, name: String(op.name), kind: String(op.channelType), ...(parentId ? { parentId } : {}),
          ...(typeof op.topic === 'string' ? { topic: op.topic } : {}),
          position: pos, permissionOverwrites: [], permissionsSynced: parentId ? false : null, isPrivate: false,
          ...(typeof op.slowmodeSeconds === 'number' ? { slowmodeSeconds: op.slowmodeSeconds } : {}),
        });
        mark(id, 'create'); break;
      }
      case 'renameChannel': { const c = findCh(String(op.channelId)); if (c) { c.name = String(op.name); mark(c.id, 'rename'); } break; }
      case 'renameCategory': {
        const c = findCh(String(op.categoryId)); if (c) { c.name = String(op.name); mark(c.id, 'rename'); }
        const cat = structure.categories.find(x => x.id === String(op.categoryId)); if (cat) cat.name = String(op.name);
        break;
      }
      case 'moveChannel': { const c = findCh(String(op.channelId)); const pid = resolveRefId(op.categoryRef, operations); if (c && pid) { c.parentId = pid; mark(c.id, 'move'); } break; }
      case 'setTopic': { const c = findCh(String(op.channelId)); if (c) { c.topic = String(op.topic); mark(c.id, 'topic'); } break; }
      case 'setSlowmode': { const c = findCh(String(op.channelId)); if (c) { c.slowmodeSeconds = Number(op.seconds); mark(c.id, 'slowmode'); } break; }
      case 'setPosition': {
        const id = String(op.targetId);
        const c = findCh(id); if (c) { c.position = Number(op.position); mark(id, 'position'); }
        if (op.targetKind === 'category') { const cat = structure.categories.find(x => x.id === id); if (cat) cat.position = Number(op.position); }
        break;
      }
      case 'syncPermissions': {
        const c = findCh(String(op.channelId));
        if (c) {
          const parent = c.parentId ? findCh(c.parentId) : undefined;
          if (parent) c.permissionOverwrites = JSON.parse(JSON.stringify(parent.permissionOverwrites ?? []));
          c.permissionsSynced = true; c.isPrivate = parent?.isPrivate ?? c.isPrivate; mark(c.id, 'sync');
        }
        break;
      }
      case 'setPermissions': {
        const targetId = typeof op.targetId === 'string' ? op.targetId
          : (op.targetRef && typeof op.targetRef === 'object' ? `new:${(op.targetRef as { index: number }).index}` : '');
        const c = findCh(targetId);
        const specs = Array.isArray(op.overwrites) ? op.overwrites as { targetKind: string; roleId?: string; allow?: string[]; deny?: string[] }[] : [];
        if (c) {
          for (const sp of specs) {
            const tid = sp.targetKind === 'everyone' ? '@everyone' : (sp.roleId ?? '');
            const existing = (c.permissionOverwrites ?? []).find(o => o.targetId === tid);
            const entry = { targetKind: sp.targetKind, targetId: tid, allow: sp.allow ?? [], deny: sp.deny ?? [] };
            if (existing) Object.assign(existing, entry); else (c.permissionOverwrites ??= []).push(entry);
            if (sp.targetKind === 'everyone') {
              if ((sp.deny ?? []).includes('ViewChannel')) c.isPrivate = true;
              if ((sp.allow ?? []).includes('ViewChannel')) c.isPrivate = false;
            }
          }
          if (c.kind !== 'category') c.permissionsSynced = false;
          mark(c.id, 'permissions');
        }
        if (op.targetKind === 'category') { const cat = structure.categories.find(x => x.id === targetId); if (cat && c) { cat.isPrivate = c.isPrivate; cat.permissionOverwrites = c.permissionOverwrites; } }
        break;
      }
      default: break;
    }
  });
  return { structure, changes };
}

const KIND_ICON: Record<string, string> = { voice: 'volume_up', announcement: 'campaign', forum: 'forum', stage: 'podcasts', media: 'perm_media', category: 'folder_open' };

export const ServerBuilderTree: React.FC<{
  structure: TreeStructure;
  changes?: Map<string, string[]>;
  selectedId?: string;
  onSelect?: (id: string) => void;
}> = ({ structure, changes, selectedId, onSelect }) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { uncategorized, byCategory } = useMemo(() => {
    const nonCat = structure.channels.filter(c => c.kind !== 'category');
    const sorted = [...nonCat].sort((a, b) => a.position - b.position);
    const cats = new Set(structure.categories.map(c => c.id));
    const by = new Map<string, TreeChannel[]>();
    for (const c of sorted) if (c.parentId && cats.has(c.parentId)) { const a = by.get(c.parentId) ?? []; a.push(c); by.set(c.parentId, a); }
    return { uncategorized: sorted.filter(c => !c.parentId || !cats.has(c.parentId)), byCategory: by };
  }, [structure]);
  const catsSorted = useMemo(() => [...structure.categories].sort((a, b) => a.position - b.position), [structure.categories]);

  const chRow = (c: TreeChannel) => {
    const ch = changes?.get(c.id) ?? [];
    return <button type="button" key={c.id} className={`${styles.treeCh} ${selectedId === c.id ? styles.treeChSel : ''}`} onClick={() => onSelect?.(c.id)}>
      <span className={styles.treeChIcon} aria-hidden="true">{c.kind === 'text' || c.kind === 'other'
        ? <span className={styles.hashIcon}>#</span>
        : <span className="material-icons" style={{ fontSize: 17 }}>{KIND_ICON[c.kind] ?? 'tag'}</span>}</span>
      <span className={styles.treeChName}>{c.name}</span>
      {c.isPrivate && <span className={`material-icons ${styles.lockBadge}`} aria-label="プライベート">lock</span>}
      {ch.map(label => <span key={label} className={styles.changeBadge}>{CHANGE_LABELS[label] ?? label}</span>)}
    </button>;
  };

  return <div className={styles.tree} role="tree" aria-label="サーバー構造ツリー">
    {uncategorized.map(chRow)}
    {catsSorted.map(cat => {
      const ch = changes?.get(cat.id) ?? [];
      const isCollapsed = collapsed.has(cat.id);
      return <div key={cat.id} className={styles.treeCat}>
        <div className={styles.treeCatRowWrap}>
          <button type="button" className={styles.treeCollapse} aria-label={isCollapsed ? '展開' : '折りたたみ'}
            onClick={() => setCollapsed(prev => { const n = new Set(prev); if (n.has(cat.id)) n.delete(cat.id); else n.add(cat.id); return n; })}>
            <span className="material-icons" style={{ fontSize: 16 }}>{isCollapsed ? 'chevron_right' : 'expand_more'}</span>
          </button>
          <button type="button" className={`${styles.treeCatRow} ${selectedId === cat.id ? styles.treeChSel : ''}`} onClick={() => onSelect?.(cat.id)}>
            <span className={styles.treeCatName}>{cat.name}</span>
            {cat.isPrivate && <span className={`material-icons ${styles.lockBadge}`} aria-label="プライベート">lock</span>}
            {ch.map(label => <span key={label} className={styles.changeBadge}>{CHANGE_LABELS[label] ?? label}</span>)}
          </button>
        </div>
        {!isCollapsed && <div className={styles.treeChildren}>{(byCategory.get(cat.id) ?? []).map(chRow)}</div>}
      </div>;
    })}
    {structure.channels.length === 0 && <p className={styles.treeEmpty}>チャンネルがありません</p>}
  </div>;
};

export default ServerBuilderTree;
