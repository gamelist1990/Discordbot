import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styles from './AppHeader.module.css';

interface UserInfo {
  userId: string;
  username: string;
  avatar?: string | null;
  permissionLevel?: number;
}

interface AppHeaderProps {
  user?: UserInfo | null;
  onLogout?: () => void;
}

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

const AppHeader: React.FC<AppHeaderProps> = ({ user: userProp, onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [user, setUser] = useState<UserInfo | null | undefined>(userProp);
  const [loading, setLoading] = useState(userProp === undefined);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (userProp !== undefined) {
      setUser(userProp);
      setLoading(false);
      return;
    }

    const fetchSession = async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/auth/session', { credentials: 'include' });
        if (!response.ok) {
          setUser(null);
          return;
        }

        const data = await response.json();
        setUser(data.user || null);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [userProp]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setShowUserMenu(false);
      }

      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(target)) {
        setShowWorkspaceMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const canSeeStaff = Boolean(user?.permissionLevel && user.permissionLevel >= 1);

  const primaryItems = useMemo<NavItem[]>(
    () => [
      { label: 'ホーム', path: '/', icon: 'home' },
      { label: 'サーバー管理', path: '/settings', icon: 'tune' },
      { label: 'フィードバック', path: '/feedback', icon: 'forum' },
      { label: 'ランキング', path: '/rank', icon: 'leaderboard' },
      { label: 'Tools', path: '/tools', icon: 'construction' },
    ],
    []
  );

  const workspaceItems = useMemo<NavItem[]>(() => {
    const items: NavItem[] = [
      { label: 'プロフィール', path: '/profile', icon: 'person' },
      { label: 'サーバー管理', path: '/settings', icon: 'tune' },
      { label: 'フィードバック', path: '/feedback', icon: 'forum' },
      { label: 'ランキング', path: '/rank', icon: 'leaderboard' },
      { label: 'Tools', path: '/tools', icon: 'construction' },
    ];

    if (canSeeStaff) {
      items.push({ label: 'スタッフ', path: '/staff', icon: 'shield' });
    }

    return items;
  }, [canSeeStaff]);

  const goTo = (path: string) => {
    setShowUserMenu(false);
    setShowWorkspaceMenu(false);
    navigate(path);
  };

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/';
    }

    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      onLogout?.();
      window.location.href = '/';
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const avatarSrc = (() => {
    if (!user?.avatar) {
      return 'https://cdn.discordapp.com/embed/avatars/0.png';
    }

    if (/^https?:\/\//.test(user.avatar)) {
      return user.avatar;
    }

    const isAnimated = user.avatar.startsWith('a_');
    const extension = isAnimated ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.userId}/${user.avatar}.${extension}?size=128`;
  })();

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <button className={styles.brand} onClick={() => goTo('/')} type="button">
          <span className={styles.brandMark}>PX</span>
          <span className={styles.brandCopy}>
            <span className={styles.brandTitle}>PEXServer</span>
            <span className={styles.brandSubtitle}>Discord operations surface</span>
          </span>
        </button>

        <nav className={styles.nav} aria-label="Primary">
          {user
            ? primaryItems.map((item) => (
                <button
                  key={item.path}
                  className={`${styles.navLink} ${isActive(item.path) ? styles.navLinkActive : ''}`}
                  onClick={() => goTo(item.path)}
                  type="button"
                >
                  <span className="material-icons">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))
            : null}
        </nav>

        <div className={styles.actions}>
          {loading ? <span className={styles.loadingText}>セッション確認中...</span> : null}

          {!loading && user ? (
            <>
              <div className={styles.workspaceMenu} ref={workspaceMenuRef}>
                <button
                  className={styles.iconButton}
                  onClick={() => setShowWorkspaceMenu((prev) => !prev)}
                  type="button"
                  aria-label="ワークスペースメニュー"
                >
                  <span className="material-icons">dashboard_customize</span>
                </button>

                {showWorkspaceMenu ? (
                  <div className={styles.panel}>
                    <div className={styles.panelHeader}>
                      <span className={styles.panelEyebrow}>Workspace</span>
                      <h2>移動先を選択</h2>
                    </div>
                    <div className={styles.menuGrid}>
                      {workspaceItems.map((item) => (
                        <button
                          key={item.path}
                          className={styles.menuCard}
                          onClick={() => goTo(item.path)}
                          type="button"
                        >
                          <span className="material-icons">{item.icon}</span>
                          <span>{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={styles.userMenu} ref={userMenuRef}>
                <button
                  className={styles.userButton}
                  onClick={() => setShowUserMenu((prev) => !prev)}
                  type="button"
                >
                  <img
                    className={styles.avatar}
                    src={avatarSrc}
                    alt={user.username}
                    onError={(event) => {
                      event.currentTarget.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
                    }}
                  />
                  <span className={styles.userCopy}>
                    <span className={styles.userName}>{user.username}</span>
                    <span className={styles.userMeta}>ID {user.userId}</span>
                  </span>
                  <span className="material-icons">
                    {showUserMenu ? 'expand_less' : 'expand_more'}
                  </span>
                </button>

                {showUserMenu ? (
                  <div className={styles.panel}>
                    <div className={styles.panelHeader}>
                      <span className={styles.panelEyebrow}>Account</span>
                      <h2>{user.username}</h2>
                    </div>
                    <div className={styles.panelStack}>
                      <button className={styles.menuRow} onClick={() => goTo('/profile')} type="button">
                        <span className="material-icons">person</span>
                        <span>プロフィール</span>
                      </button>
                      <button className={styles.menuRow} onClick={handleLogout} type="button">
                        <span className="material-icons">logout</span>
                        <span>ログアウト</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {!loading && !user ? (
            <button
              className={styles.loginButton}
              onClick={() => {
                window.location.href = '/api/auth/discord';
              }}
              type="button"
            >
              <span className="material-icons">login</span>
              <span>Discordでログイン</span>
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
