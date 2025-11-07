import React, { useState } from 'react';
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
    <div className={styles.stickerPicker}>
      <div className={styles.stickerPickerHeader}>
        <h3>ステッカー・画像を選択</h3>
      </div>

      <div className={styles.stickerPickerBody}>
        <div className={styles.formGroup}>
          <label>画像URL</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com/image.png"
              style={{ flex: 1 }}
            />
            <button onClick={handleUseUrl} className={styles.button}>
              使用
            </button>
          </div>
        </div>

        <div className={styles.formGroup}>
          <label>ギルド絵文字を検索</label>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="絵文字名で検索..."
          />
        </div>

        <div className={styles.emojiList}>
          {filteredGuilds.map((guild) => (
            <div key={guild.guildId} className={styles.emojiGuild}>
              <button
                className={styles.emojiGuildHeader}
                onClick={() => toggleGuild(guild.guildId)}
              >
                <span className="material-icons">
                  {expandedGuilds.has(guild.guildId)
                    ? 'expand_more'
                    : 'chevron_right'}
                </span>
                <span>{guild.guildName}</span>
                <span className={styles.emojiCount}>
                  ({guild.emojis.length})
                </span>
              </button>

              {expandedGuilds.has(guild.guildId) && (
                <div className={styles.emojiGrid}>
                  {guild.emojis.map((emoji) => (
                    <button
                      key={emoji.id}
                      className={styles.emojiButton}
                      onClick={() => onPick(emoji.url)}
                      title={emoji.name}
                    >
                      <img src={emoji.url} alt={emoji.name} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {filteredGuilds.length === 0 && (
          <div className={styles.emptyState}>
            <p>絵文字が見つかりませんでした</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default StickerPicker;
