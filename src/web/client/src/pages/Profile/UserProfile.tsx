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
    const [error, setError] = useState<string | null>(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editData, setEditData] = useState<any>({});

    useEffect(() => {
        checkAuthentication();
    }, [urlUserId]);

    const checkAuthentication = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch('/api/auth/session', { credentials: 'include' });

            if (response.ok) {
                const sessionData = await response.json();
                setIsOwnProfile(!urlUserId || sessionData.userId === urlUserId);
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
            const queryParam = urlUserId ? `?userId=${urlUserId}` : '';
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
        setEditData({
            displayName: profileData?.customProfile?.displayName || '',
            bio: profileData?.customProfile?.bio || '',
            pronouns: profileData?.customProfile?.pronouns || '',
            location: profileData?.customProfile?.location || '',
            website: profileData?.customProfile?.website || '',
            banner: profileData?.customProfile?.banner || { type: 'color', value: '#1DA1F2' },
            favoriteEmojis: profileData?.customProfile?.favoriteEmojis || []
        });
        setShowEditModal(true);
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
                            <span className={styles.metaItem}>
                                <span className="material-icons">place</span>
                                {profileData.customProfile.location}
                            </span>
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
                        <p className={styles.comingSoon}>アクティビティデータは準備中です</p>
                    </div>
                )}
            </div>

            {/* Edit Modal */}
            {showEditModal && (
                <div className={styles.modal} onClick={() => setShowEditModal(false)}>
                    <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2>プロフィールを編集</h2>
                            <button onClick={() => setShowEditModal(false)} className={styles.closeButton}>
                                <span className="material-icons">close</span>
                            </button>
                        </div>
                        <div className={styles.modalBody}>
                            <div className={styles.formGroup}>
                                <label>表示名</label>
                                <input
                                    type="text"
                                    value={editData.displayName}
                                    onChange={(e) => setEditData({ ...editData, displayName: e.target.value })}
                                    placeholder="表示名を入力"
                                    maxLength={32}
                                />
                            </div>
                            <div className={styles.formGroup}>
                                <label>自己紹介</label>
                                <textarea
                                    value={editData.bio}
                                    onChange={(e) => setEditData({ ...editData, bio: e.target.value })}
                                    placeholder="自己紹介を入力"
                                    maxLength={500}
                                    rows={4}
                                />
                                <span className={styles.charCount}>{editData.bio?.length || 0}/500</span>
                            </div>
                            <div className={styles.formGroup}>
                                <label>代名詞</label>
                                <input
                                    type="text"
                                    value={editData.pronouns}
                                    onChange={(e) => setEditData({ ...editData, pronouns: e.target.value })}
                                    placeholder="例: she/her, he/him"
                                />
                            </div>
                            <div className={styles.formGroup}>
                                <label>場所</label>
                                <input
                                    type="text"
                                    value={editData.location}
                                    onChange={(e) => setEditData({ ...editData, location: e.target.value })}
                                    placeholder="場所を入力"
                                    maxLength={100}
                                />
                            </div>
                            <div className={styles.formGroup}>
                                <label>ウェブサイト</label>
                                <input
                                    type="url"
                                    value={editData.website}
                                    onChange={(e) => setEditData({ ...editData, website: e.target.value })}
                                    placeholder="https://example.com"
                                />
                            </div>
                        </div>
                        <div className={styles.modalFooter}>
                            <button onClick={() => setShowEditModal(false)} className={styles.cancelButton}>
                                キャンセル
                            </button>
                            <button onClick={handleSaveProfile} className={styles.saveButton}>
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserProfile;
