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
  webhookUrl?: string;
  customMessage?: string;
}

interface XpConditionRule {
  id: string;
  name: string;
  actionType: 'message' | 'reaction' | 'voiceChat' | 'invite' | 'custom';
  description?: string;
  channels?: string[];
  roles?: string[];
  xpReward: number;
  xpRewardMin?: number;
  xpRewardMax?: number;
  cooldownSec?: number;
  maxPerDay?: number;
  isActive: boolean;
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
    messageXpMin?: number;
    messageXpMax?: number;
    messageCooldownSec: number;
    vcXpPerMinute: number;
    vcXpPerMinuteMin?: number;
    vcXpPerMinuteMax?: number;
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
  const [activeTab, setActiveTab] = useState<'presets' | 'panels' | 'settings' | 'rules' | 'advanced'>('presets');
  
  // Modal states
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [showPanelModal, setShowPanelModal] = useState(false);
  const [, setShowSettingsModal] = useState(false);
  const [editingPreset, setEditingPreset] = useState<RankPreset | null>(null);
  const [] = useState<number | null>(null);
  const [presetModalTab, setPresetModalTab] = useState<'ranks' | 'rewards'>('ranks');
  
  // XP条件ルール管理
  const [xpRules, setXpRules] = useState<XpConditionRule[]>([]);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<XpConditionRule | null>(null);
  const [selectedPresetForRules, setSelectedPresetForRules] = useState<string | null>(null);
  
  // リセット確認ダイアログ
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetTarget, setResetTarget] = useState<'all' | 'user'>('all');
  const [resetUserId, setResetUserId] = useState('');
  
  // Panel creation state
  const [, setNewPanel] = useState({
    preset: '',
    channelId: '',
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
        } else {
          addToast?.('ギルド一覧の読み込みに失敗しました', 'error');
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
          setPresets(Array.isArray(data) ? data : []);
        } else {
          console.error('Failed to load presets:', await presetsRes.text());
          setPresets([]);
        }

        // Load panels
        const panelsRes = await fetch(
          `/api/staff/rankmanager/panels?guildId=${selectedGuildId}`,
          { credentials: 'include' }
        );
        if (panelsRes.ok) {
          const data = await panelsRes.json();
          setPanels(data || {});
        } else {
          console.error('Failed to load panels:', await panelsRes.text());
          setPanels({});
        }

        // Load settings
        const settingsRes = await fetch(
          `/api/staff/rankmanager/settings?guildId=${selectedGuildId}`,
          { credentials: 'include' }
        );
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          setSettings(data);
        } else {
          console.error('Failed to load settings:', await settingsRes.text());
        }

        // Load channels from guilds endpoint
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
    setEditingPreset({ ...preset });
    setShowPresetModal(true);
  };

  const handleSavePreset = async () => {
    if (!editingPreset || !selectedGuildId) return;

    // Validation
    if (!editingPreset.name.trim()) {
      addToast?.('プリセット名を入力してください', 'error');
      return;
    }

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
          const data = await presetsRes.json();
          setPresets(Array.isArray(data) ? data : []);
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
    setNewPanel({
      preset: presets[0]?.name || '',
      channelId: '',
      topCount: 10
    });
    setShowPanelModal(true);
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

  const addRankToPreset = () => {
    if (!editingPreset) return;
    const lastRank = editingPreset.ranks[editingPreset.ranks.length - 1];
    setEditingPreset({
      ...editingPreset,
      ranks: [
        ...editingPreset.ranks,
        {
          name: 'New Rank',
          minXp: lastRank ? lastRank.maxXp + 1 : 0,
          maxXp: lastRank ? lastRank.maxXp + 1000 : 999,
          color: '#4A90E2'
        }
      ]
    });
  };

  const updateRank = (index: number, field: keyof RankTier, value: any) => {
    if (!editingPreset) return;
    const newRanks = [...editingPreset.ranks];
    newRanks[index] = { ...newRanks[index], [field]: value };
    setEditingPreset({ ...editingPreset, ranks: newRanks });
  };

  const removeRank = (index: number) => {
    if (!editingPreset || editingPreset.ranks.length <= 1) return;
    const newRanks = editingPreset.ranks.filter((_, i) => i !== index);
    setEditingPreset({ ...editingPreset, ranks: newRanks });
  };

  const addReward = () => {
    if (!editingPreset || editingPreset.ranks.length === 0) return;
    const newReward: RankReward = {
      rankName: editingPreset.ranks[0].name,
      notify: true
    };
    setEditingPreset({
      ...editingPreset,
      rewards: [...editingPreset.rewards, newReward]
    });
  };

  const updateReward = (index: number, field: keyof RankReward, value: any) => {
    if (!editingPreset) return;
    const newRewards = [...editingPreset.rewards];
    newRewards[index] = { ...newRewards[index], [field]: value };
    setEditingPreset({ ...editingPreset, rewards: newRewards });
  };

  const removeReward = (index: number) => {
    if (!editingPreset) return;
    const newRewards = editingPreset.rewards.filter((_, i) => i !== index);
    setEditingPreset({ ...editingPreset, rewards: newRewards });
  };

  // XP条件ルール管理
  const loadXpRules = async (presetName: string) => {
    if (!selectedGuildId) return;
    try {
      const res = await fetch(
        `/api/staff/rankmanager/guilds/${selectedGuildId}/presets/${presetName}/rules`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setXpRules(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load XP rules:', err);
    }
  };

  const handleSaveRule = async () => {
    if (!editingRule || !selectedGuildId || !selectedPresetForRules) return;

    setSaving(true);
    try {
      const method = editingRule.id && editingRule.id.startsWith('new-') ? 'POST' : 'PUT';
      const url = method === 'POST'
        ? `/api/staff/rankmanager/guilds/${selectedGuildId}/presets/${selectedPresetForRules}/rules`
        : `/api/staff/rankmanager/guilds/${selectedGuildId}/presets/${selectedPresetForRules}/rules/${editingRule.id}`;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(editingRule)
      });

      if (res.ok) {
        addToast?.('ルールを保存しました', 'success');
        setShowRuleModal(false);
        loadXpRules(selectedPresetForRules);
      } else {
        const error = await res.json();
        addToast?.(error.error || 'ルール保存に失敗しました', 'error');
      }
    } catch (err) {
      console.error('Failed to save rule:', err);
      addToast?.('ルール保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!selectedGuildId || !selectedPresetForRules) return;

    try {
      const res = await fetch(
        `/api/staff/rankmanager/guilds/${selectedGuildId}/presets/${selectedPresetForRules}/rules/${ruleId}`,
        { method: 'DELETE', credentials: 'include' }
      );

      if (res.ok) {
        addToast?.('ルールを削除しました', 'success');
        loadXpRules(selectedPresetForRules);
      } else {
        const error = await res.json();
        addToast?.(error.error || 'ルール削除に失敗しました', 'error');
      }
    } catch (err) {
      console.error('Failed to delete rule:', err);
      addToast?.('ルール削除に失敗しました', 'error');
    }
  };

  const handleResetRank = async () => {
    if (!selectedGuildId) return;

    setSaving(true);
    try {
      const res = await fetch(
        `/api/staff/rankmanager/guilds/${selectedGuildId}/reset`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ userId: resetTarget === 'user' ? resetUserId : undefined })
        }
      );

      if (res.ok) {
        addToast?.(resetTarget === 'user' ? 'ユーザーのランクをリセットしました' : 'すべてのランクをリセットしました', 'success');
        setShowResetConfirm(false);
      } else {
        const error = await res.json();
        addToast?.(error.error || 'リセットに失敗しました', 'error');
      }
    } catch (err) {
      console.error('Failed to reset rank:', err);
      addToast?.('リセットに失敗しました', 'error');
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

  return (
    <div className={styles.container}>
      {/* Top Bar */}
      <div className={styles.topBar}>
        <div className={styles.topBarContent}>
          <div className={styles.titleSection}>
            <button className={styles.backButton} onClick={() => navigate('/staff')}>
              <i className="material-icons">arrow_back</i>
            </button>
            <div>
              <h1>ランキング管理</h1>
              <p className={styles.subtitle}>ギルドのランクシステムを管理</p>
            </div>
          </div>
          <div className={styles.guildSelector}>
            <i className="material-icons-outlined">dns</i>
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
        </div>
      </div>

      {selectedGuildId && (
        <div className={styles.mainContent}>
          {/* Tabs */}
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${activeTab === 'presets' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('presets')}
            >
              <i className="material-icons-outlined">category</i>
              プリセット
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'panels' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('panels')}
            >
              <i className="material-icons-outlined">dashboard</i>
              パネル
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'settings' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <i className="material-icons-outlined">settings</i>
              設定
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'rules' ? styles.tabActive : ''}`}
              onClick={() => {
                if (presets.length > 0) {
                  setSelectedPresetForRules(presets[0].name);
                  loadXpRules(presets[0].name);
                }
                setActiveTab('rules');
              }}
            >
              <i className="material-icons-outlined">rule</i>
              XP条件
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'advanced' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('advanced')}
            >
              <i className="material-icons-outlined">tune</i>
              アドバンス
            </button>
          </div>

          {/* Tab Content */}
          <div className={styles.tabContent}>
            {activeTab === 'presets' && (
              <div className={styles.tabPanel}>
                <div className={styles.panelHeader}>
                  <h2>ランクプリセット</h2>
                  <button className={styles.primaryButton} onClick={handleCreatePreset}>
                    <i className="material-icons">add</i>
                    新規作成
                  </button>
                </div>

                {presets.length === 0 ? (
                  <div className={styles.emptyState}>
                    <i className="material-icons-outlined">category</i>
                    <p>プリセットがありません</p>
                    <button className={styles.primaryButton} onClick={handleCreatePreset}>
                      最初のプリセットを作成
                    </button>
                  </div>
                ) : (
                  <div className={styles.presetsList}>
                    {presets.map(preset => (
                      <div key={preset.name} className={styles.presetCard}>
                        <div className={styles.cardHeader}>
                          <div>
                            <h3>{preset.name}</h3>
                            <p className={styles.cardDescription}>{preset.description || '説明なし'}</p>
                          </div>
                          <div className={styles.cardActions}>
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
                        <div className={styles.ranksList}>
                          {preset.ranks.map((rank, idx) => (
                            <div key={idx} className={styles.rankBadge} style={{ borderLeftColor: rank.color }}>
                              <span style={{ color: rank.color, fontWeight: 500 }}>{rank.name}</span>
                              <span className={styles.xpRange}>{rank.minXp} - {rank.maxXp} XP</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'panels' && (
              <div className={styles.tabPanel}>
                <div className={styles.panelHeader}>
                  <h2>ランクパネル</h2>
                  <button className={styles.primaryButton} onClick={handleCreatePanel}>
                    <i className="material-icons">add</i>
                    パネル作成
                  </button>
                </div>

                {Object.keys(panels).length === 0 ? (
                  <div className={styles.emptyState}>
                    <i className="material-icons-outlined">dashboard</i>
                    <p>パネルがありません</p>
                    <button className={styles.primaryButton} onClick={handleCreatePanel}>
                      最初のパネルを作成
                    </button>
                  </div>
                ) : (
                  <div className={styles.panelsList}>
                    {Object.entries(panels).map(([panelId, panel]) => (
                      <div key={panelId} className={styles.panelCard}>
                        <div className={styles.cardHeader}>
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
                          <div className={styles.infoRow}>
                            <i className="material-icons-outlined">tag</i>
                            <span>チャンネル ID:</span>
                            <code>{panel.channelId}</code>
                          </div>
                          <div className={styles.infoRow}>
                            <i className="material-icons-outlined">schedule</i>
                            <span>最終更新:</span>
                            <span>{new Date(panel.lastUpdate).toLocaleString('ja-JP')}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'settings' && settings && (
              <div className={styles.tabPanel}>
                <div className={styles.panelHeader}>
                  <h2>XP設定</h2>
                  <button 
                    className={styles.primaryButton}
                    onClick={handleSaveSettings}
                    disabled={saving}
                  >
                    {saving ? '保存中...' : '保存'}
                  </button>
                </div>

                <div className={styles.settingsForm}>
                  <div className={styles.formSection}>
                    <h3>メッセージ設定</h3>
                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <label>メッセージXP (固定)</label>
                        <input
                          type="number"
                          value={settings.xpRates.messageXp}
                          onChange={(e) => setSettings({
                            ...settings,
                            xpRates: { ...settings.xpRates, messageXp: parseInt(e.target.value) || 0 }
                          })}
                          min="0"
                        />
                        <span className={styles.helpText}>固定XP値 (ランダム無効時はこちらを使用)</span>
                      </div>
                      <div className={styles.formGroup}>
                        <label>メッセージXP Min</label>
                        <input
                          type="number"
                          value={settings.xpRates.messageXpMin || ''}
                          onChange={(e) => setSettings({
                            ...settings,
                            xpRates: { ...settings.xpRates, messageXpMin: parseInt(e.target.value) || undefined }
                          })}
                          min="0"
                          placeholder="ランダム無効"
                        />
                        <span className={styles.helpText}>ランダムXPの下限</span>
                      </div>
                      <div className={styles.formGroup}>
                        <label>メッセージXP Max</label>
                        <input
                          type="number"
                          value={settings.xpRates.messageXpMax || ''}
                          onChange={(e) => setSettings({
                            ...settings,
                            xpRates: { ...settings.xpRates, messageXpMax: parseInt(e.target.value) || undefined }
                          })}
                          min="0"
                          placeholder="ランダム無効"
                        />
                        <span className={styles.helpText}>ランダムXPの上限</span>
                      </div>
                      <div className={styles.formGroup}>
                        <label>クールダウン (秒)</label>
                        <input
                          type="number"
                          value={settings.xpRates.messageCooldownSec}
                          onChange={(e) => setSettings({
                            ...settings,
                            xpRates: { ...settings.xpRates, messageCooldownSec: parseInt(e.target.value) || 0 }
                          })}
                          min="0"
                        />
                        <span className={styles.helpText}>XP獲得のクールダウン時間</span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.formSection}>
                    <h3>ボイスチャット設定</h3>
                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <label>VC XP (毎分・固定)</label>
                        <input
                          type="number"
                          value={settings.xpRates.vcXpPerMinute}
                          onChange={(e) => setSettings({
                            ...settings,
                            xpRates: { ...settings.xpRates, vcXpPerMinute: parseInt(e.target.value) || 0 }
                          })}
                          min="0"
                        />
                        <span className={styles.helpText}>固定XP値 (ランダム無効時はこちらを使用)</span>
                      </div>
                      <div className={styles.formGroup}>
                        <label>VC XP Min (毎分)</label>
                        <input
                          type="number"
                          value={settings.xpRates.vcXpPerMinuteMin || ''}
                          onChange={(e) => setSettings({
                            ...settings,
                            xpRates: { ...settings.xpRates, vcXpPerMinuteMin: parseInt(e.target.value) || undefined }
                          })}
                          min="0"
                          placeholder="ランダム無効"
                        />
                        <span className={styles.helpText}>ランダムXPの下限</span>
                      </div>
                      <div className={styles.formGroup}>
                        <label>VC XP Max (毎分)</label>
                        <input
                          type="number"
                          value={settings.xpRates.vcXpPerMinuteMax || ''}
                          onChange={(e) => setSettings({
                            ...settings,
                            xpRates: { ...settings.xpRates, vcXpPerMinuteMax: parseInt(e.target.value) || undefined }
                          })}
                          min="0"
                          placeholder="ランダム無効"
                        />
                        <span className={styles.helpText}>ランダムXPの上限</span>
                      </div>
                      <div className={styles.formGroup}>
                        <label>VC計測間隔 (秒)</label>
                        <input
                          type="number"
                          value={settings.xpRates.vcIntervalSec}
                          onChange={(e) => setSettings({
                            ...settings,
                            xpRates: { ...settings.xpRates, vcIntervalSec: parseInt(e.target.value) || 60 }
                          })}
                          min="1"
                          max="3600"
                        />
                        <span className={styles.helpText}>VCのXP計算間隔</span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.formSection}>
                    <h3>制限設定</h3>
                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <label>日次XP上限</label>
                        <input
                          type="number"
                          value={settings.xpRates.dailyXpCap}
                          onChange={(e) => setSettings({
                            ...settings,
                            xpRates: { ...settings.xpRates, dailyXpCap: parseInt(e.target.value) || 0 }
                          })}
                          min="0"
                        />
                        <span className={styles.helpText}>0 = 無制限</span>
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
                        <span className={styles.helpText}>イベント時などのXP倍率</span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.formSection}>
                    <h3>パネル設定</h3>
                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <label>更新間隔 (分)</label>
                        <input
                          type="number"
                          value={Math.round(settings.updateIntervalMs / 60000)}
                          onChange={(e) => setSettings({
                            ...settings,
                            updateIntervalMs: (parseInt(e.target.value) || 5) * 60000
                          })}
                          min="1"
                          max="60"
                        />
                        <span className={styles.helpText}>パネルの自動更新間隔</span>
                      </div>
                      <div className={styles.formGroup}>
                        <label>通知チャンネル</label>
                        <select
                          value={settings.notifyChannelId || ''}
                          onChange={(e) => setSettings({
                            ...settings,
                            notifyChannelId: e.target.value || undefined
                          })}
                        >
                          <option value="">未設定</option>
                          {channels.filter(ch => ch.type === 0).map(channel => (
                            <option key={channel.id} value={channel.id}>{channel.name}</option>
                          ))}
                        </select>
                        <span className={styles.helpText}>ランクアップ通知を送信するチャンネル</span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.formSection}>
                    <h3>除外設定</h3>
                    <div className={styles.formGroup}>
                      <label>除外チャンネル</label>
                      <div className={styles.multiSelect}>
                        {channels.filter(ch => ch.type === 0).map(channel => (
                          <label key={channel.id} className={styles.checkboxLabel}>
                            <input
                              type="checkbox"
                              checked={settings.xpRates.excludeChannels.includes(channel.id)}
                              onChange={(e) => {
                                const newExclude = e.target.checked
                                  ? [...settings.xpRates.excludeChannels, channel.id]
                                  : settings.xpRates.excludeChannels.filter(id => id !== channel.id);
                                setSettings({
                                  ...settings,
                                  xpRates: { ...settings.xpRates, excludeChannels: newExclude }
                                });
                              }}
                            />
                            <span>#{channel.name}</span>
                          </label>
                        ))}
                      </div>
                      <span className={styles.helpText}>これらのチャンネルではXPを獲得できません</span>
                    </div>

                    <div className={styles.formGroup}>
                      <label>除外ロール</label>
                      <div className={styles.multiSelect}>
                        {roles.map(role => (
                          <label key={role.id} className={styles.checkboxLabel}>
                            <input
                              type="checkbox"
                              checked={settings.xpRates.excludeRoles.includes(role.id)}
                              onChange={(e) => {
                                const newExclude = e.target.checked
                                  ? [...settings.xpRates.excludeRoles, role.id]
                                  : settings.xpRates.excludeRoles.filter(id => id !== role.id);
                                setSettings({
                                  ...settings,
                                  xpRates: { ...settings.xpRates, excludeRoles: newExclude }
                                });
                              }}
                            />
                            <span style={{ color: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : undefined }}>
                              @{role.name}
                            </span>
                          </label>
                        ))}
                      </div>
                      <span className={styles.helpText}>これらのロールを持つユーザーはXPを獲得できません</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'rules' && selectedPresetForRules && (
              <div className={styles.tabPanel}>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>XP獲得条件ルール</h2>
                    <p className={styles.cardDescription}>プリセット: {selectedPresetForRules}</p>
                  </div>
                  <button className={styles.primaryButton} onClick={() => {
                    setEditingRule({
                      id: `new-${Date.now()}`,
                      name: '新規ルール',
                      actionType: 'message',
                      xpReward: 10,
                      isActive: true
                    });
                    setShowRuleModal(true);
                  }}>
                    <i className="material-icons">add</i>
                    ルール追加
                  </button>
                </div>

                <div className={styles.rulesEditor}>
                  {xpRules.length === 0 ? (
                    <div className={styles.emptyState}>
                      <i className="material-icons-outlined">rule</i>
                      <p>ルールがありません</p>
                    </div>
                  ) : (
                    xpRules.map((rule) => (
                      <div key={rule.id} className={styles.ruleCard}>
                        <div className={styles.cardHeader}>
                          <div>
                            <h3>{rule.name}</h3>
                            <p className={styles.cardDescription}>{rule.description || 'アクション: ' + rule.actionType}</p>
                          </div>
                          <div className={styles.cardActions}>
                            <button className={styles.iconButton} onClick={() => {
                              setEditingRule(rule);
                              setShowRuleModal(true);
                            }} title="編集">
                              <i className="material-icons-outlined">edit</i>
                            </button>
                            <button className={styles.iconButton} onClick={() => handleDeleteRule(rule.id)} title="削除">
                              <i className="material-icons-outlined">delete</i>
                            </button>
                          </div>
                        </div>
                        <div className={styles.ruleDetails}>
                          <div className={styles.detail}>
                            <span>アクション:</span>
                            <strong>{rule.actionType}</strong>
                          </div>
                          <div className={styles.detail}>
                            <span>獲得XP:</span>
                            <strong>
                              {rule.xpRewardMin && rule.xpRewardMax 
                                ? `${rule.xpRewardMin}-${rule.xpRewardMax} (ランダム)`
                                : rule.xpReward
                              }
                            </strong>
                          </div>
                          {rule.cooldownSec && (
                            <div className={styles.detail}>
                              <span>クールダウン:</span>
                              <strong>{rule.cooldownSec}秒</strong>
                            </div>
                          )}
                          {rule.maxPerDay && (
                            <div className={styles.detail}>
                              <span>1日の上限:</span>
                              <strong>{rule.maxPerDay}回</strong>
                            </div>
                          )}
                          <div className={styles.detail}>
                            <span>ステータス:</span>
                            <strong style={{ color: rule.isActive ? '#4CAF50' : '#F44336' }}>
                              {rule.isActive ? '有効' : '無効'}
                            </strong>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === 'advanced' && (
              <div className={styles.tabPanel}>
                <div className={styles.panelHeader}>
                  <h2>アドバンスオプション</h2>
                </div>

                <div className={styles.advancedOptions}>
                  <div className={styles.optionCard}>
                    <div className={styles.optionHeader}>
                      <i className="material-icons-outlined">restart_alt</i>
                      <h3>ランクリセット</h3>
                    </div>
                    <p className={styles.optionDescription}>ユーザーまたはすべてのユーザーのランク/XPをリセットします</p>
                    <button className={styles.secondaryButton} onClick={() => setShowResetConfirm(true)}>
                      <i className="material-icons-outlined">restart_alt</i>
                      リセット実行
                    </button>
                  </div>

                  <div className={styles.optionCard}>
                    <div className={styles.optionHeader}>
                      <i className="material-icons-outlined">info</i>
                      <h3>XP条件の詳細設定</h3>
                    </div>
                    <p className={styles.optionDescription}>「XP条件」タブで、ユーザーがXPを獲得できるアクションを細かく設定できます</p>
                    <button className={styles.secondaryButton} onClick={() => setActiveTab('rules')}>
                      <i className="material-icons-outlined">rule</i>
                      条件ルールの管理
                    </button>
                  </div>

                  <div className={styles.optionCard}>
                    <div className={styles.optionHeader}>
                      <i className="material-icons-outlined">webhook</i>
                      <h3>外部Webhook連携</h3>
                    </div>
                    <p className={styles.optionDescription}>報酬設定でWebhook URLを指定すると、ランクアップ時に外部APIに通知します</p>
                    <button className={styles.secondaryButton} onClick={() => setActiveTab('presets')}>
                      <i className="material-icons-outlined">category</i>
                      プリセットの編集
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Preset Modal */}
      {showPresetModal && editingPreset && (
        <div className={styles.modal} onClick={() => setShowPresetModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{presets.find(p => p.name === editingPreset.name) ? 'プリセット編集' : 'プリセット作成'}</h2>
              <button className={styles.closeButton} onClick={() => setShowPresetModal(false)}>
                <i className="material-icons">close</i>
              </button>
            </div>

            {/* Modal Tabs */}
            <div className={styles.modalTabs}>
              <button
                className={`${styles.modalTab} ${presetModalTab === 'ranks' ? styles.modalTabActive : ''}`}
                onClick={() => setPresetModalTab('ranks')}
              >
                <i className="material-icons-outlined">military_tech</i>
                ランク設定
              </button>
              <button
                className={`${styles.modalTab} ${presetModalTab === 'rewards' ? styles.modalTabActive : ''}`}
                onClick={() => setPresetModalTab('rewards')}
              >
                <i className="material-icons-outlined">card_giftcard</i>
                報酬設定
              </button>
            </div>

            <div className={styles.modalBody}>
              {presetModalTab === 'ranks' && (
                <>
                  <div className={styles.formGroup}>
                    <label>プリセット名 *</label>
                    <input
                      type="text"
                      value={editingPreset.name}
                      onChange={(e) => setEditingPreset({ ...editingPreset, name: e.target.value })}
                      placeholder="例: default, vip, seasonal"
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>説明</label>
                    <textarea
                      value={editingPreset.description || ''}
                      onChange={(e) => setEditingPreset({ ...editingPreset, description: e.target.value })}
                      placeholder="このプリセットの説明"
                      rows={2}
                    />
                  </div>
                  
                  <div className={styles.ranksEditor}>
                    <div className={styles.ranksHeader}>
                      <h3>ランク一覧</h3>
                      <button className={styles.secondaryButton} onClick={addRankToPreset}>
                        <i className="material-icons">add</i>
                        ランク追加
                      </button>
                    </div>
                    
                    {editingPreset.ranks.map((rank, idx) => (
                      <div key={idx} className={styles.rankEditor}>
                        <div className={styles.rankEditorHeader}>
                          <span className={styles.rankNumber}>#{idx + 1}</span>
                          {editingPreset.ranks.length > 1 && (
                            <button 
                              className={styles.iconButton}
                              onClick={() => removeRank(idx)}
                              title="削除"
                            >
                              <i className="material-icons-outlined">delete</i>
                            </button>
                          )}
                        </div>
                        <div className={styles.rankFields}>
                          <div className={styles.formGroup}>
                            <label>ランク名</label>
                            <input
                              type="text"
                              value={rank.name}
                              onChange={(e) => updateRank(idx, 'name', e.target.value)}
                            />
                          </div>
                          <div className={styles.formGroup}>
                            <label>最小XP</label>
                            <input
                              type="number"
                              value={rank.minXp}
                              onChange={(e) => updateRank(idx, 'minXp', parseInt(e.target.value) || 0)}
                              min="0"
                            />
                          </div>
                          <div className={styles.formGroup}>
                            <label>最大XP</label>
                            <input
                              type="number"
                              value={rank.maxXp}
                              onChange={(e) => updateRank(idx, 'maxXp', parseInt(e.target.value) || 0)}
                              min="0"
                            />
                          </div>
                          <div className={styles.formGroup}>
                            <label>色</label>
                            <input
                              type="color"
                              value={rank.color || '#4A90E2'}
                              onChange={(e) => updateRank(idx, 'color', e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {presetModalTab === 'rewards' && (
                <div className={styles.rewardsEditor}>
                  <div className={styles.ranksHeader}>
                    <h3>ランクアップ報酬</h3>
                    <button className={styles.secondaryButton} onClick={addReward}>
                      <i className="material-icons">add</i>
                      報酬追加
                    </button>
                  </div>

                  {editingPreset.rewards.length === 0 ? (
                    <div className={styles.emptyRewards}>
                      <i className="material-icons-outlined">card_giftcard</i>
                      <p>報酬が設定されていません</p>
                      <button className={styles.secondaryButton} onClick={addReward}>
                        <i className="material-icons">add</i>
                        報酬を追加
                      </button>
                    </div>
                  ) : (
                    editingPreset.rewards.map((reward, idx) => (
                      <div key={idx} className={styles.rewardEditor}>
                        <div className={styles.rankEditorHeader}>
                          <span className={styles.rankNumber}>報酬 #{idx + 1}</span>
                          <button 
                            className={styles.iconButton}
                            onClick={() => removeReward(idx)}
                            title="削除"
                          >
                            <i className="material-icons-outlined">delete</i>
                          </button>
                        </div>
                        <div className={styles.rewardFields}>
                          <div className={styles.formGroup}>
                            <label>対象ランク</label>
                            <select
                              value={reward.rankName}
                              onChange={(e) => updateReward(idx, 'rankName', e.target.value)}
                            >
                              {editingPreset.ranks.map(rank => (
                                <option key={rank.name} value={rank.name}>{rank.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className={styles.formGroup}>
                            <label>付与ロール</label>
                            <select
                              value={reward.giveRoleId || ''}
                              onChange={(e) => updateReward(idx, 'giveRoleId', e.target.value || undefined)}
                            >
                              <option value="">なし</option>
                              {roles.map(role => (
                                <option key={role.id} value={role.id}>{role.name}</option>
                              ))}
                            </select>
                            <span className={styles.helpText}>ランク到達時に付与するロール</span>
                          </div>
                          <div className={styles.formGroup}>
                            <label className={styles.checkboxLabel}>
                              <input
                                type="checkbox"
                                checked={reward.notify || false}
                                onChange={(e) => updateReward(idx, 'notify', e.target.checked)}
                              />
                              <span>ランクアップ通知を送信</span>
                            </label>
                          </div>
                          <div className={styles.formGroup}>
                            <label>カスタムメッセージ</label>
                            <textarea
                              value={reward.customMessage || ''}
                              onChange={(e) => updateReward(idx, 'customMessage', e.target.value)}
                              placeholder="例: おめでとうございます！{rank}に到達しました！"
                              rows={2}
                            />
                            <span className={styles.helpText}>変数: {`{rank}`} = ランク名, {`{user}`} = ユーザー名, {`{mention}`} = メンション, {`{oldRank}`} = 前のランク, {`{newRank}`} = 新しいランク, {`{userId}`} = ユーザーID, {`{date}`} = 日付, {`{time}`} = 時刻, {`{timestamp}`} = ISO日時, {`{emoji}`} = 絵文字</span>
                          </div>
                          <div className={styles.formGroup}>
                            <label>Webhook URL</label>
                            <input
                              type="url"
                              value={reward.webhookUrl || ''}
                              onChange={(e) => updateReward(idx, 'webhookUrl', e.target.value || undefined)}
                              placeholder="https://example.com/webhook"
                            />
                            <span className={styles.helpText}>ランクアップ時に外部APIに通知を送信します</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className={styles.modalFooter}>
              <button 
                className={styles.secondaryButton}
                onClick={() => setShowPresetModal(false)}
              >
                キャンセル
              </button>
              <button 
                className={styles.primaryButton}
                onClick={handleSavePreset}
                disabled={saving}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Panel Modal */}
      {showPanelModal && (
        <div className={styles.modal} onClick={() => setShowPanelModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>パネル作成</h2>
              <button className={styles.closeButton} onClick={() => setShowPanelModal(false)}>
                <i className="material-icons">close</i>
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.infoBox}>
                <i className="material-icons-outlined">info</i>
                <p>パネルは Discord コマンド <code>/staff rank action:create-panel</code> から作成してください。</p>
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button 
                className={styles.secondaryButton}
                onClick={() => setShowPanelModal(false)}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* XP Rule Modal */}
      {showRuleModal && editingRule && (
        <div className={styles.modal} onClick={() => setShowRuleModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{editingRule.id.startsWith('new-') ? 'ルール作成' : 'ルール編集'}</h2>
              <button className={styles.closeButton} onClick={() => setShowRuleModal(false)}>
                <i className="material-icons">close</i>
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.formGroup}>
                <label>ルール名 *</label>
                <input
                  type="text"
                  value={editingRule.name}
                  onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                  placeholder="例: メッセージ投稿"
                />
              </div>

              <div className={styles.formGroup}>
                <label>説明</label>
                <textarea
                  value={editingRule.description || ''}
                  onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })}
                  placeholder="このルールの説明"
                  rows={2}
                />
              </div>

              <div className={styles.formGrid}>
                <div className={styles.formGroup}>
                  <label>アクション種別 *</label>
                  <select
                    value={editingRule.actionType}
                    onChange={(e) => setEditingRule({ 
                      ...editingRule, 
                      actionType: e.target.value as any 
                    })}
                  >
                    <option value="message">メッセージ投稿</option>
                    <option value="reaction">リアクション</option>
                    <option value="voiceChat">ボイスチャット</option>
                    <option value="invite">招待</option>
                    <option value="custom">カスタム</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>獲得XP (固定) *</label>
                  <input
                    type="number"
                    value={editingRule.xpReward}
                    onChange={(e) => setEditingRule({ ...editingRule, xpReward: parseInt(e.target.value) || 0 })}
                    min="1"
                  />
                  <span className={styles.helpText}>固定XP値 (ランダム無効時はこちらを使用)</span>
                </div>
                <div className={styles.formGroup}>
                  <label>獲得XP Min</label>
                  <input
                    type="number"
                    value={editingRule.xpRewardMin || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, xpRewardMin: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="ランダム無効"
                    min="1"
                  />
                  <span className={styles.helpText}>ランダムXPの下限</span>
                </div>
                <div className={styles.formGroup}>
                  <label>獲得XP Max</label>
                  <input
                    type="number"
                    value={editingRule.xpRewardMax || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, xpRewardMax: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="ランダム無効"
                    min="1"
                  />
                  <span className={styles.helpText}>ランダムXPの上限</span>
                </div>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.formGroup}>
                  <label>クールダウン (秒)</label>
                  <input
                    type="number"
                    value={editingRule.cooldownSec || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, cooldownSec: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="クールダウンなし"
                    min="0"
                  />
                  <span className={styles.helpText}>同じユーザーが短時間に何度も獲得できないようにします</span>
                </div>
                <div className={styles.formGroup}>
                  <label>1日の上限</label>
                  <input
                    type="number"
                    value={editingRule.maxPerDay || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, maxPerDay: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="上限なし"
                    min="1"
                  />
                  <span className={styles.helpText}>1日に何回までこのルールでXPを獲得できるか</span>
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={editingRule.isActive}
                    onChange={(e) => setEditingRule({ ...editingRule, isActive: e.target.checked })}
                  />
                  <span>このルールを有効にする</span>
                </label>
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button 
                className={styles.secondaryButton}
                onClick={() => setShowRuleModal(false)}
              >
                キャンセル
              </button>
              <button 
                className={styles.primaryButton}
                onClick={handleSaveRule}
                disabled={saving}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation Dialog */}
      {showResetConfirm && (
        <div className={styles.modal} onClick={() => setShowResetConfirm(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>ランクリセット確認</h2>
              <button className={styles.closeButton} onClick={() => setShowResetConfirm(false)}>
                <i className="material-icons">close</i>
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.warningBox}>
                <i className="material-icons-outlined">warning</i>
                <p>このアクションは取り消せません。本当に実行しますか？</p>
              </div>

              <div className={styles.formGroup}>
                <label>リセット対象</label>
                <div className={styles.radioGroup}>
                  <label className={styles.radioLabel}>
                    <input
                      type="radio"
                      checked={resetTarget === 'all'}
                      onChange={() => setResetTarget('all')}
                    />
                    <span>すべてのユーザー</span>
                  </label>
                  <label className={styles.radioLabel}>
                    <input
                      type="radio"
                      checked={resetTarget === 'user'}
                      onChange={() => setResetTarget('user')}
                    />
                    <span>特定のユーザー</span>
                  </label>
                </div>
              </div>

              {resetTarget === 'user' && (
                <div className={styles.formGroup}>
                  <label>ユーザーID *</label>
                  <input
                    type="text"
                    value={resetUserId}
                    onChange={(e) => setResetUserId(e.target.value)}
                    placeholder="ユーザーIDを入力"
                  />
                </div>
              )}
            </div>
            <div className={styles.modalFooter}>
              <button 
                className={styles.secondaryButton}
                onClick={() => setShowResetConfirm(false)}
              >
                <i className="material-icons-outlined">close</i>
                キャンセル
              </button>
              <button 
                className={styles.dangerButton}
                onClick={handleResetRank}
                disabled={saving || (resetTarget === 'user' && !resetUserId)}
              >
                <i className="material-icons-outlined">restart_alt</i>
                {saving ? '実行中...' : 'リセット実行'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RankManagerPage;
