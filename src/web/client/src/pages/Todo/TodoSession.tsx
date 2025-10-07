import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styles from './TodoSession.module.css';

interface UserSession {
    userId: string;
    username: string;
    guildId: string;
}

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
    const { guildId, sessionId } = useParams<{ guildId: string; sessionId: string }>();
    const navigate = useNavigate();
    const [session, setSession] = useState<UserSession | null>(null);
    const [todoSession, setTodoSession] = useState<TodoSession | null>(null);
    const [todos, setTodos] = useState<TodoItem[]>([]);
    const [accessLevel, setAccessLevel] = useState<AccessLevel>('viewer');
    const [loading, setLoading] = useState(true);
    const [newTodoText, setNewTodoText] = useState('');
    const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');
    const [showShareModal, setShowShareModal] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadData();
    }, [sessionId]);

    const loadData = async () => {
        try {
            setLoading(true);
            const [sessionRes, contentRes] = await Promise.all([
                fetch(`/api/todos/sessions/${sessionId}`, { credentials: 'include' }),
                fetch(`/api/todos/sessions/${sessionId}/content`, { credentials: 'include' })
            ]);

            if (sessionRes.ok && contentRes.ok) {
                const sessionData = await sessionRes.json();
                const contentData = await contentRes.json();
                
                setTodoSession(sessionData.session);
                setAccessLevel(contentData.accessLevel);
                setTodos(contentData.content.todos || []);
            }
        } catch (err) {
            console.error('Failed to load data:', err);
            setError('Failed to load session');
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
                <button className={styles.backBtn} onClick={() => navigate(`/todo/${guildId}`)}>
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
                    todoSession={todoSession!}
                    onClose={() => setShowShareModal(false)}
                    onUpdate={loadData}
                />
            )}
        </div>
    );
};

const ShareModal: React.FC<{ sessionId: string; todoSession: TodoSession; onClose: () => void; onUpdate: () => void; }> = 
    ({ sessionId, todoSession, onClose, onUpdate }) => {
    const [userId, setUserId] = useState('');
    const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
    const [adding, setAdding] = useState(false);

    const addMember = async () => {
        if (!userId.trim()) return;

        setAdding(true);
        try {
            const response = await fetch(`/api/todos/sessions/${sessionId}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ userId: userId.trim(), role })
            });

            if (response.ok) {
                setUserId('');
                await onUpdate();
            }
        } catch (err) {
            console.error('Failed to add member:', err);
        } finally {
            setAdding(false);
        }
    };

    const removeMember = async (uid: string) => {
        try {
            await fetch(`/api/todos/sessions/${sessionId}/members/${uid}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            await onUpdate();
        } catch (err) {
            console.error('Failed to remove member:', err);
        }
    };

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h2>共有設定</h2>
                    <button onClick={onClose}><i className="material-icons">close</i></button>
                </div>
                <div className={styles.modalBody}>
                    <div className={styles.memberSection}>
                        <h3>編集者</h3>
                        {todoSession.editors.length === 0 ? <p>なし</p> : todoSession.editors.map(uid => (
                            <div key={uid} className={styles.member}>
                                <span>{uid}</span>
                                <button onClick={() => removeMember(uid)}><i className="material-icons">delete</i></button>
                            </div>
                        ))}
                    </div>
                    <div className={styles.memberSection}>
                        <h3>閲覧者</h3>
                        {todoSession.viewers.length === 0 ? <p>なし</p> : todoSession.viewers.map(uid => (
                            <div key={uid} className={styles.member}>
                                <span>{uid}</span>
                                <button onClick={() => removeMember(uid)}><i className="material-icons">delete</i></button>
                            </div>
                        ))}
                    </div>
                    <div className={styles.addMember}>
                        <input
                            type="text"
                            placeholder="ユーザーID"
                            value={userId}
                            onChange={(e) => setUserId(e.target.value)}
                        />
                        <select value={role} onChange={(e) => setRole(e.target.value as any)}>
                            <option value="viewer">閲覧者</option>
                            <option value="editor">編集者</option>
                        </select>
                        <button onClick={addMember} disabled={adding || !userId.trim()}>追加</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TodoSessionPage;
