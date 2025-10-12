import React, { useState, useEffect, useRef } from 'react';
import styles from './FeedbackPage.module.css';
import LoginPage from '../../components/Login/LoginPage';

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
}

const FeedbackPage: React.FC = () => {
    const [session, setSession] = useState<UserSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [filterType, setFilterType] = useState<string>('all');
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null);
    const [sseConnected, setSseConnected] = useState(false);
    const eventSourceRef = useRef<EventSource | null>(null);

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
            const [feedbackRes, statsRes] = await Promise.all([
                fetch('/api/feedback', { credentials: 'include' }),
                fetch('/api/feedback/stats', { credentials: 'include' })
            ]);

            if (feedbackRes.ok) {
                const feedbackData = await feedbackRes.json();
                setFeedback(feedbackData.feedback || []);
            }

            if (statsRes.ok) {
                const statsData = await statsRes.json();
                setStats(statsData);
            }

            setupSSE();
            setLoading(false);
        } catch (error) {
            console.error('Failed to load initial data:', error);
            setLoading(false);
        }
    };

    const setupSSE = () => {
        try {
            const es = new EventSource('/api/feedback/stream');

            es.onopen = () => {
                console.log('[SSE] Connected to feedback stream');
                setSseConnected(true);
            };

            es.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleSSEMessage(data);
                } catch (error) {
                    console.error('[SSE] Failed to parse message:', error);
                }
            };

            es.onerror = (error) => {
                console.error('[SSE] Connection error:', error);
                setSseConnected(false);
                es.close();

                // Reconnect after 5 seconds
                setTimeout(() => {
                    if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
                        setupSSE();
                    }
                }, 5000);
            };

            eventSourceRef.current = es;
        } catch (error) {
            console.error('[SSE] Setup failed:', error);
        }
    };

    const handleSSEMessage = (data: any) => {
        switch (data.type) {
            case 'initialData':
                if (data.payload.feedback) {
                    setFeedback(data.payload.feedback);
                }
                if (data.payload.stats) {
                    setStats(data.payload.stats);
                }
                break;

            case 'feedbackCreated':
                setFeedback(prev => [data.payload, ...prev]);
                refreshStats();
                break;

            case 'feedbackUpdated':
                setFeedback(prev =>
                    prev.map(item => item.id === data.payload.id ? data.payload : item)
                );
                if (selectedFeedback && selectedFeedback.id === data.payload.id) {
                    setSelectedFeedback(data.payload);
                }
                break;

            case 'feedbackDeleted':
                setFeedback(prev => prev.filter(item => item.id !== data.payload.id));
                if (selectedFeedback && selectedFeedback.id === data.payload.id) {
                    setSelectedFeedback(null);
                }
                refreshStats();
                break;

            case 'feedbackUpvoted':
                setFeedback(prev =>
                    prev.map(item => item.id === data.payload.id ? data.payload : item)
                );
                if (selectedFeedback && selectedFeedback.id === data.payload.id) {
                    setSelectedFeedback(data.payload);
                }
                break;

            case 'commentAdded':
            case 'commentDeleted':
                if (data.payload.feedback) {
                    setFeedback(prev =>
                        prev.map(item => item.id === data.payload.feedback.id ? data.payload.feedback : item)
                    );
                    if (selectedFeedback && selectedFeedback.id === data.payload.feedbackId) {
                        setSelectedFeedback(data.payload.feedback);
                    }
                }
                break;

            case 'keepalive':
            case 'connected':
                // Just for connection health check
                break;

            default:
                console.log('[SSE] Unknown message type:', data.type);
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
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
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
        try {
            const response = await fetch(`/api/feedback/${id}/upvote`, {
                method: 'POST',
                credentials: 'include'
            });

            if (!response.ok) {
                alert('投票に失敗しました');
            }
            // SSE will handle the update
        } catch (error) {
            console.error('Failed to upvote:', error);
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
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <i className="material-icons">feedback</i>
                    <div>
                        <h1 className={styles.title}>フィードバック管理</h1>
                        <p className={styles.subtitle}>機能リクエスト・バグ報告・改善要望</p>
                    </div>
                </div>
                <div className={styles.headerRight}>
                    <div className={`${styles.sseStatus} ${sseConnected ? styles.connected : ''}`}>
                        <span className={`${styles.statusDot} ${sseConnected ? styles.connected : ''}`}></span>
                        {sseConnected ? 'リアルタイム接続中' : '再接続中...'}
                    </div>
                </div>
            </div>

            <div className={styles.container}>
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

                    <button
                        className={styles.createButton}
                        onClick={() => setShowCreateModal(true)}
                    >
                        <i className="material-icons">add</i>
                        新規作成
                    </button>
                </div>

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
                                onUpvote={(id, e) => handleUpvote(id, e)}
                                onClick={() => setSelectedFeedback(item)}
                            />
                        ))}
                    </div>
                )}
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
                    feedback={selectedFeedback}
                    currentUserId={session.userId}
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
}

const FeedbackCard: React.FC<FeedbackCardProps> = ({ item, currentUserId, onUpvote, onClick }) => {
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
                    {item.authorAvatar ? (
                        <img src={item.authorAvatar} alt={item.authorName} className={styles.avatar} />
                    ) : (
                        <div className={styles.avatar} />
                    )}
                    <span className={styles.authorName}>{item.authorName}</span>
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

    const handleAddTag = () => {
        if (tagInput.trim() && !tags.includes(tagInput.trim())) {
            setTags([...tags, tagInput.trim()]);
            setTagInput('');
        }
    };

    const handleRemoveTag = (tag: string) => {
        setTags(tags.filter(t => t !== tag));
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
                        <label className={styles.formLabel}>タグ</label>
                        <div className={styles.tagInput}>
                            <input
                                type="text"
                                className={`${styles.formInput} ${styles.tagInputField}`}
                                value={tagInput}
                                onChange={(e) => setTagInput(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                                placeholder="タグを入力してEnter"
                            />
                            <button className={styles.addTagButton} onClick={handleAddTag}>
                                追加
                            </button>
                        </div>
                        {tags.length > 0 && (
                            <div className={styles.tagsList}>
                                {tags.map((tag) => (
                                    <div key={tag} className={styles.tagItem}>
                                        {tag}
                                        <button
                                            className={styles.removeTagButton}
                                            onClick={() => handleRemoveTag(tag)}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
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
    onClose: () => void;
    onUpvote: (id: string, e: React.MouseEvent) => void;
    onAddComment: (feedbackId: string, content: string) => void;
    onDelete: (id: string) => void;
}

const FeedbackDetailModal: React.FC<FeedbackDetailModalProps> = ({
    feedback,
    currentUserId,
    onClose,
    onUpvote,
    onAddComment,
    onDelete
}) => {
    const [commentInput, setCommentInput] = useState('');
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
                        </div>
                    </div>

                    <div className={styles.author}>
                        {feedback.authorAvatar ? (
                            <img src={feedback.authorAvatar} alt={feedback.authorName} className={styles.avatar} />
                        ) : (
                            <div className={styles.avatar} />
                        )}
                        <div>
                            <div className={styles.authorName}>{feedback.authorName}</div>
                            <div className={styles.commentTime}>{formatDate(feedback.createdAt)}</div>
                        </div>
                    </div>

                    {feedback.tags.length > 0 && (
                        <div className={styles.cardTags}>
                            {feedback.tags.map((tag, idx) => (
                                <span key={idx} className={styles.tag}>
                                    {tag}
                                </span>
                            ))}
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
                                        {comment.authorAvatar ? (
                                            <img src={comment.authorAvatar} alt={comment.authorName} className={styles.avatar} />
                                        ) : (
                                            <div className={styles.avatar} />
                                        )}
                                        <span className={styles.authorName}>{comment.authorName}</span>
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
