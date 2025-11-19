import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import styles from './ProfileSettings.module.css';
import { COUNTRIES } from '../../data/countries';

interface LocationField {
    label?: string;
    url?: string;
    code?: string;
    emoji?: string;
}

interface CustomProfile {
    userId: string;
    displayName?: string;
    bio?: string;
    pronouns?: string;
    location?: LocationField;
    website?: string;
    banner?: any;
    themeColor?: string;
    privacy?: any;
    favoriteEmojis?: any[];
    favoriteImage?: string; // New field
}

const ProfileSettings: React.FC = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState<Partial<CustomProfile>>({});
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { fetchProfile(); }, []);

    const fetchProfile = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/user/profile/custom', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                setProfile(data || {});
            } else {
                setError('プロフィールが取得できませんでした');
            }
        } catch (e) {
            console.error(e);
            setError('ネットワークエラー');
        } finally {
            setLoading(false);
        }
    };

    const pickCountry = (c: any) => {
        const loc = profile.location || {};
        setProfile({ ...(profile || {}), location: { label: c.label, code: c.code, emoji: c.emoji, url: loc.url } });
    };

    const handleSave = async () => {
        try {
            const body = {
                ...profile,
                // Remove overviewConfig if it exists to clean up
                overviewConfig: undefined, 
            };
            const res = await fetch('/api/user/profile/custom', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                navigate('/profile');
            } else {
                const b = await res.json();
                setError((b && b.errors && b.errors.join('\n')) || '保存に失敗しました');
            }
        } catch (e) {
            console.error(e);
            setError('ネットワークエラー');
        }
    };

    if (loading) return <div className={styles.container}><div style={{padding:60,textAlign:'center'}}>読み込み中...</div></div>;

    const loc = profile.location || {};

    return (
        <motion.div 
            className={styles.container}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
        >
            <div className={styles.header}>
                <h2>プロフィール設定</h2>
                <div className={styles.headerActions}>
                    <button onClick={() => navigate(-1)} className={styles.cancel}>キャンセル</button>
                    <button onClick={handleSave} className={styles.save}>保存</button>
                </div>
            </div>

            {error && <div style={{color:'var(--ios-red)', marginBottom: 20, textAlign:'center'}}>{error}</div>}

            <div className={styles.singleColumnGrid}>
                <div className={styles.formColumn}>
                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>基本情報</h3>
                        <div className={styles.formGroup}>
                            <label htmlFor="displayName">表示名</label>
                            <input id="displayName" name="displayName" autoComplete="name" className={styles.input} value={profile.displayName || ''} onChange={(e) => setProfile({...profile, displayName: e.target.value})} />
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="bio">自己紹介</label>
                            <textarea id="bio" name="bio" autoComplete="off" className={styles.textarea} value={profile.bio || ''} onChange={(e) => setProfile({...profile, bio: e.target.value})} />
                        </div>
                        
                        <div className={styles.formGroup}>
                            <label htmlFor="pronouns">代名詞 (Pronouns)</label>
                            <input id="pronouns" name="pronouns" autoComplete="nickname" className={styles.input} value={profile.pronouns || ''} onChange={(e) => setProfile({...profile, pronouns: e.target.value})} placeholder="例: he/him, she/her" />
                        </div>
                    </div>

                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>お気に入りの画像</h3>
                        <div className={styles.formGroup}>
                            <label htmlFor="favoriteImage">画像URL</label>
                            <input 
                                id="favoriteImage"
                                name="favoriteImage"
                                autoComplete="off"
                                className={styles.input} 
                                value={profile.favoriteImage || ''} 
                                onChange={(e) => setProfile({...profile, favoriteImage: e.target.value})} 
                                placeholder="https://example.com/image.png" 
                            />
                            <p style={{fontSize: 12, color: 'var(--ios-text-secondary)', marginTop: 8}}>
                                プロフィールに大きく表示されるお気に入りの画像を設定できます。
                            </p>
                            {profile.favoriteImage && (
                                <div style={{marginTop: 16, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--ios-divider)'}}>
                                    <img src={profile.favoriteImage} alt="Preview" style={{width: '100%', height: 'auto', display: 'block'}} />
                                </div>
                            )}
                        </div>
                    </div>

                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>場所・リンク</h3>
                            <div className={styles.formGroup}>
                            <label>場所（国）</label>
                            <div className={styles.countryList}>
                                {COUNTRIES.map(c => (
                                    <button key={c.code} type="button" className={`${styles.countryBtn} ${loc.code === c.code ? styles.countryActive : ''}`} onClick={() => pickCountry(c)}>
                                        <span className={styles.emoji}>{c.emoji}</span>
                                        <span className={styles.countryLabel}>{c.label}</span>
                                    </button>
                                ))}
                            </div>
                            <div style={{display:'flex', flexDirection:'column', gap:12}}>
                                <input id="locationLabel" name="locationLabel" className={styles.input} placeholder="カスタムラベル（例: 日本）" value={loc.label || ''} onChange={(e) => setProfile({...profile, location: {...loc, label: e.target.value}})} />
                                <input id="locationUrl" name="locationUrl" autoComplete="off" className={styles.input} placeholder="場所のリンク (任意)" value={loc.url || ''} onChange={(e) => setProfile({...profile, location: {...loc, url: e.target.value}})} />
                            </div>
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="website">ウェブサイト</label>
                            <input id="website" name="website" autoComplete="url" className={styles.input} value={profile.website || ''} onChange={(e) => setProfile({...profile, website: e.target.value})} />
                        </div>
                    </div>

                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>デザイン</h3>
                        <div className={styles.formGroup}>
                            <label>バナー</label>
                            <div style={{display:'flex',gap:8,alignItems:'center'}}>
                                <select id="bannerType" name="bannerType" className={styles.select} style={{width:'auto'}} value={(profile.banner && profile.banner.type) || 'color'} onChange={(e) => setProfile({...profile, banner: { ...(profile.banner||{}), type: e.target.value }})}>
                                    <option value="color">カラー</option>
                                    <option value="image">画像URL</option>
                                </select>
                                <input id="bannerValue" name="bannerValue" autoComplete="off" className={styles.input} value={(profile.banner && profile.banner.value) || ''} onChange={(e) => setProfile({...profile, banner: { ...(profile.banner||{}), value: e.target.value }})} placeholder="#RRGGBB または 画像URL" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default ProfileSettings;
