import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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

const AppHeader: React.FC<AppHeaderProps> = ({ user: userProp, onLogout }) => {
    const navigate = useNavigate();
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [showAppMenu, setShowAppMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const appMenuRef = useRef<HTMLDivElement>(null);
    const [user, setUser] = useState<UserInfo | null | undefined>(userProp);
    const [loading, setLoading] = useState(userProp === undefined);

    useEffect(() => {
        // 親からuserが渡された場合はそれを優先
        if (userProp !== undefined) {
            setUser(userProp);
            setLoading(false);
            return;
        }
        // 自分でセッション取得
        const fetchSession = async () => {
            setLoading(true);
            try {
                const res = await fetch('/api/auth/session', { credentials: 'include' });
                if (res.ok) {
                    const data = await res.json();
                    setUser(data.user || null);
                } else {
                    setUser(null);
                }
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
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowUserMenu(false);
            }
            if (appMenuRef.current && !appMenuRef.current.contains(event.target as Node)) {
                setShowAppMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleLogout = async () => {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });
            if (onLogout) {
                onLogout();
            }
            window.location.href = '/';
        } catch (err) {
            console.error('Logout failed:', err);
        }
    };

    if (loading) {
        return (
            <header className={styles.header}>
                <div className={styles.container}>
                    <div className={styles.left}>
                        <button className={styles.logoBtn} onClick={() => navigate('/')}> 
                            <span className="material-icons">home</span>
                            <span className={styles.logoText}>Discord Bot</span>
                        </button>
                    </div>
                    <div className={styles.right}>
                        <span className={styles.loadingText}>ログイン状態を確認中...</span>
                    </div>
                </div>
            </header>
        );
    }

    return (
        <header className={styles.header}>
            <div className={styles.container}>
                <div className={styles.left}>
                    <button className={styles.logoBtn} onClick={() => navigate('/')}> 
                        <span className="material-icons">home</span>
                        <span className={styles.logoText}>Discord Bot</span>
                    </button>
                </div>

                <nav className={styles.nav}>
                    {/* Remove main Dashboard link per request; keep home logo as entrypoint */}
                    {user && (
                        <>
                            <button className={styles.navBtn} onClick={() => navigate('/profile')}>
                                <span className="material-icons">person</span>
                                <span>プロフィール</span>
                            </button>
                            <button className={styles.navBtn} onClick={() => navigate('/settings')}>
                                <span className="material-icons">settings</span>
                                <span>設定</span>
                            </button>
                            <button className={styles.navBtn} onClick={() => navigate('/feedback')}>
                                <span className="material-icons">feedback</span>
                                <span>フィードバック</span>
                            </button>
                            <button className={styles.navBtn} onClick={() => navigate('/rank')}>
                                <span className="material-icons">leaderboard</span>
                                <span>ランキング</span>
                            </button>
                        </>
                    )}
                </nav>

                <div className={styles.right}>
                    {user && (
                        <div className={styles.appMenuSection} ref={appMenuRef}>
                            <button 
                                className={styles.appMenuBtn}
                                onClick={() => setShowAppMenu(!showAppMenu)}
                                title="アプリ"
                            >
                                <span className="material-icons">apps</span>
                            </button>

                            {showAppMenu && (
                                <div className={styles.appMenu}>
                                    <div className={styles.appGrid}>
                                        <button 
                                            className={styles.appItem}
                                            onClick={() => {
                                                setShowAppMenu(false);
                                                // Remove dashboard quick-link, link to feedback instead
                                                navigate('/feedback');
                                            }}
                                        >
                                            <span className="material-icons">dashboard</span>
                                            <span>フィードバック</span>
                                        </button>
                                        <button 
                                            className={styles.appItem}
                                            onClick={() => {
                                                setShowAppMenu(false);
                                                navigate('/settings');
                                            }}
                                        >
                                            <span className="material-icons">settings</span>
                                            <span>設定</span>
                                        </button>
                                        <button 
                                            className={styles.appItem}
                                            onClick={() => {
                                                setShowAppMenu(false);
                                                navigate('/profile');
                                            }}
                                        >
                                            <span className="material-icons">person</span>
                                            <span>プロフィール</span>
                                        </button>
                                        <button 
                                            className={styles.appItem}
                                            onClick={() => {
                                                setShowAppMenu(false);
                                                navigate('/todo/default');
                                            }}
                                        >
                                            <span className="material-icons">checklist</span>
                                            <span>TODO</span>
                                        </button>

                                        <button 
                                            className={styles.appItem}
                                            onClick={() => {
                                                setShowAppMenu(false);
                                                navigate('/rank');
                                            }}
                                        >
                                            <span className="material-icons">leaderboard</span>
                                            <span>ランキング</span>
                                        </button>

                                        {/* スタッフ権限以上の場合のみ表示 */}
                                        {user && user.permissionLevel && user.permissionLevel >= 1 && (
                                            <button 
                                                className={styles.appItem}
                                                onClick={() => {
                                                    setShowAppMenu(false);
                                                    navigate('/staff');
                                                }}
                                            >
                                                <span className="material-icons">admin_panel_settings</span>
                                                <span>スタッフ</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {user ? (
                        <div className={styles.userSection} ref={menuRef}>
                            <button 
                                className={styles.userButton}
                                onClick={() => setShowUserMenu(!showUserMenu)}
                            >
                                {(() => {
                                    const avatar = user?.avatar;
                                    let src = 'https://cdn.discordapp.com/embed/avatars/0.png';
                                    if (avatar) {
                                        if (/^https?:\/\//.test(avatar)) {
                                            src = avatar;
                                        } else {
                                            const isAnimated = avatar.startsWith('a_');
                                            const ext = isAnimated ? 'gif' : 'png';
                                            src = `https://cdn.discordapp.com/avatars/${user.userId}/${avatar}.${ext}?size=128`;
                                        }
                                    }
                                    return (
                                        <img
                                            src={src}
                                            alt="Avatar"
                                            className={styles.avatar}
                                            onError={(e) => { e.currentTarget.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                                        />
                                    );
                                })()}
                                <div className={styles.userInfo}>
                                    <span className={styles.username}>{user.username}</span>
                                    <span className={styles.userId}>ID: {user.userId}</span>
                                </div>
                                <span className="material-icons">{showUserMenu ? 'expand_less' : 'expand_more'}</span>
                            </button>

                            {showUserMenu && (
                                <div className={styles.userMenu}>
                                    <button 
                                        className={styles.menuItem}
                                        onClick={() => {
                                            setShowUserMenu(false);
                                            navigate('/profile');
                                        }}
                                    >
                                        <span className="material-icons">person</span>
                                        <span>プロフィール</span>
                                    </button>
                                    <div className={styles.divider}></div>
                                    <button 
                                        className={styles.menuItem}
                                        onClick={handleLogout}
                                    >
                                        <span className="material-icons">logout</span>
                                        <span>ログアウト</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <button 
                            className={styles.loginBtn}
                            onClick={() => window.location.href = '/api/auth/discord'}
                        >
                            <span className="material-icons">login</span>
                            <span>ログイン</span>
                        </button>
                    )}
                </div>
            </div>
        </header>
    );
};

export default AppHeader;
