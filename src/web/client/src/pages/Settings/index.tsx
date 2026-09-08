import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PermissionsTab from "../../components/Tabs/PermissionsTab";
import {
  fetchGuildInfo,
  fetchSettings,
  saveSettings,
} from "../../services/api";
import type { GuildInfo, GuildSettings } from "../../types";
import styles from "./SettingsPage.module.css";

interface ManagementSurface {
  title: string;
  description: string;
  icon: string;
  actionLabel: string;
  onClick: () => void;
}

function formatUpdatedAt(timestamp: number): string {
  if (!timestamp) {
    return "未保存";
  }

  return new Date(timestamp).toLocaleString("ja-JP");
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
      navigate("/404");
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
        setError(
          loadError instanceof Error
            ? loadError.message
            : "初期化に失敗しました",
        );
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
        (window as any).web?.notify?.(
          "設定を保存しました",
          "success",
          "設定保存",
          4000,
        );
      } catch {
        // noop
      }
    } catch (saveError) {
      try {
        (window as any).web?.notify?.(
          "設定の保存に失敗しました",
          "error",
          "保存エラー",
          4000,
        );
      } catch {
        // noop
      }
      console.error(saveError);
    }
  };

  const roleMap = useMemo(() => {
    return new Map(
      (guildInfo?.roles || []).map((role) => [role.id, role.name]),
    );
  }, [guildInfo]);

  const staffRoleName = settings?.staffRoleId
    ? roleMap.get(settings.staffRoleId) || settings.staffRoleId
    : "未設定";
  const webAuthRoleName = settings?.webAuthRoleId
    ? roleMap.get(settings.webAuthRoleId) || settings.webAuthRoleId
    : "未設定";

  const managementSurfaces = useMemo<ManagementSurface[]>(() => {
    if (!guildId) {
      return [];
    }

    return [
      {
        title: "権限ロール",
        description: "スタッフ・認証用ロールを選択。",
        icon: "admin_panel_settings",
        actionLabel: "権限設定へ",
        onClick: () => {
          document
            .getElementById("permissions-section")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        },
      },
      {
        title: "ロール管理",
        description: "プリセットとロールパネルを管理。",
        icon: "style",
        actionLabel: "ロール管理を開く",
        onClick: () =>
          navigate(
            `/staff/rolemanager?guildId=${guildId}&returnTo=${encodeURIComponent(`/settings/${guildId}`)}`,
          ),
      },
      {
        title: "Core パネル",
        description: "性格診断・レスバ・観戦パネルの設定。",
        icon: "dashboard",
        actionLabel: "Core パネルを開く",
        onClick: () =>
          navigate(
            `/staff/corepanel?guildId=${guildId}&returnTo=${encodeURIComponent(`/settings/${guildId}`)}`,
          ),
      },
      {
        title: "Request 管理",
        description: "リクエストのカテゴリと説明文を編集。",
        icon: "assignment",
        actionLabel: "Request 管理を開く",
        onClick: () =>
          navigate(
            `/staff/corepanel?guildId=${guildId}&returnTo=${encodeURIComponent(`/settings/${guildId}`)}`,
          ),
      },
      {
        title: "AntiCheat",
        description: "検知ルール・自動処罰・ログを設定。",
        icon: "shield",
        actionLabel: "AntiCheat を開く",
        onClick: () => navigate(`/staff/anticheat/${guildId}`),
      },
      {
        title: "スタッフ運用",
        description: "運営ツールとコマンド一覧。",
        icon: "dashboard_customize",
        actionLabel: "スタッフ面を開く",
        onClick: () => navigate("/staff"),
      },
    ];
  }, [guildId, navigate]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.statePanel}>
          サーバー管理面を準備しています...
        </div>
      </div>
    );
  }

  if (error || !guildInfo || !settings) {
    return (
      <div className={styles.page}>
        <div className={styles.statePanel}>
          <h2>エラー</h2>
          <p>{error || "データの読み込みに失敗しました"}</p>
          <button
            className={styles.secondaryButton}
            onClick={() => navigate("/settings")}
            type="button"
          >
            一覧へ戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="パンくずリスト">
        <button onClick={() => navigate("/settings")} type="button">
          サーバー管理
        </button>
        <span aria-hidden="true">/</span>
        <span>{guildInfo.name}</span>
      </nav>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.pageEyebrow}>SERVER SETTINGS</span>
          <h1>サーバー設定</h1>
          <p>権限の割り当てと、サーバーの運用設定。</p>
        </div>
        <span className={styles.savedAt}>
          最終保存 {formatUpdatedAt(settings.updatedAt)}
        </span>
      </header>
      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.guildIdentity}>
            <div className={styles.guildIcon}>
              {guildInfo.iconURL ? (
                <img src={guildInfo.iconURL} alt="" />
              ) : (
                guildInfo.name.charAt(0)
              )}
            </div>
            <div className={styles.guildCopy}>
              <strong>{guildInfo.name}</strong>
              <span>{guildInfo.roles.length} ロール</span>
            </div>
          </div>
          <nav className={styles.sectionNav} aria-label="サーバー設定の項目">
            <a href="#permissions-section">
              <span className="material-icons" aria-hidden="true">
                admin_panel_settings
              </span>
              権限ロール
            </a>
            <a href="#server-tools">
              <span className="material-icons" aria-hidden="true">
                grid_view
              </span>
              管理ツール
            </a>
            <button
              type="button"
              onClick={() => navigate(`/staff/anticheat/${guildId}`)}
            >
              <span className="material-icons" aria-hidden="true">
                shield
              </span>
              AntiCheat
              <span className={styles.external} aria-hidden="true">
                ↗
              </span>
            </button>
          </nav>
          <div className={styles.sidebarMeta}>
            <span>現在の設定</span>
            <dl>
              <dt>スタッフ</dt>
              <dd>{staffRoleName}</dd>
              <dt>WEB認証</dt>
              <dd>{webAuthRoleName}</dd>
            </dl>
          </div>
          <p className={styles.guildId}>
            サーバーID
            <br />
            {guildInfo.id}
          </p>
          <button
            className={styles.switchServer}
            onClick={() => navigate("/settings")}
            type="button"
          >
            <span className="material-icons" aria-hidden="true">
              swap_horiz
            </span>
            サーバーを切り替え
          </button>
        </aside>
        <div className={styles.workspaceBody}>
          <section id="permissions-section" className={styles.permissions}>
            <PermissionsTab
              settings={settings}
              roles={guildInfo.roles}
              onSave={handleSaveSettings}
            />
          </section>
          <section id="server-tools" className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>管理ツール</h2>
                <p>このサーバーの各機能を設定します。</p>
              </div>
              <span>{managementSurfaces.length} TOOLS</span>
            </div>
            <div className={styles.surfaceGrid}>
              {managementSurfaces.map((surface) => (
                <button
                  key={surface.title}
                  className={styles.surfaceCard}
                  onClick={surface.onClick}
                  type="button"
                >
                  <span
                    className={`material-icons ${styles.surfaceIcon}`}
                    aria-hidden="true"
                  >
                    {surface.icon}
                  </span>
                  <div className={styles.surfaceBody}>
                    <strong>{surface.title}</strong>
                    <p>{surface.description}</p>
                  </div>
                  <span className={styles.surfaceAction} aria-hidden="true">
                    ↗
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
export default SettingsPage;
