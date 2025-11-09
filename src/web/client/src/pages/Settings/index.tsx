import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout/Layout';
import PermissionsTab from '../../components/Tabs/PermissionsTab';
import { fetchGuildInfo, fetchSettings, saveSettings } from '../../services/api';
import type { GuildInfo, GuildSettings } from '../../types';
import styles from './SettingsPage.module.css';


const SettingsPage: React.FC = () => {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guildInfo, setGuildInfo] = useState<GuildInfo | null>(null);
  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [activeTab, setActiveTab] = useState('permissions');

  useEffect(() => {
    if (!guildId) {
      navigate('/404');
      return;
    }

    const initialize = async () => {
      try {
        // ギルド情報取得
        const guild = await fetchGuildInfo(guildId);
        setGuildInfo(guild);

        // 設定取得
        const currentSettings = await fetchSettings(guildId);
        setSettings(currentSettings);

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : '初期化に失敗しました');
        setLoading(false);
      }
    };

    initialize();
  }, [guildId, navigate]);

  const handleSaveSettings = async (newSettings: Partial<GuildSettings>) => {
    if (!guildId || !settings) return;

    try {
      const updated = { ...settings, ...newSettings };
      await saveSettings(guildId, updated);
      setSettings(updated);
      try { (window as any).web?.notify?.('設定を保存しました', 'success', '設定保存', 4000); } catch {}
    } catch (err) {
      try { (window as any).web?.notify?.('設定の保存に失敗しました', 'error', '保存エラー', 4000); } catch {}
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>読み込み中...</p>
      </div>
    );
  }

  if (error || !guildInfo || !settings) {
    return (
      <div className={styles.error}>
        <h2>エラー</h2>
        <p>{error || 'データの読み込みに失敗しました'}</p>
      </div>
    );
  }

  return (
    <Layout guildInfo={guildInfo} activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'permissions' && (
        <PermissionsTab
          settings={settings}
          roles={guildInfo.roles}
          onSave={handleSaveSettings}
        />
      )}
      {activeTab === 'general' && (
        <div className={styles.comingSoon}>
          <div className={styles.comingSoonIcon}>🚧</div>
          <h2>一般設定</h2>
          <p>この機能は近日公開予定です</p>
          <span className={styles.comingSoonText}>Coming Soon</span>
        </div>
      )}
      {activeTab === 'moderation' && (
        <div className={styles.comingSoon}>
          <div className={styles.comingSoonIcon}>🛡️</div>
          <h2>モデレーション</h2>
          <p>この機能は近日公開予定です</p>
          <span className={styles.comingSoonText}>Coming Soon</span>
        </div>
      )}
    </Layout>
  );
};

export default SettingsPage;
