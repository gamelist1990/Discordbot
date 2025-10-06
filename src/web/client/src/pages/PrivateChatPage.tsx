import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styles from './PrivateChatPage.module.css';
import {
  validateToken,
  fetchPrivateChats,
  createPrivateChat,
  deletePrivateChat,
  fetchPrivateChatStats,
  ApiError,
  type PrivateChat,
  type PrivateChatStats as Stats,
} from '../services/api';


const PrivateChatPage: React.FC = () => {
  const params = useParams();
  const navigate = useNavigate();

  // path parameter を必須とする（古い ?token 形式は廃止）
  const token = params.token ?? undefined;

  const [chats, setChats] = useState<PrivateChat[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [useSSE, setUseSSE] = useState(true); // SSE を優先的に使用

  useEffect(() => {
    // NOTE: token はパスパラメータ優先で取得するようになった
    if (!token) {
      navigate('/404');
      return;
    }

    validateAndLoadData();

    let eventSource: EventSource | null = null;
    let pollInterval: NodeJS.Timeout | null = null;

    // SSE を試行
    if (useSSE) {
      try {
        eventSource = new EventSource(`/api/staff/privatechats/${token}/stream`);

        eventSource.onopen = () => {
          console.log('SSE 接続が確立されました');
          setRealtimeStatus('connected');
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'update') {
              setChats(data.chats || []);
              setStats(data.stats || null);
              setLastUpdate(new Date(data.timestamp));
              setRealtimeStatus('connected');
            } else if (data.error) {
              console.error('SSE エラー:', data.error);
              setRealtimeStatus('disconnected');
            }
          } catch (err) {
            console.error('SSE データのパースエラー:', err);
          }
        };

        eventSource.onerror = (err) => {
          console.error('SSE 接続エラー:', err);
          setRealtimeStatus('disconnected');
          eventSource?.close();
          
          // SSE が失敗した場合、ポーリングにフォールバック
          setUseSSE(false);
        };
      } catch (err) {
        console.error('SSE 初期化エラー:', err);
        setUseSSE(false);
      }
    }

    // SSE が利用できない場合はポーリング
    if (!useSSE) {
      pollInterval = setInterval(() => {
        loadChats();
        loadStats();
        setLastUpdate(new Date());
      }, 10000); // 10秒ごとに更新
    }

    return () => {
      if (eventSource) {
        eventSource.close();
        console.log('SSE 接続を閉じました');
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [token, navigate, useSSE]);

  const validateAndLoadData = async () => {
    setRealtimeStatus('connecting');
    try {
      // トークン検証
      await validateToken(token!);

      // データ読み込み
      await Promise.all([loadChats(), loadStats()]);
      setRealtimeStatus('connected');
      setLastUpdate(new Date());
    } catch (err) {
      const errorMessage = err instanceof ApiError 
        ? err.message 
        : err instanceof Error 
        ? err.message 
        : 'Failed to load data';
      setError(errorMessage);
      setLoading(false);
      setRealtimeStatus('disconnected');
    }
  };

  const loadChats = async () => {
    try {
      const data = await fetchPrivateChats(token!);
      setChats(data.chats || []);
      setLoading(false);
    } catch (err) {
      const errorMessage = err instanceof ApiError 
        ? err.message 
        : err instanceof Error 
        ? err.message 
        : 'Failed to load chats';
      setError(errorMessage);
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const data = await fetchPrivateChatStats(token!);
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const handleCreateChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;

    setCreating(true);
    try {
      await createPrivateChat(token!, { roomName: newRoomName.trim() });
      setNewRoomName('');
      await loadChats();
      await loadStats();
    } catch (err) {
      const errorMessage = err instanceof ApiError 
        ? err.message 
        : err instanceof Error 
        ? err.message 
        : 'Failed to create chat';
      alert(errorMessage);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    if (!confirm('このプライベートチャットを削除しますか？')) return;

    try {
      await deletePrivateChat(token!, chatId);
      await loadChats();
      await loadStats();
    } catch (err) {
      const errorMessage = err instanceof ApiError 
        ? err.message 
        : err instanceof Error 
        ? err.message 
        : 'Failed to delete chat';
      alert(errorMessage);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('ja-JP');
  };

  if (loading) {
    return (
      <div className={styles.privateChatPage}>
        <div className={styles.loading}>読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.privateChatPage}>
        <div className={styles.error}>
          <h2>エラー</h2>
          <p>{error}</p>
          <button onClick={() => navigate('/')}>ダッシュボードに戻る</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.privateChatPage}>
      {/* Real-time update indicator */}
      {realtimeStatus === 'connected' && lastUpdate && (
        <div className={`${styles.updateIndicator}`}>
          <span className={styles.pulse}></span>
          <span>リアルタイム更新中 {useSSE ? '(SSE)' : '(ポーリング)'}</span>
        </div>
      )}
      {realtimeStatus === 'connecting' && (
        <div className={`${styles.updateIndicator} ${styles.connecting}`}>
          <span>接続中...</span>
        </div>
      )}
      {realtimeStatus === 'disconnected' && (
        <div className={`${styles.updateIndicator} ${styles.error}`}>
          <span>切断されました</span>
        </div>
      )}

      <header className={styles.pageHeader}>
        <h1>💬 プライベートチャット管理</h1>
        <p>部屋名でプライベートな会話チャンネルを作成・管理できます</p>
        {lastUpdate && (
          <p style={{ fontSize: '0.9rem', color: '#999', marginTop: '0.5rem' }}>
            最終更新: {lastUpdate.toLocaleTimeString('ja-JP')}
          </p>
        )}
      </header>

      {stats && (
        <div className={styles.statsSection}>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>{stats.total}</div>
            <div className={styles.statLabel}>合計</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>{stats.today}</div>
            <div className={styles.statLabel}>今日</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>{stats.thisWeek}</div>
            <div className={styles.statLabel}>今週</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>{stats.thisMonth}</div>
            <div className={styles.statLabel}>今月</div>
          </div>
        </div>
      )}

      <div className={styles.createSection}>
        <h2>🆕 新しいチャットを作成</h2>
        <p>部屋名を指定してプライベートチャットを作成します。作成後にメンバーを追加できます。</p>
        <form onSubmit={handleCreateChat} className={styles.createForm}>
          <input
            type="text"
            placeholder="部屋名を入力"
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            disabled={creating}
            className={styles.userIdInput}
          />
          <button type="submit" disabled={creating || !newRoomName.trim()} className={styles.createButton}>
            {creating ? '作成中...' : '作成'}
          </button>
        </form>
      </div>

      <div className={styles.chatsSection}>
        <h2>📋 アクティブなチャット一覧 ({chats.length})</h2>
        
        {chats.length === 0 ? (
          <div className={styles.emptyState}>
            <p>まだプライベートチャットがありません</p>
          <p className={styles.hint}>上のフォームから部屋名を入力して作成できます</p>
          </div>
        ) : (
          <div className={styles.chatsList}>
            {chats.map((chat) => (
              <div key={chat.chatId} className={styles.chatCard}>
                <div className={styles.chatHeader}>
                  <div className={styles.chatTitle}>
                    <span className={styles.chatIcon}>💬</span>
                    <span className={styles.userName}>{chat.userName}</span>
                    {!chat.channelExists && <span className={styles.deletedBadge}>削除済み</span>}
                  </div>
                  <button 
                    onClick={() => handleDeleteChat(chat.chatId)}
                    className={styles.deleteButton}
                    title="削除"
                  >
                    🗑️
                  </button>
                </div>
                
                <div className={styles.chatDetails}>
                  <div className={styles.detailRow}>
                    <span className={styles.label}>チャットID:</span>
                    <span className={styles.value + ' ' + styles.mono}>{chat.chatId}</span>
                  </div>
                  {chat.roomName && (
                    <div className={styles.detailRow}>
                      <span className={styles.label}>部屋名:</span>
                      <span className={styles.value}>{chat.roomName}</span>
                    </div>
                  )}
                  {chat.userId && (
                    <div className={styles.detailRow}>
                      <span className={styles.label}>ユーザーID:</span>
                      <span className={styles.value + ' ' + styles.mono}>{chat.userId}</span>
                    </div>
                  )}
                  <div className={styles.detailRow}>
                    <span className={styles.label}>スタッフ:</span>
                    <span className={styles.value}>{chat.staffName}</span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.label}>作成日時:</span>
                    <span className={styles.value}>{formatDate(chat.createdAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PrivateChatPage;
