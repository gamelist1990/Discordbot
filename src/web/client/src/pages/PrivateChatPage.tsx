import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import './PrivateChatPage.module.css';

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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [chats, setChats] = useState<PrivateChat[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newUserId, setNewUserId] = useState('');

  useEffect(() => {
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
      <div className="private-chat-page">
        <div className="loading">読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="private-chat-page">
        <div className="error">
          <h2>エラー</h2>
          <p>{error}</p>
          <button onClick={() => navigate('/')}>ダッシュボードに戻る</button>
        </div>
      </div>
    );
  }

  return (
    <div className="private-chat-page">
      <header className="page-header">
        <h1>💬 プライベートチャット管理</h1>
        <p>ユーザーとのプライベートな会話チャンネルを管理できます</p>
      </header>

      {stats && (
        <div className="stats-section">
          <div className="stat-card">
            <div className="stat-number">{stats.total}</div>
            <div className="stat-label">合計</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{stats.today}</div>
            <div className="stat-label">今日</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{stats.thisWeek}</div>
            <div className="stat-label">今週</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{stats.thisMonth}</div>
            <div className="stat-label">今月</div>
          </div>
        </div>
      )}

      <div className="create-section">
        <h2>🆕 新しいチャットを作成</h2>
        <form onSubmit={handleCreateChat} className="create-form">
          <input
            type="text"
            placeholder="ユーザーID を入力"
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            disabled={creating}
            className="user-id-input"
          />
          <button type="submit" disabled={creating || !newUserId.trim()} className="create-button">
            {creating ? '作成中...' : '作成'}
          </button>
        </form>
      </div>

      <div className="chats-section">
        <h2>📋 アクティブなチャット一覧 ({chats.length})</h2>
        
        {chats.length === 0 ? (
          <div className="empty-state">
            <p>まだプライベートチャットがありません</p>
            <p className="hint">上のフォームからユーザーIDを入力して作成できます</p>
          </div>
        ) : (
          <div className="chats-list">
            {chats.map((chat) => (
              <div key={chat.chatId} className="chat-card">
                <div className="chat-header">
                  <div className="chat-title">
                    <span className="chat-icon">💬</span>
                    <span className="user-name">{chat.userName}</span>
                    {!chat.channelExists && <span className="deleted-badge">削除済み</span>}
                  </div>
                  <button 
                    onClick={() => handleDeleteChat(chat.chatId)}
                    className="delete-button"
                    title="削除"
                  >
                    🗑️
                  </button>
                </div>
                
                <div className="chat-details">
                  <div className="detail-row">
                    <span className="label">チャットID:</span>
                    <span className="value mono">{chat.chatId}</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">ユーザーID:</span>
                    <span className="value mono">{chat.userId}</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">スタッフ:</span>
                    <span className="value">{chat.staffName}</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">作成日時:</span>
                    <span className="value">{formatDate(chat.createdAt)}</span>
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
