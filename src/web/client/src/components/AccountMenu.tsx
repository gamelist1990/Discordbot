import React from 'react';

interface Props {
  userId: string;
  username: string;
  avatarUrl?: string | null;
  onLogout: () => void;
}

const AccountMenu: React.FC<Props> = ({ userId, username, avatarUrl, onLogout }) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {avatarUrl ? (
        <img src={avatarUrl} alt="avatar" style={{ width: 32, height: 32, borderRadius: 16 }} />
      ) : (
        <div style={{ width: 32, height: 32, borderRadius: 16, background: '#666', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{username?.charAt(0)?.toUpperCase()}</div>
      )}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 12 }}>{username}</div>
        <div style={{ fontSize: 10, opacity: 0.8 }}>{userId}</div>
      </div>
      <button onClick={onLogout} style={{ marginLeft: 8 }}>ログアウト</button>
    </div>
  );
};

export default AccountMenu;
