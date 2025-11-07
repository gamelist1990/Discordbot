import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './ProfileSettings.module.css';
import { COUNTRIES } from '../../data/countries';
import OverviewEditorCanvas from './OverviewEditorCanvas';
import CardInspector from './CardInspector';
import StickerPicker from './StickerPicker';
import { Card, migrateGridToPx } from './types';

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
    const [cards, setCards] = useState<Card[]>([]);
    const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
    const [showStickerPicker, setShowStickerPicker] = useState(false);

    useEffect(() => { fetchProfile(); fetchGuildEmojis(); }, []);

    const fetchProfile = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/user/profile/custom', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                setProfile(data || {});
                
                // Migrate old grid-based cards to px-based if needed
                const existingCards = (data?.overviewConfig?.cards || []);
                if (existingCards.length > 0 && existingCards[0].w !== undefined) {
                    // Has grid-based layout, migrate
                    const migratedCards = migrateGridToPx(existingCards, 600, 12);
                    setCards(migratedCards);
                } else {
                    setCards(existingCards);
                }
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

    // Overview cards handling (updated for px-based)
    const addCard = (type: 'text' | 'image' | 'sticker') => {
        const id = `card_${Date.now()}`;
        const newCard: Card = {
            id,
            type,
            content: type === 'text' ? '新しいテキスト' : '',
            x: 16,
            y: 16,
            pxW: 160,
            pxH: 80,
            zIndex: cards.length + 1,
        };
        setCards([...cards, newCard]);
        setSelectedCardId(id);
    };

    const updateCard = (id: string, patch: Partial<Card>) => {
        setCards(cards.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    };

    const removeCard = (id: string) => {
        setCards(cards.filter((c) => c.id !== id));
        if (selectedCardId === id) setSelectedCardId(null);
    };

    const duplicateCard = (id: string) => {
        const card = cards.find((c) => c.id === id);
        if (!card) return;
        const newId = `card_${Date.now()}`;
        const newCard = { ...card, id: newId, x: card.x + 16, y: card.y + 16 };
        setCards([...cards, newCard]);
        setSelectedCardId(newId);
    };

    const bringForward = (id: string) => {
        const card = cards.find((c) => c.id === id);
        if (!card) return;
        const maxZ = Math.max(...cards.map((c) => c.zIndex || 1));
        updateCard(id, { zIndex: maxZ + 1 });
    };

    const sendBackward = (id: string) => {
        const card = cards.find((c) => c.id === id);
        if (!card) return;
        const minZ = Math.min(...cards.map((c) => c.zIndex || 1));
        updateCard(id, { zIndex: Math.max(1, minZ - 1) });
    };

    const handleSave = async () => {
        try {
            const body = {
                ...profile,
                overviewConfig: {
                    ...(profile.overviewConfig || {}),
                    cards: cards,
                },
            };
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
    const selectedCard = cards.find((c) => c.id === selectedCardId) || null;

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

                        {/* New react-rnd based editor canvas */}
                        <div style={{ marginTop: 16 }}>
                            <OverviewEditorCanvas
                                cards={cards}
                                width={360}
                                height={400}
                                onUpdateCard={updateCard}
                                onSelectCard={setSelectedCardId}
                                selectedId={selectedCardId}
                                gridSnap={8}
                                onDuplicateCard={duplicateCard}
                                onDeleteCard={removeCard}
                                onBringForward={bringForward}
                                onSendBackward={sendBackward}
                            />
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

                    {/* New card editor controls */}
                    <div className={styles.formGroup}>
                        <label>概要カスタム（カード）</label>
                        <div className={styles.cardToolbar}>
                            <button type="button" onClick={() => addCard('text')}>テキスト追加</button>
                            <button type="button" onClick={() => addCard('image')}>画像追加</button>
                            <button type="button" onClick={() => { addCard('sticker'); setShowStickerPicker(true); }}>ステッカー追加</button>
                        </div>
                    </div>

                    {/* Card Inspector */}
                    {selectedCard && (
                        <CardInspector
                            card={selectedCard}
                            onChange={(patch) => updateCard(selectedCard.id, patch)}
                            onClose={() => setSelectedCardId(null)}
                        />
                    )}

                    {/* Sticker Picker */}
                    {showStickerPicker && (
                        <StickerPicker
                            guildEmojis={guildEmojis}
                            onPick={(url) => {
                                if (selectedCardId) {
                                    updateCard(selectedCardId, { content: url });
                                }
                                setShowStickerPicker(false);
                            }}
                        />
                    )}

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
