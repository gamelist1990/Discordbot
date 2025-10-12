import React, { useState, useEffect } from 'react';
import styles from './FeedbackPage.module.css';
import LoginPage from '../../components/Login/LoginPage';
import AppHeader from '../../components/Common/AppHeader';
import { feedbackWS, WSMessage } from '../../services/WebSocketService';
import { getAvatarSrc } from '../../utils/discord';

interface FeedbackItem {
    id: string;
    type: 'feature_request' | 'bug_report' | 'improvement';
    title: string;
    description: string;
    status: 'open' | 'in_progress' | 'completed' | 'rejected';
    authorId: string;
    authorName: string;
    authorAvatar?: string;
    createdAt: number;
    updatedAt: number;
    upvotes: string[];
    comments: FeedbackComment[];
    tags: string[];
}

interface FeedbackComment {
    id: string;
    feedbackId: string;
    authorId: string;
    authorName: string;
    authorAvatar?: string;
    content: string;
    createdAt: number;
    updatedAt: number;
}

interface Stats {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
}

interface UserSession {
    userId: string;
    username: string;
    avatar?: string;
    isOwner?: boolean;
    owners?: string[];
}

const FeedbackPage: React.FC = () => {
    const [session, setSession] = useState<UserSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [filterType, setFilterType] = useState<string>('all');
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [filterTagInput, setFilterTagInput] = useState<string>('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null);
    const [wsConnected, setWsConnected] = useState(false);

    // Check authentication
    useEffect(() => {
        checkAuth();
    }, []);

    const checkAuth = async () => {
        try {
            const response = await fetch('/api/auth/session', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                setSession(data.user);
                loadInitialData();
            } else {
                setLoading(false);
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            setLoading(false);
        }
    };

    const loadInitialData = async () => {
        try {
            const response = await fetch('/api/feedback/initial', { credentials: 'include' });

            if (response.ok) {
                const result = await response.json();
                setFeedback(result.data.feedback || []);
                setStats(result.data.stats);
            }

            setupWebSocket();
            setLoading(false);
        } catch (error) {
            console.error('Failed to load initial data:', error);
            setLoading(false);
        }
    };

    const applyTagFilter = async () => {
        try {
            const tag = filterTagInput.trim();
            if (!tag) {
                // reload initial
                await loadInitialData();
                return;
            }
            const response = await fetch(`/api/feedback?tag=${encodeURIComponent(tag)}`, { credentials: 'include' });
            if (response.ok) {
                const data = await response.json();
                setFeedback(data.feedback || []);
            }
        } catch (e) {
            console.error('Failed to apply tag filter:', e);
        }
    };

    const setupWebSocket = () => {
        try {
            // 接続状態の変化をリスニング
            feedbackWS.onConnectionChange((connected) => {
                console.log('[WebSocket] Connection status:', connected);
                setWsConnected(connected);
            });

            // メッセージハンドラーを登録
            feedbackWS.on('connected', handleWSConnected);
            feedbackWS.on('feedbackCreated', handleFeedbackCreated);
            feedbackWS.on('feedbackUpdated', handleFeedbackUpdated);
            feedbackWS.on('feedbackDeleted', handleFeedbackDeleted);
            feedbackWS.on('feedbackUpvoted', handleFeedbackUpvoted);
            feedbackWS.on('commentAdded', handleCommentAdded);
            feedbackWS.on('commentDeleted', handleCommentDeleted);

            // WebSocket接続開始
            feedbackWS.connect();
        } catch (error) {
            console.error('[WebSocket] Setup failed:', error);
        }
    };

    const handleWSConnected = (message: WSMessage) => {
        console.log('[WebSocket] Connected:', message.payload);
    };

    const handleFeedbackCreated = (message: WSMessage) => {
        setFeedback(prev => [message.payload, ...prev]);
        refreshStats();
    };

    const handleFeedbackUpdated = (message: WSMessage) => {
        setFeedback(prev =>
            prev.map(item => item.id === message.payload.id ? message.payload : item)
        );
        // use functional updater to avoid stale closure on selectedFeedback
        setSelectedFeedback(prev => prev && prev.id === message.payload.id ? message.payload : prev);
    };

    const handleFeedbackDeleted = (message: WSMessage) => {
        setFeedback(prev => prev.filter(item => item.id !== message.payload.id));
        // clear selectedFeedback only if it matches the deleted one (functional updater)
        setSelectedFeedback(prev => prev && prev.id === message.payload.id ? null : prev);
        refreshStats();
    };

    const handleFeedbackUpvoted = (message: WSMessage) => {
        console.log('[WebSocket] feedbackUpvoted received:', message.payload?.id, 'upvotes=', message.payload?.upvotes?.length);
        setFeedback(prev => {
            const updated = prev.map(item => item.id === message.payload.id ? message.payload : item);
            return updated;
        });

        // update selectedFeedback safely using functional updater
        setSelectedFeedback(prev => prev && prev.id === message.payload.id ? message.payload : prev);

        // Upvote count changed -> refresh stats to reflect any ordering/aggregates
        refreshStats();
    };

    const handleCommentAdded = (message: WSMessage) => {
        if (message.payload.feedback) {
            setFeedback(prev =>
                prev.map(item => item.id === message.payload.feedback.id ? message.payload.feedback : item)
            );
            // update selectedFeedback only if it matches the feedback id from payload
            const fid = message.payload.feedback.id;
            setSelectedFeedback(prev => prev && prev.id === fid ? message.payload.feedback : prev);
        }
    };

    const handleCommentDeleted = (message: WSMessage) => {
        if (message.payload.feedback) {
            setFeedback(prev =>
                prev.map(item => item.id === message.payload.feedback.id ? message.payload.feedback : item)
            );
            const fid = message.payload.feedback.id;
            setSelectedFeedback(prev => prev && prev.id === fid ? message.payload.feedback : prev);
        }
    };

    const refreshStats = async () => {
        try {
            const response = await fetch('/api/feedback/stats', { credentials: 'include' });
            if (response.ok) {
                const data = await response.json();
                setStats(data);
            }
        } catch (error) {
            console.error('Failed to refresh stats:', error);
        }
    };

    useEffect(() => {
        return () => {
            // WebSocket接続をクリーンアップ
            feedbackWS.disconnect();
        };
    }, []);

    const handleCreateFeedback = async (type: string, title: string, description: string, tags: string[]) => {
        try {
            const response = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ type, title, description, tags })
            });

            if (response.ok) {
                setShowCreateModal(false);
                // SSE will handle the update
            } else {
                alert('フィードバックの作成に失敗しました');
            }
        } catch (error) {
            console.error('Failed to create feedback:', error);
            alert('フィードバックの作成に失敗しました');
        }
    };

    const handleUpvote = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();

        // optimistic UI update: toggle upvote locally first
        try {
            const userId = session?.userId;
            if (!userId) return;

            console.log('[Upvote] optimistic toggle for', id, 'user', userId);
            setFeedback(prev => {
                return prev.map(item => {
                    if (item.id !== id) return item;
                    // clone
                    const upvotes = Array.isArray(item.upvotes) ? [...item.upvotes] : [];
                    const has = upvotes.includes(userId);
                    const newUpvotes = has ? upvotes.filter(u => u !== userId) : [...upvotes, userId];
                    console.log('[Upvote] item', id, 'oldCount', upvotes.length, 'newCount', newUpvotes.length);
                    return { ...item, upvotes: newUpvotes };
                });
            });

            if (selectedFeedback && selectedFeedback.id === id) {
                const upvotes = Array.isArray(selectedFeedback.upvotes) ? [...selectedFeedback.upvotes] : [];
                const has = upvotes.includes(session.userId);
                const newUpvotes = has ? upvotes.filter(u => u !== session.userId) : [...upvotes, session.userId];
                setSelectedFeedback({ ...selectedFeedback, upvotes: newUpvotes });
            }

            const response = await fetch(`/api/feedback/${id}/upvote`, {
                method: 'POST',
                credentials: 'include'
            });

            if (!response.ok) {
                // revert by refetching the specific feedback
                console.warn('Upvote request failed, refetching feedback');
                const r = await fetch(`/api/feedback/${id}`, { credentials: 'include' });
                if (r.ok) {
                    const data = await r.json();
                    // server returns { feedback }
                    const updated = data.feedback;
                    setFeedback(prev => prev.map(item => item.id === updated.id ? updated : item));
                    if (selectedFeedback && selectedFeedback.id === updated.id) {
                        setSelectedFeedback(updated);
                    }
                } else {
                    alert('投票に失敗しました');
                }
            }

            // server will broadcast the canonical state; handler will reconcile
        } catch (error) {
            console.error('Failed to upvote:', error);
            // try to rollback by refetching
            try {
                const r = await fetch(`/api/feedback/${id}`, { credentials: 'include' });
                if (r.ok) {
                    const data = await r.json();
                    const updated = data.feedback;
                    setFeedback(prev => prev.map(item => item.id === updated.id ? updated : item));
                    if (selectedFeedback && selectedFeedback.id === updated.id) {
                        setSelectedFeedback(updated);
                    }
                }
            } catch (e) {
                // ignore
            }
        }
    };

    const handleAddComment = async (feedbackId: string, content: string) => {
        try {
            const response = await fetch(`/api/feedback/${feedbackId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ content })
            });

            if (!response.ok) {
                alert('コメントの投稿に失敗しました');
            }
            // SSE will handle the update
        } catch (error) {
            console.error('Failed to add comment:', error);
        }
    };

    const handleDeleteFeedback = async (id: string) => {
        if (!confirm('このフィードバックを削除しますか？')) return;

        try {
            const response = await fetch(`/api/feedback/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (response.ok) {
                setSelectedFeedback(null);
                // SSE will handle the update
            } else {
                alert('削除に失敗しました');
            }
        } catch (error) {
            console.error('Failed to delete feedback:', error);
        }
    };

    const filteredFeedback = feedback.filter(item => {
        if (filterType !== 'all' && item.type !== filterType) return false;
        if (filterStatus !== 'all' && item.status !== filterStatus) return false;
        return true;
    });

    if (loading) {
        return (
            <div className={styles.loading}>
                <div>読み込み中...</div>
            </div>
        );
    }

    if (!session) {
        return (
            <LoginPage
                serviceName="フィードバック管理"
                onLoginSuccess={(user) => {
                    setSession(user);
                    loadInitialData();
                }}
                redirectPath="/feedback"
            />
        );
    }

    return (
        <div className={styles.page}>
            {/* AppHeader (shared with Dashboard) */}
            <AppHeader user={session} />

            <div className={styles.container}>
                {/* Sidebar - filters and status (shown on desktop only) */}
                <div className={styles.sidebar}>
                    {/* Connection Status */}
                    <div className={styles.statusBar}>
                        <div className={`${styles.statusIndicator} ${wsConnected ? styles.connected : ''}`}>
                            <span className={`${styles.statusDot} ${wsConnected ? styles.connected : ''}`}></span>
                            {wsConnected ? 'リアルタイム接続中' : '再接続中...'}
                        </div>
                    </div>

                    {/* Filters */}
                    <div className={styles.filterSection}>
                        <div className={styles.filterGroup}>
                            <span className={styles.filterLabel}>種類:</span>
                            <button
                                className={`${styles.filterButton} ${filterType === 'all' ? styles.active : ''}`}
                                onClick={() => setFilterType('all')}
                            >
                                すべて
                            </button>
                            <button
                                className={`${styles.filterButton} ${filterType === 'feature_request' ? styles.active : ''}`}
                                onClick={() => setFilterType('feature_request')}
                            >
                                機能リクエスト
                            </button>
                            <button
                                className={`${styles.filterButton} ${filterType === 'bug_report' ? styles.active : ''}`}
                                onClick={() => setFilterType('bug_report')}
                            >
                                バグ報告
                            </button>
                            <button
                                className={`${styles.filterButton} ${filterType === 'improvement' ? styles.active : ''}`}
                                onClick={() => setFilterType('improvement')}
                            >
                                改善要望
                            </button>
                        </div>

                        <div className={styles.filterGroup}>
                            <span className={styles.filterLabel}>ステータス:</span>
                            <button
                                className={`${styles.filterButton} ${filterStatus === 'all' ? styles.active : ''}`}
                                onClick={() => setFilterStatus('all')}
                            >
                                すべて
                            </button>
                            <button
                                className={`${styles.filterButton} ${filterStatus === 'open' ? styles.active : ''}`}
                                onClick={() => setFilterStatus('open')}
                            >
                                未対応
                            </button>
                            <button
                                className={`${styles.filterButton} ${filterStatus === 'in_progress' ? styles.active : ''}`}
                                onClick={() => setFilterStatus('in_progress')}
                            >
                                対応中
                            </button>
                            <button
                                className={`${styles.filterButton} ${filterStatus === 'completed' ? styles.active : ''}`}
                                onClick={() => setFilterStatus('completed')}
                            >
                                完了
                            </button>
                        </div>

                        <div className={styles.filterGroup}>
                            <span className={styles.filterLabel}>タグ検索:</span>
                            <input
                                type="text"
                                className={styles.formInput}
                                placeholder="例: ui, performance"
                                value={filterTagInput}
                                onChange={(e) => setFilterTagInput(e.target.value)}
                                onKeyPress={(e) => { if (e.key === 'Enter') applyTagFilter(); }}
                            />
                            <button className={styles.filterButton} onClick={applyTagFilter}>検索</button>
                        </div>

                        <button
                            className={styles.createButton}
                            onClick={() => setShowCreateModal(true)}
                        >
                            <i className="material-icons">add</i>
                            新規作成
                        </button>
                    </div>
                </div>

                {/* Main Content */}
                <div className={styles.mainContent}>
                    {/* Mobile-only filters and status */}
                    <div className={styles.mobileFilters}>
                        {/* Connection Status */}
                        <div className={styles.statusBar}>
                            <div className={`${styles.statusIndicator} ${wsConnected ? styles.connected : ''}`}>
                                <span className={`${styles.statusDot} ${wsConnected ? styles.connected : ''}`}></span>
                                {wsConnected ? 'リアルタイム接続中' : '再接続中...'}
                            </div>
                        </div>

                        {/* Filters */}
                        <div className={styles.filterSection}>
                            <div className={styles.filterGroup}>
                                <span className={styles.filterLabel}>種類:</span>
                                <button
                                    className={`${styles.filterButton} ${filterType === 'all' ? styles.active : ''}`}
                                    onClick={() => setFilterType('all')}
                                >
                                    すべて
                                </button>
                                <button
                                    className={`${styles.filterButton} ${filterType === 'feature_request' ? styles.active : ''}`}
                                    onClick={() => setFilterType('feature_request')}
                                >
                                    機能リクエスト
                                </button>
                                <button
                                    className={`${styles.filterButton} ${filterType === 'bug_report' ? styles.active : ''}`}
                                    onClick={() => setFilterType('bug_report')}
                                >
                                    バグ報告
                                </button>
                                <button
                                    className={`${styles.filterButton} ${filterType === 'improvement' ? styles.active : ''}`}
                                    onClick={() => setFilterType('improvement')}
                                >
                                    改善要望
                                </button>
                            </div>

                            <div className={styles.filterGroup}>
                                <span className={styles.filterLabel}>ステータス:</span>
                                <button
                                    className={`${styles.filterButton} ${filterStatus === 'all' ? styles.active : ''}`}
                                    onClick={() => setFilterStatus('all')}
                                >
                                    すべて
                                </button>
                                <button
                                    className={`${styles.filterButton} ${filterStatus === 'open' ? styles.active : ''}`}
                                    onClick={() => setFilterStatus('open')}
                                >
                                    未対応
                                </button>
                                <button
                                    className={`${styles.filterButton} ${filterStatus === 'in_progress' ? styles.active : ''}`}
                                    onClick={() => setFilterStatus('in_progress')}
                                >
                                    対応中
                                </button>
                                <button
                                    className={`${styles.filterButton} ${filterStatus === 'completed' ? styles.active : ''}`}
                                    onClick={() => setFilterStatus('completed')}
                                >
                                    完了
                                </button>
                            </div>

                            <div className={styles.filterGroup}>
                                <span className={styles.filterLabel}>タグ検索:</span>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    placeholder="例: ui, performance"
                                    value={filterTagInput}
                                    onChange={(e) => setFilterTagInput(e.target.value)}
                                    onKeyPress={(e) => { if (e.key === 'Enter') applyTagFilter(); }}
                                />
                                <button className={styles.filterButton} onClick={applyTagFilter}>検索</button>
                            </div>

                            <button
                                className={styles.createButton}
                                onClick={() => setShowCreateModal(true)}
                            >
                                <i className="material-icons">add</i>
                                新規作成
                            </button>
                        </div>
                    </div>

                    {/* Stats */}
                    {stats && (
                        <div className={styles.statsGrid}>
                            <div className={styles.statCard}>
                                <div className={styles.statLabel}>総フィードバック数</div>
                                <div className={styles.statValue}>{stats.total}</div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statLabel}>機能リクエスト</div>
                                <div className={`${styles.statValue} ${styles.feature}`}>
                                    {stats.byType.feature_request || 0}
                                </div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statLabel}>バグ報告</div>
                                <div className={`${styles.statValue} ${styles.bug}`}>
                                    {stats.byType.bug_report || 0}
                                </div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statLabel}>改善要望</div>
                                <div className={`${styles.statValue} ${styles.improvement}`}>
                                    {stats.byType.improvement || 0}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Feedback Grid */}
                    {filteredFeedback.length === 0 ? (
                        <div className={styles.emptyState}>
                            <i className="material-icons">inbox</i>
                            <p>フィードバックがありません</p>
                        </div>
                    ) : (
                        <div className={styles.feedbackGrid}>
                            {filteredFeedback.map(item => (
                                <FeedbackCard
                                    key={item.id}
                                    item={item}
                                    currentUserId={session.userId}
                                    owners={session.owners}
                                    onUpvote={(id, e) => handleUpvote(id, e)}
                                    onClick={() => setSelectedFeedback(item)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <CreateFeedbackModal
                    onClose={() => setShowCreateModal(false)}
                    onSubmit={handleCreateFeedback}
                />
            )}

            {/* Detail Modal */}
            {selectedFeedback && (
                <FeedbackDetailModal
                    key={`${selectedFeedback.id}-${selectedFeedback.upvotes.length}`}
                    feedback={selectedFeedback}
                    currentUserId={session.userId}
                    owners={session.owners}
                    onClose={() => setSelectedFeedback(null)}
                    onUpvote={(id, e) => handleUpvote(id, e)}
                    onAddComment={handleAddComment}
                    onDelete={handleDeleteFeedback}
                />
            )}
        </div>
    );
};

// Feedback Card Component
interface FeedbackCardProps {
    item: FeedbackItem;
    currentUserId: string;
    onUpvote: (id: string, e: React.MouseEvent) => void;
    onClick: () => void;
    owners?: string[];
}

const FeedbackCard: React.FC<FeedbackCardProps> = ({ item, currentUserId, onUpvote, onClick, owners }) => {
    const hasUpvoted = item.upvotes.includes(currentUserId);

    const typeLabels = {
        feature_request: '機能リクエスト',
        bug_report: 'バグ報告',
        improvement: '改善要望'
    };

    const statusLabels = {
        open: '未対応',
        in_progress: '対応中',
        completed: '完了',
        rejected: '却下'
    };

    return (
        <div className={styles.feedbackCard} onClick={onClick}>
            <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>{item.title}</h3>
                <span className={`${styles.typeBadge} ${styles[item.type]}`}>
                    {typeLabels[item.type]}
                </span>
            </div>

            <p className={styles.cardDescription}>{item.description}</p>

            {item.tags.length > 0 && (
                <div className={styles.cardTags}>
                    {item.tags.map((tag, idx) => (
                        <span key={idx} className={styles.tag}>
                            {tag}
                        </span>
                    ))}
                </div>
            )}

            <div className={styles.cardFooter}>
                <div className={styles.author}>
                    <img 
                        src={getAvatarSrc(item.authorAvatar, item.authorId)} 
                        alt={item.authorName} 
                        className={styles.avatar}
                        onError={(e) => {
                            // 画像読み込み失敗時のフォールバック
                            e.currentTarget.src = getAvatarSrc(null, item.authorId);
                        }}
                    />
                    <span className={styles.authorName} style={owners && owners.includes(item.authorId) ? { color: '#d4af37', fontWeight: 600 } : {}}>
                        {item.authorName}
                        {owners && owners.includes(item.authorId) && (
                            <i className="material-icons" title="Owner" style={{ fontSize: '16px', marginLeft: '6px', color: '#d4af37' }}>emoji_events</i>
                        )}
                    </span>
                </div>

                <div className={styles.cardMeta}>
                    <button
                        className={`${styles.upvoteButton} ${hasUpvoted ? styles.upvoted : ''}`}
                        onClick={(e) => onUpvote(item.id, e)}
                    >
                        <i className="material-icons" style={{ fontSize: '16px' }}>thumb_up</i>
                        {item.upvotes.length}
                    </button>

                    <div className={styles.commentCount}>
                        <i className="material-icons" style={{ fontSize: '16px' }}>comment</i>
                        {item.comments.length}
                    </div>

                    <span className={`${styles.statusBadge} ${styles[item.status]}`}>
                        {statusLabels[item.status]}
                    </span>
                </div>
            </div>
        </div>
    );
};

// Create Feedback Modal Component
interface CreateFeedbackModalProps {
    onClose: () => void;
    onSubmit: (type: string, title: string, description: string, tags: string[]) => void;
}

const CreateFeedbackModal: React.FC<CreateFeedbackModalProps> = ({ onClose, onSubmit }) => {
    const [type, setType] = useState('feature_request');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState('');
    const [showTagInput, setShowTagInput] = useState(false);

    const handleAddTag = () => {
        if (tagInput.trim() && !tags.includes(tagInput.trim())) {
            setTags([...tags, tagInput.trim()]);
            setTagInput('');
        }
    };

    const handleRemoveTag = (tag: string) => {
        setTags(tags.filter(t => t !== tag));
    };

    const handleTagDoubleClick = (tag: string) => {
        handleRemoveTag(tag);
    };

    const handleSubmit = () => {
        if (!title.trim() || !description.trim()) {
            alert('タイトルと説明を入力してください');
            return;
        }
        onSubmit(type, title, description, tags);
    };

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h2 className={styles.modalTitle}>新規フィードバック</h2>
                    <button className={styles.closeButton} onClick={onClose}>
                        <i className="material-icons">close</i>
                    </button>
                </div>

                <div className={styles.modalBody}>
                    <div className={styles.formGroup}>
                        <label className={styles.formLabel}>種類</label>
                        <select
                            className={styles.formSelect}
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                        >
                            <option value="feature_request">機能リクエスト</option>
                            <option value="bug_report">バグ報告</option>
                            <option value="improvement">改善要望</option>
                        </select>
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.formLabel}>タイトル</label>
                        <input
                            type="text"
                            className={styles.formInput}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="簡潔なタイトルを入力"
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.formLabel}>説明</label>
                        <textarea
                            className={styles.formTextarea}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="詳細な説明を入力"
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <div className={styles.tagSectionHeader}>
                            <label className={styles.formLabel} style={{ marginBottom: 0 }}>タグ</label>
                            <button 
                                className={`${styles.toggleTagInputButton} ${showTagInput ? styles.active : ''}`}
                                onClick={() => setShowTagInput(!showTagInput)}
                                type="button"
                                title={showTagInput ? 'タグ入力を非表示' : 'タグ入力を表示'}
                                aria-pressed={showTagInput}
                                aria-label={showTagInput ? 'タグ入力を非表示' : 'タグ入力を表示'}
                            >
                                <i className="material-icons" style={{ fontSize: '18px' }}>
                                    {showTagInput ? 'remove' : 'add'}
                                </i>
                            </button>
                        </div>
                        <div className={`${styles.tagInput} ${!showTagInput ? styles.collapsed : ''}`}>
                            <input
                                type="text"
                                className={`${styles.formInput} ${styles.tagInputField}`}
                                value={tagInput}
                                onChange={(e) => setTagInput(e.target.value)}
                                onKeyPress={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleAddTag();
                                    }
                                }}
                                placeholder="タグを入力してEnter"
                            />
                            <button className={styles.addTagButton} onClick={handleAddTag} type="button">
                                保存
                            </button>
                        </div>
                        {tags.length > 0 && (
                            <>
                                <div className={styles.tagsList}>
                                    {tags.map((tag) => (
                                        <div 
                                            key={tag} 
                                            className={styles.tagItem}
                                            onDoubleClick={() => handleTagDoubleClick(tag)}
                                            title="ダブルクリックで削除"
                                        >
                                            {tag}
                                            <button
                                                className={styles.removeTagButton}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleRemoveTag(tag);
                                                }}
                                                type="button"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <div className={styles.tagHint}>
                                    ヒント: タグをダブルクリックで削除できます
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className={styles.modalFooter}>
                    <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={onClose}>
                        キャンセル
                    </button>
                    <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={handleSubmit}>
                        作成
                    </button>
                </div>
            </div>
        </div>
    );
};

// Feedback Detail Modal Component
interface FeedbackDetailModalProps {
    feedback: FeedbackItem;
    currentUserId: string;
    owners?: string[];
    onClose: () => void;
    onUpvote: (id: string, e: React.MouseEvent) => void;
    onAddComment: (feedbackId: string, content: string) => void;
    onDelete: (id: string) => void;
}

const FeedbackDetailModal: React.FC<FeedbackDetailModalProps> = ({
    feedback,
    currentUserId,
    owners,
    onClose,
    onUpvote,
    onAddComment,
    onDelete
}) => {
    const [commentInput, setCommentInput] = useState('');
    const [localStatus, setLocalStatus] = useState<FeedbackItem['status']>(feedback.status);
    const [localTags, setLocalTags] = useState<string[]>(feedback.tags || []);
    const [tagInput, setTagInput] = useState<string>('');
    const [showTagInput, setShowTagInput] = useState(false);
    const hasUpvoted = feedback.upvotes.includes(currentUserId);

    const typeLabels = {
        feature_request: '機能リクエスト',
        bug_report: 'バグ報告',
        improvement: '改善要望'
    };

    const statusLabels = {
        open: '未対応',
        in_progress: '対応中',
        completed: '完了',
        rejected: '却下'
    };

    const handleAddComment = () => {
        if (!commentInput.trim()) return;
        onAddComment(feedback.id, commentInput);
        setCommentInput('');
    };

    const canChangeStatus = owners && owners.includes(currentUserId);
    const canEditTags = feedback.authorId === currentUserId || (owners && owners.includes(currentUserId));

    const handleApplyStatus = async () => {
        if (!canChangeStatus) return;
        try {
            const response = await fetch(`/api/feedback/${feedback.id}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: localStatus })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                alert('ステータス変更に失敗しました: ' + (err?.error || response.statusText));
            } else {
                // 正常ならサーバが WebSocket で broadcast する -> ハンドラが state を更新する
                // ここではローカル選択のまま閉じずに待機させる
            }
        } catch (e) {
            console.error('Failed to change status:', e);
            alert('ステータス変更に失敗しました');
        }
    };

    const handleAddTagLocal = () => {
        const t = tagInput.trim();
        if (!t) return;
        if (!localTags.includes(t)) setLocalTags(prev => [...prev, t]);
        setTagInput('');
    };

    const handleRemoveTagLocal = (t: string) => {
        setLocalTags(prev => prev.filter(x => x !== t));
    };

    const handleSaveTags = async () => {
        if (!canEditTags) return;
        try {
            const response = await fetch(`/api/feedback/${feedback.id}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: localTags })
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                alert('タグ更新に失敗しました: ' + (err?.error || response.statusText));
            }
        } catch (e) {
            console.error('Failed to save tags:', e);
            alert('タグ更新に失敗しました');
        }
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleString('ja-JP');
    };

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h2 className={styles.modalTitle}>{feedback.title}</h2>
                    <button className={styles.closeButton} onClick={onClose}>
                        <i className="material-icons">close</i>
                    </button>
                </div>

                <div className={styles.modalBody}>
                    <div className={styles.detailHeader}>
                        <div>
                            <span className={`${styles.typeBadge} ${styles[feedback.type]}`}>
                                {typeLabels[feedback.type]}
                            </span>
                            {' '}
                            <span className={`${styles.statusBadge} ${styles[feedback.status]}`}>
                                {statusLabels[feedback.status]}
                            </span>
                        </div>
                        <div className={styles.detailActions}>
                            <button
                                className={`${styles.upvoteButton} ${hasUpvoted ? styles.upvoted : ''}`}
                                onClick={(e) => onUpvote(feedback.id, e)}
                            >
                                <i className="material-icons" style={{ fontSize: '16px' }}>thumb_up</i>
                                {feedback.upvotes.length}
                            </button>
                                {feedback.authorId === currentUserId && (
                                <button
                                    className={styles.iconButton}
                                    onClick={() => onDelete(feedback.id)}
                                    title="削除"
                                >
                                    <i className="material-icons">delete</i>
                                </button>
                            )}
                                {/* Owner-only status controls */}
                                {canChangeStatus && (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginLeft: '8px' }}>
                                        <select value={localStatus} onChange={e => setLocalStatus(e.target.value as FeedbackItem['status'])}>
                                            <option value="open">未対応</option>
                                            <option value="in_progress">対応中</option>
                                            <option value="completed">完了</option>
                                            <option value="rejected">却下</option>
                                        </select>
                                        <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={handleApplyStatus}>適用</button>
                                    </div>
                                )}
                        </div>
                    </div>

                    <div className={styles.author}>
                        <img 
                            src={getAvatarSrc(feedback.authorAvatar, feedback.authorId)} 
                            alt={feedback.authorName} 
                            className={styles.avatar}
                            onError={(e) => {
                                e.currentTarget.src = getAvatarSrc(null, feedback.authorId);
                            }}
                        />
                        <div>
                            <div className={styles.authorName}>{feedback.authorName}</div>
                            <div className={styles.commentTime}>{formatDate(feedback.createdAt)}</div>
                        </div>
                    </div>

                    {(feedback.tags.length > 0 || canEditTags) && (
                        <div className={styles.cardTags}>
                            {localTags.map((tag, idx) => (
                                <span 
                                    key={idx} 
                                    className={styles.tag}
                                    onDoubleClick={() => canEditTags && handleRemoveTagLocal(tag)}
                                    title={canEditTags ? "ダブルクリックで削除" : ""}
                                    style={{ cursor: canEditTags ? 'pointer' : 'default' }}
                                >
                                    {tag}
                                    {canEditTags && (
                                        <button 
                                            className={styles.removeTagButton} 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleRemoveTagLocal(tag);
                                            }}
                                        >
                                            ×
                                        </button>
                                    )}
                                </span>
                            ))}
                            {canEditTags && (
                                <div style={{ width: '100%', marginTop: '12px' }}>
                                    <div className={styles.tagSectionHeader}>
                                        <button 
                                            className={`${styles.toggleTagInputButton} ${showTagInput ? styles.active : ''}`}
                                            onClick={() => setShowTagInput(!showTagInput)}
                                            type="button"
                                            title={showTagInput ? 'タグ編集を閉じる' : 'タグ編集を開く'}
                                            aria-pressed={showTagInput}
                                            aria-label={showTagInput ? 'タグ編集を閉じる' : 'タグ編集を開く'}
                                        >
                                            <i className="material-icons" style={{ fontSize: '18px' }}>
                                                {showTagInput ? 'remove' : 'add'}
                                            </i>
                                        </button>
                                        <span style={{ fontSize: '13px', color: 'var(--grey-600)' }}>
                                            タグを編集
                                        </span>
                                    </div>
                                    <div className={`${styles.tagInput} ${!showTagInput ? styles.collapsed : ''}`} style={{ marginTop: '8px' }}>
                                        <input 
                                            type="text" 
                                            className={`${styles.formInput} ${styles.tagInputField}`}
                                            value={tagInput} 
                                            onChange={e => setTagInput(e.target.value)} 
                                            placeholder="新しいタグ" 
                                            onKeyPress={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    handleAddTagLocal();
                                                }
                                            }}
                                        />
                                        <button className={styles.addTagButton} onClick={handleAddTagLocal} type="button">追加</button>
                                    </div>
                                    {showTagInput && (
                                        <button 
                                            className={`${styles.button} ${styles.buttonPrimary}`} 
                                            onClick={handleSaveTags}
                                            style={{ marginTop: '8px', width: '100%' }}
                                        >
                                            タグを保存
                                        </button>
                                    )}
                                    {localTags.length > 0 && (
                                        <div className={styles.tagHint}>
                                            ヒント: タグをダブルクリックで削除できます
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <div className={styles.detailDescription}>
                        {feedback.description}
                    </div>

                    <div className={styles.commentsSection}>
                        <h3 className={styles.commentsTitle}>
                            コメント ({feedback.comments.length})
                        </h3>

                        {feedback.comments.map(comment => (
                            <div key={comment.id} className={styles.commentItem}>
                                <div className={styles.commentHeader}>
                                    <div className={styles.commentAuthor}>
                                        <img 
                                            src={getAvatarSrc(comment.authorAvatar, comment.authorId)} 
                                            alt={comment.authorName} 
                                            className={styles.avatar}
                                            onError={(e) => {
                                                e.currentTarget.src = getAvatarSrc(null, comment.authorId);
                                            }}
                                        />
                                        <span className={styles.authorName} style={owners && owners.includes(comment.authorId) ? { color: '#d4af37', fontWeight: 600 } : {}}>
                                            {comment.authorName}
                                            {owners && owners.includes(comment.authorId) && (
                                                <i className="material-icons" title="Owner" style={{ fontSize: '16px', marginLeft: '6px', color: '#d4af37' }}>emoji_events</i>
                                            )}
                                        </span>
                                    </div>
                                    <span className={styles.commentTime}>{formatDate(comment.createdAt)}</span>
                                </div>
                                <div className={styles.commentContent}>{comment.content}</div>
                            </div>
                        ))}

                        <div className={styles.addCommentBox}>
                            <textarea
                                className={styles.commentInputBox}
                                value={commentInput}
                                onChange={(e) => setCommentInput(e.target.value)}
                                placeholder="コメントを入力..."
                            />
                            <button
                                className={styles.addCommentButton}
                                onClick={handleAddComment}
                            >
                                コメントを投稿
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FeedbackPage;
