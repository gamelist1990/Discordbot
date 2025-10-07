import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './AppHeader.module.css';

interface UserInfo {
    userId: string;
    username: string;
    avatar?: string | null;
}

interface AppHeaderProps {
    user?: UserInfo | null;
    onLogout?: () => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({ user, onLogout }) => {
    const navigate = useNavigate();
    const [showUserMenu, setShowUserMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowUserMenu(false);
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
                    <button className={styles.navBtn} onClick={() => navigate('/')}>
                        <span className="material-icons">dashboard</span>
                        <span>ダッシュボード</span>
                    </button>
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
                        </>
                    )}
                </nav>

                <div className={styles.right}>
                    {user ? (
                        <div className={styles.userSection} ref={menuRef}>
                            <button 
                                className={styles.userButton}
                                onClick={() => setShowUserMenu(!showUserMenu)}
                            >
                                <img
                                    src={
                                        user.avatar
                                            ? `https://cdn.discordapp.com/avatars/${user.userId}/${user.avatar}.png`
                                            : `https://cdn.discordapp.com/embed/avatars/0.png`
                                    }
                                    alt="Avatar"
                                    className={styles.avatar}
                                    onError={(e) => { e.currentTarget.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                                />
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
