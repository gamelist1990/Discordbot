import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    validateToken,
    fetchPrivateChats,
    createPrivateChat,
    deletePrivateChat,
    fetchPrivateChatStats,
    fetchChatMembers,
    addChatMember,
    removeChatMember,
    searchUsers,
    type PrivateChat,
    type PrivateChatStats,
    type ChatMember
} from '../../services/api';
import { useAppToast } from '../../AppToastProvider';
import styles from './PrivateChatPage.module.css';

type TabType = 'overview' | 'rooms' | 'stats';

const PrivateChatPage: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<TabType>('overview');
    
    const [chats, setChats] = useState<PrivateChat[]>([]);
    const [stats, setStats] = useState<PrivateChatStats | null>(null);
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
    const [roomMembers, setRoomMembers] = useState<ChatMember[]>([]);
    
    const [newRoomName, setNewRoomName] = useState('');
    const [newMemberUserName, setNewMemberUserName] = useState('');
    const [userSearchResults, setUserSearchResults] = useState<Array<{ id: string; username: string; displayName: string | null; avatar: string | null }>>([]);
    const [showUserSuggestions, setShowUserSuggestions] = useState(false);
    const [creatingChat, setCreatingChat] = useState(false);
    
    const [lastUpdate, setLastUpdate] = useState<string>('');
    const eventSourceRef = useRef<EventSource | null>(null);
    const { addToast } = (() => {
        try {
            return useAppToast();
        } catch {
            return { addToast: undefined } as any;
        }
    })();

    // トークン検証
    useEffect(() => {
        if (!token) {
            setError('トークンが指定されていません');
            setLoading(false);
            return;
        }

        validateToken(token)
            .then(() => {
                setLoading(false);
            })
            .catch(() => {
                setError('トークンが無効です');
                setLoading(false);
            });
    }, [token]);

    // データ取得とSSE接続
    useEffect(() => {
        if (!token || loading || error) return;

        const loadData = async () => {
            try {
                const [chatsData, statsData] = await Promise.all([
                    fetchPrivateChats(token),
                    fetchPrivateChatStats(token)
                ]);
                setChats(chatsData.chats);
                setStats(statsData);
                setLastUpdate(new Date().toLocaleTimeString('ja-JP'));
            } catch (err) {
                console.error('データ取得エラー:', err);
            }
        };

        loadData();

        // SSE接続
        const eventSource = new EventSource(`/api/staff/privatechats/${token}/stream`);
        eventSourceRef.current = eventSource;

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'update') {
                    setChats(data.chats);
                    setStats(data.stats);
                    setLastUpdate(new Date().toLocaleTimeString('ja-JP'));
                }
            } catch (err) {
                console.error('SSE データパースエラー:', err);
            }
        };

        eventSource.onerror = () => {
            eventSource.close();
        };

        return () => {
            eventSource.close();
        };
    }, [token, loading, error]);

    // 選択された部屋のメンバーを取得
    useEffect(() => {
        if (!token || !selectedRoomId) return;

        const loadMembers = async () => {
            try {
                const data = await fetchChatMembers(token, selectedRoomId);
                setRoomMembers(data.members);
            } catch (err) {
                console.error('メンバー取得エラー:', err);
            }
        };

        loadMembers();
    }, [token, selectedRoomId]);

    // チャット作成
    const handleCreateChat = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token || !newRoomName.trim() || creatingChat) return;

        setCreatingChat(true);
        try {
            await createPrivateChat(token, {
                roomName: newRoomName.trim(),
                members: []
            });
            setNewRoomName('');
            // データは SSE で更新される
        } catch (err) {
            console.error('チャット作成エラー:', err);
            alert('チャットの作成に失敗しました');
        } finally {
            setCreatingChat(false);
        }
    };

    // チャット削除
    const handleDeleteChat = async (chatId: string) => {
        if (!token || !confirm('このチャットを削除してもよろしいですか？')) return;

        try {
            await deletePrivateChat(token, chatId);
            if (selectedRoomId === chatId) {
                setSelectedRoomId(null);
            }
        } catch (err) {
            console.error('チャット削除エラー:', err);
            alert('チャットの削除に失敗しました');
        }
    };

    // メンバー追加
    const handleAddMember = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token || !selectedRoomId || !newMemberUserName.trim()) return;

        try {
            await addChatMember(token, selectedRoomId, newMemberUserName.trim());
            setNewMemberUserName('');
            setUserSearchResults([]);
            setShowUserSuggestions(false);
            // メンバーリストを再取得
            const data = await fetchChatMembers(token, selectedRoomId);
            setRoomMembers(data.members);
            // トースト通知
            try { addToast && addToast('メンバーを追加しました', 'success'); } catch {}
        } catch (err) {
            console.error('メンバー追加エラー:', err);
            try { addToast && addToast('メンバーの追加に失敗しました', 'error'); } catch {}
        }
    };

    // ユーザー名入力ハンドラー
    const handleUserNameChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setNewMemberUserName(value);

        if (value.trim().length > 0 && token) {
            try {
                const results = await searchUsers(token, value.trim(), selectedRoomId || undefined);
                setUserSearchResults(results.users);
                setShowUserSuggestions(true);
            } catch (err) {
                console.error('ユーザー検索エラー:', err);
                setUserSearchResults([]);
                setShowUserSuggestions(false);
            }
        } else {
            setUserSearchResults([]);
            setShowUserSuggestions(false);
        }
    };

    // ユーザー候補選択
    const handleUserSelect = (user: { username: string; displayName: string | null }) => {
        setNewMemberUserName(user.displayName || user.username);
        setUserSearchResults([]);
        setShowUserSuggestions(false);
    };

    // メンバー削除
    const handleRemoveMember = async (userId: string) => {
        if (!token || !selectedRoomId || !confirm('このメンバーを削除してもよろしいですか？')) return;

        try {
            await removeChatMember(token, selectedRoomId, userId);
            // メンバーリストを再取得
            const data = await fetchChatMembers(token, selectedRoomId);
            setRoomMembers(data.members);
            try { addToast && addToast('メンバーを削除しました', 'info'); } catch {}
        } catch (err) {
            console.error('メンバー削除エラー:', err);
            try { addToast && addToast('メンバーの削除に失敗しました', 'error'); } catch {}
        }
    };

    if (loading) {
        return (
            <div className={styles.loading}>
                <i className="material-icons">sync</i>
                <p>読み込み中...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.error}>
                <i className="material-icons">error</i>
                <h2>エラー</h2>
                <p>{error}</p>
                <button className={styles.button} onClick={() => navigate('/')}>
                    <i className="material-icons">home</i>
                    ダッシュボードに戻る
                </button>
            </div>
        );
    }

    const selectedRoom = chats.find(chat => chat.chatId === selectedRoomId);

    return (
        <div className={styles.container}>
            {/* ヘッダー */}
            <header className={styles.header}>
                <div className={styles.headerContent}>
                    <div className={styles.headerTitle}>
                        <i className="material-icons">forum</i>
                        <h1>プライベートチャット管理</h1>
                    </div>
                    <div className={styles.headerStatus}>
                        <div className={styles.statusConnected}>
                            <i className="material-icons">cloud_done</i>
                            <span>接続中</span>
                        </div>
                        <div className={styles.lastUpdate}>
                            最終更新: {lastUpdate}
                        </div>
                    </div>
                </div>
            </header>

            {/* タブナビゲーション */}
            <div className={styles.tabs}>
                <button
                    className={`${styles.tab} ${activeTab === 'overview' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('overview')}
                >
                    <i className="material-icons">dashboard</i>
                    概要
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'rooms' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('rooms')}
                >
                    <i className="material-icons">meeting_room</i>
                    部屋管理
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'stats' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('stats')}
                >
                    <i className="material-icons">bar_chart</i>
                    統計
                </button>
            </div>

            {/* メインコンテンツ */}
            <div className={styles.content}>
                {/* 概要タブ */}
                {activeTab === 'overview' && (
                    <>
                        {/* 統計カード */}
                        {stats && (
                            <div className={styles.statsGrid}>
                                <div className={`${styles.statCard} ${styles.statCardPrimary}`}>
                                    <i className="material-icons">folder</i>
                                    <div className={styles.statNumber}>{stats.total}</div>
                                    <div className={styles.statLabel}>総チャット数</div>
                                </div>
                                <div className={`${styles.statCard} ${styles.statCardSuccess}`}>
                                    <i className="material-icons">today</i>
                                    <div className={styles.statNumber}>{stats.today}</div>
                                    <div className={styles.statLabel}>今日作成</div>
                                </div>
                                <div className={`${styles.statCard} ${styles.statCardInfo}`}>
                                    <i className="material-icons">date_range</i>
                                    <div className={styles.statNumber}>{stats.thisWeek}</div>
                                    <div className={styles.statLabel}>今週作成</div>
                                </div>
                                <div className={`${styles.statCard} ${styles.statCardWarning}`}>
                                    <i className="material-icons">calendar_today</i>
                                    <div className={styles.statNumber}>{stats.thisMonth}</div>
                                    <div className={styles.statLabel}>今月作成</div>
                                </div>
                            </div>
                        )}

                        {/* チャット作成フォーム */}
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <i className="material-icons">add_circle</i>
                                <h2>新しいチャットを作成</h2>
                            </div>
                            <div className={styles.cardContent}>
                                <form onSubmit={handleCreateChat} className={styles.form}>
                                    <div className={styles.inputGroup}>
                                        <i className="material-icons">label</i>
                                        <input
                                            type="text"
                                            className={styles.input}
                                            placeholder="部屋名を入力 (例: meeting-room)"
                                            value={newRoomName}
                                            onChange={(e) => setNewRoomName(e.target.value)}
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        className={styles.button}
                                        disabled={creatingChat || !newRoomName.trim()}
                                    >
                                        <i className="material-icons">add</i>
                                        作成
                                    </button>
                                </form>
                                <p className={styles.hint}>
                                    💡 部屋名を入力すると、テキストチャンネル「部屋名」とボイスチャンネル「部屋名-vc」が作成されます
                                </p>
                            </div>
                        </div>

                        {/* チャット一覧 */}
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <i className="material-icons">list</i>
                                <h2>アクティブなチャット</h2>
                            </div>
                            <div className={styles.cardContent}>
                                {chats.length === 0 ? (
                                    <div className={styles.emptyState}>
                                        <i className="material-icons">inbox</i>
                                        <p>アクティブなチャットはありません</p>
                                        <p className={styles.hint}>新しいチャットを作成してください</p>
                                    </div>
                                ) : (
                                    <div className={styles.chatsList}>
                                        {chats.map((chat) => (
                                            <div key={chat.chatId} className={styles.chatCard}>
                                                <div className={styles.chatCardHeader}>
                                                    <div className={styles.chatCardTitle}>
                                                        <i className="material-icons">chat</i>
                                                        {chat.roomName || chat.userName}
                                                    </div>
                                                    <button
                                                        className={styles.deleteButton}
                                                        onClick={() => handleDeleteChat(chat.chatId)}
                                                        title="削除"
                                                    >
                                                        <i className="material-icons">delete</i>
                                                    </button>
                                                </div>
                                                <div className={styles.chatCardBody}>
                                                    <div className={styles.infoRow}>
                                                        <i className="material-icons">tag</i>
                                                        <strong>チャンネル:</strong>
                                                        <span>#{chat.channelId}</span>
                                                    </div>
                                                    {chat.vcId && (
                                                        <div className={styles.infoRow}>
                                                            <i className="material-icons">volume_up</i>
                                                            <strong>VC:</strong>
                                                            <span>#{chat.vcId}</span>
                                                        </div>
                                                    )}
                                                    <div className={styles.infoRow}>
                                                        <i className="material-icons">person</i>
                                                        <strong>作成者:</strong>
                                                        <span>{chat.staffName}</span>
                                                    </div>
                                                    <div className={styles.infoRow}>
                                                        <i className="material-icons">schedule</i>
                                                        <strong>作成日時:</strong>
                                                        <span>{new Date(chat.createdAt).toLocaleString('ja-JP')}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {/* 部屋管理タブ */}
                {activeTab === 'rooms' && (
                    <div className={styles.roomsView}>
                        <div className={styles.roomsLayout}>
                            {/* 部屋リスト */}
                            <div className={styles.card}>
                                <div className={styles.cardHeader}>
                                    <i className="material-icons">meeting_room</i>
                                    <h2>部屋一覧</h2>
                                </div>
                                <div className={styles.cardContent}>
                                    {chats.length === 0 ? (
                                        <div className={styles.emptyState}>
                                            <i className="material-icons">inbox</i>
                                            <p>部屋がありません</p>
                                        </div>
                                    ) : (
                                        <div className={styles.roomItems}>
                                            {chats.map((chat) => (
                                                <div
                                                    key={chat.chatId}
                                                    className={`${styles.roomItem} ${selectedRoomId === chat.chatId ? styles.roomItemActive : ''}`}
                                                    onClick={() => setSelectedRoomId(chat.chatId)}
                                                >
                                                    <i className="material-icons">
                                                        {chat.roomName ? 'meeting_room' : 'person'}
                                                    </i>
                                                    <div className={styles.roomItemInfo}>
                                                        <div className={styles.roomItemName}>
                                                            {chat.roomName || chat.userName}
                                                        </div>
                                                        <div className={styles.roomItemSubtitle}>
                                                            作成: {new Date(chat.createdAt).toLocaleDateString('ja-JP')}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 部屋詳細 */}
                            <div className={styles.card}>
                                <div className={styles.cardHeader}>
                                    <i className="material-icons">info</i>
                                    <h2>部屋の詳細</h2>
                                </div>
                                <div className={styles.cardContent}>
                                    {!selectedRoom ? (
                                        <div className={styles.emptyState}>
                                            <i className="material-icons">touch_app</i>
                                            <p>部屋を選択してください</p>
                                        </div>
                                    ) : (
                                        <div className={styles.roomDetails}>
                                            {/* 部屋情報 */}
                                            <div className={styles.detailSection}>
                                                <h3>
                                                    <i className="material-icons">description</i>
                                                    部屋情報
                                                </h3>
                                                <div className={styles.infoRow}>
                                                    <i className="material-icons">label</i>
                                                    <strong>部屋名:</strong>
                                                    <span>{selectedRoom.roomName || selectedRoom.userName}</span>
                                                </div>
                                                <div className={styles.infoRow}>
                                                    <i className="material-icons">tag</i>
                                                    <strong>テキストチャンネル:</strong>
                                                    <span>#{selectedRoom.channelId}</span>
                                                </div>
                                                {selectedRoom.vcId && (
                                                    <div className={styles.infoRow}>
                                                        <i className="material-icons">volume_up</i>
                                                        <strong>VCチャンネル:</strong>
                                                        <span>#{selectedRoom.vcId}</span>
                                                    </div>
                                                )}
                                                <div className={styles.infoRow}>
                                                    <i className="material-icons">person</i>
                                                    <strong>作成者:</strong>
                                                    <span>{selectedRoom.staffName}</span>
                                                </div>
                                            </div>

                                            {/* メンバー管理 */}
                                            <div className={styles.detailSection}>
                                                <h3>
                                                    <i className="material-icons">group</i>
                                                    メンバー管理
                                                </h3>
                                                <form onSubmit={handleAddMember} className={styles.form}>
                                                    <div className={styles.inputGroup}>
                                                        <i className="material-icons">person_add</i>
                                                        <input
                                                            type="text"
                                                            className={styles.input}
                                                            placeholder="ユーザー名を入力"
                                                            value={newMemberUserName}
                                                            onChange={handleUserNameChange}
                                                        />
                                                        {showUserSuggestions && userSearchResults.length > 0 && (
                                                            <div className={styles.suggestions}>
                                                                {userSearchResults.map((user) => (
                                                                    <div
                                                                        key={user.id}
                                                                        className={styles.suggestionItem}
                                                                        onClick={() => handleUserSelect(user)}
                                                                    >
                                                                        {user.avatar ? (
                                                                            <img
                                                                                src={user.avatar}
                                                                                alt={user.username}
                                                                                className={styles.suggestionAvatar}
                                                                            />
                                                                        ) : (
                                                                            <div className={styles.suggestionAvatarPlaceholder}>
                                                                                <i className="material-icons">person</i>
                                                                            </div>
                                                                        )}
                                                                        <div className={styles.suggestionInfo}>
                                                                            <div className={styles.suggestionUsername}>{user.username}</div>
                                                                            {user.displayName && user.displayName !== user.username && (
                                                                                <div className={styles.suggestionDisplayName}>{user.displayName}</div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <button
                                                        type="submit"
                                                        className={styles.button}
                                                        disabled={!newMemberUserName.trim()}
                                                    >
                                                        <i className="material-icons">add</i>
                                                        追加
                                                    </button>
                                                </form>

                                                {/* メンバーリスト */}
                                                {roomMembers.length === 0 ? (
                                                    <div className={styles.emptyState}>
                                                        <i className="material-icons">person_off</i>
                                                        <p>メンバーがいません</p>
                                                    </div>
                                                ) : (
                                                    <div className={styles.membersList}>
                                                        {roomMembers.map((member) => (
                                                            <div key={member.id} className={styles.memberCard}>
                                                                {member.avatar ? (
                                                                    <img
                                                                        src={member.avatar}
                                                                        alt={member.username}
                                                                        className={styles.memberAvatar}
                                                                    />
                                                                ) : (
                                                                    <div className={styles.memberAvatarPlaceholder}>
                                                                        <i className="material-icons">person</i>
                                                                    </div>
                                                                )}
                                                                <div className={styles.memberInfo}>
                                                                    <div className={styles.memberName}>{member.username}</div>
                                                                    <div className={styles.memberId}>{member.id}</div>
                                                                </div>
                                                                <button
                                                                    className={styles.removeMemberButton}
                                                                    onClick={() => handleRemoveMember(member.id)}
                                                                    title="削除"
                                                                >
                                                                    <i className="material-icons">remove_circle</i>
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 統計タブ */}
                {activeTab === 'stats' && stats && (
                    <>
                        <div className={styles.statsGrid}>
                            <div className={`${styles.statCard} ${styles.statCardPrimary}`}>
                                <i className="material-icons">folder</i>
                                <div className={styles.statNumber}>{stats.total}</div>
                                <div className={styles.statLabel}>総チャット数</div>
                            </div>
                            <div className={`${styles.statCard} ${styles.statCardSuccess}`}>
                                <i className="material-icons">today</i>
                                <div className={styles.statNumber}>{stats.today}</div>
                                <div className={styles.statLabel}>今日作成</div>
                            </div>
                            <div className={`${styles.statCard} ${styles.statCardInfo}`}>
                                <i className="material-icons">date_range</i>
                                <div className={styles.statNumber}>{stats.thisWeek}</div>
                                <div className={styles.statLabel}>今週作成</div>
                            </div>
                            <div className={`${styles.statCard} ${styles.statCardWarning}`}>
                                <i className="material-icons">calendar_today</i>
                                <div className={styles.statNumber}>{stats.thisMonth}</div>
                                <div className={styles.statLabel}>今月作成</div>
                            </div>
                        </div>

                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <i className="material-icons">analytics</i>
                                <h2>詳細統計</h2>
                            </div>
                            <div className={styles.cardContent}>
                                <div className={styles.infoRow}>
                                    <i className="material-icons">trending_up</i>
                                    <strong>平均作成数/日:</strong>
                                    <span>{(stats.total / Math.max(1, Math.ceil((Date.now() - (chats[chats.length - 1]?.createdAt || Date.now())) / (1000 * 60 * 60 * 24)))).toFixed(2)}</span>
                                </div>
                                <div className={styles.infoRow}>
                                    <i className="material-icons">check_circle</i>
                                    <strong>アクティブなチャット:</strong>
                                    <span>{chats.filter(c => c.channelExists).length}</span>
                                </div>
                                <div className={styles.infoRow}>
                                    <i className="material-icons">mic</i>
                                    <strong>VC付きチャット:</strong>
                                    <span>{chats.filter(c => c.vcId).length}</span>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default PrivateChatPage;
