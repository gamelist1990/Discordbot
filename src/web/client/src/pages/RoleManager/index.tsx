import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAppToast } from "../../AppToastProvider";
import styles from "./RoleManager.module.css";

interface RolePreset {
  id: string;
  name: string;
  description: string;
  roles: string[];
  allowMulti: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

interface GuildRole {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
}

interface Guild {
  id: string;
  name: string;
  icon?: string | null;
}

const RoleManagerPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [accessibleGuilds, setAccessibleGuilds] = useState<Guild[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const [presets, setPresets] = useState<Record<string, RolePreset>>({});
  const [guildRoles, setGuildRoles] = useState<GuildRole[]>([]);
  const [roleSearch, setRoleSearch] = useState("");

  // Group roles by color
  const groupedRoles = useMemo(() => {
    const groups: Record<string, GuildRole[]> = { default: [] };

    guildRoles.forEach((role) => {
      if (role.color === 0) {
        groups.default.push(role);
      } else {
        const colorKey = `color-${role.color.toString(16).padStart(6, "0")}`;
        if (!groups[colorKey]) {
          groups[colorKey] = [];
        }
        groups[colorKey].push(role);
      }
    });

    // Sort roles within each group by position (descending)
    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => b.position - a.position);
    });

    return groups;
  }, [guildRoles]);

  // Filter roles based on search
  const filteredGroupedRoles = useMemo(() => {
    if (!roleSearch.trim()) return groupedRoles;

    const filtered: Record<string, GuildRole[]> = {};

    Object.entries(groupedRoles).forEach(([colorGroup, roles]) => {
      const filteredRoles = roles.filter((role) =>
        role.name.toLowerCase().includes(roleSearch.toLowerCase())
      );
      if (filteredRoles.length > 0) {
        filtered[colorGroup] = filteredRoles;
      }
    });

    return filtered;
  }, [groupedRoles, roleSearch]);

  const [showModal, setShowModal] = useState(false);
  const [editingPreset, setEditingPreset] = useState<RolePreset | null>(null);
  const [formData, setFormData] = useState({
    id: "",
    name: "",
    description: "",
    roles: [] as string[],
    allowMulti: true,
  });

  const { addToast } = (() => {
    try {
      return useAppToast();
    } catch {
      return { addToast: undefined } as any;
    }
  })();

  // Handle role toggle in form
  const handleRoleToggle = (roleId: string, checked: boolean) => {
    setFormData((prev) => ({
      ...prev,
      roles: checked
        ? [...prev.roles, roleId]
        : prev.roles.filter((id) => id !== roleId),
    }));
  };

  // Load accessible guilds
  useEffect(() => {
    const loadGuilds = async () => {
      try {
        const res = await fetch("/api/staff/guilds", {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          setAccessibleGuilds(data.guilds || []);
        }
      } catch (err) {
        console.error("Failed to load guilds:", err);
      } finally {
        setLoading(false);
      }
    };

    loadGuilds();
  }, []);

  // Load presets and roles when guild is selected
  useEffect(() => {
    if (!selectedGuildId) return;

    const loadGuildData = async () => {
      try {
        // Load presets
        const presetsRes = await fetch(
          `/api/staff/guilds/${selectedGuildId}/role-presets`,
          { credentials: "include" }
        );
        if (presetsRes.ok) {
          const data = await presetsRes.json();
          setPresets(data.presets || {});
        }

        // Load roles
        const rolesRes = await fetch(
          `/api/staff/guilds/${selectedGuildId}/roles`,
          { credentials: "include" }
        );
        if (rolesRes.ok) {
          const data = await rolesRes.json();
          setGuildRoles(data.roles || []);
        }
      } catch (err) {
        console.error("Failed to load guild data:", err);
        addToast?.("データの読み込みに失敗しました", "error");
      }
    };

    loadGuildData();
  }, [selectedGuildId]);

  // Handle create preset
  const handleCreatePreset = () => {
    setEditingPreset(null);
    setFormData({
      id: "",
      name: "",
      description: "",
      roles: [],
      allowMulti: true,
    });
    setShowModal(true);
  };

  // Handle edit preset
  const handleEditPreset = (preset: RolePreset) => {
    setEditingPreset(preset);
    setFormData({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      roles: preset.roles,
      allowMulti: preset.allowMulti,
    });
    setShowModal(true);
  };

  // Handle save preset
  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedGuildId) return;

    try {
      const method = editingPreset ? "PUT" : "POST";
      const url = editingPreset
        ? `/api/staff/guilds/${selectedGuildId}/role-presets/${formData.id}`
        : `/api/staff/guilds/${selectedGuildId}/role-presets`;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        const savedPreset = await res.json();
        setPresets((prev) => ({
          ...prev,
          [savedPreset.id]: savedPreset,
        }));
        setShowModal(false);
        addToast?.(
          editingPreset
            ? "プリセットを更新しました"
            : "プリセットを作成しました",
          "success"
        );
      } else {
        const error = await res.json();
        addToast?.(error.error || "保存に失敗しました", "error");
      }
    } catch (err) {
      console.error("Failed to save preset:", err);
      addToast?.("保存に失敗しました", "error");
    }
  };

  // Handle delete preset
  const handleDeletePreset = async (presetId: string) => {
    if (
      !selectedGuildId ||
      !confirm("このプリセットを削除してもよろしいですか？")
    )
      return;

    try {
      const res = await fetch(
        `/api/staff/guilds/${selectedGuildId}/role-presets/${presetId}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );

      if (res.ok) {
        setPresets((prev) => {
          const newPresets = { ...prev };
          delete newPresets[presetId];
          return newPresets;
        });
        addToast?.("プリセットを削除しました", "info");
      } else {
        addToast?.("削除に失敗しました", "error");
      }
    } catch (err) {
      console.error("Failed to delete preset:", err);
      addToast?.("削除に失敗しました", "error");
    }
  };

  // Handle post panel to Discord
  const handlePostPanel = (presetId: string) => {
    addToast?.(
      `Discord で /staff rolepanel preset:${presetId} を実行してください`,
      "info"
    );
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <i className="material-icons">sync</i>
        <p>読み込み中...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <div className={styles.headerTitle}>
            <i className="material-icons">admin_panel_settings</i>
            <h1>ロールプリセット管理</h1>
          </div>
          <button
            className={styles.backButton}
            onClick={() => navigate("/staff")}
          >
            <i className="material-icons">arrow_back</i>
            戻る
          </button>
        </div>
      </header>

      {/* Guild selector */}
      {!selectedGuildId ? (
        <div className={styles.guildSelector}>
          <h2>サーバーを選択</h2>
          {accessibleGuilds.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="material-icons">visibility_off</i>
              <p>アクセス可能なサーバーがありません</p>
            </div>
          ) : (
            <div className={styles.guildGrid}>
              {accessibleGuilds.map((guild) => (
                <div
                  key={guild.id}
                  className={styles.guildCard}
                  onClick={() => setSelectedGuildId(guild.id)}
                >
                  {guild.icon ? (
                    <img
                      src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`}
                      alt={guild.name}
                      className={styles.guildIcon}
                    />
                  ) : (
                    <div className={styles.guildIconPlaceholder}>
                      <i className="material-icons">group</i>
                    </div>
                  )}
                  <div className={styles.guildName}>{guild.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Presets view */
        <div className={styles.content}>
          <div className={styles.toolbar}>
            <button
              className={styles.changeGuildButton}
              onClick={() => setSelectedGuildId(null)}
            >
              <i className="material-icons">swap_horiz</i>
              サーバー変更
            </button>
            <button
              className={styles.createButton}
              onClick={handleCreatePreset}
            >
              <i className="material-icons">add</i>
              新規プリセット
            </button>
          </div>

          {Object.keys(presets).length === 0 ? (
            <div className={styles.emptyState}>
              <i className="material-icons">inbox</i>
              <p>プリセットがありません</p>
              <p className={styles.hint}>新規プリセットを作成してください</p>
            </div>
          ) : (
            <div className={styles.presetGrid}>
              {Object.values(presets).map((preset) => (
                <div key={preset.id} className={styles.presetCard}>
                  <div className={styles.presetHeader}>
                    <h3>{preset.name}</h3>
                    <div className={styles.presetActions}>
                      <button
                        className={styles.iconButton}
                        onClick={() => handleEditPreset(preset)}
                        title="編集"
                      >
                        <i className="material-icons">edit</i>
                      </button>
                      <button
                        className={styles.iconButton}
                        onClick={() => handleDeletePreset(preset.id)}
                        title="削除"
                      >
                        <i className="material-icons">delete</i>
                      </button>
                    </div>
                  </div>
                  <p className={styles.presetDescription}>
                    {preset.description}
                  </p>
                  <div className={styles.presetMeta}>
                    <div className={styles.metaItem}>
                      <i className="material-icons">badge</i>
                      <span>{preset.roles.length} ロール</span>
                    </div>
                    <div className={styles.metaItem}>
                      <i className="material-icons">
                        {preset.allowMulti
                          ? "check_box"
                          : "check_box_outline_blank"}
                      </i>
                      <span>
                        {preset.allowMulti ? "複数選択可" : "単一選択"}
                      </span>
                    </div>
                  </div>
                  <div className={styles.roleList}>
                    {preset.roles.map((roleId) => {
                      const role = guildRoles.find((r) => r.id === roleId);
                      return (
                        <div key={roleId} className={styles.roleChip}>
                          <span
                            className={styles.roleColor}
                            style={{
                              backgroundColor: role
                                ? `#${role.color.toString(16).padStart(6, "0")}`
                                : "#99aab5",
                            }}
                          />
                          {role?.name || roleId}
                        </div>
                      );
                    })}
                  </div>
                  <button
                    className={styles.postButton}
                    onClick={() => handlePostPanel(preset.id)}
                  >
                    <i className="material-icons">send</i>
                    パネルを投稿
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => setShowModal(false)}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{editingPreset ? "プリセット編集" : "新規プリセット"}</h2>
              <button
                className={styles.closeButton}
                onClick={() => setShowModal(false)}
              >
                <i className="material-icons">close</i>
              </button>
            </div>
            <form onSubmit={handleSavePreset} className={styles.modalForm}>
              <div className={styles.formGroup}>
                <label>プリセットID *</label>
                <input
                  type="text"
                  value={formData.id}
                  onChange={(e) =>
                    setFormData({ ...formData, id: e.target.value })
                  }
                  placeholder="例: helpdesk"
                  disabled={!!editingPreset}
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label>プリセット名 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="例: Helpdesk Roles"
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label>説明 *</label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="プリセットの説明を入力..."
                  rows={3}
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label>ロール選択 *</label>
                <div className={styles.roleSearchContainer}>
                  <div className={styles.searchInput}>
                    <i className="material-icons">search</i>
                    <input
                      type="text"
                      placeholder="ロールを検索..."
                      value={roleSearch}
                      onChange={(e) => setRoleSearch(e.target.value)}
                    />
                    {roleSearch && (
                      <button
                        type="button"
                        onClick={() => setRoleSearch("")}
                        className={styles.clearSearch}
                      >
                        <i className="material-icons">clear</i>
                      </button>
                    )}
                  </div>
                  <div className={styles.selectedCount}>
                    {formData.roles.length} 個選択中
                  </div>
                </div>
                <div className={styles.roleCheckboxes}>
                  {guildRoles.length === 0 ? (
                    <div className={styles.emptyState}>
                      <i className="material-icons">badge</i>
                      <p>サーバーからロール情報を取得できませんでした</p>
                    </div>
                  ) : Object.keys(filteredGroupedRoles).length === 0 ? (
                    <div className={styles.emptyState}>
                      <i className="material-icons">search_off</i>
                      <p>検索条件に一致するロールが見つかりません</p>
                    </div>
                  ) : (
                    Object.entries(filteredGroupedRoles).map(
                      ([colorGroup, roles]) => (
                        <div key={colorGroup}>
                          {colorGroup !== "default" && roles.length > 0 && (
                            <h4
                              style={{
                                marginTop: "1.5rem",
                                marginBottom: "0.75rem",
                                fontSize: "0.875rem",
                                color: "var(--md-sys-color-on-surface-variant)",
                                fontWeight: "500",
                              }}
                            >
                              {colorGroup === "default"
                                ? "デフォルト"
                                : `カラーグループ ${colorGroup.replace(
                                    "color-",
                                    ""
                                  )}`}
                            </h4>
                          )}
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "repeat(auto-fill, minmax(300px, 1fr))",
                              gap: "0.75rem",
                              marginBottom: "1rem",
                            }}
                          >
                            {roles.map((role) => (
                              <label
                                key={role.id}
                                className={`${styles.roleCheckbox} ${
                                  formData.roles.includes(role.id)
                                    ? styles.selected
                                    : ""
                                }`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleRoleToggle(
                                    role.id,
                                    !formData.roles.includes(role.id)
                                  );
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={formData.roles.includes(role.id)}
                                  onChange={() => {}} // Prevent default behavior, handled by label click
                                  readOnly
                                />
                                <div className={styles.checkmark}>
                                  {formData.roles.includes(role.id) && "✓"}
                                </div>
                                <div className={styles.roleInfo}>
                                  <span
                                    className={styles.roleColor}
                                    style={{
                                      backgroundColor:
                                        role.color === 0
                                          ? "var(--md-sys-color-on-surface-variant)"
                                          : `#${role.color
                                              .toString(16)
                                              .padStart(6, "0")}`,
                                    }}
                                  />
                                  <div className={styles.roleDetails}>
                                    <span className={styles.roleName}>
                                      {role.name}
                                    </span>
                                    <small className={styles.roleMeta}>
                                      {!role.managed && role.position === 0
                                        ? "初期ロール"
                                        : `位置: ${role.position}`}
                                      {role.managed && " (管理ロール)"}
                                    </small>
                                  </div>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    )
                  )}
                </div>
                {formData.roles.length > 0 && (
                  <small
                    style={{
                      display: "block",
                      marginTop: "0.5rem",
                      color: "var(--md-sys-color-primary)",
                      fontSize: "0.875rem",
                    }}
                  >
                    選択されたロール: {formData.roles.length}個
                  </small>
                )}
              </div>
              <div className={styles.formGroup}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={formData.allowMulti}
                    onChange={(e) =>
                      setFormData({ ...formData, allowMulti: e.target.checked })
                    }
                  />
                  <div className={styles.checkboxMark}></div>
                  <span>複数選択を許可</span>
                </label>
              </div>
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={() => setShowModal(false)}
                >
                  キャンセル
                </button>
                <button type="submit" className={styles.saveButton}>
                  <i className="material-icons">save</i>
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleManagerPage;
