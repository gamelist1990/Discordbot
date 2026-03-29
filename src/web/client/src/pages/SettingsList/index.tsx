import React, { useEffect, useMemo, useState } from 'react';
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
    const fetchGuilds = async () => {
      try {
        const response = await fetch('/api/user/guilds', { credentials: 'include' });

        if (response.status === 401) {
          setIsAuthenticated(false);
          setGuilds([]);
          return;
        }

        if (!response.ok) {
          throw new Error('サーバー一覧の取得に失敗しました');
        }

        const data = await response.json();
        setGuilds(data.guilds || []);
        setIsAuthenticated(true);
      } catch (fetchError) {
        setError(
          fetchError instanceof Error ? fetchError.message : 'サーバー一覧の取得に失敗しました'
        );
      } finally {
        setLoading(false);
      }
    };

    fetchGuilds();
  }, []);

  const ownerCount = useMemo(() => guilds.filter((guild) => guild.owner).length, [guilds]);
  const isLoggedOut = isAuthenticated === false;

  const renderContent = () => {
    if (loading) {
      return <div className={styles.statePanel}>管理対象サーバーを読み込んでいます...</div>;
    }

    if (error) {
      return <div className={styles.statePanel}>{error}</div>;
    }

    if (isAuthenticated === false) {
      return (
        <div className={styles.statePanel}>
          <h2>ログインが必要です</h2>
          <p>Discord で認証すると、管理権限のあるサーバーだけを安全に一覧化します。</p>
          <button
            className={styles.primaryButton}
            onClick={() => {
              window.location.href = '/api/auth/discord';
            }}
            type="button"
          >
            <span className="material-icons">login</span>
            Discordでログイン
          </button>
        </div>
      );
    }

    if (guilds.length === 0) {
      return (
        <div className={styles.statePanel}>
          <h2>管理できるサーバーがありません</h2>
          <p>Bot が参加していて、あなたに管理権限のあるサーバーだけがここに表示されます。</p>
        </div>
      );
    }

    return (
      <div className={styles.guildList}>
        {guilds.map((guild) => (
          <article key={guild.id} className={styles.guildCard}>
            <div className={styles.guildIdentity}>
              <div className={styles.guildIcon}>
                {guild.icon ? (
                  <img
                    src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`}
                    alt={guild.name}
                  />
                ) : (
                  <span>{guild.name.charAt(0).toUpperCase()}</span>
                )}
              </div>

              <div className={styles.guildCopy}>
                <div className={styles.guildHeader}>
                  <h2>{guild.name}</h2>
                  <span className={styles.guildBadge}>{guild.owner ? 'Owner' : 'Manage'}</span>
                </div>
                <p>ID {guild.id}</p>
              </div>
            </div>

            <button
              className={styles.secondaryButton}
              onClick={() => navigate(`/settings/${guild.id}`)}
              type="button"
            >
              <span>設定を開く</span>
              <span className="material-icons">arrow_forward</span>
            </button>
          </article>
        ))}
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <section className={styles.pageHeader}>
        <div className={styles.pageHeaderCopy}>
          <span className={styles.pageEyebrow}>Server Management</span>
          <h1>管理対象サーバー</h1>
          <p>設定を触れるサーバーだけを集め、次に開く面を迷わない一覧に整理しています。</p>
        </div>

        <div className={styles.pageHeaderActions}>
          <button
            className={styles.primaryButton}
            onClick={() => navigate('/staff')}
            type="button"
          >
            <span className="material-icons">shield</span>
            スタッフ運用へ
          </button>
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Visible guilds</span>
            <strong>{isLoggedOut ? '—' : guilds.length}</strong>
            <p>
              {isLoggedOut
                ? 'Discord でログインすると、管理対象サーバーが表示されます。'
                : '現在このアカウントから管理できるサーバー数です。'}
            </p>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Owner access</span>
            <strong>{isLoggedOut ? '—' : ownerCount}</strong>
            <p>
              {isLoggedOut
                ? '認証後にオーナー権限の判定を行います。'
                : 'オーナー権限で開けるサーバー数を分離して把握できます。'}
            </p>
          </div>
        </div>
      </section>

      <div>
        {renderContent()}
      </div>
    </div>
  );
};

export default SettingsListPage;
