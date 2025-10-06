import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styles from './PrivateChatPage.module.css';

interface PrivateChat {
  chatId: string;
  channelId: string;
  userId: string;
  staffId: string;
  userName: string;
  staffName: string;
  channelExists: boolean;
  createdAt: number;
}

interface Stats {
  total: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
}

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
  const [newUserId, setNewUserId] = useState('');

  useEffect(() => {
    // NOTE: token はパスパラメータ優先で取得するようになった
    if (!token) {
      navigate('/404');
      return;
    }

    validateAndLoadData();
  }, [token, navigate]);

  const validateAndLoadData = async () => {
    try {
      // トークン検証
      const validateResponse = await fetch(`/api/validate/${token}`);
      if (!validateResponse.ok) {
        throw new Error('Invalid or expired token');
      }

      // データ読み込み
      await Promise.all([loadChats(), loadStats()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
      setLoading(false);
    }
  };

  const loadChats = async () => {
    try {
      const response = await fetch(`/api/staff/privatechats/${token}`);
      if (!response.ok) throw new Error('Failed to fetch chats');
      
      const data = await response.json();
      setChats(data.chats || []);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chats');
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await fetch(`/api/staff/stats/${token}`);
      if (!response.ok) throw new Error('Failed to fetch stats');
      
      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const handleCreateChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserId.trim()) return;

    setCreating(true);
    try {
      const response = await fetch(`/api/staff/privatechats/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: newUserId.trim() })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create chat');
      }

      setNewUserId('');
      await loadChats();
      await loadStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create chat');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    if (!confirm('このプライベートチャットを削除しますか？')) return;

    try {
      const response = await fetch(`/api/staff/privatechats/${token}/${chatId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete chat');
      }

      await loadChats();
      await loadStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete chat');
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
      <header className={styles.pageHeader}>
        <h1>💬 プライベートチャット管理</h1>
        <p>ユーザーとのプライベートな会話チャンネルを管理できます</p>
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
        <form onSubmit={handleCreateChat} className={styles.createForm}>
          <input
            type="text"
            placeholder="ユーザーID を入力"
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            disabled={creating}
            className={styles.userIdInput}
          />
          <button type="submit" disabled={creating || !newUserId.trim()} className={styles.createButton}>
            {creating ? '作成中...' : '作成'}
          </button>
        </form>
      </div>

      <div className={styles.chatsSection}>
        <h2>📋 アクティブなチャット一覧 ({chats.length})</h2>
        
        {chats.length === 0 ? (
          <div className={styles.emptyState}>
            <p>まだプライベートチャットがありません</p>
            <p className="hint">上のフォームからユーザーIDを入力して作成できます</p>
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
                  <div className={styles.detailRow}>
                    <span className={styles.label}>ユーザーID:</span>
                    <span className={styles.value + ' ' + styles.mono}>{chat.userId}</span>
                  </div>
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
