import { useId, useState } from 'react';
import styles from './ContentSafetyControls.module.css';

export function SettingSwitch({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void;
}) {
  return <div className={styles.controlPanel}>
    <button type="button" className={styles.switchButton} role="switch" aria-label={label}
      aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className={styles.switchLabel}>{label}</span>
      <span className={styles.switchState} aria-hidden="true">{checked ? 'ON' : 'OFF'}</span>
      <span className={styles.track} aria-hidden="true"><span /></span>
    </button>
  </div>;
}

export function ContentSafetyControls({ action, disabled, onChange, guildId }: {
  action: string; disabled: boolean; onChange: (action: string) => void; guildId?: string;
}) {
  const id = useId();
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState('');
  const clearCache = async () => {
    setClearing(true); setNotice('');
    try {
      const response = await fetch(`/api/staff/anticheat/${encodeURIComponent(guildId!)}/content-cache/clear`, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('キャッシュを削除できませんでした。');
      const result = await response.json();
      setNotice(`${result.removed}件の判定キャッシュを削除しました。次回は再判定します。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'キャッシュ削除に失敗しました。'); }
    finally { setClearing(false); }
  };
  return <div className={styles.controlPanel}>
    <fieldset className={styles.modeGroup} disabled={disabled}>
      <legend>検知した投稿の扱い</legend>
      <div className={styles.modeOptions}>
        {[
          { value: 'spoiler', title: 'ネタバレで代理投稿', description: '投稿者と警告を表示し、本文・画像を隠して残します。' },
          { value: 'delete', title: '投稿を削除', description: '元投稿を削除します。代理投稿はせず、検知ログに記録します。' }
        ].map(option => <label className={styles.modeCard} key={option.value} data-selected={action === option.value} data-danger={option.value === 'delete'}>
          <input type="radio" name={id} value={option.value} checked={action === option.value}
            onChange={() => onChange(option.value)} />
          <span><strong>{option.title}</strong><small>{option.description}</small></span>
        </label>)}
      </div>
      <p className={styles.modeHelp}>{action === 'delete'
        ? '誤検知でも元投稿は削除されます。この設定を保存すると適用されます。'
        : '代理投稿に失敗した場合は元投稿を残します。'} スコア加算は初期OFFです。</p>
    </fieldset>
    {guildId && <div className={styles.cacheControls}>
      <button type="button" className={styles.switchButton} disabled={clearing} onClick={clearCache}>
        {clearing ? 'キャッシュを削除中…' : 'このサーバーの判定キャッシュを削除'}
      </button>
      <small>完全一致・類似一致の判定を消去します。保存前でもすぐに反映されます。</small>
      <p role="status" aria-live="polite">{notice}</p>
    </div>}
  </div>;
}
