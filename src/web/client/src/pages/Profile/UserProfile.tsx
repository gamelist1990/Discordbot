import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
}

interface CustomProfile {
    userId: string;
    displayName?: string;
    bio?: string;
    pronouns?: string;
    location?: string;
    website?: string;
    banner?: {
        type: 'color' | 'gradient' | 'image' | 'pattern';
        value: string;
        gradient?: {
            colors: string[];
            direction: 'horizontal' | 'vertical' | 'diagonal';
        };
    };
    themeColor?: string;
    favoriteEmojis?: Array<{
        emoji: string;
        label?: string;
    }>;
    privacy?: {
        showStats: boolean;
        showServers: boolean;
        showActivity: boolean;
        allowPublicView: boolean;
    };
    createdAt: string;
    updatedAt: string;
}

interface UserProfile {
    id: string;
    username: string;
    discriminator: string;
    avatar?: string;
    guilds: GuildStats[];
    totalStats: {
        totalMessages: number;
        totalLinks: number;
        totalMedia: number;
        totalServers: number;
    };
    customProfile?: CustomProfile;
}

const UserProfile: React.FC = () => {
    const { userId: urlUserId } = useParams<{ userId: string }>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [profileData, setProfileData] = useState<UserProfile | null>(null);
    const [activeTab, setActiveTab] = useState<'posts' | 'servers' | 'activity'>('posts');
    const [isOwnProfile, setIsOwnProfile] = useState(true);
    const [sessionUser, setSessionUser] = useState<{ userId?: string; username?: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editData, setEditData] = useState<any>({});
    const [overviewRanking, setOverviewRanking] = useState<any | null>(null);
    const [guildTops, setGuildTops] = useState<Array<any>>([]);

    useEffect(() => {
        checkAuthentication();
    }, [urlUserId]);

    useEffect(() => {
        if (activeTab === 'activity' && profileData) fetchGuildTopRankings();
    }, [activeTab, profileData]);

    const fetchGuildTopRankings = async () => {
        try {
            const tops: any[] = [];
            for (const g of profileData!.guilds) {
                try {
                    const resp = await fetch(`/api/rank/guild/${g.id}`, { credentials: 'include' });
                    if (!resp.ok) continue;
                    const rd = await resp.json();
                    if (rd && rd.leaderboard && rd.leaderboard.length > 0) {
                        tops.push({ guild: rd.guild || g, top: rd.leaderboard[0] });
                    }
                } catch (e) {
                    // ignore per-guild errors
                }
            }
            // sort by top.xp (or score) descending
            tops.sort((a, b) => (b.top.xp || 0) - (a.top.xp || 0));
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
                // If user has overviewConfig requesting ranking, fetch top for the first widget
                try {
                    const widgets = data.customProfile?.overviewConfig?.widgets || [];
                    const rankingWidget = widgets.find((w: any) => w.type === 'ranking' && w.guildId);
                    if (rankingWidget) {
                        const resp = await fetch(`/api/rank/guild/${rankingWidget.guildId}`, { credentials: 'include' });
                        if (resp.ok) {
                            const rd = await resp.json();
                            // rd.leaderboard is array sorted; take first
                            if (rd.leaderboard && rd.leaderboard.length > 0) {
                                setOverviewRanking({ guild: rd.guild, top: rd.leaderboard[0] });
                            }
                        }
                    }
                } catch (e) {
                    // ignore overview ranking errors
                }
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

    const handleSaveProfile = async () => {
        try {
            const response = await fetch('/api/user/profile/custom', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(editData)
            });

            if (response.ok) {
                setShowEditModal(false);
                loadUserProfile();
            } else {
                const errorData = await response.json();
                alert(errorData.errors ? errorData.errors.join('\n') : 'エラーが発生しました');
            }
        } catch (error) {
            console.error('Failed to save profile:', error);
            alert('保存に失敗しました');
        }
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
        <div className={styles.container}>
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
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'servers' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('servers')}
                >
                    <span className="material-icons">dns</span>
                    <span>サーバー</span>
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'activity' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('activity')}
                >
                    <span className="material-icons">timeline</span>
                    <span>アクティビティ</span>
                </button>
            </div>

            {/* Tab Content */}
            <div className={styles.content}>
                {activeTab === 'posts' && (
                    <div className={styles.overview}>
                        <div className={styles.statsGrid}>
                            <div className={styles.statCard}>
                                <span className="material-icons">message</span>
                                <div>
                                    <strong>{profileData.totalStats.totalMessages.toLocaleString()}</strong>
                                    <p>総メッセージ数</p>
                                </div>
                            </div>
                            <div className={styles.statCard}>
                                <span className="material-icons">link</span>
                                <div>
                                    <strong>{profileData.totalStats.totalLinks.toLocaleString()}</strong>
                                    <p>リンク送信</p>
                                </div>
                            </div>
                            <div className={styles.statCard}>
                                <span className="material-icons">image</span>
                                <div>
                                    <strong>{profileData.totalStats.totalMedia.toLocaleString()}</strong>
                                    <p>メディア送信</p>
                                </div>
                            </div>
                            <div className={styles.statCard}>
                                <span className="material-icons">groups</span>
                                <div>
                                    <strong>{profileData.totalStats.totalServers}</strong>
                                    <p>参加サーバー</p>
                                </div>
                            </div>
                        </div>
                        {overviewRanking && (
                            <div className={styles.rankingOverview}>
                                <h3>ランキング (トップ)</h3>
                                <div className={styles.rankingItem}>
                                    <img src={overviewRanking.top.avatar || ''} alt="avatar" style={{width:48,height:48,borderRadius:8}} />
                                    <div style={{marginLeft:10}}>
                                        <div style={{fontWeight:700}}>{overviewRanking.top.username}</div>
                                        <div style={{fontSize:12,color:'#666'}}>{overviewRanking.guild.name} • {overviewRanking.top.xp} Pt</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Render overviewConfig cards if present */}
                        {profileData.customProfile?.overviewConfig && ((profileData.customProfile.overviewConfig as any).cards || []).length > 0 && (
                            <div className={styles.previewGrid}>
                                {((profileData.customProfile.overviewConfig as any).cards || []).map((c: any) => (
                                    <div key={c.id} className={styles.previewCard} style={{ gridColumn: `span ${c.w || 4}`, gridRow: `span ${c.h || 2}` }}>
                                        {c.type === 'text' && <div className={styles.cardText}>{c.content}</div>}
                                        {c.type === 'image' && c.content && <img src={c.content} alt="card" className={styles.cardImage} />}
                                        {c.type === 'sticker' && (
                                            c.content && /^https?:\/\//.test(c.content) ? <img src={c.content} className={styles.cardSticker} alt="sticker"/> : <div className={styles.cardStickerText}>{c.content}</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'servers' && (
                    <div className={styles.servers}>
                        {profileData.guilds.map(guild => (
                            <div key={guild.id} className={styles.serverCard}>
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
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'activity' && (
                    <div className={styles.activity}>
                        {guildTops.length === 0 ? (
                            <p className={styles.comingSoon}>ランキング情報を取得中です...</p>
                        ) : (
                            <div className={styles.rankingOverview}>
                                <h3>サーバー別トップ (PT順)</h3>
                                <div style={{display:'grid',gap:12}}>
                                    {guildTops.map((g, i) => (
                                        <div key={g.guild.id || i} className={styles.rankingItem} style={{padding:12, border:'1px solid #E9ECEF', borderRadius:10}}>
                                            <div style={{display:'flex',alignItems:'center',gap:12}}>
                                                <div style={{width:48,height:48,overflow:'hidden',borderRadius:8}}>
                                                    <img src={g.top.avatar || ''} alt="avatar" style={{width:'100%',height:'100%',objectFit:'cover'}} />
                                                </div>
                                                <div style={{flex:1}}>
                                                    <div style={{fontWeight:700}}>{g.top.username || g.top.id}</div>
                                                    <div style={{fontSize:12,color:'#666'}}>{g.guild.name} • {(g.top.xp || g.top.score || 0)} Pt</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Editing moved to full-screen settings page */}
        </div>
    );
};

export default UserProfile;
