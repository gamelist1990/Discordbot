import React, { useEffect, useMemo, useState } from 'react';
import type { GuildSettings, Role } from '../../types';
import styles from './PermissionsTab.module.css';

interface PermissionsTabProps {
  settings: GuildSettings;
  roles: Role[];
  onSave: (newSettings: Partial<GuildSettings>) => Promise<void>;
}

const PermissionsTab: React.FC<PermissionsTabProps> = ({ settings, roles, onSave }) => {
  const [staffRoleId, setStaffRoleId] = useState(settings.staffRoleId || '');
  const [webAuthRoleId, setWebAuthRoleId] = useState(settings.webAuthRoleId || '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setStaffRoleId(settings.staffRoleId || '');
    setWebAuthRoleId(settings.webAuthRoleId || '');
  }, [settings.staffRoleId, settings.webAuthRoleId]);

  const sortedRoles = useMemo(
    () => (Array.isArray(roles) ? [...roles].sort((left, right) => right.position - left.position) : []),
    [roles]
  );

  const selectedStaffRole = sortedRoles.find((role) => role.id === staffRoleId);
  const selectedWebAuthRole = sortedRoles.find((role) => role.id === webAuthRoleId);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        staffRoleId: staffRoleId || undefined,
        webAuthRoleId: webAuthRoleId || undefined,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className={styles.container}>
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Permissions</span>
          <h2>権限ロール</h2>
          <p>スタッフ権限と WEB 認証付与ロールだけをここで管理します。</p>
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <span>スタッフ</span>
            <strong>{selectedStaffRole?.name || '未設定'}</strong>
          </div>
          <div className={styles.summaryRow}>
            <span>WEB 認証</span>
            <strong>{selectedWebAuthRole?.name || '未設定'}</strong>
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        <label className={styles.field}>
          <span className={styles.label}>スタッフロール</span>
          <span className={styles.help}>モデレーション面へ入れるロールを選択します。</span>
          <select
            className={styles.select}
            value={staffRoleId}
            onChange={(event) => setStaffRoleId(event.target.value)}
          >
            <option value="">未設定</option>
            {sortedRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>WEB認証ロール</span>
          <span className={styles.help}>認証完了時に自動付与するロールを選択します。</span>
          <select
            className={styles.select}
            value={webAuthRoleId}
            onChange={(event) => setWebAuthRoleId(event.target.value)}
          >
            <option value="">未設定</option>
            {sortedRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.actions}>
        <p className={styles.footnote}>
          管理者ロールはサーバー側の権限構造に従うため、この画面では明示設定しません。
        </p>
        <button className={styles.saveButton} onClick={handleSave} disabled={isSaving} type="button">
          <span className="material-icons">{isSaving ? 'sync' : 'save'}</span>
          <span>{isSaving ? '保存中...' : '権限設定を保存'}</span>
        </button>
      </div>
    </section>
  );
};

export default PermissionsTab;
