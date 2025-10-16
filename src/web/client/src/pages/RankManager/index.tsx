import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppToast } from '../../AppToastProvider';
import styles from './RankManager.module.css';

interface RankPreset {
  name: string;
  description?: string;
  ranks: RankTier[];
  rewards: RankReward[];
}

interface RankTier {
  name: string;
  minXp: number;
  maxXp: number;
  color?: string;
  icon?: string;
}

interface RankReward {
  rankName: string;
  giveRoleId?: string;
  notify?: boolean;
  customMessage?: string;
}

interface RankPanel {
  channelId: string;
  messageId: string;
  preset: string;
  lastUpdate: string;
  topCount?: number;
}

interface RankSettings {
  notifyChannelId?: string;
  updateIntervalMs: number;
  xpRates: {
    messageXp: number;
    messageCooldownSec: number;
    vcXpPerMinute: number;
    vcIntervalSec: number;
    dailyXpCap: number;
    excludeChannels: string[];
    excludeRoles: string[];
    globalMultiplier: number;
  };
}

interface Guild {
  id: string;
  name: string;
  icon?: string | null;
}

interface GuildChannel {
  id: string;
  name: string;
  type: number;
}

interface GuildRole {
  id: string;
  name: string;
  color: number;
}

const RankManagerPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accessibleGuilds, setAccessibleGuilds] = useState<Guild[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const [presets, setPresets] = useState<RankPreset[]>([]);
  const [panels, setPanels] = useState<Record<string, RankPanel>>({});
  const [settings, setSettings] = useState<RankSettings | null>(null);
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [roles, setRoles] = useState<GuildRole[]>([]);
  
  // Modal states
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [showPanelWizard, setShowPanelWizard] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editingPreset, setEditingPreset] = useState<RankPreset | null>(null);
  
  // Panel wizard state
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardData, setWizardData] = useState({
    preset: '',
    channelId: '',
    updateInterval: 5,
    topCount: 10
  });

  const { addToast } = (() => {
    try {
      return useAppToast();
    } catch {
      return { addToast: undefined } as any;
    }
  })();

  // Load accessible guilds
  useEffect(() => {
    const loadGuilds = async () => {
      try {
        const res = await fetch('/api/staff/guilds', {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setAccessibleGuilds(data.guilds || []);
          if (data.guilds && data.guilds.length > 0) {
            setSelectedGuildId(data.guilds[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load guilds:', err);
        addToast?.('ギルド一覧の読み込みに失敗しました', 'error');
      } finally {
        setLoading(false);
      }
    };

    loadGuilds();
  }, []);

  // Load rank data when guild is selected
  useEffect(() => {
    if (!selectedGuildId) return;

    const loadRankData = async () => {
      setLoading(true);
      try {
        // Load presets
        const presetsRes = await fetch(
          `/api/staff/rankmanager/presets?guildId=${selectedGuildId}`,
          { credentials: 'include' }
        );
        if (presetsRes.ok) {
          const data = await presetsRes.json();
          setPresets(data);
        }

        // Load panels
        const panelsRes = await fetch(
          `/api/staff/rankmanager/panels?guildId=${selectedGuildId}`,
          { credentials: 'include' }
        );
        if (panelsRes.ok) {
          const data = await panelsRes.json();
          setPanels(data);
        }

        // Load settings
        const settingsRes = await fetch(
          `/api/staff/rankmanager/settings?guildId=${selectedGuildId}`,
          { credentials: 'include' }
        );
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          setSettings(data);
        }

        // Load channels
        const channelsRes = await fetch(
          `/api/staff/guilds/${selectedGuildId}/channels`,
          { credentials: 'include' }
        );
        if (channelsRes.ok) {
          const data = await channelsRes.json();
          setChannels(data.channels || []);
        }

        // Load roles
        const rolesRes = await fetch(
          `/api/staff/guilds/${selectedGuildId}/roles`,
          { credentials: 'include' }
        );
        if (rolesRes.ok) {
          const data = await rolesRes.json();
          setRoles(data.roles || []);
        }
      } catch (err) {
        console.error('Failed to load rank data:', err);
        addToast?.('ランクデータの読み込みに失敗しました', 'error');
      } finally {
        setLoading(false);
      }
    };

    loadRankData();
  }, [selectedGuildId]);

  const handleCreatePreset = () => {
    setEditingPreset({
      name: '',
      description: '',
      ranks: [
        { name: 'Bronze', minXp: 0, maxXp: 999, color: '#CD7F32' },
        { name: 'Silver', minXp: 1000, maxXp: 4999, color: '#C0C0C0' },
        { name: 'Gold', minXp: 5000, maxXp: 9999, color: '#FFD700' },
      ],
      rewards: []
    });
    setShowPresetModal(true);
  };

  const handleEditPreset = (preset: RankPreset) => {
    setEditingPreset(preset);
    setShowPresetModal(true);
  };

  const handleSavePreset = async () => {
    if (!editingPreset || !selectedGuildId) return;

    setSaving(true);
    try {
      const isNew = !presets.find(p => p.name === editingPreset.name);
      const url = isNew
        ? `/api/staff/rankmanager/presets`
        : `/api/staff/rankmanager/presets/${editingPreset.name}`;
      
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...editingPreset, guildId: selectedGuildId }),
      });

      if (res.ok) {
        addToast?.(`プリセット「${editingPreset.name}」を保存しました`, 'success');
        setShowPresetModal(false);
        setEditingPreset(null);
        // Reload presets
        const presetsRes = await fetch(
          `/api/staff/rankmanager/presets?guildId=${selectedGuildId}`,
          { credentials: 'include' }
        );
        if (presetsRes.ok) {
          setPresets(await presetsRes.json());
        }
      } else {
        const error = await res.json();
        addToast?.(error.error || 'プリセットの保存に失敗しました', 'error');
      }
    } catch (err) {
      console.error('Failed to save preset:', err);
      addToast?.('プリセットの保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePreset = async (presetName: string) => {
    if (!selectedGuildId) return;
    if (!confirm(`プリセット「${presetName}」を削除しますか？`)) return;

    try {
      const res = await fetch(
        `/api/staff/rankmanager/presets/${presetName}?guildId=${selectedGuildId}`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      );

      if (res.ok) {
        addToast?.(`プリセット「${presetName}」を削除しました`, 'success');
        setPresets(presets.filter(p => p.name !== presetName));
      } else {
        const error = await res.json();
        addToast?.(error.error || 'プリセットの削除に失敗しました', 'error');
      }
    } catch (err) {
      console.error('Failed to delete preset:', err);
      addToast?.('プリセットの削除に失敗しました', 'error');
    }
  };

  const handleCreatePanel = () => {
    setWizardStep(1);
    setWizardData({
      preset: presets[0]?.name || '',
      channelId: '',
      updateInterval: 5,
      topCount: 10
    });
    setShowPanelWizard(true);
  };

  const handleDeletePanel = async (panelId: string) => {
    if (!selectedGuildId) return;
    if (!confirm('このパネルを削除しますか？')) return;

    try {
      const res = await fetch(
        `/api/staff/rankmanager/panels/${panelId}?guildId=${selectedGuildId}`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      );

      if (res.ok) {
        addToast?.('パネルを削除しました', 'success');
        const newPanels = { ...panels };
        delete newPanels[panelId];
        setPanels(newPanels);
      } else {
        const error = await res.json();
        addToast?.(error.error || 'パネルの削除に失敗しました', 'error');
      }
    } catch (err) {
      console.error('Failed to delete panel:', err);
      addToast?.('パネルの削除に失敗しました', 'error');
    }
  };

  const handleSaveSettings = async () => {
    if (!settings || !selectedGuildId) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/staff/rankmanager/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...settings, guildId: selectedGuildId }),
      });

      if (res.ok) {
        addToast?.('設定を保存しました', 'success');
        setShowSettingsModal(false);
      } else {
        const error = await res.json();
        addToast?.(error.error || '設定の保存に失敗しました', 'error');
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      addToast?.('設定の保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <i className="material-icons-outlined">hourglass_empty</i>
          <h2>読み込み中...</h2>
        </div>
      </div>
    );
  }

  const selectedGuild = accessibleGuilds.find(g => g.id === selectedGuildId);

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <div className={styles.headerTitle}>
            <i className="material-icons-outlined">emoji_events</i>
            <div>
              <h1>ランキング管理</h1>
              <p className={styles.subtitle}>ギルドのランクシステムとリーダーボードを管理</p>
            </div>
          </div>
          <button className={styles.backButton} onClick={() => navigate('/staff')}>
            <i className="material-icons">arrow_back</i>
            スタッフページに戻る
          </button>
        </div>
      </div>

      {/* Guild Selector */}
      <div className={styles.content}>
        <div className={styles.guildSelector}>
          <label>
            <i className="material-icons-outlined">dns</i>
            ギルド選択
          </label>
          <select
            value={selectedGuildId || ''}
            onChange={(e) => setSelectedGuildId(e.target.value)}
            className={styles.select}
          >
            {accessibleGuilds.map(guild => (
              <option key={guild.id} value={guild.id}>{guild.name}</option>
            ))}
          </select>
        </div>

        {selectedGuildId && (
          <>
            {/* Summary Cards */}
            <div className={styles.summaryGrid}>
              <div className={styles.summaryCard}>
                <i className="material-icons-outlined">groups</i>
                <div>
                  <div className={styles.summaryLabel}>プリセット数</div>
                  <div className={styles.summaryValue}>{presets.length}</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <i className="material-icons-outlined">dashboard</i>
                <div>
                  <div className={styles.summaryLabel}>稼働パネル</div>
                  <div className={styles.summaryValue}>{Object.keys(panels).length}</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <i className="material-icons-outlined">settings</i>
                <div>
                  <div className={styles.summaryLabel}>XP倍率</div>
                  <div className={styles.summaryValue}>{settings?.xpRates.globalMultiplier || 1.0}x</div>
                </div>
              </div>
            </div>

            {/* Presets Section */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>
                  <i className="material-icons-outlined">category</i>
                  ランクプリセット
                </h2>
                <button className={styles.primaryButton} onClick={handleCreatePreset}>
                  <i className="material-icons">add</i>
                  新規作成
                </button>
              </div>

              <div className={styles.presetsGrid}>
                {presets.map(preset => (
                  <div key={preset.name} className={styles.presetCard}>
                    <div className={styles.presetHeader}>
                      <h3>{preset.name}</h3>
                      <div className={styles.presetActions}>
                        <button 
                          className={styles.iconButton}
                          onClick={() => handleEditPreset(preset)}
                          title="編集"
                        >
                          <i className="material-icons-outlined">edit</i>
                        </button>
                        <button 
                          className={styles.iconButton}
                          onClick={() => handleDeletePreset(preset.name)}
                          title="削除"
                        >
                          <i className="material-icons-outlined">delete</i>
                        </button>
                      </div>
                    </div>
                    <p className={styles.presetDescription}>{preset.description || '説明なし'}</p>
                    <div className={styles.ranksList}>
                      {preset.ranks.map(rank => (
                        <div key={rank.name} className={styles.rankBadge} style={{ borderColor: rank.color }}>
                          <span style={{ color: rank.color }}>{rank.name}</span>
                          <span className={styles.xpRange}>{rank.minXp} - {rank.maxXp} XP</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {presets.length === 0 && (
                <div className={styles.emptyState}>
                  <i className="material-icons-outlined">category</i>
                  <p>プリセットがありません</p>
                  <button className={styles.primaryButton} onClick={handleCreatePreset}>
                    最初のプリセットを作成
                  </button>
                </div>
              )}
            </div>

            {/* Panels Section */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>
                  <i className="material-icons-outlined">dashboard</i>
                  ランクパネル
                </h2>
                <button className={styles.primaryButton} onClick={handleCreatePanel}>
                  <i className="material-icons">add</i>
                  パネル作成
                </button>
              </div>

              <div className={styles.panelsGrid}>
                {Object.entries(panels).map(([panelId, panel]) => (
                  <div key={panelId} className={styles.panelCard}>
                    <div className={styles.panelHeader}>
                      <h3>パネル: {panel.preset}</h3>
                      <button 
                        className={styles.iconButton}
                        onClick={() => handleDeletePanel(panelId)}
                        title="削除"
                      >
                        <i className="material-icons-outlined">delete</i>
                      </button>
                    </div>
                    <div className={styles.panelInfo}>
                      <div>
                        <i className="material-icons-outlined">tag</i>
                        チャンネル: <code>{panel.channelId}</code>
                      </div>
                      <div>
                        <i className="material-icons-outlined">schedule</i>
                        最終更新: {new Date(panel.lastUpdate).toLocaleString('ja-JP')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {Object.keys(panels).length === 0 && (
                <div className={styles.emptyState}>
                  <i className="material-icons-outlined">dashboard</i>
                  <p>パネルがありません</p>
                  <button className={styles.primaryButton} onClick={handleCreatePanel}>
                    最初のパネルを作成
                  </button>
                </div>
              )}
            </div>

            {/* Settings Button */}
            <div className={styles.section}>
              <button 
                className={styles.settingsButton}
                onClick={() => setShowSettingsModal(true)}
              >
                <i className="material-icons-outlined">tune</i>
                ランクシステム設定
              </button>
            </div>
          </>
        )}
      </div>

      {/* Settings Modal */}
      {showSettingsModal && settings && (
        <div className={styles.modal} onClick={() => setShowSettingsModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>ランクシステム設定</h2>
              <button className={styles.closeButton} onClick={() => setShowSettingsModal(false)}>
                <i className="material-icons">close</i>
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.formGroup}>
                <label>メッセージXP</label>
                <input
                  type="number"
                  value={settings.xpRates.messageXp}
                  onChange={(e) => setSettings({
                    ...settings,
                    xpRates: { ...settings.xpRates, messageXp: parseInt(e.target.value) || 0 }
                  })}
                  min="0"
                />
              </div>
              <div className={styles.formGroup}>
                <label>メッセージクールダウン (秒)</label>
                <input
                  type="number"
                  value={settings.xpRates.messageCooldownSec}
                  onChange={(e) => setSettings({
                    ...settings,
                    xpRates: { ...settings.xpRates, messageCooldownSec: parseInt(e.target.value) || 0 }
                  })}
                  min="0"
                />
              </div>
              <div className={styles.formGroup}>
                <label>VC XP (毎分)</label>
                <input
                  type="number"
                  value={settings.xpRates.vcXpPerMinute}
                  onChange={(e) => setSettings({
                    ...settings,
                    xpRates: { ...settings.xpRates, vcXpPerMinute: parseInt(e.target.value) || 0 }
                  })}
                  min="0"
                />
              </div>
              <div className={styles.formGroup}>
                <label>日次XP上限 (0 = 無制限)</label>
                <input
                  type="number"
                  value={settings.xpRates.dailyXpCap}
                  onChange={(e) => setSettings({
                    ...settings,
                    xpRates: { ...settings.xpRates, dailyXpCap: parseInt(e.target.value) || 0 }
                  })}
                  min="0"
                />
              </div>
              <div className={styles.formGroup}>
                <label>グローバル倍率</label>
                <input
                  type="number"
                  step="0.1"
                  value={settings.xpRates.globalMultiplier}
                  onChange={(e) => setSettings({
                    ...settings,
                    xpRates: { ...settings.xpRates, globalMultiplier: parseFloat(e.target.value) || 1.0 }
                  })}
                  min="0.1"
                  max="10"
                />
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button 
                className={styles.secondaryButton}
                onClick={() => setShowSettingsModal(false)}
              >
                キャンセル
              </button>
              <button 
                className={styles.primaryButton}
                onClick={handleSaveSettings}
                disabled={saving}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RankManagerPage;
