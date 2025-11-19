import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './ProfileSettings.module.css';

interface GuildEmoji {
  guildId: string;
  guildName: string;
  emojis: Array<{
    id: string;
    name?: string;
    url: string;
  }>;
}

interface StickerPickerProps {
  guildEmojis: GuildEmoji[];
  onPick: (value: string) => void;
}

const StickerPicker: React.FC<StickerPickerProps> = ({
  guildEmojis,
  onPick,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [expandedGuilds, setExpandedGuilds] = useState<Set<string>>(new Set());

  const toggleGuild = (guildId: string) => {
    const newExpanded = new Set(expandedGuilds);
    if (newExpanded.has(guildId)) {
      newExpanded.delete(guildId);
    } else {
      newExpanded.add(guildId);
    }
    setExpandedGuilds(newExpanded);
  };

  const filteredGuilds = guildEmojis.map((guild) => ({
    ...guild,
    emojis: guild.emojis.filter((emoji) =>
      (emoji.name || '').toLowerCase().includes(searchTerm.toLowerCase())
    ),
  })).filter((guild) => guild.emojis.length > 0);

  const handleUseUrl = () => {
    if (urlInput.trim()) {
      onPick(urlInput.trim());
      setUrlInput('');
    }
  };

  return (
    <motion.div 
        className={styles.stickerPickerOverlay}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
    >
      <motion.div 
        className={styles.stickerPicker}
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        <div className={styles.stickerPickerHeader}>
          <h3>ステッカー・画像を選択</h3>
          <button onClick={() => onPick('')} className={styles.closeButton}>
            <span className="material-icons">close</span>
          </button>
        </div>

        <div className={styles.stickerPickerBody}>
          <div className={styles.formGroup}>
            <label>画像URLから追加</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                className={styles.input}
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com/image.png"
                style={{ flex: 1 }}
              />
              <button onClick={handleUseUrl} className={styles.save} style={{padding:'0 16px', height:40}}>
                使用
              </button>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label>サーバー絵文字から選択</label>
            <div className={styles.searchBox}>
                <span className="material-icons">search</span>
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="絵文字を検索..."
                />
            </div>
          </div>

          <div className={styles.emojiList}>
            {filteredGuilds.map((guild) => (
              <div key={guild.guildId} className={styles.emojiGuild}>
                <button
                  className={styles.emojiGuildHeader}
                  onClick={() => toggleGuild(guild.guildId)}
                >
                  <span className="material-icons" style={{
                      transform: expandedGuilds.has(guild.guildId) ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s'
                  }}>
                    chevron_right
                  </span>
                  <span style={{fontWeight:600}}>{guild.guildName}</span>
                  <span className={styles.emojiCount}>
                    {guild.emojis.length}
                  </span>
                </button>

                <AnimatePresence>
                    {expandedGuilds.has(guild.guildId) && (
                    <motion.div 
                        className={styles.emojiGrid}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        {guild.emojis.map((emoji) => (
                        <motion.button
                            key={emoji.id}
                            className={styles.emojiButton}
                            onClick={() => onPick(emoji.url)}
                            title={emoji.name}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                        >
                            <img src={emoji.url} alt={emoji.name} loading="lazy" />
                        </motion.button>
                        ))}
                    </motion.div>
                    )}
                </AnimatePresence>
              </div>
            ))}
            
            {filteredGuilds.length === 0 && (
                <div className={styles.emptyState}>
                    <span className="material-icons" style={{fontSize:48, opacity:0.3, marginBottom:16}}>sentiment_dissatisfied</span>
                    <p>絵文字が見つかりませんでした</p>
                </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default StickerPicker;
