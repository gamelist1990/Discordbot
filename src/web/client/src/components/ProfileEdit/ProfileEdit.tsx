import React, { useState } from 'react';
import styles from './ProfileEdit.module.css';
import { updateCustomProfile } from '../../services/api';

interface Props {
  initial?: any;
  onClose: () => void;
  onSaved: (newProfile: any) => void;
}

const ProfileEdit: React.FC<Props> = ({ initial = {}, onClose, onSaved }) => {
  const [displayName, setDisplayName] = useState(initial.displayName || '');
  const [bio, setBio] = useState(initial.bio || '');
  const [pronouns, setPronouns] = useState(initial.pronouns || '');
  const [location, setLocation] = useState(initial.location || '');
  const [website, setWebsite] = useState(initial.website || '');
  const [bannerType, setBannerType] = useState(initial.banner?.type || 'color');
  const [bannerValue, setBannerValue] = useState(initial.banner?.value || '#1DA1F2');
  const [favoriteEmojis, setFavoriteEmojis] = useState((initial.favoriteEmojis || []).map((e: any) => e.emoji).join(' ') );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = () => {
    if (displayName.length > 32) return '表示名は32文字以内にしてください';
    if (bio.length > 500) return 'バイオは500文字以内にしてください';
    if (location.length > 100) return '場所は100文字以内にしてください';
    if (website && !/^https?:\/\//.test(website)) return 'ウェブサイトURLは http(s):// で始めてください';
    return null;
  };

  const handleSave = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    setError(null);
    const payload: any = {
      displayName: displayName || undefined,
      bio: bio || undefined,
      pronouns: pronouns || undefined,
      location: location || undefined,
      website: website || undefined,
      banner: {
        type: bannerType,
        value: bannerValue
      },
      favoriteEmojis: favoriteEmojis.trim() ? favoriteEmojis.split(/\s+/).slice(0,10).map((e: string) => ({ emoji: e })) : []
    };

    try {
      const resp = await updateCustomProfile(payload);
      // API は新しいカスタムプロフィールを返す想定
      onSaved(resp);
      onClose();
    } catch (err: any) {
      setError(err?.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>プロフィールを編集</div>
          <div>
            <button className={styles.ghost} onClick={onClose} aria-label="閉じる">閉じる</button>
          </div>
        </div>

        <div className={styles.previewBanner} style={{ background: bannerType === 'color' ? bannerValue : `url(${bannerType === 'image' ? bannerValue : ''}) center/cover` }} />

        <div className={styles.formRow}>
          <div className={styles.field}>
            <label className={styles.label}>表示名</label>
            <input className={styles.input} value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={32} />
            <div className={styles.small}>{displayName.length}/32</div>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>代名詞</label>
            <input className={styles.input} value={pronouns} onChange={e => setPronouns(e.target.value)} placeholder="例: she/her" />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>バイオ</label>
          <textarea className={styles.textarea} value={bio} onChange={e => setBio(e.target.value)} maxLength={500} />
          <div className={styles.small}>{bio.length}/500</div>
        </div>

        <div className={styles.twoCol}>
          <div className={styles.field}>
            <label className={styles.label}>場所</label>
            <input className={styles.input} value={location} onChange={e => setLocation(e.target.value)} maxLength={100} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>ウェブサイト</label>
            <input className={styles.input} value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://example.com" />
          </div>
        </div>

        <div className={styles.formRow}>
          <div className={styles.field}>
            <label className={styles.label}>バナー種別</label>
            <select className={styles.select} value={bannerType} onChange={e => setBannerType(e.target.value)}>
              <option value="color">単色</option>
              <option value="image">画像URL</option>
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{bannerType === 'color' ? 'カラー (HEX)' : '画像 URL'}</label>
            <input className={styles.input} value={bannerValue} onChange={e => setBannerValue(e.target.value)} />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>お気に入り絵文字（スペース区切り、最大10）</label>
          <input className={`${styles.input} ${styles.emojiInput}`} value={favoriteEmojis} onChange={e => setFavoriteEmojis(e.target.value)} placeholder="💻 🎮" />
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <button className={styles.ghost} onClick={onClose} disabled={saving}>キャンセル</button>
          <button className={styles.primary} onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>
    </div>
  );
};

export default ProfileEdit;
