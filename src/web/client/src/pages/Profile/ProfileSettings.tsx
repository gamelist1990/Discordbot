import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './ProfileSettings.module.css';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { COUNTRIES } from '../../data/countries';

const ResponsiveGridLayout = WidthProvider(Responsive as any) as React.ComponentType<any>;

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
    overviewConfig?: any;
}

const ProfileSettings: React.FC = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState<Partial<CustomProfile>>({});
    const [error, setError] = useState<string | null>(null);
    const [guildEmojis, setGuildEmojis] = useState<any[]>([]);

    useEffect(() => { fetchProfile(); fetchGuildEmojis(); }, []);

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

    const fetchGuildEmojis = async () => {
        try {
            const res = await fetch('/api/user/emojis', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                setGuildEmojis(data.guilds || []);
            }
        } catch (e) {
            // ignore
        }
    };

    const pickCountry = (c: any) => {
        const loc = profile.location || {};
        setProfile({ ...(profile || {}), location: { label: c.label, code: c.code, emoji: c.emoji, url: loc.url } });
    };

    // Overview cards handling
    const addCard = (type: 'text' | 'image' | 'sticker') => {
        const cards = (profile.overviewConfig && (profile.overviewConfig as any).cards) || [];
        const id = `card_${Date.now()}`;
        const newCard = { id, type, content: type === 'text' ? '新しいテキスト' : '', w: 4, h: 2, x: 0, y: 0 };
        const updated = { ...(profile.overviewConfig || {}), cards: [...cards, newCard] };
        setProfile({ ...(profile || {}), overviewConfig: updated });
    };

    const updateCard = (id: string, patch: any) => {
        const cards = (profile.overviewConfig && (profile.overviewConfig as any).cards) || [];
        const next = cards.map((c: any) => c.id === id ? { ...c, ...patch } : c);
        setProfile({ ...(profile || {}), overviewConfig: { ...(profile.overviewConfig || {}), cards: next } });
    };

    const removeCard = (id: string) => {
        const cards = (profile.overviewConfig && (profile.overviewConfig as any).cards) || [];
        const next = cards.filter((c: any) => c.id !== id);
        setProfile({ ...(profile || {}), overviewConfig: { ...(profile.overviewConfig || {}), cards: next } });
    };

    const moveCard = (id: string, dir: 'up' | 'down') => {
        const cards = (profile.overviewConfig && (profile.overviewConfig as any).cards) || [];
        const idx = cards.findIndex((c: any) => c.id === id);
        if (idx === -1) return;
        const swap = dir === 'up' ? idx - 1 : idx + 1;
        if (swap < 0 || swap >= cards.length) return;
        const copy = [...cards];
        const tmp = copy[swap];
        copy[swap] = copy[idx];
        copy[idx] = tmp;
        setProfile({ ...(profile || {}), overviewConfig: { ...(profile.overviewConfig || {}), cards: copy } });
    };

    const layoutFromCards = () => {
        const cards = (profile.overviewConfig && (profile.overviewConfig as any).cards) || [];
        return cards.map((c: any, idx: number) => ({ i: c.id, x: c.x || (idx * 2) % 12, y: c.y || Math.floor(idx / 6) * 2, w: c.w || 4, h: c.h || 2 }));
    };

    const onLayoutChange = (layout: any[]) => {
        // map back to profile.overviewConfig.cards positions
        const cards = (profile.overviewConfig && (profile.overviewConfig as any).cards) || [];
        const next = cards.map((c: any) => {
            const l = layout.find(x => x.i === c.id);
            if (l) return { ...c, x: l.x, y: l.y, w: l.w, h: l.h };
            return c;
        });
        setProfile({ ...(profile || {}), overviewConfig: { ...(profile.overviewConfig || {}), cards: next } });
    };

    const handleSave = async () => {
        try {
            const body = { ...profile };
            const res = await fetch('/api/user/profile/custom', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                navigate(`/profile`);
            } else {
                const b = await res.json();
                setError((b && b.errors && b.errors.join('\n')) || '保存に失敗しました');
            }
        } catch (e) {
            console.error(e);
            setError('ネットワークエラー');
        }
    };

    if (loading) return <div style={{padding:20}}>読み込み中...</div>;

    const loc = profile.location || {};

    return (
        <div className={styles.container}>
            <h2>プロフィール設定</h2>
            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.grid}>
                <div className={styles.preview}>
                    <div className={styles.previewBanner} style={{background: profile.banner?.type === 'color' ? profile.banner.value || '#EEE' : '#EEE'}}>
                    </div>
                    <div className={styles.previewBody}>
                        <h3 className={styles.previewName}>{profile.displayName || '表示名'}</h3>
                        <p className={styles.previewBio}>{profile.bio || '自己紹介がここに表示されます。'}</p>
                        <div className={styles.previewMeta}>
                            {loc.label && (
                                loc.url ? (
                                    <a className={styles.previewMetaItem} href={loc.url} target="_blank" rel="noopener noreferrer">
                                        <span className={styles.emoji}>{loc.emoji || '📍'}</span>
                                        <span>{loc.label}</span>
                                    </a>
                                ) : (
                                    <div className={styles.previewMetaItem}>
                                        <span className={styles.emoji}>{loc.emoji || '📍'}</span>
                                        <span>{loc.label}</span>
                                    </div>
                                )
                            )}
                            {profile.website && (
                                <a className={styles.previewMetaItem} href={profile.website} target="_blank" rel="noopener noreferrer">
                                    🔗 {new URL(profile.website).hostname}
                                </a>
                            )}
                        </div>

                        {/* Preview overview grid (draggable/resizable) */}
                        <div className={styles.previewGrid}>
                            <ResponsiveGridLayout
                                className="layout"
                                layouts={{ lg: layoutFromCards() }}
                                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
                                cols={{ lg: 12, md: 10, sm: 8, xs: 4 }}
                                rowHeight={80}
                                onLayoutChange={(_layout: any, layouts: any) => onLayoutChange((layouts as any).lg || _layout)}
                                isResizable
                                isDraggable
                            >
                                {((profile.overviewConfig && (profile.overviewConfig as any).cards) || []).map((c: any) => (
                                    <div key={c.id} data-grid={{ x: c.x || 0, y: c.y || 0, w: c.w || 4, h: c.h || 2 }} className={styles.previewCard}>
                                        {c.type === 'text' && <div className={styles.cardText}>{c.content}</div>}
                                        {c.type === 'image' && c.content && <img src={c.content} alt="card" className={styles.cardImage} />}
                                        {c.type === 'sticker' && (
                                            c.content && /^https?:\/\//.test(c.content) ? <img src={c.content} className={styles.cardSticker} alt="sticker"/> : <div className={styles.cardStickerText}>{c.content}</div>
                                        )}
                                    </div>
                                ))}
                            </ResponsiveGridLayout>
                        </div>
                    </div>
                </div>

                <div className={styles.form}>
                    <div className={styles.formGroup}>
                        <label>表示名</label>
                        <input value={profile.displayName || ''} onChange={(e) => setProfile({...profile, displayName: e.target.value})} />
                    </div>

                    <div className={styles.formGroup}>
                        <label>自己紹介</label>
                        <textarea value={profile.bio || ''} onChange={(e) => setProfile({...profile, bio: e.target.value})} />
                    </div>

                    <div className={styles.formGroup}>
                        <label>場所（国）選択</label>
                        <div className={styles.countryList}>
                            {COUNTRIES.map(c => (
                                <button key={c.code} type="button" className={`${styles.countryBtn} ${loc.code === c.code ? styles.countryActive : ''}`} onClick={() => pickCountry(c)}>
                                    <span className={styles.emoji}>{c.emoji}</span>
                                    <span className={styles.countryLabel}>{c.label}</span>
                                </button>
                            ))}
                        </div>
                        <div className={styles.formRow}>
                            <input placeholder="カスタムラベル（例: 日本）" value={loc.label || ''} onChange={(e) => setProfile({...profile, location: {...loc, label: e.target.value}})} />
                        </div>
                        <div className={styles.formRow}>
                            <input placeholder="場所のリンク (任意) 例: https://maps.google.com/..." value={loc.url || ''} onChange={(e) => setProfile({...profile, location: {...loc, url: e.target.value}})} />
                        </div>
                    </div>

                    <div className={styles.formGroup}>
                        <label>バナー (カラーまたは画像URL)</label>
                        <div style={{display:'flex',gap:8,alignItems:'center'}}>
                            <select value={(profile.banner && profile.banner.type) || 'color'} onChange={(e) => setProfile({...profile, banner: { ...(profile.banner||{}), type: e.target.value }})}>
                                <option value="color">カラー</option>
                                <option value="image">画像URL</option>
                            </select>
                            <input style={{flex:1}} value={(profile.banner && profile.banner.value) || ''} onChange={(e) => setProfile({...profile, banner: { ...(profile.banner||{}), value: e.target.value }})} placeholder="#RRGGBB または 画像URL" />
                        </div>
                    </div>

                    {/* Overview editor */}
                    <div className={styles.formGroup}>
                        <label>概要カスタム（カード）</label>
                        <div className={styles.cardToolbar}>
                            <button type="button" onClick={() => addCard('text')}>テキスト追加</button>
                            <button type="button" onClick={() => addCard('image')}>画像追加</button>
                            <button type="button" onClick={() => addCard('sticker')}>ステッカー追加</button>
                        </div>
                        <div className={styles.cardList}>
                            {((profile.overviewConfig && (profile.overviewConfig as any).cards) || []).map((c: any) => (
                                <div key={c.id} className={styles.cardRow}>
                                    <div className={styles.cardRowMain}>
                                        <strong>{c.type}</strong>
                                        {c.type === 'sticker' ? (
                                            <select value={c.content || ''} onChange={(e) => updateCard(c.id, { content: e.target.value })}>
                                                <option value="">-- ステッカー選択 --</option>
                                                {guildEmojis.map(g => (
                                                    <optgroup key={g.guildId} label={g.guildName}>
                                                        {g.emojis.map((em: any) => (
                                                            <option key={`${g.guildId}_${em.id}`} value={em.url}>{em.name ? `${em.name}` : em.url}</option>
                                                        ))}
                                                    </optgroup>
                                                ))}
                                            </select>
                                        ) : (
                                            <input value={c.content || ''} onChange={(e) => updateCard(c.id, { content: e.target.value })} placeholder={c.type === 'text' ? 'テキスト' : '画像URLまたは絵文字'} />
                                        )}
                                        <div className={styles.sizeControls}>
                                            <label>幅</label>
                                            <input type="number" value={c.w || 4} min={1} max={12} onChange={(e) => updateCard(c.id, { w: Number(e.target.value) })} />
                                            <label>高さ</label>
                                            <input type="number" value={c.h || 2} min={1} max={12} onChange={(e) => updateCard(c.id, { h: Number(e.target.value) })} />
                                        </div>
                                    </div>
                                    <div className={styles.cardRowActions}>
                                        <button onClick={() => moveCard(c.id, 'up')}>↑</button>
                                        <button onClick={() => moveCard(c.id, 'down')}>↓</button>
                                        <button onClick={() => removeCard(c.id)}>削除</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className={styles.formGroup}>
                        <label>ウェブサイト</label>
                        <input value={profile.website || ''} onChange={(e) => setProfile({...profile, website: e.target.value})} />
                    </div>

                    <div className={styles.formActions}>
                        <button onClick={() => navigate(-1)} className={styles.cancel}>キャンセル</button>
                        <button onClick={handleSave} className={styles.save}>保存</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProfileSettings;
