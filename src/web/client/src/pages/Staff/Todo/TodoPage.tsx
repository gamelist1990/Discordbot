import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAppToast } from '../../../AppToastProvider';
import styles from './TodoPage.module.css';

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

type TodoStatus = 'todo' | 'doing' | 'review' | 'blocked' | 'done';
type TodoPriority = 'low' | 'medium' | 'high' | 'critical';

type TodoItem = {
  id: string;
  title: string;
  status: TodoStatus;
  priority: TodoPriority;
  progress: number;
  summary: string;
  details: string;
  assignee: string;
  dueDate: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

type TodoBoard = {
  version: 3;
  guildId: string;
  channelId: string;
  messageId: string | null;
  title: string;
  summary: string;
  items: TodoItem[];
  updatedAt: string;
  updatedBy: string;
};

type TodoSnapshot = {
  messageId: string;
  jumpUrl: string;
  board: TodoBoard;
  updatedAt: string;
  updatedBy: string;
  embedCount: number;
} | null;

type ContextMenuState =
  | { x: number; y: number; itemId: string }
  | null;

type DragState = {
  itemId: string;
} | null;

type DropTargetState = {
  itemId: string;
  status: TodoStatus;
  position: 'before' | 'after';
} | {
  itemId: null;
  status: TodoStatus;
  position: 'end';
} | null;

const statusOptions: Array<{ value: TodoStatus; label: string }> = [
  { value: 'todo', label: 'Todo' },
  { value: 'doing', label: '進行中' },
  { value: 'review', label: '確認待ち' },
  { value: 'blocked', label: '停止中' },
  { value: 'done', label: '完了' },
];

const priorityOptions: Array<{ value: TodoPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const priorityLabelMap = Object.fromEntries(priorityOptions.map((option) => [option.value, option.label])) as Record<TodoPriority, string>;

function createEmptyBoard(title = 'Project Todo'): TodoBoard {
  return {
    version: 3,
    guildId: '',
    channelId: '',
    messageId: null,
    title,
    summary: '',
    items: [],
    updatedAt: new Date().toISOString(),
    updatedBy: 'Unknown',
  };
}

function createTodoItem(seed?: Partial<TodoItem>): TodoItem {
  const now = new Date().toISOString();
  return {
    id: seed?.id || `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: seed?.title || 'New Todo',
    status: seed?.status || 'todo',
    priority: seed?.priority || 'medium',
    progress: typeof seed?.progress === 'number' ? seed.progress : 0,
    summary: seed?.summary || '',
    details: seed?.details || '',
    assignee: seed?.assignee || '',
    dueDate: seed?.dueDate || null,
    tags: seed?.tags || [],
    createdAt: seed?.createdAt || now,
    updatedAt: seed?.updatedAt || now,
  };
}

const TodoPage: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo') || '/staff';
  const initialGuildId = params.guildId || '';
  const initialChannelId = params.channelId || '';

  const { addToast } = (() => {
    try {
      return useAppToast();
    } catch {
      return { addToast: undefined } as any;
    }
  })();

  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState(initialGuildId);
  const [selectedChannelId, setSelectedChannelId] = useState(initialChannelId);
  const [savedTodo, setSavedTodo] = useState<TodoSnapshot>(null);
  const [board, setBoard] = useState<TodoBoard>(createEmptyBoard());
  const [selectedItemId, setSelectedItemId] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetState>(null);
  const [loadingGuilds, setLoadingGuilds] = useState(true);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [, setLoadingTodo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === selectedGuildId) || null,
    [guilds, selectedGuildId]
  );
  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId) || null,
    [channels, selectedChannelId]
  );
  const sharePath = selectedGuildId && selectedChannelId ? `/todo/${selectedGuildId}/${selectedChannelId}` : '/todo';
  const textChannels = useMemo(
    () => channels.filter((channel) => [0, 5].includes(channel.type)),
    [channels]
  );
  const selectedItem = useMemo(
    () => board.items.find((item) => item.id === selectedItemId) || null,
    [board.items, selectedItemId]
  );
  const groupedItems = useMemo(() => {
    return statusOptions.map((status) => ({
      ...status,
      items: board.items.filter((item) => item.status === status.value),
    }));
  }, [board.items]);
  const completionRate = useMemo(() => {
    if (board.items.length === 0) return 0;
    return Math.round((board.items.filter((item) => item.status === 'done').length / board.items.length) * 100);
  }, [board.items]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close);
    };
  }, []);

  useEffect(() => {
    const loadGuilds = async () => {
      setLoadingGuilds(true);
      setError(null);
      try {
        const response = await fetch('/api/staff/guilds', { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'サーバー一覧の取得に失敗しました。');
        }

        const nextGuilds = (data.guilds || []) as GuildSummary[];
        setGuilds(nextGuilds);

        if (initialGuildId && nextGuilds.some((guild) => guild.id === initialGuildId)) {
          setSelectedGuildId(initialGuildId);
        } else if (!initialGuildId && nextGuilds[0]) {
          setSelectedGuildId(nextGuilds[0].id);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'サーバー一覧の取得に失敗しました。');
      } finally {
        setLoadingGuilds(false);
      }
    };

    loadGuilds();
  }, [initialGuildId]);

  useEffect(() => {
    if (!selectedGuildId) {
      setChannels([]);
      setSelectedChannelId('');
      setSavedTodo(null);
      setBoard(createEmptyBoard());
      setSelectedItemId('');
      return;
    }

    const loadChannels = async () => {
      setLoadingChannels(true);
      setError(null);
      try {
        const response = await fetch(`/api/staff/guilds/${selectedGuildId}/channels`, { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'チャンネル一覧の取得に失敗しました。');
        }

        const nextChannels = ((data.channels || []) as GuildChannel[])
          .filter((channel) => [0, 5].includes(channel.type))
          .sort((left, right) => left.position - right.position);

        setChannels(nextChannels);
        setSelectedChannelId((current) => {
          if (initialChannelId && selectedGuildId === initialGuildId && nextChannels.some((channel) => channel.id === initialChannelId)) {
            return initialChannelId;
          }
          if (nextChannels.some((channel) => channel.id === current)) {
            return current;
          }
          return nextChannels[0]?.id || '';
        });
      } catch (loadError) {
        setChannels([]);
        setError(loadError instanceof Error ? loadError.message : 'チャンネル一覧の取得に失敗しました。');
      } finally {
        setLoadingChannels(false);
      }
    };

    loadChannels();
  }, [initialChannelId, initialGuildId, selectedGuildId]);

  useEffect(() => {
    if (!selectedGuildId || !selectedChannelId) {
      setSavedTodo(null);
      setBoard(createEmptyBoard());
      setSelectedItemId('');
      return;
    }

    navigate(`/todo/${selectedGuildId}/${selectedChannelId}`, { replace: true });

    const loadTodo = async () => {
      setLoadingTodo(true);
      setError(null);
      try {
        const response = await fetch(`/api/staff/todo/${selectedGuildId}/${selectedChannelId}`, { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Todo の取得に失敗しました。');
        }

        const nextTodo = (data.todo || null) as TodoSnapshot;
        setSavedTodo(nextTodo);
        const nextBoard = nextTodo?.board || { ...createEmptyBoard(), guildId: selectedGuildId, channelId: selectedChannelId };
        setBoard(nextBoard);
        setSelectedItemId((current) => nextBoard.items.some((item) => item.id === current) ? current : nextBoard.items[0]?.id || '');
      } catch (loadError) {
        setSavedTodo(null);
        const nextBoard = createEmptyBoard();
        nextBoard.guildId = selectedGuildId;
        nextBoard.channelId = selectedChannelId;
        setBoard(nextBoard);
        setSelectedItemId('');
        setError(loadError instanceof Error ? loadError.message : 'Todo の取得に失敗しました。');
      } finally {
        setLoadingTodo(false);
      }
    };

    loadTodo();
  }, [navigate, selectedChannelId, selectedGuildId]);

  const patchBoard = (updater: (current: TodoBoard) => TodoBoard) => {
    setBoard((current) => ({
      ...updater(current),
      updatedAt: new Date().toISOString(),
      updatedBy: 'Web Editor',
    }));
  };

  const updateSelectedItem = (patch: Partial<TodoItem>) => {
    if (!selectedItem) return;
    patchBoard((current) => ({
      ...current,
      items: current.items.map((item) => (
        item.id === selectedItem.id
          ? {
              ...item,
              ...patch,
              progress: patch.progress !== undefined ? Math.max(0, Math.min(100, Math.round(patch.progress))) : item.progress,
              tags: patch.tags ?? item.tags,
              updatedAt: new Date().toISOString(),
            }
          : item
      )),
    }));
  };

  const addItem = () => {
    const item = createTodoItem({ title: `Task ${board.items.length + 1}` });
    patchBoard((current) => ({
      ...current,
      items: [...current.items, item],
    }));
    setSelectedItemId(item.id);
  };

  const duplicateItem = (itemId: string) => {
    const source = board.items.find((item) => item.id === itemId);
    if (!source) return;
    const item = createTodoItem({
      ...source,
      id: undefined,
      title: `${source.title} Copy`,
      createdAt: undefined,
      updatedAt: undefined,
    });
    const index = board.items.findIndex((entry) => entry.id === itemId);
    patchBoard((current) => {
      const nextItems = [...current.items];
      nextItems.splice(index + 1, 0, item);
      return { ...current, items: nextItems };
    });
    setSelectedItemId(item.id);
  };

  const deleteItem = (itemId: string) => {
    const target = board.items.find((item) => item.id === itemId);
    if (!target) return;
    patchBoard((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== itemId),
    }));
    setSelectedItemId((current) => current === itemId ? board.items.find((item) => item.id !== itemId)?.id || '' : current);
  };

  const moveItem = (itemId: string, direction: -1 | 1) => {
    const index = board.items.findIndex((item) => item.id === itemId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= board.items.length) return;
    patchBoard((current) => {
      const nextItems = [...current.items];
      const [target] = nextItems.splice(index, 1);
      nextItems.splice(nextIndex, 0, target);
      return { ...current, items: nextItems };
    });
  };

  const reorderItem = (itemId: string, target: DropTargetState) => {
    if (!target) return;

    patchBoard((current) => {
      const sourceIndex = current.items.findIndex((item) => item.id === itemId);
      if (sourceIndex < 0) {
        return current;
      }

      const source = current.items[sourceIndex];
      const remaining = current.items.filter((item) => item.id !== itemId);
      const movedItem: TodoItem = {
        ...source,
        status: target.status,
        updatedAt: new Date().toISOString(),
      };

      let insertIndex = remaining.length;
      if (target.itemId) {
        const targetIndex = remaining.findIndex((item) => item.id === target.itemId);
        if (targetIndex >= 0) {
          insertIndex = target.position === 'after' ? targetIndex + 1 : targetIndex;
        }
      } else {
        const sameStatusIndexes = remaining
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.status === target.status);
        insertIndex = sameStatusIndexes.length > 0
          ? sameStatusIndexes[sameStatusIndexes.length - 1].index + 1
          : remaining.length;
      }

      const nextItems = [...remaining];
      nextItems.splice(insertIndex, 0, movedItem);
      return {
        ...current,
        items: nextItems,
      };
    });
  };

  const cycleStatus = (itemId: string) => {
    const index = statusOptions.findIndex((status) => status.value === board.items.find((item) => item.id === itemId)?.status);
    if (index < 0) return;
    const nextStatus = statusOptions[(index + 1) % statusOptions.length].value;
    patchBoard((current) => ({
      ...current,
      items: current.items.map((item) => item.id === itemId ? { ...item, status: nextStatus, updatedAt: new Date().toISOString() } : item),
    }));
  };

  const resetFromSaved = () => {
    const nextBoard = savedTodo?.board || createEmptyBoard();
    setBoard(nextBoard);
    setSelectedItemId(nextBoard.items[0]?.id || '');
  };

  const saveTodo = async () => {
    if (!selectedGuildId || !selectedChannelId) {
      addToast?.('投稿先を確認してください', 'warning');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/todo/${selectedGuildId}/${selectedChannelId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(board),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Todo の保存に失敗しました。');
      }

      const nextTodo = (data.todo || null) as TodoSnapshot;
      setSavedTodo(nextTodo);
      const nextBoard = nextTodo?.board || { ...createEmptyBoard(), guildId: selectedGuildId, channelId: selectedChannelId };
      setBoard(nextBoard);
      setSelectedItemId((current) => nextBoard.items.some((item) => item.id === current) ? current : nextBoard.items[0]?.id || '');
      addToast?.('Todo ボードを Discord に反映しました', 'success');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Todo の保存に失敗しました。';
      setError(message);
      addToast?.(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${sharePath}`);
      addToast?.('直アクセス URL をコピーしました', 'success');
    } catch {
      addToast?.('URL のコピーに失敗しました', 'error');
    }
  };

  const openContextMenu = (event: React.MouseEvent, itemId: string) => {
    event.preventDefault();
    setSelectedItemId(itemId);
    setContextMenu({ x: event.clientX, y: event.clientY, itemId });
  };

  const startDragItem = (itemId: string) => {
    setDragState({ itemId });
    setSelectedItemId(itemId);
    setContextMenu(null);
  };

  const finishDragItem = () => {
    setDragState(null);
    setDropTarget(null);
  };

  if (loadingGuilds) {
    return <div className={styles.loading}>Todo 機能を読み込んでいます...</div>;
  }

  return (
    <div className={styles.page} onContextMenu={(event) => event.preventDefault()}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>Staff Todo</span>
          <h1>リスト型 Todo 管理ツール</h1>
          <p>右クリックのコンテキストメニューで項目操作しながら、Discord には概要 Embed と詳細ドロップダウンを投稿します。</p>
        </div>
        <div className={styles.heroActions}>
          <button className={styles.secondaryButton} onClick={() => navigate(returnTo)} type="button">
            <span className="material-icons">arrow_back</span>
            戻る
          </button>
          <button className={styles.secondaryButton} onClick={copyShareUrl} type="button" disabled={!selectedGuildId || !selectedChannelId}>
            <span className="material-icons">link</span>
            URL をコピー
          </button>
          <button className={styles.primaryButton} onClick={saveTodo} type="button" disabled={saving || !selectedGuildId || !selectedChannelId}>
            <span className="material-icons">send</span>
            {saving ? '反映中...' : savedTodo?.messageId ? 'Discord を更新' : 'Discord に投稿'}
          </button>
        </div>
      </header>

      {error ? <div className={styles.errorBox}>{error}</div> : null}

      <section className={styles.selectorCard}>
        <div className={styles.selectorGrid}>
          <label className={styles.field}>
            <span>サーバー</span>
            <select
              value={selectedGuildId}
              onChange={(event) => {
                setSelectedGuildId(event.target.value);
                setSelectedChannelId('');
              }}
            >
              <option value="">サーバーを選択</option>
              {guilds.map((guild) => (
                <option key={guild.id} value={guild.id}>{guild.name}</option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>チャンネル</span>
            <select
              value={selectedChannelId}
              onChange={(event) => setSelectedChannelId(event.target.value)}
              disabled={!selectedGuildId || loadingChannels}
            >
              <option value="">チャンネルを選択</option>
              {textChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>#{channel.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className={styles.selectorMeta}>
          <div>
            <strong>{selectedGuild?.name || '未選択'}</strong>
            <span>{selectedChannel ? `#${selectedChannel.name}` : 'チャンネル未選択'}</span>
          </div>
          <code>{sharePath}</code>
        </div>
      </section>

      {!selectedGuildId || !selectedChannelId ? (
        <div className={styles.emptyState}>Todo を管理するにはサーバーとチャンネルを選択してください。</div>
      ) : (
        <>
          <section className={styles.boardCard}>
            <div className={styles.boardHeader}>
              <div className={styles.boardMeta}>
                <span className={styles.sectionEyebrow}>Board</span>
                <h2>ボード設定</h2>
              </div>
              <div className={styles.summaryStats}>
                <div><strong>{board.items.length}</strong><span>Items</span></div>
                <div><strong>{completionRate}%</strong><span>Done Rate</span></div>
                <div><strong>{savedTodo?.embedCount || 0}</strong><span>Embeds</span></div>
              </div>
            </div>

            <div className={styles.boardGrid}>
              <label className={styles.field}>
                <span>ボードタイトル</span>
                <input
                  type="text"
                  value={board.title}
                  maxLength={120}
                  onChange={(event) => setBoard((current) => ({ ...current, title: event.target.value }))}
                />
              </label>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span>概要</span>
                <textarea
                  className={styles.summaryTextarea}
                  value={board.summary}
                  onChange={(event) => setBoard((current) => ({ ...current, summary: event.target.value }))}
                  placeholder="このボード全体の進行状況や注記を書きます。"
                />
              </label>
            </div>

            <div className={styles.buttonRow}>
              <button className={styles.secondaryButton} onClick={resetFromSaved} type="button" disabled={saving}>
                <span className="material-icons">restart_alt</span>
                保存済みに戻す
              </button>
              <button className={styles.secondaryButton} onClick={addItem} type="button">
                <span className="material-icons">add</span>
                項目を追加
              </button>
            </div>
          </section>

          <div className={styles.layout}>
            <section className={styles.listPane}>
              <div className={styles.listHeader}>
                <div>
                  <span className={styles.sectionEyebrow}>Items</span>
                  <h2>Todo 一覧</h2>
                </div>
                <button className={styles.primaryButton} onClick={addItem} type="button">
                  <span className="material-icons">playlist_add</span>
                  新規項目
                </button>
              </div>

              <div className={styles.groups}>
                {groupedItems.map((group) => (
                  <section key={group.value} className={styles.groupCard}>
                    <div className={styles.groupHeader}>
                      <h3>{group.label}</h3>
                      <span>{group.items.length}</span>
                    </div>
                    <div
                      className={`${styles.itemList} ${dropTarget?.itemId === null && dropTarget.status === group.value ? styles.itemListDropActive : ''}`}
                      onDragOver={(event) => {
                        if (!dragState) return;
                        event.preventDefault();
                        setDropTarget({ itemId: null, status: group.value, position: 'end' });
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (!dragState) return;
                        reorderItem(dragState.itemId, { itemId: null, status: group.value, position: 'end' });
                        finishDragItem();
                      }}
                    >
                      {group.items.length === 0 ? (
                        <div className={styles.emptyMini}>項目なし</div>
                      ) : group.items.map((item) => (
                        <button
                          key={item.id}
                          className={`${styles.itemCard} ${selectedItemId === item.id ? styles.itemCardActive : ''} ${dragState?.itemId === item.id ? styles.itemCardDragging : ''} ${dropTarget?.itemId === item.id ? styles.itemDropTarget : ''}`}
                          onClick={() => setSelectedItemId(item.id)}
                          onContextMenu={(event) => openContextMenu(event, item.id)}
                          draggable
                          onDragStart={() => startDragItem(item.id)}
                          onDragEnd={finishDragItem}
                          onDragOver={(event) => {
                            if (!dragState || dragState.itemId === item.id) return;
                            event.preventDefault();
                            const rect = event.currentTarget.getBoundingClientRect();
                            const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                            setDropTarget({ itemId: item.id, status: group.value, position });
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (!dragState || dragState.itemId === item.id) return;
                            const rect = event.currentTarget.getBoundingClientRect();
                            const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                            reorderItem(dragState.itemId, { itemId: item.id, status: group.value, position });
                            finishDragItem();
                          }}
                          type="button"
                        >
                          <div className={styles.itemHead}>
                            <strong>{item.title}</strong>
                            <span>{item.progress}%</span>
                          </div>
                          <p>{item.summary || '要約なし'}</p>
                          <div className={styles.itemMeta}>
                            <span>{priorityLabelMap[item.priority]}</span>
                            <span>{item.assignee || '担当未設定'}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>

            <section className={styles.detailPane}>
              {!selectedItem ? (
                <div className={styles.emptyState}>左の一覧から Todo 項目を選択してください。</div>
              ) : (
                <article className={styles.detailCard}>
                  <div className={styles.detailHeader}>
                    <div>
                      <span className={styles.sectionEyebrow}>Detail</span>
                      <h2>{selectedItem.title}</h2>
                    </div>
                    <div className={styles.quickActions}>
                      <button className={styles.iconButton} onClick={() => moveItem(selectedItem.id, -1)} type="button">
                        <span className="material-icons">arrow_upward</span>
                      </button>
                      <button className={styles.iconButton} onClick={() => moveItem(selectedItem.id, 1)} type="button">
                        <span className="material-icons">arrow_downward</span>
                      </button>
                      <button className={styles.iconButton} onClick={() => duplicateItem(selectedItem.id)} type="button">
                        <span className="material-icons">content_copy</span>
                      </button>
                      <button className={styles.iconButtonDanger} onClick={() => deleteItem(selectedItem.id)} type="button">
                        <span className="material-icons">delete</span>
                      </button>
                    </div>
                  </div>

                  <div className={styles.detailGrid}>
                    <label className={styles.field}>
                      <span>タイトル</span>
                      <input type="text" value={selectedItem.title} onChange={(event) => updateSelectedItem({ title: event.target.value })} />
                    </label>
                    <label className={styles.field}>
                      <span>状態</span>
                      <select value={selectedItem.status} onChange={(event) => updateSelectedItem({ status: event.target.value as TodoStatus })}>
                        {statusOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>優先度</span>
                      <select value={selectedItem.priority} onChange={(event) => updateSelectedItem({ priority: event.target.value as TodoPriority })}>
                        {priorityOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>進捗</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={selectedItem.progress}
                        onChange={(event) => updateSelectedItem({ progress: Number(event.target.value) })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>担当</span>
                      <input type="text" value={selectedItem.assignee} onChange={(event) => updateSelectedItem({ assignee: event.target.value })} />
                    </label>
                    <label className={styles.field}>
                      <span>期限</span>
                      <input
                        type="text"
                        value={selectedItem.dueDate || ''}
                        onChange={(event) => updateSelectedItem({ dueDate: event.target.value || null })}
                        placeholder="2026-04-30"
                      />
                    </label>
                    <label className={`${styles.field} ${styles.fieldWide}`}>
                      <span>要約</span>
                      <textarea
                        className={styles.summaryTextarea}
                        value={selectedItem.summary}
                        onChange={(event) => updateSelectedItem({ summary: event.target.value })}
                        placeholder="一覧に表示する短い説明"
                      />
                    </label>
                    <label className={`${styles.field} ${styles.fieldWide}`}>
                      <span>詳細</span>
                      <textarea
                        className={styles.detailsTextarea}
                        value={selectedItem.details}
                        onChange={(event) => updateSelectedItem({ details: event.target.value })}
                        placeholder="ドロップダウンから表示する詳細情報"
                      />
                    </label>
                    <label className={`${styles.field} ${styles.fieldWide}`}>
                      <span>タグ</span>
                      <input
                        type="text"
                        value={selectedItem.tags.join(' ')}
                        onChange={(event) => updateSelectedItem({ tags: event.target.value.split(/\s+/).map((tag) => tag.trim()).filter(Boolean) })}
                        placeholder="backend api urgent"
                      />
                    </label>
                  </div>

                  <div className={styles.detailFooter}>
                    <span>更新者: {savedTodo?.updatedBy || '未保存'}</span>
                    <span>最終更新: {savedTodo?.updatedAt ? new Date(savedTodo.updatedAt).toLocaleString() : '未保存'}</span>
                  </div>
                </article>
              )}

              <article className={styles.infoCard}>
                <div className={styles.infoList}>
                  <div className={styles.infoItem}>
                    <span>Discord 投稿</span>
                    <strong>{savedTodo?.messageId || '未投稿'}</strong>
                  </div>
                  <div className={styles.infoItem}>
                    <span>詳細確認</span>
                    <strong>ドロップダウン選択</strong>
                  </div>
                  <div className={styles.infoItem}>
                    <span>保存方式</span>
                    <strong>Database + Discord Embed</strong>
                  </div>
                </div>
                <div className={styles.buttonRow}>
                  <a
                    className={styles.linkButton}
                    href={savedTodo?.jumpUrl || '#'}
                    target="_blank"
                    rel="noreferrer"
                    aria-disabled={!savedTodo?.jumpUrl}
                  >
                    <span className="material-icons">open_in_new</span>
                    Discord で開く
                  </a>
                </div>
              </article>
            </section>
          </div>
        </>
      )}

      {contextMenu ? (
        <div className={styles.contextMenu} style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button className={styles.contextItem} onClick={() => { cycleStatus(contextMenu.itemId); setContextMenu(null); }} type="button">
            <span className="material-icons">sync_alt</span>
            <span>状態を進める</span>
          </button>
          <button className={styles.contextItem} onClick={() => { duplicateItem(contextMenu.itemId); setContextMenu(null); }} type="button">
            <span className="material-icons">content_copy</span>
            <span>複製</span>
          </button>
          <button className={styles.contextItem} onClick={() => { moveItem(contextMenu.itemId, -1); setContextMenu(null); }} type="button">
            <span className="material-icons">arrow_upward</span>
            <span>上へ移動</span>
          </button>
          <button className={styles.contextItem} onClick={() => { moveItem(contextMenu.itemId, 1); setContextMenu(null); }} type="button">
            <span className="material-icons">arrow_downward</span>
            <span>下へ移動</span>
          </button>
          <button className={`${styles.contextItem} ${styles.contextDanger}`} onClick={() => { deleteItem(contextMenu.itemId); setContextMenu(null); }} type="button">
            <span className="material-icons">delete</span>
            <span>削除</span>
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default TodoPage;
