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

interface ActivityData {
    weeklyMessages: number;
    monthlyMessages: number;
    yearlyMessages: number;
    weeklyAverage: number;
    monthlyAverage: number;
    chatFrequency: 'very_high' | 'high' | 'moderate' | 'low' | 'very_low';
    mostActiveGuild?: {
        id: string;
        name: string;
        messages: number;
    };
    recentActivity: Array<{
        date: string;
        messages: number;
    }>;
    hasTimestampData?: boolean;
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
    const [activityData, setActivityData] = useState<ActivityData | null>(null);

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

    // アクティビティデータを計算
    const calculateActivityData = (profile: UserProfile): ActivityData => {
        const totalMessages = profile.totalStats.totalMessages || 0;
        const guilds = profile.guilds || [];

        // 週間・月間・年間の推定値（実際のデータがないため、総メッセージ数から推定）
        // 実装では、過去のメッセージタイムスタンプがあれば正確に計算可能
        const now = new Date();

        // 簡易的な推定（実際のタイムスタンプデータがある場合は正確に計算）
        // ここでは総メッセージ数から比例配分
        const estimatedYearlyMessages = totalMessages;
        const estimatedMonthlyMessages = Math.floor(totalMessages / 12);
        const estimatedWeeklyMessages = Math.floor(totalMessages / 52);

        // 1日あたりの平均
        const weeklyAverage = estimatedWeeklyMessages / 7;
        const monthlyAverage = estimatedMonthlyMessages / 30;

        // チャット頻度の判定
        let chatFrequency: 'very_high' | 'high' | 'moderate' | 'low' | 'very_low' = 'low';
        if (weeklyAverage >= 50) chatFrequency = 'very_high';
        else if (weeklyAverage >= 20) chatFrequency = 'high';
        else if (weeklyAverage >= 10) chatFrequency = 'moderate';
        else if (weeklyAverage >= 3) chatFrequency = 'low';
        else chatFrequency = 'very_low';

        // 最もアクティブなサーバーを見つける
        const mostActiveGuild = guilds.reduce((prev, current) => {
            return (current.totalMessages > (prev?.totalMessages || 0)) ? current : prev;
        }, guilds[0] || null);

        // 最近7日間のアクティビティ（模擬データ - 実装では実際のデータを使用）
        const recentActivity = Array.from({ length: 7 }, (_, i) => {
            const date = new Date(now.getTime() - (6 - i) * 24 * 60 * 60 * 1000);
            // ランダムな変動を追加してグラフを表示（実際のデータがある場合は置き換え）
            const dailyMessages = Math.floor(weeklyAverage * (0.7 + Math.random() * 0.6));
            return {
                date: date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }),
                messages: dailyMessages
            };
        });

        return {
            weeklyMessages: estimatedWeeklyMessages,
            monthlyMessages: estimatedMonthlyMessages,
            yearlyMessages: estimatedYearlyMessages,
            weeklyAverage,
            monthlyAverage,
            chatFrequency,
            mostActiveGuild: mostActiveGuild ? {
                id: mostActiveGuild.id,
                name: mostActiveGuild.name,
                messages: mostActiveGuild.totalMessages
            } : undefined,
            recentActivity
        };
    };

    useEffect(() => {
        if (profileData) {
            // Try to fetch real timestamp-based activity data from API
            fetchActivityData();
        }
    }, [profileData]);

    const fetchActivityData = async () => {
        try {
            const response = await fetch('/api/user/activity', { credentials: 'include' });
            if (response.ok) {
                const data = await response.json();
                
                // Find most active guild
                const guilds = profileData?.guilds || [];
                const mostActiveGuild = guilds.reduce((prev, current) => {
                    return (current.totalMessages > (prev?.totalMessages || 0)) ? current : prev;
                }, guilds[0] || null);

                setActivityData({
                    ...data,
                    mostActiveGuild: mostActiveGuild ? {
                        id: mostActiveGuild.id,
                        name: mostActiveGuild.name,
                        messages: mostActiveGuild.totalMessages
                    } : undefined
                });
            } else {
                // Fallback to calculation if API fails
                const activity = calculateActivityData(profileData!);
                setActivityData(activity);
            }
        } catch (error) {
            console.error('Failed to fetch activity data:', error);
            // Fallback to calculation
            const activity = calculateActivityData(profileData!);
            setActivityData(activity);
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
                        {activityData ? (
                            <div className={styles.activityContent}>
                                {/* チャット頻度サマリー */}
                                <div className={styles.frequencyCard}>
                                    <div className={styles.frequencyHeader}>
                                        <span className="material-icons">timeline</span>
                                        <h3>チャット頻度</h3>
                                    </div>
                                    <div className={styles.frequencyBadge} data-frequency={activityData.chatFrequency}>
                                        {activityData.chatFrequency === 'very_high' && '🔥 非常に高い'}
                                        {activityData.chatFrequency === 'high' && '⚡ 高い'}
                                        {activityData.chatFrequency === 'moderate' && '📊 普通'}
                                        {activityData.chatFrequency === 'low' && '📉 低い'}
                                        {activityData.chatFrequency === 'very_low' && '💤 とても低い'}
                                    </div>
                                    <p className={styles.frequencyDesc}>
                                        1日平均 <strong>{activityData.weeklyAverage.toFixed(1)}</strong> メッセージ
                                        {activityData.hasTimestampData && (
                                            <span className={styles.timestampBadge} title="実際のメッセージタイムスタンプに基づいた正確なデータ">
                                                ✓ リアルタイムデータ
                                            </span>
                                        )}
                                    </p>
                                </div>

                                {/* 集計データ */}
                                <div className={styles.periodStats}>
                                    <div className={styles.periodCard}>
                                        <div className={styles.periodIcon}>
                                            <span className="material-icons">calendar_view_week</span>
                                        </div>
                                        <div className={styles.periodData}>
                                            <h4>週間</h4>
                                            <p className={styles.periodValue}>{activityData.weeklyMessages.toLocaleString()}</p>
                                            <span className={styles.periodLabel}>メッセージ</span>
                                        </div>
                                    </div>

                                    <div className={styles.periodCard}>
                                        <div className={styles.periodIcon}>
                                            <span className="material-icons">calendar_month</span>
                                        </div>
                                        <div className={styles.periodData}>
                                            <h4>月間</h4>
                                            <p className={styles.periodValue}>{activityData.monthlyMessages.toLocaleString()}</p>
                                            <span className={styles.periodLabel}>メッセージ</span>
                                        </div>
                                    </div>

                                    <div className={styles.periodCard}>
                                        <div className={styles.periodIcon}>
                                            <span className="material-icons">event</span>
                                        </div>
                                        <div className={styles.periodData}>
                                            <h4>年間</h4>
                                            <p className={styles.periodValue}>{activityData.yearlyMessages.toLocaleString()}</p>
                                            <span className={styles.periodLabel}>メッセージ</span>
                                        </div>
                                    </div>
                                </div>

                                {/* 最近のアクティビティグラフ */}
                                <div className={styles.activityChart}>
                                    <h3>最近7日間のアクティビティ</h3>
                                    <div className={styles.chartBars}>
                                        {activityData.recentActivity.map((day, index) => {
                                            const maxMessages = Math.max(...activityData.recentActivity.map(d => d.messages), 1);
                                            const height = (day.messages / maxMessages) * 100;
                                            return (
                                                <div key={index} className={styles.chartBar}>
                                                    <div 
                                                        className={styles.bar} 
                                                        style={{ height: `${height}%` }}
                                                        title={`${day.messages} メッセージ`}
                                                    >
                                                        <span className={styles.barValue}>{day.messages}</span>
                                                    </div>
                                                    <span className={styles.barLabel}>{day.date}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* 最もアクティブなサーバー */}
                                {activityData.mostActiveGuild && (
                                    <div className={styles.mostActiveServer}>
                                        <h3>最もアクティブなサーバー</h3>
                                        <div className={styles.activeServerCard}>
                                            <span className="material-icons">emoji_events</span>
                                            <div className={styles.serverInfo}>
                                                <h4>{activityData.mostActiveGuild.name}</h4>
                                                <p>{activityData.mostActiveGuild.messages.toLocaleString()} メッセージ</p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* 平均メッセージ数 */}
                                <div className={styles.averageStats}>
                                    <div className={styles.avgCard}>
                                        <span className="material-icons">today</span>
                                        <div>
                                            <h4>1日平均（週間）</h4>
                                            <p>{activityData.weeklyAverage.toFixed(1)} メッセージ</p>
                                        </div>
                                    </div>
                                    <div className={styles.avgCard}>
                                        <span className="material-icons">calendar_today</span>
                                        <div>
                                            <h4>1日平均（月間）</h4>
                                            <p>{activityData.monthlyAverage.toFixed(1)} メッセージ</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className={styles.activityLoading}>
                                <div className={styles.loadingSpinner}></div>
                                <p>アクティビティデータを計算中...</p>
                            </div>
                        )}
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