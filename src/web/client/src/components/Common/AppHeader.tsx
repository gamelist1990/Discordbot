import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styles from './AppHeader.module.css';
import { useTheme } from '../../theme/ThemeProvider';
import logoMark from '../../../../../../assets/logo/server.png';

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
}

const AppHeader: React.FC<AppHeaderProps> = ({ user: userProp, onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [user, setUser] = useState<UserInfo | null | undefined>(userProp);
  const [loading, setLoading] = useState(userProp === undefined);
  const userMenuRef = useRef<HTMLDivElement>(null);

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
    setShowUserMenu(false);
    setShowMobileNav(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const canSeeStaff = Boolean(user?.permissionLevel && user.permissionLevel >= 1);

  const primaryItems = useMemo<NavItem[]>(() => {
    const items: NavItem[] = [
      { label: 'ホーム', path: '/' },
      { label: 'ランキング', path: '/rank' },
      { label: 'サーバー管理', path: '/settings' },
    ];

    if (canSeeStaff) {
      items.push({ label: 'スタッフ', path: '/staff' });
    }

    return items;
  }, [canSeeStaff]);

  const currentSurface = useMemo(() => {
    if (location.pathname.startsWith('/staff/anticheat')) {
      return 'AntiCheat';
    }
    if (location.pathname.startsWith('/staff/corepanel')) {
      return 'Core Panel';
    }
    if (location.pathname.startsWith('/staff/rolemanager')) {
      return 'Role Manager';
    }
    if (location.pathname.startsWith('/staff')) {
      return 'Staff Workspace';
    }
    if (location.pathname.startsWith('/settings')) {
      return 'Server Management';
    }
    if (location.pathname.startsWith('/rank')) {
      return 'Rank Board';
    }
    if (location.pathname.startsWith('/profile')) {
      return 'Profile';
    }
    return 'Operations Workspace';
  }, [location.pathname]);

  const goTo = (path: string) => {
    setShowUserMenu(false);
    setShowMobileNav(false);
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
        <div className={styles.brandZone}>
          <button className={styles.brand} onClick={() => goTo('/')} type="button">
            <span className={styles.brandMark}>
              <img src={logoMark} alt="PEXServer" className={styles.brandLogo} />
            </span>
            <span className={styles.brandCopy}>
              <span className={styles.brandTitle}>PEXServer</span>
              <span className={styles.brandSubtitle}>Discord operation console</span>
            </span>
          </button>

          <div className={styles.surfaceBadge}>
            <span className={styles.surfaceLabel}>Surface</span>
            <strong>{currentSurface}</strong>
          </div>
        </div>

        <nav
          className={`${styles.nav} ${showMobileNav ? styles.navOpen : ''}`}
          aria-label="Primary"
        >
          {primaryItems.map((item) => (
            <button
              key={item.path}
              className={`${styles.navLink} ${isActive(item.path) ? styles.navLinkActive : ''}`}
              onClick={() => goTo(item.path)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className={styles.utility}>
          {loading ? <span className={styles.sessionHint}>セッション確認中...</span> : null}

          <button
            className={styles.themeButton}
            onClick={toggleTheme}
            type="button"
            aria-label={theme === 'light' ? 'ダークテーマへ切り替え' : 'ライトテーマへ切り替え'}
            title={theme === 'light' ? 'ダークテーマへ切り替え' : 'ライトテーマへ切り替え'}
          >
            <span className="material-icons">
              {theme === 'light' ? 'dark_mode' : 'light_mode'}
            </span>
            <span className={styles.utilityText}>{theme === 'light' ? 'Dark' : 'Light'}</span>
          </button>

          {!loading && user ? (
            <div className={styles.accountWrap} ref={userMenuRef}>
              <button
                className={styles.accountButton}
                onClick={() => setShowUserMenu((previous) => !previous)}
                type="button"
                aria-expanded={showUserMenu}
                aria-label="アカウントメニュー"
              >
                <img
                  className={styles.avatar}
                  src={avatarSrc}
                  alt={user.username}
                  onError={(event) => {
                    event.currentTarget.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
                  }}
                />
                <span className={styles.accountCopy}>
                  <span className={styles.accountName}>{user.username}</span>
                  <span className={styles.accountMeta}>
                    {canSeeStaff ? 'Staff access' : 'Member access'}
                  </span>
                </span>
                <span className="material-icons">
                  {showUserMenu ? 'expand_less' : 'expand_more'}
                </span>
              </button>

              {showUserMenu ? (
                <div className={styles.menuPanel}>
                  <div className={styles.menuHeader}>
                    <span className={styles.menuEyebrow}>Account</span>
                    <strong>{user.username}</strong>
                    <span className={styles.menuMeta}>ID {user.userId}</span>
                  </div>

                  <button className={styles.menuAction} onClick={() => goTo('/profile')} type="button">
                    <span className={styles.menuActionLeft}>
                      <span className="material-icons">person</span>
                      <span>プロフィール</span>
                    </span>
                    <span className="material-icons">arrow_forward</span>
                  </button>

                  <button className={styles.menuAction} onClick={() => goTo('/settings')} type="button">
                    <span className={styles.menuActionLeft}>
                      <span className="material-icons">tune</span>
                      <span>サーバー管理</span>
                    </span>
                    <span className="material-icons">arrow_forward</span>
                  </button>

                  {canSeeStaff ? (
                    <button className={styles.menuAction} onClick={() => goTo('/staff')} type="button">
                      <span className={styles.menuActionLeft}>
                        <span className="material-icons">shield</span>
                        <span>スタッフ運用</span>
                      </span>
                      <span className="material-icons">arrow_forward</span>
                    </button>
                  ) : null}

                  <button
                    className={`${styles.menuAction} ${styles.dangerAction}`}
                    onClick={handleLogout}
                    type="button"
                  >
                    <span className={styles.menuActionLeft}>
                      <span className="material-icons">logout</span>
                      <span>ログアウト</span>
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {!loading && !user ? (
            <button
              className={styles.loginButton}
              onClick={() => {
                window.location.href = '/api/auth/discord';
              }}
              type="button"
              aria-label="Discordでログイン"
              title="Discordでログイン"
            >
              <span className="material-icons">login</span>
              <span>Discordでログイン</span>
            </button>
          ) : null}

          <button
            className={styles.mobileToggle}
            onClick={() => setShowMobileNav((previous) => !previous)}
            type="button"
            aria-label="メニューを切り替え"
            aria-expanded={showMobileNav}
          >
            <span className="material-icons">{showMobileNav ? 'close' : 'menu'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
