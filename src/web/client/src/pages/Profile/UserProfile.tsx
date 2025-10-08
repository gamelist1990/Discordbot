import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppHeader from '../../components/Common/AppHeader';
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
    const [activeTab, setActiveTab] = useState<'overview' | 'servers' | 'activity' | 'settings'>('overview');
    const [sidebarOpen, setSidebarOpen] = useState(true);

    const [] = useSearchParams();

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

                // For each guild, try to fetch authoritative mod stats and merge
                try {
                    // Normalize guilds to an array in case server returns unexpected type
                    const guilds = Array.isArray(data.guilds) ? data.guilds : [];
                    const updatedGuilds = await Promise.all(guilds.map(async (g: GuildStats) => {
                        try {
                            const r = await fetch(`/api/guilds/${g.id}/modinfo`, { credentials: 'include' });
                            if (!r.ok) return g;
                            const mod = await r.json();
                            // if mod returns aggregates, use them
                            if (mod && mod.guildAggregates) {
                                return {
                                    ...g,
                                    totalMessages: mod.guildAggregates.totalMessages || g.totalMessages,
                                    linkMessages: mod.guildAggregates.totalLinks || g.linkMessages,
                                    mediaMessages: mod.guildAggregates.totalMedia || g.mediaMessages,
                                    memberCount: mod.memberCount || g.memberCount,
                                } as GuildStats;
                            }
                            return g;
                        } catch (e) {
                            return g;
                        }
                    }));

                    // compute totals from updatedGuilds
                    const totals = (Array.isArray(updatedGuilds) ? updatedGuilds : []).reduce((acc, cur) => {
                        acc.totalMessages += (cur && cur.totalMessages) ? cur.totalMessages : 0;
                        acc.totalLinks += (cur && cur.linkMessages) ? cur.linkMessages : 0;
                        acc.totalMedia += (cur && cur.mediaMessages) ? cur.mediaMessages : 0;
                        return acc;
                    }, { totalMessages: 0, totalLinks: 0, totalMedia: 0 });

                    setProfileData({ ...data, guilds: updatedGuilds, totalStats: { ...data.totalStats, totalMessages: totals.totalMessages, totalLinks: totals.totalLinks, totalMedia: totals.totalMedia } });
                } catch (e) {
                    // ignore per-guild merge failures
                }
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

    const handleLogout = async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
            // リロードしてセッションを反映
            window.location.reload();
        } catch (e) {
            console.error('Logout failed', e);
        }
    };


    if (loading) {
        return (
            <div>
                <AppHeader user={profileData ? { userId: profileData.id, username: profileData.username, avatar: profileData.avatar } : null} />
                <div className={styles.loading}>
                    <div className={styles.loadingSpinner}></div>
                    <p>プロフィールを読み込み中...</p>
                </div>
            </div>
        );
    }

    if (!profileData) {
        return (
            <div>
                <AppHeader user={null} />
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
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <AppHeader user={{ userId: profileData.id, username: profileData.username, avatar: profileData.avatar }} />
            
            <div className={styles.mainLayout}>
                {/* Sidebar */}
                <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : styles.sidebarClosed}`}>
                    <div className={styles.sidebarHeader}>
                        <h2 className={styles.sidebarTitle}>プロフィール</h2>
                        <button 
                            className={styles.sidebarToggle}
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                            aria-label="サイドバーを切り替え"
                        >
                            <span className="material-icons">
                                {sidebarOpen ? 'menu_open' : 'menu'}
                            </span>
                        </button>
                    </div>
                    
                    <nav className={styles.sidebarNav}>
                        <button
                            className={`${styles.sidebarItem} ${activeTab === 'overview' ? styles.sidebarItemActive : ''}`}
                            onClick={() => setActiveTab('overview')}
                        >
                            <span className="material-icons">dashboard</span>
                            {sidebarOpen && <span>概要</span>}
                        </button>
                        <button
                            className={`${styles.sidebarItem} ${activeTab === 'servers' ? styles.sidebarItemActive : ''}`}
                            onClick={() => setActiveTab('servers')}
                        >
                            <span className="material-icons">dns</span>
                            {sidebarOpen && <span>サーバー</span>}
                        </button>
                        <button
                            className={`${styles.sidebarItem} ${activeTab === 'activity' ? styles.sidebarItemActive : ''}`}
                            onClick={() => setActiveTab('activity')}
                        >
                            <span className="material-icons">timeline</span>
                            {sidebarOpen && <span>アクティビティ</span>}
                        </button>
                        <button
                            className={`${styles.sidebarItem} ${activeTab === 'settings' ? styles.sidebarItemActive : ''}`}
                            onClick={() => setActiveTab('settings')}
                        >
                            <span className="material-icons">settings</span>
                            {sidebarOpen && <span>設定</span>}
                        </button>
                    </nav>
                    
                    <div className={styles.sidebarFooter}>
                        <button className={styles.logoutBtn} onClick={handleLogout}>
                            <span className="material-icons">logout</span>
                            {sidebarOpen && <span>ログアウト</span>}
                        </button>
                    </div>
                </aside>

                {/* Main Content */}
                <main className={styles.content}>
                    {/* User Header */}
                    <div className={styles.profileCard}>
                        <div className={styles.profileCardHeader}>
                            <div className={styles.avatarWrapper}>
                                {(() => {
                                    const avatar = profileData.avatar;
                                    let src = `https://cdn.discordapp.com/embed/avatars/${parseInt(profileData.discriminator) % 5}.png`;
                                    if (avatar) {
                                        if (/^https?:\/\//.test(avatar)) {
                                            src = avatar;
                                        } else {
                                            const isAnimated = avatar.startsWith('a_');
                                            const ext = isAnimated ? 'gif' : 'png';
                                            src = `https://cdn.discordapp.com/avatars/${profileData.id}/${avatar}.${ext}?size=256`;
                                        }
                                    }
                                    return (
                                        <img
                                            src={src}
                                            alt={`${profileData.username}のプロフィール画像`}
                                            className={styles.profileAvatar}
                                        />
                                    );
                                })()}
                            </div>
                            <div className={styles.profileInfo}>
                                <h1 className={styles.profileName}>
                                    {profileData.username}
                                    <span className={styles.profileDiscriminator}>#{profileData.discriminator}</span>
                                </h1>
                                <p className={styles.profileId}>ID: {profileData.id}</p>
                                <div className={styles.profileStats}>
                                    <span className={styles.profileStat}>
                                        <span className="material-icons">message</span>
                                        {profileData.totalStats.totalMessages?.toLocaleString() || 0} メッセージ
                                    </span>
                                    <span className={styles.profileStat}>
                                        <span className="material-icons">dns</span>
                                        {profileData.guilds.length} サーバー
                                    </span>
                                </div>
                            </div>
                        </div>
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
                                        {(profileData.totalStats.totalMessages || 0).toLocaleString()}
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
                                        {(profileData.totalStats.totalLinks || 0).toLocaleString()}
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
                                        {(profileData.totalStats.totalMedia || 0).toLocaleString()}
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
                                        {(profileData.totalStats.totalServers || 0).toLocaleString()}
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
                                            <span>{(guild.totalMessages || 0).toLocaleString()}</span>
                                            <label>メッセージ</label>
                                        </div>
                                        <div className={styles.guildStat}>
                                            <span className="material-icons-outlined">link</span>
                                            <span>{(guild.linkMessages || 0).toLocaleString()}</span>
                                            <label>リンク</label>
                                        </div>
                                        <div className={styles.guildStat}>
                                            <span className="material-icons-outlined">image</span>
                                            <span>{(guild.mediaMessages || 0).toLocaleString()}</span>
                                            <label>メディア</label>
                                        </div>
                                    </div>

                                    {guild.role && (
                                        <div className={styles.guildRole}>
                                            ロール: {guild.role}
                                        </div>
                                    )}

                                    {/* display full roles array if present (some servers provide `roles` array) */}
                                    {(guild as any).roles && (guild as any).roles.length > 0 && (
                                        <div className={styles.guildRolesList}>
                                            <strong>所有ロール:</strong>
                                            <ul>
                                                {((guild as any).roles as string[]).map(r => (
                                                    <li key={r}>{r}</li>
                                                ))}
                                            </ul>
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

                {activeTab === 'activity' && (
                    <div className={styles.activity}>
                        <h2 className={styles.sectionTitle}>アクティビティ</h2>
                        <div className={styles.activityContent}>
                            <div className={styles.infoCard}>
                                <span className="material-icons">info</span>
                                <p>アクティビティ情報は今後のアップデートで追加されます。</p>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'settings' && (
                    <div className={styles.settings}>
                        <h2 className={styles.sectionTitle}>設定</h2>
                        <div className={styles.settingsContent}>
                            <div className={styles.infoCard}>
                                <span className="material-icons">settings</span>
                                <p>プロフィール設定は今後のアップデートで追加されます。</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
                </main>
            </div>
        </div>
    );
};

export default UserProfile;