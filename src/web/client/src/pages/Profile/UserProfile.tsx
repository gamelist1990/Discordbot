import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import styles from './UserProfile.module.css';

interface GuildStats {
    id: string;
    name: string;
    icon?: string;
    totalMessages: number;
    linkMessages: number;
    mediaMessages: number;
    memberCount?: number;
    joinedAt?: string;
    role?: string;
}

interface UserProfile {
    id: string;
    username: string;
    discriminator: string;
    avatar?: string;
    banner?: string;
    guilds: GuildStats[];
    totalStats: {
        totalMessages: number;
        totalLinks: number;
        totalMedia: number;
        totalServers: number;
    };
}

interface UserProfileProps {
    user?: UserProfile;
    onLoginClick?: () => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ user, onLoginClick }) => {
    const [loading, setLoading] = useState(true);
    const [profileData, setProfileData] = useState<UserProfile | null>(user || null);
    const [activeTab, setActiveTab] = useState<'overview' | 'servers'>('overview');

    const [searchParams] = useSearchParams();
    const guildId = searchParams.get('guildId') || '';

    useEffect(() => {
        if (!user) {
            checkAuthentication();
        } else {
            setProfileData(user);
            setLoading(false);
        }
    }, [user]);

    const checkAuthentication = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/auth/session', { credentials: 'include' });

            if (response.ok) {
                // 認証済みの場合、プロフィール情報を取得
                loadUserProfile();
            } else {
                // 未認証の場合
                setLoading(false);
            }
        } catch (error) {
            console.error('Authentication check failed:', error);
            setLoading(false);
        }
    };

    const loadUserProfile = async () => {
        try {
            const response = await fetch('/api/user/profile', { credentials: 'include' });

            if (response.ok) {
                const data = await response.json();
                setProfileData(data);
            }
        } catch (error) {
            console.error('Failed to load user profile:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleLoginClick = () => {
        // Discord OAuth URLにリダイレクト
        const oauthUrl = `/api/auth/discord`;
        window.location.href = oauthUrl;
    };

    if (loading) {
        return (
            <div className={styles.loading}>
                <div className={styles.loadingSpinner}></div>
                <p>プロフィールを読み込み中...</p>
            </div>
        );
    }

    if (!profileData) {
        return (
            <div className={styles.error}>
                <h2>ログインが必要です</h2>
                <p>Discord でログインして、あなたのプロフィールを表示しましょう。</p>
                {onLoginClick ? (
                    <button onClick={onLoginClick} className={styles.loginButton}>
                        Discord でログイン
                    </button>
                ) : (
                    <button onClick={handleLoginClick} className={styles.loginButton}>
                        Discord でログイン
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* User Header */}
            <div className={styles.profileHeader}>
                <div className={styles.avatarContainer}>
                    <img
                        src={profileData.avatar || `https://cdn.discordapp.com/embed/avatars/${parseInt(profileData.discriminator) % 5}.png`}
                        alt={`${profileData.username}のプロフィール画像`}
                        className={styles.avatar}
                    />
                </div>
                <div className={styles.userInfo}>
                    <h1 className={styles.username}>
                        {profileData.username}
                        <span className={styles.discriminator}>#{profileData.discriminator}</span>
                    </h1>
                    <p className={styles.userId}>ユーザーID: {profileData.id}</p>
                </div>
                {profileData.banner && (
                    <div className={styles.bannerContainer}>
                        <img src={profileData.banner} alt="バナー画像" className={styles.banner} />
                    </div>
                )}
            </div>

            {/* Navigation Tabs */}
            <div className={styles.tabs}>
                <button
                    className={`${styles.tab} ${activeTab === 'overview' ? styles.active : ''}`}
                    onClick={() => setActiveTab('overview')}
                >
                    <span className="material-icons-outlined">analytics</span>
                    概要
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'servers' ? styles.active : ''}`}
                    onClick={() => setActiveTab('servers')}
                >
                    <span className="material-icons-outlined">groups</span>
                    参加中のサーバー ({profileData.guilds.length})
                </button>
            </div>

            {/* Tab Content */}
            <div className={styles.tabContent}>
                {activeTab === 'overview' && (
                    <div className={styles.overview}>
                        <h2 className={styles.sectionTitle}>活動統計</h2>
                        <div className={styles.statsGrid}>
                            <div className={styles.statCard}>
                                <div className={styles.statIcon}>
                                    <span className="material-icons-outlined">message</span>
                                </div>
                                <div className={styles.statContent}>
                                    <h3>総メッセージ数</h3>
                                    <p className={styles.statValue}>
                                        {profileData.totalStats.totalMessages.toLocaleString()}
                                    </p>
                                </div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statIcon}>
                                    <span className="material-icons-outlined">link</span>
                                </div>
                                <div className={styles.statContent}>
                                    <h3>リンク送信数</h3>
                                    <p className={styles.statValue}>
                                        {profileData.totalStats.totalLinks.toLocaleString()}
                                    </p>
                                </div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statIcon}>
                                    <span className="material-icons-outlined">image</span>
                                </div>
                                <div className={styles.statContent}>
                                    <h3>メディア送信数</h3>
                                    <p className={styles.statValue}>
                                        {profileData.totalStats.totalMedia.toLocaleString()}
                                    </p>
                                </div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statIcon}>
                                    <span className="material-icons-outlined">groups</span>
                                </div>
                                <div className={styles.statContent}>
                                    <h3>参加サーバー数</h3>
                                    <p className={styles.statValue}>
                                        {profileData.totalStats.totalServers.toLocaleString()}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'servers' && (
                    <div className={styles.servers}>
                        <h2 className={styles.sectionTitle}>参加中のサーバー</h2>
                        <div className={styles.guildsGrid}>
                            {profileData.guilds.map(guild => (
                                <div key={guild.id} className={styles.guildCard}>
                                    <div className={styles.guildHeader}>
                                        <div className={styles.guildIcon}>
                                            {guild.icon ? (
                                                <img
                                                    src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`}
                                                    alt={`${guild.name}のアイコン`}
                                                />
                                            ) : (
                                                <div className={styles.defaultIcon}>
                                                    <span>{guild.name.charAt(0).toUpperCase()}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className={styles.guildInfo}>
                                            <h3>{guild.name}</h3>
                                            {guild.memberCount && (
                                                <p>{guild.memberCount.toLocaleString()} メンバー</p>
                                            )}
                                        </div>
                                    </div>

                                    <div className={styles.guildStats}>
                                        <div className={styles.guildStat}>
                                            <span className="material-icons-outlined">message</span>
                                            <span>{guild.totalMessages.toLocaleString()}</span>
                                            <label>メッセージ</label>
                                        </div>
                                        <div className={styles.guildStat}>
                                            <span className="material-icons-outlined">link</span>
                                            <span>{guild.linkMessages.toLocaleString()}</span>
                                            <label>リンク</label>
                                        </div>
                                        <div className={styles.guildStat}>
                                            <span className="material-icons-outlined">image</span>
                                            <span>{guild.mediaMessages.toLocaleString()}</span>
                                            <label>メディア</label>
                                        </div>
                                    </div>

                                    {guild.role && (
                                        <div className={styles.guildRole}>
                                            ロール: {guild.role}
                                        </div>
                                    )}

                                    {guild.joinedAt && (
                                        <div className={styles.guildJoined}>
                                            参加日: {new Date(guild.joinedAt).toLocaleDateString('ja-JP')}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default UserProfile;