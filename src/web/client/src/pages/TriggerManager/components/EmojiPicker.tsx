import React, { useState } from 'react';
import { EMOJI_PICKER_EMOJIS } from '../utils/placeholders.js';
import styles from './EmojiPicker.module.css';

interface EmojiPickerProps {
    value: string;
    onChange: (emoji: string) => void;
}

const EmojiPicker: React.FC<EmojiPickerProps> = ({ value, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const handleEmojiSelect = (emoji: string) => {
        onChange(emoji);
        setIsOpen(false);
    };

    const filteredEmojis = EMOJI_PICKER_EMOJIS.filter(emoji => {
        if (!searchQuery) return true;
        // 簡単な検索（複雑な検索ロジックは省略）
        return emoji.includes(searchQuery);
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
                    <span className={styles.emoji}>{value || '😊'}</span>
                </button>
                <input
                    type="text"
                    placeholder="直接入力: 😀 または :emoji_name:"
                    value={value}
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
                            {filteredEmojis.length > 0 ? (
                                filteredEmojis.map((emoji, index) => (
                                    <button
                                        key={index}
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
