import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AppHeader from '../../components/Common/AppHeader';
import LoginPage from '../../components/Login/LoginPage';
import styles from './TodoDashboard.module.css';

interface UserSession {
    userId: string;
    username: string;
    guildId: string;
    permission: number;
    avatar?: string | null;
}

interface TodoSession {
    id: string;
    name: string;
    ownerId: string;
    guildId: string;
    createdAt: number;
    updatedAt: number;
    viewers: string[];
    editors: string[];
    favoritedBy: string[];
}

/**
 * Todo Dashboard (Project Screen)
 */
const TodoDashboard: React.FC = () => {
    const { guildId } = useParams<{ guildId: string }>();
    const navigate = useNavigate();
    const [session, setSession] = useState<UserSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [sessions, setSessions] = useState<TodoSession[]>([]);
    const [filter, setFilter] = useState<'all' | 'favorites' | 'owned' | 'shared'>('all');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [shareInfo, setShareInfo] = useState<{ mode: 'view' | 'edit'; token: string | null; expiresInSeconds: number | null } | null>(null);
    const [newSessionName, setNewSessionName] = useState('');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        checkAuth();
    }, []);

    useEffect(() => {
        if (session) {
            loadSessions();
        }
    }, [session]);

    const checkAuth = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/auth/session', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                setSession(data.user);
            }
        } catch (err) {
            console.error('Auth check failed:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadSessions = async () => {
        try {
            const response = await fetch('/api/todos/sessions', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                setSessions(data.sessions || []);
            } else {
                setError('Failed to load sessions');
            }
        } catch (err) {
            console.error('Failed to load sessions:', err);
            setError('Failed to load sessions');
        }
    };

    const createSession = async () => {
        if (!newSessionName.trim()) {
            setError('セッション名を入力してください');
            return;
        }

        setCreating(true);
        setError(null);

        try {
            const response = await fetch('/api/todos/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ name: newSessionName.trim() })
            });

            if (response.ok) {
                const data = await response.json();
                setSessions([...sessions, data.session]);
                setShowCreateModal(false);
                setNewSessionName('');
            } else {
                const data = await response.json();
                setError(data.error || 'Failed to create session');
            }
        } catch (err) {
            console.error('Failed to create session:', err);
            setError('Failed to create session');
        } finally {
            setCreating(false);
        }
    };

    const toggleFavorite = async (sessionId: string) => {
        try {
            const response = await fetch(`/api/todos/sessions/${sessionId}/favorite`, {
                method: 'POST',
                credentials: 'include'
            });

            if (response.ok) {
                await loadSessions();
            }
        } catch (err) {
            console.error('Failed to toggle favorite:', err);
        }
    };

    // logout is handled by AppHeader; no local handler needed here

    const getAccessLevel = (todoSession: TodoSession): 'owner' | 'editor' | 'viewer' => {
        if (!session) return 'viewer';
        if (todoSession.ownerId === session.userId) return 'owner';
        if (todoSession.editors.includes(session.userId)) return 'editor';
        return 'viewer';
    };

    const getFilteredSessions = () => {
        if (!session) return [];

        let filtered = sessions;

        if (filter === 'favorites') {
            filtered = sessions.filter(s => s.favoritedBy.includes(session.userId));
        } else if (filter === 'owned') {
            filtered = sessions.filter(s => s.ownerId === session.userId);
        } else if (filter === 'shared') {
            filtered = sessions.filter(s => 
                s.ownerId !== session.userId && 
                (s.editors.includes(session.userId) || s.viewers.includes(session.userId))
            );
        }

        return filtered;
    };

    const ownedCount = session ? sessions.filter(s => s.ownerId === session.userId).length : 0;
    const canCreateMore = ownedCount < 3;

    if (!session && !loading) {
        return <LoginPage serviceName="Todo Management" redirectPath={`/todo/${guildId}`} onLoginSuccess={(user) => setSession(user)} />;
    }

    if (loading) {
        return (
            <div className={styles.loadingContainer}>
                <div className={styles.spinner}></div>
                <p>読み込み中...</p>
            </div>
        );
    }

    const filteredSessions = getFilteredSessions();

    return (
        <div className={styles.page}>
            <AppHeader user={session} />
            <div className={styles.dashboard}>
            {/* Main Content */}
            <main className={styles.main}>
                {/* Actions Bar */}
                <div className={styles.actionsBar}>
                    {canCreateMore && (
                        <button className={styles.createBtn} onClick={() => setShowCreateModal(true)}>
                            <i className="material-icons">add</i>
                            新規セッション作成 ({ownedCount}/3)
                        </button>
                    )}
                    {!canCreateMore && (
                        <div className={styles.limitInfo}>
                            <i className="material-icons">info</i>
                            最大3個までセッションを作成できます（現在: {ownedCount}/3）
                        </div>
                    )}

                    {/* Filter Buttons */}
                    <div className={styles.filters}>
                        <button 
                            className={`${styles.filterBtn} ${filter === 'all' ? styles.active : ''}`}
                            onClick={() => setFilter('all')}
                        >
                            全て
                        </button>
                        <button 
                            className={`${styles.filterBtn} ${filter === 'favorites' ? styles.active : ''}`}
                            onClick={() => setFilter('favorites')}
                        >
                            <i className="material-icons">star</i>
                            お気に入り
                        </button>
                        <button 
                            className={`${styles.filterBtn} ${filter === 'owned' ? styles.active : ''}`}
                            onClick={() => setFilter('owned')}
                        >
                            所有
                        </button>
                        <button 
                            className={`${styles.filterBtn} ${filter === 'shared' ? styles.active : ''}`}
                            onClick={() => setFilter('shared')}
                        >
                            共有
                        </button>
                    </div>
                </div>

                {error && (
                    <div className={styles.error}>
                        <i className="material-icons">error</i>
                        {error}
                    </div>
                )}

                {/* Sessions Grid */}
                <div className={styles.sessionsGrid}>
                    {filteredSessions.length === 0 ? (
                        <div className={styles.empty}>
                            <i className="material-icons" style={{ fontSize: '64px', color: '#9AA0A6' }}>inbox</i>
                            <p>Todoセッションがありません</p>
                            {canCreateMore && (
                                <button className={styles.createBtn} onClick={() => setShowCreateModal(true)}>
                                    <i className="material-icons">add</i>
                                    最初のセッションを作成
                                </button>
                            )}
                        </div>
                    ) : (
                        filteredSessions.map((todoSession) => {
                            const accessLevel = getAccessLevel(todoSession);
                            const isFavorited = session && todoSession.favoritedBy.includes(session.userId);

                            return (
                                <div key={todoSession.id} className={styles.sessionCard}>
                                    <div className={styles.cardHeader}>
                                        <h3 className={styles.sessionName}>{todoSession.name}</h3>
                                        <button 
                                            className={`${styles.favoriteBtn} ${isFavorited ? styles.favorited : ''}`}
                                            onClick={() => toggleFavorite(todoSession.id)}
                                        >
                                            <i className="material-icons">
                                                {isFavorited ? 'star' : 'star_border'}
                                            </i>
                                        </button>
                                    </div>
                                    <div className={styles.cardBody}>
                                        <div className={styles.cardInfo}>
                                            <span className={styles.accessBadge} data-level={accessLevel}>
                                                {accessLevel === 'owner' ? 'オーナー' : accessLevel === 'editor' ? '編集者' : '閲覧者'}
                                            </span>
                                            <span className={styles.date}>
                                                更新: {new Date(todoSession.updatedAt).toLocaleDateString('ja-JP')}
                                            </span>
                                        </div>
                                        <button 
                                            className={styles.openBtn}
                                            onClick={() => navigate(`/todo/${guildId}/session/${todoSession.id}`)}
                                        >
                                            <i className="material-icons">arrow_forward</i>
                                            開く
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </main>

            {/* Create Modal */}
            {showCreateModal && (
                <div className={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2>新規Todoセッション作成</h2>
                            <button className={styles.closeBtn} onClick={() => setShowCreateModal(false)}>
                                <i className="material-icons">close</i>
                            </button>
                        </div>
                        <div className={styles.modalBody}>
                            <label className={styles.label}>セッション名</label>
                            <input
                                type="text"
                                className={styles.input}
                                placeholder="プロジェクト名を入力..."
                                value={newSessionName}
                                onChange={(e) => setNewSessionName(e.target.value)}
                                maxLength={100}
                            />
                            <div className={styles.charCount}>{newSessionName.length}/100</div>
                        </div>
                        <div className={styles.modalFooter}>
                            <button className={styles.cancelBtn} onClick={() => setShowCreateModal(false)}>
                                キャンセル
                            </button>
                            <button 
                                className={styles.submitBtn} 
                                onClick={createSession}
                                disabled={creating || !newSessionName.trim()}
                            >
                                {creating ? '作成中...' : '作成'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Share Modal */}
            {showShareModal && (
                <div className={styles.modalOverlay} onClick={() => { setShowShareModal(false); setShareInfo(null); }}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2>共有リンク</h2>
                            <button className={styles.closeBtn} onClick={() => { setShowShareModal(false); setShareInfo(null); }}>
                                <i className="material-icons">close</i>
                            </button>
                        </div>
                        <div className={styles.modalBody}>
                            {shareInfo && shareInfo.mode === 'edit' && shareInfo.token ? (
                                <>
                                    <p>編集用リンク（有効期限: {shareInfo.expiresInSeconds} 秒）</p>
                                    <input type="text" readOnly value={`${window.location.origin}/todo/shared/${shareInfo.token}?guildId=${guildId}`} className={styles.input} />
                                    <div style={{ marginTop: '8px' }}>
                                        <button onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/todo/shared/${shareInfo.token}?guildId=${guildId}`); }}>コピー</button>
                                    </div>
                                </>
                            ) : shareInfo && shareInfo.mode === 'view' ? (
                                <>
                                    <p>閲覧用URLの生成にはオーナーが個別にトークンを発行するか、ユーザー追加で閲覧者として登録してください。</p>
                                    <p>代替: オーナーに編集用リンク(短時間)を発行してもらってください。</p>
                                </>
                            ) : (
                                <p>共有リンクがありません。</p>
                            )}
                        </div>
                        <div className={styles.modalFooter}>
                            <button className={styles.cancelBtn} onClick={() => { setShowShareModal(false); setShareInfo(null); }}>閉じる</button>
                        </div>
                    </div>
                </div>
            )}
            </div>
        </div>
    );
};

export default TodoDashboard;
