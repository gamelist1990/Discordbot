import React, { useEffect, useState } from 'react';
import { EMOJI_PICKER_EMOJIS } from '../utils/placeholders.js';
import styles from './EmojiPicker.module.css';
import { fetchGuildEmojis } from '../../../services/api.js';

interface EmojiPickerProps {
    value: string;
    onChange: (emoji: string) => void;
    guildId?: string | null;
}

const EmojiPicker: React.FC<EmojiPickerProps> = ({ value, onChange, guildId }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [guildEmojis, setGuildEmojis] = useState<Array<{ id: string; name: string | null; animated: boolean; url: string }>>([]);
    const [loadingGuildEmojis, setLoadingGuildEmojis] = useState(false);
    const isSingleEmoji = (v: string) => {
        if (!v) return false;
        try {
            // Unicode property escape for Emoji; fallback to simple length check
            return /^\p{Emoji}(?:\uFE0F)?$/u.test(v);
        } catch {
            return v.trim().length <= 2;
        }
    };

    // Parse custom emoji string and find matching emoji data
    const parseCustomEmoji = (emojiStr: string) => {
        const match = emojiStr.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
        if (!match) return null;
        const [, animated, name, id] = match;
        return { animated: !!animated, name, id };
    };

    // Get URL for custom emoji preview
    const getCustomEmojiUrl = (emojiStr: string) => {
        const parsed = parseCustomEmoji(emojiStr);
        if (!parsed) return null;
        return guildEmojis.find(e => e.id === parsed.id)?.url || null;
    };

    const handleEmojiSelect = (emoji: string) => {
        onChange(emoji);
        setIsOpen(false);
    };

    useEffect(() => {
        // fetch guild emojis when opened (if guildId provided)
        let cancelled = false;
        async function loadGuildEmojis() {
            if (!guildId) return;
            setLoadingGuildEmojis(true);
            try {
                const res = await fetchGuildEmojis(guildId as string);
                if (!cancelled) {
                    setGuildEmojis(res.emojis || []);
                }
            } catch (err) {
                // ignore failures silently
                console.warn('Failed to load guild emojis', err);
            } finally {
                if (!cancelled) setLoadingGuildEmojis(false);
            }
        }

        // Load guild emojis when picker opens OR when value is a custom emoji (for preview display)
        if (isOpen || parseCustomEmoji(value)) {
            loadGuildEmojis();
        }

        return () => { cancelled = true; };
    }, [isOpen, guildId, value]);

    const filteredEmojis = EMOJI_PICKER_EMOJIS.filter(emoji => {
        if (!searchQuery) return true;
        // 簡単な検索（複雑な検索ロジックは省略）
        return emoji.includes(searchQuery);
    });

    const filteredGuildEmojis = guildEmojis.filter(e => {
        if (!searchQuery) return true;
        return (e.name || '').toLowerCase().includes(searchQuery.toLowerCase());
    });

    return (
        <div className={styles.emojiPickerContainer}>
            <div className={styles.emojiDisplay}>
                <button
                    className={styles.previewBtn}
                    onClick={() => setIsOpen(!isOpen)}
                    type="button"
                    title="クリックして絵文字ピッカーを開く"
                >
                    <span className={styles.emoji}>
                        {(() => {
                            const customEmojiUrl = getCustomEmojiUrl(value);
                            if (customEmojiUrl) {
                                return <img src={customEmojiUrl} alt="selected emoji" className={styles.customEmojiPreview} />;
                            }
                            return value || '😊';
                        })()}
                    </span>
                </button>
                <input
                    type="text"
                    placeholder="直接入力: 😀 または :emoji_name:"
                    value={isSingleEmoji(value) ? '' : value}
                    onChange={e => onChange(e.target.value)}
                    className={styles.input}
                />
            </div>

            {isOpen && (
                <div className={styles.pickerOverlay} onClick={() => setIsOpen(false)}>
                    <div className={styles.pickerPanel} onClick={e => e.stopPropagation()}>
                        <div className={styles.pickerHeader}>
                            <h4>絵文字を選択</h4>
                            <button
                                className={styles.closeBtn}
                                onClick={() => setIsOpen(false)}
                                type="button"
                            >
                                <span className="material-icons">close</span>
                            </button>
                        </div>

                        <div className={styles.searchContainer}>
                            <input
                                type="text"
                                placeholder="絵文字を検索..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className={styles.searchInput}
                                autoFocus
                            />
                        </div>

                        <div className={styles.emojiGrid}>
                            {/* Guild custom emojis first (images) */}
                            {loadingGuildEmojis ? (
                                <div className={styles.loading}>読み込み中...</div>
                            ) : (
                                filteredGuildEmojis.map((ge) => (
                                    <button
                                        key={ge.id}
                                        className={`${styles.emojiBtn} ${value === `<${ge.animated ? 'a' : ''}:${ge.name}:${ge.id}>` ? styles.selected : ''}`}
                                        onClick={() => handleEmojiSelect(`<${ge.animated ? 'a' : ''}:${ge.name}:${ge.id}>`)}
                                        type="button"
                                        title={ge.name || ''}
                                    >
                                        <img src={ge.url} alt={ge.name || 'emoji'} className={styles.customEmojiImg} />
                                    </button>
                                ))
                            )}

                            {/* Unicode emojis */}
                            {filteredEmojis.length > 0 ? (
                                filteredEmojis.map((emoji, index) => (
                                    <button
                                        key={`u-${index}`}
                                        className={`${styles.emojiBtn} ${value === emoji ? styles.selected : ''}`}
                                        onClick={() => handleEmojiSelect(emoji)}
                                        type="button"
                                        title={emoji}
                                    >
                                        {emoji}
                                    </button>
                                ))
                            ) : (
                                <div className={styles.noResults}>
                                    <p>絵文字が見つかりません</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EmojiPicker;
