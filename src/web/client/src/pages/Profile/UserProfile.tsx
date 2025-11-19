import React, { useEffect, useState, useRef } from 'react';
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
        banner?: {
            type: 'color' | 'gradient' | 'image';
            value: string;
            gradient?: {
                colors: string[];
                direction: string;
            };
        };
        overviewConfig?: {
            canvasWidth: number;
            cards: any[];
            widgets?: any[];
        };
    };
}

import { migrateGridToPx, Card } from './types';

const UserProfile: React.FC = () => {
    const { userId: urlUserId } = useParams<{ userId: string }>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [profileData, setProfileData] = useState<Profile | null>(null);
    const [activeTab, setActiveTab] = useState<'posts' | 'servers' | 'ranking'>('posts');
    const [isOwnProfile, setIsOwnProfile] = useState(true);
    const [sessionUser, setSessionUser] = useState<{ userId?: string; username?: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Editing flows moved to separate settings page; keep state minimal here.
    const [overviewRanking, setOverviewRanking] = useState<{ guild: GuildStats; userEntry: any; } | null>(null);
    const [guildTops, setGuildTops] = useState<Array<{ guild: GuildStats; userEntry: any; }>>([]);
    const previewRef = useRef<HTMLDivElement | null>(null);
    const [scale, setScale] = useState<number>(1);

    const getCanvasHeight = (cards: Card[]) => {
        if (!cards || cards.length === 0) return 300;
        let max = 0;
        for (const c of cards) {
            const bottom = (c.y || 0) + (c.pxH || 0);
            if (bottom > max) max = bottom;
        }
        return Math.max(300, max);
    };

    useEffect(() => {
        const handleResize = () => {
            try {
                const baseCanvasWidth = (profileData?.customProfile?.overviewConfig && profileData!.customProfile!.overviewConfig.canvasWidth) || 800;
                const parentWidth = previewRef.current ? previewRef.current.clientWidth : 0;
                if (parentWidth > 0) {
                    // prevent overly tiny scaling on narrow screens
                        const raw = parentWidth / baseCanvasWidth;
                        // On small mobile widths prefer a larger minimum scale so preview remains readable
                        const minScale = parentWidth < 480 ? 0.9 : 0.5;
                        setScale(Math.max(raw, minScale));
                } else {
                    setScale(1);
                }
            } catch (e) {
                setScale(1);
            }
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [profileData]);

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
                // If user has overviewConfig requesting ranking, fetch top for the first widget
                try {
                    const widgets = data.customProfile?.overviewConfig?.widgets || [];
                    const rankingWidget = widgets.find((w: any) => w.type === 'ranking' && w.guildId);
                    if (rankingWidget) {
                        // Get guild rankings to get presets
                        const guildResp = await fetch(`/api/rank/guild/${rankingWidget.guildId}`, { credentials: 'include' });
                        if (guildResp.ok) {
                            const guildData = await guildResp.json();
                            if (guildData.presets && guildData.presets.length > 0) {

                                let bestEntry: any = null;

                                // Check each preset
                                for (const preset of guildData.presets) {
                                    try {
                                        const resp = await fetch(`/api/rank/leaderboard/${rankingWidget.guildId}?preset=${preset.name}&limit=1000`, { credentials: 'include' });
                                        if (!resp.ok) continue;
                                        const rd = await resp.json();
                                        if (rd && rd.leaderboard && rd.leaderboard.length > 0) {
                                            const userEntry = rd.leaderboard.find((entry: any) => entry.userId === data.id);
                                            if (userEntry) {
                                                const rank = rd.leaderboard.findIndex((entry: any) => entry.userId === data.id) + 1;
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
                                    setOverviewRanking({ guild: guildData.guild || { id: rankingWidget.guildId, name: 'Unknown' }, userEntry: bestEntry });
                                }
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

    // Profile saving handled in `/settings/profile` (navigates there).

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
                                    {/* Render overviewConfig cards if present */}
                                    {profileData.customProfile?.overviewConfig && ((profileData.customProfile.overviewConfig as any).cards || []).length > 0 && (
                                        <div className={styles.previewCanvasWrapper} ref={previewRef}>
                                            {(() => {
                                                const rawCards = (profileData.customProfile.overviewConfig as any).cards || [];
                                                const baseCanvasWidth = (profileData.customProfile.overviewConfig && profileData.customProfile.overviewConfig.canvasWidth) || 800;
                                                const hasPx = rawCards.length > 0 && rawCards[0].pxW !== undefined;
                                                const cards: Card[] = hasPx ? rawCards : migrateGridToPx(rawCards, baseCanvasWidth, 12);

                                                const canvasWidth = baseCanvasWidth;
                                                const canvasHeight = getCanvasHeight(cards);

                                                return (
                                                    <div
                                                        className={styles.previewCanvas}
                                                        style={{ width: '100%', height: (canvasHeight * scale + 48) + 'px' }}
                                                    >
                                                        <div
                                                            className={styles.previewInnerCanvas}
                                                            style={{
                                                                width: canvasWidth + 'px',
                                                                height: canvasHeight + 'px',
                                                                transform: `scale(${scale})`,
                                                                transformOrigin: 'top center',
                                                            }}
                                                        >
                                                            {cards.map((c) => {
                                                                const left = Math.round(c.x);
                                                                const top = Math.round(c.y);
                                                                const width = Math.round(c.pxW);
                                                                const height = Math.round(c.pxH);
                                                                return (
                                                                    <div
                                                                        key={c.id}
                                                                        className={styles.previewCanvasCard}
                                                                        style={{
                                                                            left: left + 'px',
                                                                            top: top + 'px',
                                                                            width: width + 'px',
                                                                            height: height + 'px',
                                                                            transform: `rotate(${c.rotation || 0}deg)`,
                                                                            zIndex: c.zIndex || 1,
                                                                            opacity: c.opacity == null ? 1 : c.opacity,
                                                                        }}
                                                                    >
                                                                        {c.type === 'text' && (
                                                                            <div style={{ 
                                                                                fontSize: c.meta?.fontSize || 14, 
                                                                                color: c.meta?.color || '#111', 
                                                                                textAlign: c.meta?.align || 'left',
                                                                                fontWeight: c.meta?.fontWeight || 'normal',
                                                                                fontFamily: c.meta?.fontFamily || 'inherit',
                                                                                whiteSpace: 'pre-wrap',
                                                                                width: '100%',
                                                                                height: '100%',
                                                                                overflow: 'hidden'
                                                                            }}>
                                                                                {c.content}
                                                                            </div>
                                                                        )}
                                                                        {c.type === 'image' && c.content && <img src={c.content} alt="card" className={styles.cardImage} />}
                                                                        {c.type === 'sticker' && (
                                                                            c.content && /^https?:\/\//.test(c.content) ? <img src={c.content} className={styles.cardSticker} alt="sticker"/> : <div className={styles.cardStickerText}>{c.content}</div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}

                                    {/* If no custom cards, show a friendly empty state placeholder */}
                                    {!profileData.customProfile?.overviewConfig && (
                                        <div className={styles.emptyState}>カスタム概要がありません</div>
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

                                    {overviewRanking && (
                                        <div className={styles.rankingOverview}>
                                            <h3>ランキング (自分の順位)</h3>
                                            <div className={styles.rankingItem}>
                                                <img src={overviewRanking.userEntry.avatar || ''} alt="avatar" style={{width:48,height:48,borderRadius:8}} />
                                                <div style={{marginLeft:10}}>
                                                    <div style={{fontWeight:700}}>{overviewRanking.userEntry.username}</div>
                                                    <div style={{fontSize:12,color:'var(--ios-text-secondary)'}}>{overviewRanking.guild.name} • {overviewRanking.userEntry.rank}位 • {overviewRanking.userEntry.xp} Pt</div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
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

            {/* Editing moved to full-screen settings page */}
        </motion.div>
    );
};

export default UserProfile;
