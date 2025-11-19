import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
    const [, setIsMobileInspectorOpen] = useState(false);

    useEffect(() => { fetchProfile(); fetchGuildEmojis(); }, []);

    useEffect(() => {
        if (selectedCardId) {
            // On mobile, open inspector when card selected
            if (window.innerWidth < 1200) {
                setIsMobileInspectorOpen(true);
            }
        }
    }, [selectedCardId]);

    const fetchProfile = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/user/profile/custom', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                setProfile(data || {});
                
                const existingCards = (data?.overviewConfig?.cards || []);
                if (existingCards.length > 0 && existingCards[0].w !== undefined) {
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
    const selectedCard = cards.find((c) => c.id === selectedCardId) || null;

    return (
        <motion.div 
            className={styles.container}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
        >
            <div className={styles.header}>
                <h2>プロフィール設定</h2>
                <div className={styles.headerActions}>
                    <button onClick={() => navigate(-1)} className={styles.cancel}>キャンセル</button>
                    <button onClick={handleSave} className={styles.save}>保存</button>
                </div>
            </div>

            {error && <div style={{color:'var(--ios-red)', marginBottom: 20, textAlign:'center'}}>{error}</div>}

            <div className={styles.grid}>
                {/* Left Column: Basic Info Form */}
                <div className={styles.formColumn}>
                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>基本情報</h3>
                        <div className={styles.formGroup}>
                            <label>表示名</label>
                            <input className={styles.input} value={profile.displayName || ''} onChange={(e) => setProfile({...profile, displayName: e.target.value})} />
                        </div>

                        <div className={styles.formGroup}>
                            <label>自己紹介</label>
                            <textarea className={styles.textarea} value={profile.bio || ''} onChange={(e) => setProfile({...profile, bio: e.target.value})} />
                        </div>
                        
                        <div className={styles.formGroup}>
                            <label>代名詞 (Pronouns)</label>
                            <input className={styles.input} value={profile.pronouns || ''} onChange={(e) => setProfile({...profile, pronouns: e.target.value})} placeholder="例: he/him, she/her" />
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
                                <input className={styles.input} placeholder="カスタムラベル（例: 日本）" value={loc.label || ''} onChange={(e) => setProfile({...profile, location: {...loc, label: e.target.value}})} />
                                <input className={styles.input} placeholder="場所のリンク (任意)" value={loc.url || ''} onChange={(e) => setProfile({...profile, location: {...loc, url: e.target.value}})} />
                            </div>
                        </div>

                        <div className={styles.formGroup}>
                            <label>ウェブサイト</label>
                            <input className={styles.input} value={profile.website || ''} onChange={(e) => setProfile({...profile, website: e.target.value})} />
                        </div>
                    </div>

                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>デザイン</h3>
                        <div className={styles.formGroup}>
                            <label>バナー</label>
                            <div style={{display:'flex',gap:8,alignItems:'center'}}>
                                <select className={styles.select} style={{width:'auto'}} value={(profile.banner && profile.banner.type) || 'color'} onChange={(e) => setProfile({...profile, banner: { ...(profile.banner||{}), type: e.target.value }})}>
                                    <option value="color">カラー</option>
                                    <option value="image">画像URL</option>
                                </select>
                                <input className={styles.input} value={(profile.banner && profile.banner.value) || ''} onChange={(e) => setProfile({...profile, banner: { ...(profile.banner||{}), value: e.target.value }})} placeholder="#RRGGBB または 画像URL" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Middle Column: Canvas Editor */}
                <div className={styles.canvasColumn}>
                    <div className={styles.canvasToolbar}>
                        <motion.button whileHover={{scale:1.05}} whileTap={{scale:0.95}} className={styles.toolButton} onClick={() => addCard('text')}>
                            <span className="material-icons">text_fields</span> テキスト
                        </motion.button>
                        <motion.button whileHover={{scale:1.05}} whileTap={{scale:0.95}} className={styles.toolButton} onClick={() => addCard('image')}>
                            <span className="material-icons">image</span> 画像
                        </motion.button>
                        <motion.button whileHover={{scale:1.05}} whileTap={{scale:0.95}} className={styles.toolButton} onClick={() => { addCard('sticker'); setShowStickerPicker(true); }}>
                            <span className="material-icons">emoji_emotions</span> ステッカー
                        </motion.button>
                    </div>

                    <div className={styles.canvasWrapper}>
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
                    <p style={{textAlign:'center', fontSize:13, color:'var(--ios-text-secondary)'}}>
                        ドラッグして移動、端を掴んでリサイズできます
                    </p>
                </div>

                {/* Right Column: Inspector (Desktop) */}
                <div className={styles.inspectorColumn}>
                    <AnimatePresence mode="wait">
                        {selectedCard ? (
                            <motion.div
                                key="inspector"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                            >
                                <CardInspector
                                    card={selectedCard}
                                    onChange={(patch) => updateCard(selectedCard.id, patch)}
                                    onClose={() => setSelectedCardId(null)}
                                />
                            </motion.div>
                        ) : (
                            <motion.div
                                key="empty"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                style={{ padding: 40, textAlign: 'center', color: 'var(--ios-text-secondary)' }}
                            >
                                <span className="material-icons" style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>touch_app</span>
                                <p>カードを選択して編集</p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* Sticker Picker Modal */}
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

            {/* Mobile Inspector Modal/Sheet */}
            {/* Note: In a real app, use a proper Sheet component. Here we use a simple fixed overlay for mobile if needed. */}
        </motion.div>
    );
};

export default ProfileSettings;
