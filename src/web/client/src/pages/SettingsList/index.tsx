import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './SettingsListPage.module.css';

interface Guild {
  id: string;
  name: string;
  icon?: string;
  owner: boolean;
  permissions: number;
}

const SettingsListPage: React.FC = () => {
  const navigate = useNavigate();
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    fetchGuilds();
  }, []);

  const fetchGuilds = async () => {
    try {
      const res = await fetch('/api/user/guilds', { credentials: 'include' });
      if (res.status === 401) {
        setIsAuthenticated(false);
        setGuilds([]);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error('サーバー一覧の取得に失敗しました');
      const data = await res.json();
      setGuilds(data.guilds || []);
      setIsAuthenticated(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'サーバー一覧の取得に失敗しました');
      setIsAuthenticated(null);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSettings = (guildId: string) => {
    navigate(`/settings/${guildId}`);
  };

  return (
    <div>
      <div className={styles.container}>
        <h1>管理サーバー一覧</h1>
        {loading ? (
          <div className={styles.loading}>読み込み中...</div>
        ) : error ? (
          <div className={styles.error}>{error}</div>
        ) : isAuthenticated === false ? (
          <div className={styles.error}>
            <p>この機能を利用するにはDiscordでログインしてください。</p>
            <button className={styles.openBtn} onClick={() => window.location.href = '/api/auth/discord'}>
              <span className="material-icons">login</span> Discordでログイン
            </button>
          </div>
        ) : guilds.length === 0 ? (
          <div>管理権限のあるサーバーがありません。</div>
        ) : (
          <div className={styles.guildList}>
            {guilds.map(guild => (
              <div key={guild.id} className={styles.guildCard}>
                <div className={styles.guildIcon}>
                  {guild.icon ? (
                    <img src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`} alt={guild.name} />
                  ) : (
                    <div className={styles.defaultIcon}>{guild.name.charAt(0).toUpperCase()}</div>
                  )}
                </div>
                <div className={styles.guildInfo}>
                  <h2>{guild.name}</h2>
                  <button onClick={() => handleOpenSettings(guild.id)} className={styles.openBtn}>
                    開く
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsListPage;
