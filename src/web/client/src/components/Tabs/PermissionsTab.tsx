import React, { useState } from 'react';
import type { GuildSettings, Role } from '../../types';
import styles from './PermissionsTab.module.css';

interface PermissionsTabProps {
  settings: GuildSettings;
  roles: Role[];
  onSave: (newSettings: Partial<GuildSettings>) => Promise<void>;
}

const PermissionsTab: React.FC<PermissionsTabProps> = ({ settings, roles, onSave }) => {
  const [staffRoleId, setStaffRoleId] = useState(settings.staffRoleId || '');
  const [adminRoleId, setAdminRoleId] = useState(settings.adminRoleId || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        staffRoleId: staffRoleId || undefined,
        adminRoleId: adminRoleId || undefined,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // ロールを position で降順ソート
  const sortedRoles = [...roles].sort((a, b) => b.position - a.position);

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>権限設定</h2>
      <p className={styles.description}>
        サーバーの権限ロールを設定します。スタッフロールと管理者ロールを選択してください。
      </p>

      <div className={styles.section}>
        <label className={styles.label}>
          <span className={styles.labelText}>スタッフロール</span>
          <span className={styles.labelDescription}>
            一般的なモデレーション権限を持つロール
          </span>
        </label>
        <select
          className={styles.select}
          value={staffRoleId}
          onChange={(e) => setStaffRoleId(e.target.value)}
        >
          <option value="">-- 選択なし --</option>
          {sortedRoles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>
          <span className={styles.labelText}>管理者ロール</span>
          <span className={styles.labelDescription}>
            すべての設定変更権限を持つロール
          </span>
        </label>
        <select
          className={styles.select}
          value={adminRoleId}
          onChange={(e) => setAdminRoleId(e.target.value)}
        >
          <option value="">-- 選択なし --</option>
          {sortedRoles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.saveButton}
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? '保存中...' : '設定を保存'}
        </button>
      </div>
    </div>
  );
};

export default PermissionsTab;
