import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './UserProfile.module.css';

interface GuildStats {
    id: string;
    name: string;
    icon?: string;
    iconURL?: string | null;
    totalMessages: number;
    linkMessages: number;
    mediaMessages: number;
    memberCount?: number;
    joinedAt?: string;
    role?: string;
    viewerIsMember?: boolean;
}

interface FavoriteEmoji {
    emoji: string;
    label: string;
}

interface Profile {
    id: string;
    username: string;
    discriminator: string;
    avatar?: string;
    totalStats: {
        totalMessages: number;
        totalLinks: number;
        totalMedia: number;
        totalServers: number;
    };
    guilds: GuildStats[];
    customProfile?: {
        displayName?: string;
        pronouns?: string;
        bio?: string;
        location?: {
            label: string;
            emoji?: string;
            url?: string;
        };
        website?: string;
        favoriteEmojis?: FavoriteEmoji[];
        favoriteImage?: string;
        banner?: {
            type: 'color' | 'gradient' | 'image';
            value: string;
            gradient?: {
                colors: string[];
                direction: string;
            };
        };
    };
}

const UserProfile: React.FC = () => {
    const { userId: urlUserId } = useParams<{ userId: string }>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [profileData, setProfileData] = useState<Profile | null>(null);
    const [activeTab, setActiveTab] = useState<'posts' | 'servers' | 'ranking'>('posts');
    const [isOwnProfile, setIsOwnProfile] = useState(true);
    const [sessionUser, setSessionUser] = useState<{ userId?: string; username?: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [guildTops, setGuildTops] = useState<Array<{ guild: GuildStats; userEntry: any; }>>([]);

    useEffect(() => {
        checkAuthentication();
    }, [urlUserId]);

    useEffect(() => {
        if (activeTab === 'ranking' && profileData) fetchGuildTopRankings();
    }, [activeTab, profileData]);

    const fetchGuildTopRankings = async () => {
        try {
            const tops: any[] = [];
            for (const g of profileData!.guilds) {
                // Skip guilds where the viewer is not a member unless this is the user's own profile
                if (!isOwnProfile && !g.viewerIsMember) continue;
                try {
                    // Get guild rankings to get presets
                    const guildResp = await fetch(`/api/rank/guild/${g.id}`, { credentials: 'include' });
                    if (!guildResp.ok) continue;
                    const guildData = await guildResp.json();
                    if (!guildData.presets || guildData.presets.length === 0) continue;

                    let bestEntry: any = null;

                    // Check each preset
                    for (const preset of guildData.presets) {
                        try {
                            const resp = await fetch(`/api/rank/leaderboard/${g.id}?preset=${preset.name}&limit=1000`, { credentials: 'include' });
                            if (!resp.ok) continue;
                            const rd = await resp.json();
                            if (rd && rd.leaderboard && rd.leaderboard.length > 0) {
                                const userEntry = rd.leaderboard.find((entry: any) => entry.userId === profileData!.id);
                                if (userEntry) {
                                    const rank = rd.leaderboard.findIndex((entry: any) => entry.userId === profileData!.id) + 1;
                                    if (!bestEntry || userEntry.xp > bestEntry.xp) {
                                        bestEntry = { ...userEntry, rank, preset: preset.name };
                                    }
                                }
                            }
                        } catch (e) {
                            // ignore per-preset errors
                        }
                    }

                    if (bestEntry) {
                        tops.push({ guild: guildData.guild || g, userEntry: bestEntry });
                    }
                } catch (e) {
                    // ignore per-guild errors
                }
            }
            // sort by userEntry.xp descending
            tops.sort((a, b) => (b.userEntry.xp || 0) - (a.userEntry.xp || 0));
            setGuildTops(tops);
        } catch (e) {
            console.error('Failed to fetch guild top rankings', e);
        }
    };

    const checkAuthentication = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch('/api/auth/session', { credentials: 'include' });

            if (response.ok) {
                const sessionData = await response.json();

                // session endpoint may return { authenticated: true, user: {...} } or a flat user object
                const userObj = sessionData.user || sessionData;

                // save session user for later resolution
                setSessionUser({ userId: userObj.userId, username: userObj.username });

                // If no specific urlUserId was requested, redirect to a canonical username-based path.
                if (!urlUserId) {
                    const rawName = (userObj && (userObj.username || userObj.userId)) || '';
                    const slug = String(rawName).replace(/^@/, '').split('#')[0];
                    if (slug) {
                        navigate(`/profile/${encodeURIComponent(slug)}`, { replace: true });
                        return; // navigation will re-run effect with new param
                    }
                }

                // mark whether viewing own profile; support both shapes (numeric id or username slug)
                const currentUserId = (userObj && userObj.userId) || null;
                const currentUsername = (userObj && userObj.username) || '';
                let own = false;
                if (!urlUserId) {
                    own = true;
                } else if (currentUserId && currentUserId === urlUserId) {
                    own = true;
                } else if (currentUsername) {
                    const sessionSlug = String(currentUsername).replace(/^@/, '').split('#')[0];
                    const urlSlug = String(urlUserId).replace(/^@/, '').split('#')[0];
                    if (sessionSlug.toLowerCase() === urlSlug.toLowerCase()) own = true;
                }
                setIsOwnProfile(own);
                loadUserProfile();
            } else {
                setLoading(false);
            }
        } catch (error) {
            console.error('Authentication check failed:', error);
            setLoading(false);
        }
    };

    const loadUserProfile = async () => {
        try {
            // If the url param is a slug that matches the current session username, use numeric userId
            let queryParam = '';
            if (urlUserId) {
                const slug = String(urlUserId).replace(/^@/, '').split('#')[0];
                if (sessionUser && sessionUser.username) {
                    const sessionSlug = String(sessionUser.username).replace(/^@/, '').split('#')[0];
                    if (sessionSlug.toLowerCase() === slug.toLowerCase() && sessionUser.userId) {
                        queryParam = `?userId=${sessionUser.userId}`;
                    } else {
                        queryParam = `?userId=${slug}`;
                    }
                } else {
                    queryParam = `?userId=${slug}`;
                }
            }

            const response = await fetch(`/api/user/profile${queryParam}`, { credentials: 'include' });

            if (response.ok) {
                const data = await response.json();
                setProfileData(data);
            } else if (response.status === 403) {
                setError('このプロフィールは非公開です');
            } else if (response.status === 404) {
                setError('ユーザーが見つかりません');
            } else {
                setError('プロフィールの読み込みに失敗しました');
            }
        } catch (error) {
            console.error('Failed to load user profile:', error);
            setError('プロフィールの読み込みに失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const handleLoginClick = () => {
        window.location.href = '/api/auth/discord';
    };

    const handleEditProfile = () => {
        navigate('/settings/profile');
    };

    const getBannerStyle = () => {
        const banner = profileData?.customProfile?.banner;
        if (!banner) return { background: '#CFD9DE' };

        if (banner.type === 'color') {
            return { background: banner.value };
        } else if (banner.type === 'gradient' && banner.gradient) {
            const { colors, direction } = banner.gradient;
            const dir = direction === 'horizontal' ? 'to right' :
                       direction === 'vertical' ? 'to bottom' : 'to bottom right';
            return { background: `linear-gradient(${dir}, ${colors.join(', ')})` };
        } else if (banner.type === 'image') {
            return { backgroundImage: `url(${banner.value})`, backgroundSize: 'cover', backgroundPosition: 'center' };
        }
        return { background: '#CFD9DE' };
    };

    const getAvatarUrl = () => {
        if (!profileData) return '';
        const avatar = profileData.avatar;
        if (!avatar) return `https://cdn.discordapp.com/embed/avatars/${parseInt(profileData.discriminator) % 5}.png`;
        if (/^https?:\/\//.test(avatar)) return avatar;
        const isAnimated = avatar.startsWith('a_');
        const ext = isAnimated ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${profileData.id}/${avatar}.${ext}?size=256`;
    };

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingState}>
                    <div className={styles.spinner}></div>
                    <p>読み込み中...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.container}>
                <div className={styles.errorState}>
                    <span className="material-icons" style={{ fontSize: 48 }}>error_outline</span>
                    <h2>{error}</h2>
                    <button onClick={() => navigate('/profile')} className={styles.button}>
                        自分のプロフィールに戻る
                    </button>
                </div>
            </div>
        );
    }

    if (!profileData) {
        return (
            <div className={styles.container}>
                <div className={styles.errorState}>
                    <span className="material-icons" style={{ fontSize: 48 }}>account_circle</span>
                    <h2>ログインが必要です</h2>
                    <p>Discordでログインして、プロフィールを表示しましょう。</p>
                    <button onClick={handleLoginClick} className={styles.button}>
                        Discordでログイン
                    </button>
                </div>
            </div>
        );
    }

    return (
        <motion.div 
            className={styles.container}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
        >
            {/* Header Banner */}
            <div className={styles.banner} style={getBannerStyle()} />

            {/* Profile Header */}
            <div className={styles.profileHeader}>
                <div className={styles.profileHeaderContent}>
                    <div className={styles.avatarContainer}>
                        <img src={getAvatarUrl()} alt={profileData.username} className={styles.avatar} />
                    </div>
                    
                    {isOwnProfile && (
                        <button onClick={handleEditProfile} className={styles.editButton}>
                            プロフィールを編集
                        </button>
                    )}
                </div>

                <div className={styles.profileInfo}>
                    <h1 className={styles.displayName}>
                        {profileData.customProfile?.displayName || profileData.username}
                    </h1>
                    <p className={styles.username}>@{profileData.username}#{profileData.discriminator}</p>
                    
                    {profileData.customProfile?.pronouns && (
                        <p className={styles.pronouns}>{profileData.customProfile.pronouns}</p>
                    )}
                    
                    {profileData.customProfile?.bio && (
                        <p className={styles.bio}>{profileData.customProfile.bio}</p>
                    )}
                    
                    <div className={styles.metadata}>
                        {profileData.customProfile?.location && (
                            (() => {
                                const loc = profileData.customProfile!.location as any;
                                const label = loc.label || '';
                                const emoji = loc.emoji || '';
                                if (loc.url) {
                                    return (
                                        <a className={styles.metaItem} href={loc.url} target="_blank" rel="noopener noreferrer">
                                            <span className="material-icons">place</span>
                                            <span style={{marginLeft:6}}>{emoji} {label}</span>
                                        </a>
                                    );
                                }
                                return (
                                    <span className={styles.metaItem}>
                                        <span className="material-icons">place</span>
                                        <span style={{marginLeft:6}}>{emoji} {label}</span>
                                    </span>
                                );
                            })()
                        )}
                        {profileData.customProfile?.website && (
                            <a href={profileData.customProfile.website} target="_blank" rel="noopener noreferrer" className={styles.metaItem}>
                                <span className="material-icons">link</span>
                                {new URL(profileData.customProfile.website).hostname}
                            </a>
                        )}
                    </div>

                    {profileData.customProfile?.favoriteEmojis && profileData.customProfile.favoriteEmojis.length > 0 && (
                        <div className={styles.emojis}>
                            {profileData.customProfile.favoriteEmojis.map((item, i) => (
                                <span key={i} className={styles.emoji} title={item.label}>
                                    {item.emoji}
                                </span>
                            ))}
                        </div>
                    )}

                    <div className={styles.stats}>
                        <div className={styles.stat}>
                            <strong>{profileData.totalStats.totalMessages.toLocaleString()}</strong>
                            <span>メッセージ</span>
                        </div>
                        <div className={styles.stat}>
                            <strong>{profileData.guilds.length}</strong>
                            <span>サーバー</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className={styles.tabs}>
                <button
                    className={`${styles.tab} ${activeTab === 'posts' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('posts')}
                >
                    <span className="material-icons">dashboard</span>
                    <span>概要</span>
                    {activeTab === 'posts' && (
                        <motion.div 
                            className={styles.tabIndicator} 
                            layoutId="activeTab"
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        />
                    )}
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'servers' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('servers')}
                >
                    <span className="material-icons">dns</span>
                    <span>サーバー</span>
                    {activeTab === 'servers' && (
                        <motion.div 
                            className={styles.tabIndicator} 
                            layoutId="activeTab"
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        />
                    )}
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'ranking' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('ranking')}
                >
                    <span className="material-icons">emoji_events</span>
                    <span>ランキング</span>
                    {activeTab === 'ranking' && (
                        <motion.div 
                            className={styles.tabIndicator} 
                            layoutId="activeTab"
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        />
                    )}
                </button>
            </div>

            {/* Tab Content */}
            <div className={styles.content}>
                <AnimatePresence mode="wait">
                    {activeTab === 'posts' && (
                        <motion.div 
                            key="posts"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                            className={styles.overview}
                        >
                            {/* Two-column layout: left preview canvas, right overview stats */}
                            <div className={styles.overviewGrid}>
                                <div className={styles.previewColumn}>
                                    {/* Favorite Image Display */}
                                    {profileData.customProfile?.favoriteImage ? (
                                        <motion.div 
                                            className={styles.favoriteImageWrapper}
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            transition={{ duration: 0.5 }}
                                        >
                                            <img 
                                                src={profileData.customProfile.favoriteImage} 
                                                alt="Favorite" 
                                                className={styles.favoriteImage} 
                                            />
                                        </motion.div>
                                    ) : (
                                        <div className={styles.emptyState}>
                                            <span className="material-icons" style={{fontSize: 48, marginBottom: 16, opacity: 0.5}}>image</span>
                                            <p>お気に入りの画像が設定されていません</p>
                                        </div>
                                    )}
                                </div>

                                <aside className={styles.sideColumn}>
                                    <div className={styles.statsGrid}>
                                        <motion.div whileHover={{ scale: 1.02 }} className={styles.statCard}>
                                            <span className="material-icons">message</span>
                                            <div>
                                                <strong>{profileData.totalStats.totalMessages.toLocaleString()}</strong>
                                                <p>総メッセージ数</p>
                                            </div>
                                        </motion.div>
                                        <motion.div whileHover={{ scale: 1.02 }} className={styles.statCard}>
                                            <span className="material-icons">link</span>
                                            <div>
                                                <strong>{profileData.totalStats.totalLinks.toLocaleString()}</strong>
                                                <p>リンク送信</p>
                                            </div>
                                        </motion.div>
                                        <motion.div whileHover={{ scale: 1.02 }} className={styles.statCard}>
                                            <span className="material-icons">image</span>
                                            <div>
                                                <strong>{profileData.totalStats.totalMedia.toLocaleString()}</strong>
                                                <p>メディア送信</p>
                                            </div>
                                        </motion.div>
                                        <motion.div whileHover={{ scale: 1.02 }} className={styles.statCard}>
                                            <span className="material-icons">groups</span>
                                            <div>
                                                <strong>{profileData.totalStats.totalServers}</strong>
                                                <p>参加サーバー</p>
                                            </div>
                                        </motion.div>
                                    </div>
                                </aside>
                            </div>
                        </motion.div>
                    )}

                    {activeTab === 'servers' && (
                        <motion.div 
                            key="servers"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                            className={styles.servers}
                        >
                            {profileData.guilds.map(guild => (
                                <motion.div 
                                    key={guild.id} 
                                    className={styles.serverCard}
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                >
                                    <div className={styles.serverIcon}>
                                        {guild.iconURL ? (
                                            <img src={guild.iconURL} alt={guild.name} />
                                        ) : (
                                            <div className={styles.serverIconPlaceholder}>
                                                {guild.name.charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                    </div>
                                    <div className={styles.serverInfo}>
                                        <h3>{guild.name}</h3>
                                        {guild.memberCount && <p>{guild.memberCount.toLocaleString()} メンバー</p>}
                                        <div className={styles.serverStats}>
                                            <span>{guild.totalMessages.toLocaleString()} メッセージ</span>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </motion.div>
                    )}

                    {activeTab === 'ranking' && (
                        <motion.div 
                            key="ranking"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                            className={styles.ranking}
                        >
                            {guildTops.length === 0 ? (
                                <p className={styles.comingSoon}>ランキング情報を取得中...</p>
                            ) : (
                                <div className={styles.rankingList}>
                                    {guildTops.map((g, i) => (
                                        <motion.div 
                                            key={g.guild.id || i} 
                                            className={styles.rankingCard}
                                            whileHover={{ y: -4 }}
                                        >
                                            <div className={styles.rankingHeader}>
                                                <div className={styles.guildInfo}>
                                                    {g.guild.iconURL ? (
                                                        <img src={g.guild.iconURL} alt={g.guild.name} className={styles.guildIcon} />
                                                    ) : (
                                                        <div className={styles.guildIconPlaceholder}>
                                                            {g.guild.name.charAt(0).toUpperCase()}
                                                        </div>
                                                    )}
                                                    <div>
                                                        <h4 className={styles.guildName}>{g.guild.name}</h4>
                                                        <p className={styles.rankingLabel}>自分のランキング</p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className={styles.rankingDetails}>
                                                <div className={styles.rankingItem}>
                                                    <span className="material-icons">emoji_events</span>
                                                    <div>
                                                        <div className={styles.rankingValue}>{g.userEntry.rank}位</div>
                                                        <div className={styles.rankingKey}>順位</div>
                                                    </div>
                                                </div>
                                                <div className={styles.rankingItem}>
                                                    <span className="material-icons">stars</span>
                                                    <div>
                                                        <div className={styles.rankingValue}>{(g.userEntry.xp || g.userEntry.score || 0).toLocaleString()}</div>
                                                        <div className={styles.rankingKey}>ポイント</div>
                                                    </div>
                                                </div>
                                                <div className={styles.rankingItem}>
                                                    <span className="material-icons">person</span>
                                                    <div>
                                                        <div className={styles.rankingValue}>{g.userEntry.username || g.userEntry.userId}</div>
                                                        <div className={styles.rankingKey}>ユーザー</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
};

export default UserProfile;
