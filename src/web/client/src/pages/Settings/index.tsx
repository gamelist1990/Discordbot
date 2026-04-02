import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PermissionsTab from '../../components/Tabs/PermissionsTab';
import { fetchGuildInfo, fetchSettings, saveSettings } from '../../services/api';
import type { GuildInfo, GuildSettings } from '../../types';
import styles from './SettingsPage.module.css';

interface ManagementSurface {
  title: string;
  description: string;
  icon: string;
  actionLabel: string;
  onClick: () => void;
}

function formatUpdatedAt(timestamp: number): string {
  if (!timestamp) {
    return '未保存';
  }

  return new Date(timestamp).toLocaleString('ja-JP');
}

const SettingsPage: React.FC = () => {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guildInfo, setGuildInfo] = useState<GuildInfo | null>(null);
  const [settings, setSettings] = useState<GuildSettings | null>(null);

  useEffect(() => {
    if (!guildId) {
      navigate('/404');
      return;
    }

    const initialize = async () => {
      try {
        const [guild, currentSettings] = await Promise.all([
          fetchGuildInfo(guildId),
          fetchSettings(guildId),
        ]);

        setGuildInfo(guild);
        setSettings(currentSettings);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : '初期化に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, [guildId, navigate]);

  const handleSaveSettings = async (newSettings: Partial<GuildSettings>) => {
    if (!guildId || !settings) {
      return;
    }

    try {
      const updated = { ...settings, ...newSettings };
      await saveSettings(guildId, updated);
      setSettings(updated);
      try {
        (window as any).web?.notify?.('設定を保存しました', 'success', '設定保存', 4000);
      } catch {
        // noop
      }
    } catch (saveError) {
      try {
        (window as any).web?.notify?.('設定の保存に失敗しました', 'error', '保存エラー', 4000);
      } catch {
        // noop
      }
      console.error(saveError);
    }
  };

  const roleMap = useMemo(() => {
    return new Map((guildInfo?.roles || []).map((role) => [role.id, role.name]));
  }, [guildInfo]);

  const staffRoleName = settings?.staffRoleId ? roleMap.get(settings.staffRoleId) || settings.staffRoleId : '未設定';
  const webAuthRoleName = settings?.webAuthRoleId ? roleMap.get(settings.webAuthRoleId) || settings.webAuthRoleId : '未設定';

  const managementSurfaces = useMemo<ManagementSurface[]>(() => {
    if (!guildId) {
      return [];
    }

    return [
      {
        title: '権限ロール',
        description: 'スタッフ権限と WEB 認証ロールの割り当てを見直します。',
        icon: 'admin_panel_settings',
        actionLabel: '権限設定へ',
        onClick: () => {
          document.getElementById('permissions-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      },
      {
        title: 'ロール管理',
        description: 'ロールプリセットとパネル投稿をこのサーバー前提で開きます。',
        icon: 'style',
        actionLabel: 'ロール管理を開く',
        onClick: () => navigate(`/staff/rolemanager?guildId=${guildId}&returnTo=${encodeURIComponent(`/settings/${guildId}`)}`),
      },
      {
        title: 'Core パネル',
        description: '性格診断・レスバ・観戦設定をこのサーバー向けにまとめて管理します。',
        icon: 'dashboard',
        actionLabel: 'Core パネルを開く',
        onClick: () => navigate(`/staff/corepanel?guildId=${guildId}&returnTo=${encodeURIComponent(`/settings/${guildId}`)}`),
      },
      {
        title: 'Request 管理',
        description: 'ユーザーリクエスト機能の設定を管理します。カテゴリ名、ラベル、説明文をカスタマイズできます。',
        icon: 'assignment',
        actionLabel: 'Request 管理を開く',
        onClick: () => navigate(`/staff/requestmanager?guildId=${guildId}&returnTo=${encodeURIComponent(`/settings/${guildId}`)}`),
      },
      {
        title: 'AntiCheat',
        description: '検知ルール、スコア、処罰、ログ出力をサーバー単位で調整します。',
        icon: 'shield',
        actionLabel: 'AntiCheat を開く',
        onClick: () => navigate(`/staff/anticheat/${guildId}`),
      },
      {
        title: 'スタッフ運用',
        description: 'スタッフ共通コマンドと他の運用サービスへ移動します。',
        icon: 'dashboard_customize',
        actionLabel: 'スタッフ面を開く',
        onClick: () => navigate('/staff'),
      },
    ];
  }, [guildId, navigate]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.statePanel}>サーバー管理面を準備しています...</div>
      </div>
    );
  }

  if (error || !guildInfo || !settings) {
    return (
      <div className={styles.page}>
        <div className={styles.statePanel}>
          <h2>エラー</h2>
          <p>{error || 'データの読み込みに失敗しました'}</p>
          <button className={styles.secondaryButton} onClick={() => navigate('/settings')} type="button">
            一覧へ戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <section className={styles.pageHeader}>
        <div className={styles.pageHeaderCopy}>
          <span className={styles.pageEyebrow}>Server Management</span>
          <h1>{guildInfo.name}</h1>
          <p>このサーバーに必要な管理面だけを集約した、専用の運用ハブです。</p>
        </div>

        <div className={styles.pageHeaderActions}>
          <button className={styles.secondaryButton} onClick={() => navigate('/settings')} type="button">
            <span className="material-icons">arrow_back</span>
            <span>サーバー一覧</span>
          </button>
          <button className={styles.primaryButton} onClick={() => navigate(`/staff/anticheat/${guildId}`)} type="button">
            <span className="material-icons">shield</span>
            <span>AntiCheat を開く</span>
          </button>
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Roles</span>
            <strong>{guildInfo.roles.length}</strong>
            <p>読み込み済みのロール数です。</p>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Staff role</span>
            <strong>{staffRoleName}</strong>
            <p>スタッフ面へ入れる現在の割り当てです。</p>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Web auth</span>
            <strong>{webAuthRoleName}</strong>
            <p>認証完了時に付与するロールです。</p>
          </div>
        </div>
      </section>

      <div>
        <section className={styles.identityBar}>
          <div className={styles.guildIdentity}>
            <div className={styles.guildIcon}>
              {guildInfo.iconURL ? (
                <img src={guildInfo.iconURL} alt={guildInfo.name} />
              ) : (
                <span>{guildInfo.name.charAt(0).toUpperCase()}</span>
              )}
            </div>

            <div className={styles.guildCopy}>
              <span className={styles.identityLabel}>Target Guild</span>
              <h2>{guildInfo.name}</h2>
              <p>ID {guildInfo.id}</p>
            </div>
          </div>

          <div className={styles.identityMeta}>
            <div className={styles.metaBlock}>
              <span>最終保存</span>
              <strong>{formatUpdatedAt(settings.updatedAt)}</strong>
            </div>
            <div className={styles.metaBlock}>
              <span>権限状態</span>
              <strong>{settings.staffRoleId || settings.webAuthRoleId ? '設定済み' : '未設定'}</strong>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Workspace</span>
              <h2>運用面をここから開く</h2>
            </div>
            <p>このサーバーを前提にした設定面へ、そのまま遷移できます。</p>
          </div>

          <div className={styles.surfaceGrid}>
            {managementSurfaces.map((surface) => (
              <button key={surface.title} className={styles.surfaceCard} onClick={surface.onClick} type="button">
                <span className={styles.surfaceIcon}>
                  <span className="material-icons">{surface.icon}</span>
                </span>
                <div className={styles.surfaceBody}>
                  <strong>{surface.title}</strong>
                  <p>{surface.description}</p>
                </div>
                <span className={styles.surfaceAction}>{surface.actionLabel}</span>
              </button>
            ))}
          </div>
        </section>

        <section className={styles.section} id="permissions-section">
          <PermissionsTab settings={settings} roles={guildInfo.roles} onSave={handleSaveSettings} />
        </section>
      </div>
    </div>
  );
};

export default SettingsPage;
