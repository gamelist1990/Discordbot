import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import styles from './TodoSession.module.css';

interface TodoSession {
    id: string;
    name: string;
    ownerId: string;
    viewers: string[];
    editors: string[];
}

interface TodoItem {
    id: string;
    text: string;
    completed: boolean;
    priority: 'low' | 'medium' | 'high';
    tags: string[];
    description?: string;
    dueDate?: number;
    createdAt: number;
}

type AccessLevel = 'owner' | 'editor' | 'viewer';

const TodoSessionPage: React.FC = () => {
    const { guildId: routeGuildId, sessionId, token } = useParams<{ guildId?: string; sessionId?: string; token?: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const guildId = routeGuildId || searchParams.get('guildId') || '';
    const [todoSession, setTodoSession] = useState<TodoSession | null>(null);
    const [todos, setTodos] = useState<TodoItem[]>([]);
    const [accessLevel, setAccessLevel] = useState<AccessLevel>('viewer');
    const [loading, setLoading] = useState(true);
    const [newTodoText, setNewTodoText] = useState('');
    const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');
    const [showShareModal, setShowShareModal] = useState(false);

    useEffect(() => {
        loadData();
    }, [sessionId, token]);

    const loadData = async () => {
        try {
            setLoading(true);
            let sessionData, contentData;

            if (token) {
                // 共有トークン経由（guildId は共通の 'default' を使用）
                const sharedGuildId = guildId || 'default';
                const sessionRes = await fetch(`/api/todos/shared/${token}?guildId=${sharedGuildId}`, { credentials: 'include' });
                if (!sessionRes.ok) throw new Error('Shared session not found');
                sessionData = await sessionRes.json();
                contentData = sessionData; // 同じレスポンスに含まれる
                setTodoSession(sessionData.session);
                setAccessLevel(sessionData.accessLevel);
                setTodos(sessionData.content?.todos || []);
            } else {
                // 通常アクセス
                const [sessionRes, contentRes] = await Promise.all([
                    fetch(`/api/todos/sessions/${sessionId}`, { credentials: 'include' }),
                    fetch(`/api/todos/sessions/${sessionId}/content`, { credentials: 'include' })
                ]);

                if (sessionRes.ok && contentRes.ok) {
                    sessionData = await sessionRes.json();
                    contentData = await contentRes.json();
                    
                    setTodoSession(sessionData.session);
                    setAccessLevel(contentData.accessLevel);
                    setTodos(contentData.content.todos || []);
                }
            }
        } catch (err) {
            console.error('Failed to load data:', err);
            // setError('Failed to load session');
        } finally {
            setLoading(false);
        }
    };

    const addTodo = async () => {
        if (!newTodoText.trim() || accessLevel === 'viewer') return;

        try {
            const response = await fetch(`/api/todos/sessions/${sessionId}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ text: newTodoText.trim(), priority: 'medium', tags: [] })
            });

            if (response.ok) {
                await loadData();
                setNewTodoText('');
            }
        } catch (err) {
            console.error('Failed to add todo:', err);
        }
    };

    const toggleTodo = async (todoId: string, completed: boolean) => {
        if (accessLevel === 'viewer') return;

        try {
            await fetch(`/api/todos/sessions/${sessionId}/items/${todoId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ completed: !completed })
            });
            await loadData();
        } catch (err) {
            console.error('Failed to toggle todo:', err);
        }
    };

    const deleteTodo = async (todoId: string) => {
        if (accessLevel === 'viewer') return;

        try {
            await fetch(`/api/todos/sessions/${sessionId}/items/${todoId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            await loadData();
        } catch (err) {
            console.error('Failed to delete todo:', err);
        }
    };

    const deleteSession = async () => {
        if (accessLevel !== 'owner') return;
        if (!window.confirm('このセッションを削除しますか？')) return;

        try {
            const response = await fetch(`/api/todos/sessions/${sessionId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (response.ok) {
                navigate(`/todo/${guildId}`);
            }
        } catch (err) {
            console.error('Failed to delete session:', err);
        }
    };

    const filteredTodos = todos.filter(todo => {
        if (filter === 'active') return !todo.completed;
        if (filter === 'completed') return todo.completed;
        return true;
    });

    const canEdit = accessLevel === 'owner' || accessLevel === 'editor';

    if (loading) {
        return (
            <div className={styles.loading}>
                <div className={styles.spinner}></div>
                <p>読み込み中...</p>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <button className={styles.backBtn} onClick={() => navigate(`/todo/${guildId || 'default'}`)}>
                    <i className="material-icons">arrow_back</i>
                    戻る
                </button>
                <h1 className={styles.title}>{todoSession?.name}</h1>
                <div className={styles.actions}>
                    <span className={styles.badge} data-level={accessLevel}>
                        {accessLevel === 'owner' ? 'オーナー' : accessLevel === 'editor' ? '編集者' : '閲覧者'}
                    </span>
                    {accessLevel === 'owner' && (
                        <>
                            <button className={styles.actionBtn} onClick={() => setShowShareModal(true)}>
                                <i className="material-icons">share</i>
                                共有
                            </button>
                            <button className={styles.deleteBtn} onClick={deleteSession}>
                                <i className="material-icons">delete</i>
                                削除
                            </button>
                        </>
                    )}
                </div>
            </header>

            <main className={styles.main}>
                {canEdit && (
                    <div className={styles.addTodo}>
                        <input
                            type="text"
                            placeholder="新しいTodoを追加..."
                            value={newTodoText}
                            onChange={(e) => setNewTodoText(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && addTodo()}
                            className={styles.input}
                        />
                        <button className={styles.addBtn} onClick={addTodo} disabled={!newTodoText.trim()}>
                            <i className="material-icons">add</i>
                        </button>
                    </div>
                )}

                <div className={styles.filters}>
                    <button className={`${styles.filterBtn} ${filter === 'all' ? styles.active : ''}`} onClick={() => setFilter('all')}>
                        全て ({todos.length})
                    </button>
                    <button className={`${styles.filterBtn} ${filter === 'active' ? styles.active : ''}`} onClick={() => setFilter('active')}>
                        未完了 ({todos.filter(t => !t.completed).length})
                    </button>
                    <button className={`${styles.filterBtn} ${filter === 'completed' ? styles.active : ''}`} onClick={() => setFilter('completed')}>
                        完了 ({todos.filter(t => t.completed).length})
                    </button>
                </div>

                <div className={styles.todoList}>
                    {filteredTodos.length === 0 ? (
                        <div className={styles.empty}>
                            <i className="material-icons">inbox</i>
                            <p>Todoがありません</p>
                        </div>
                    ) : (
                        filteredTodos.map(todo => (
                            <div key={todo.id} className={`${styles.todoItem} ${todo.completed ? styles.completed : ''}`}>
                                <input
                                    type="checkbox"
                                    checked={todo.completed}
                                    onChange={() => toggleTodo(todo.id, todo.completed)}
                                    disabled={!canEdit}
                                    className={styles.checkbox}
                                />
                                <div className={styles.todoContent}>
                                    <span className={styles.todoText}>{todo.text}</span>
                                    {todo.tags.length > 0 && (
                                        <div className={styles.tags}>
                                            {todo.tags.map((tag, i) => (
                                                <span key={i} className={styles.tag}>{tag}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <span className={styles.priority} data-priority={todo.priority}>
                                    {todo.priority === 'high' ? '高' : todo.priority === 'medium' ? '中' : '低'}
                                </span>
                                {canEdit && (
                                    <button className={styles.deleteItemBtn} onClick={() => deleteTodo(todo.id)}>
                                        <i className="material-icons">delete</i>
                                    </button>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </main>

            {showShareModal && accessLevel === 'owner' && (
                <ShareModal
                    sessionId={sessionId!}
                    onClose={() => setShowShareModal(false)}
                />
            )}
        </div>
    );
};

const ShareModal: React.FC<{ sessionId: string; onClose: () => void; }> = 
    ({ sessionId, onClose }) => {
    const [shareLinks, setShareLinks] = useState<{ token: string; mode: 'view' | 'edit'; url: string }[]>([]);
    const [creating, setCreating] = useState(false);
    const [mode, setMode] = useState<'view' | 'edit'>('view');

    useEffect(() => {
        loadShareLinks();
    }, []);

    const loadShareLinks = async () => {
        try {
            const response = await fetch(`/api/todos/sessions/${sessionId}/share`, {
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                const links = data.shareLinks.map((link: any) => ({
                    token: link.token,
                    mode: link.mode,
                    url: `${window.location.origin}/todo/shared/${link.token}`
                }));
                setShareLinks(links);
            }
        } catch (err) {
            console.error('Failed to load share links:', err);
        }
    };

    const createShareLink = async () => {
        if (shareLinks.length >= 4) {
            return; // 最大4つまで
        }
        setCreating(true);
        try {
            const response = await fetch(`/api/todos/sessions/${sessionId}/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ mode })
            });

            if (response.ok) {
                const { token } = await response.json();
                const url = `${window.location.origin}/todo/shared/${token}`;
                setShareLinks(prev => [...prev, { token, mode, url }]);
            }
        } catch (err) {
            console.error('Failed to create share link:', err);
        } finally {
            setCreating(false);
        }
    };

    const revokeShareLink = async (token: string) => {
        try {
            await fetch(`/api/todos/sessions/${sessionId}/share/${token}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            setShareLinks(prev => prev.filter(link => link.token !== token));
        } catch (err) {
            console.error('Failed to revoke share link:', err);
        }
    };

    const copyToClipboard = (url: string) => {
        navigator.clipboard.writeText(url);
        // TODO: コピー成功の通知を表示
    };

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h2>共有設定</h2>
                    <button onClick={onClose}><i className="material-icons">close</i></button>
                </div>
                <div className={styles.modalBody}>
                    <div className={styles.shareSection}>
                        <h3>共有リンク</h3>
                        {shareLinks.length === 0 ? <p>共有リンクがありません</p> : shareLinks.map(link => (
                            <div key={link.token} className={styles.shareLink}>
                                <span className={styles.shareMode}>{link.mode === 'view' ? '閲覧' : '編集'}</span>
                                <input type="text" value={link.url} readOnly className={styles.shareUrl} />
                                <button onClick={() => copyToClipboard(link.url)} className={styles.copyBtn}>
                                    <i className="material-icons">content_copy</i>
                                </button>
                                <button onClick={() => revokeShareLink(link.token)} className={styles.revokeBtn}>
                                    <i className="material-icons">delete</i>
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className={styles.createShare}>
                        <select value={mode} onChange={(e) => setMode(e.target.value as 'view' | 'edit')}>
                            <option value="view">閲覧専用</option>
                            <option value="edit">編集可能</option>
                        </select>
                        <button onClick={createShareLink} disabled={creating || shareLinks.length >= 4}>
                            {creating ? '作成中...' : shareLinks.length >= 4 ? '最大4つまで' : 'リンク作成'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TodoSessionPage;
