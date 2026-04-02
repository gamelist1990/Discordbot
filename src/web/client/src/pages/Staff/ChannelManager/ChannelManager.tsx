import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styles from './ChannelManager.module.css';

type GuildSummary = { id: string; name: string; icon?: string | null };
type PermissionCatalogItem = { key: string; label: string; bit: string };
type RoleEntry = { id: string; name: string; position: number; color: number; hoist: boolean; mentionable: boolean; editable: boolean; permissionsKeys: string[]; manageableKeys: string[] };
type OverwriteEntry = {
  id: string;
  type: 'role' | 'member';
  targetName: string;
  editable: boolean;
  allow: string;
  deny: string;
  allowKeys: string[];
  denyKeys: string[];
  manageableKeys: string[];
};
type ChannelEntry = {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  position: number;
  manageable: boolean;
  topic: string;
  nsfw: boolean;
  rateLimitPerUser: number;
  bitrate: number;
  userLimit: number;
  overwrites: OverwriteEntry[];
};
type ChannelManagerState = {
  guild: { id: string; name: string; icon?: string | null };
  actor: { id: string; displayName: string; canManageChannels: boolean; canManageRoles: boolean; highestRolePosition: number; manageablePermissionBits: string; manageableRolePermissionBits: string };
  permissionCatalog: PermissionCatalogItem[];
  rolePermissionCatalog: PermissionCatalogItem[];
  roles: RoleEntry[];
  channels: ChannelEntry[];
};

type CreateKind = 'category' | 'text' | 'voice' | 'announcement' | 'forum';
type PermissionMode = 'inherit' | 'allow' | 'deny';
type ContextMenuState =
  | { x: number; y: number; kind: 'channel'; targetId: string }
  | { x: number; y: number; kind: 'role'; targetId: string }
  | null;
type DragState = { channelId: string } | null;
type SurfaceTab = 'channels' | 'roles';

const kindOptions: Array<{ value: CreateKind; label: string }> = [
  { value: 'category', label: 'カテゴリ' },
  { value: 'text', label: 'テキスト' },
  { value: 'voice', label: 'ボイス' },
  { value: 'announcement', label: 'アナウンス' },
  { value: 'forum', label: 'フォーラム' },
];

const channelTypeLabel = (type: number) => {
  switch (type) {
    case 4: return 'カテゴリ';
    case 0: return 'テキスト';
    case 2: return 'ボイス';
    case 5: return 'アナウンス';
    case 15: return 'フォーラム';
    default: return `type:${type}`;
  }
};

const channelIcon = (type: number) => {
  switch (type) {
    case 4: return 'folder';
    case 2: return 'volume_up';
    case 5: return 'campaign';
    case 15: return 'forum';
    default: return 'tag';
  }
};

const ChannelManagerPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialGuildId = searchParams.get('guildId');

  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string>(initialGuildId || '');
  const [state, setState] = useState<ChannelManagerState | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [selectedOverwriteId, setSelectedOverwriteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleSearch, setRoleSearch] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [activeTab, setActiveTab] = useState<SurfaceTab>('channels');
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<string[]>([]);

  const [createKind, setCreateKind] = useState<CreateKind>('text');
  const [createName, setCreateName] = useState('');
  const [createParentId, setCreateParentId] = useState('');

  const [editName, setEditName] = useState('');
  const [editParentId, setEditParentId] = useState('');
  const [editTopic, setEditTopic] = useState('');
  const [editNsfw, setEditNsfw] = useState(false);
  const [editSlowmode, setEditSlowmode] = useState(0);
  const [editBitrate, setEditBitrate] = useState(64000);
  const [editUserLimit, setEditUserLimit] = useState(0);
  const [permissionModes, setPermissionModes] = useState<Record<string, PermissionMode>>({});
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [roleName, setRoleName] = useState('');
  const [roleColor, setRoleColor] = useState('#000000');
  const [roleHoist, setRoleHoist] = useState(false);
  const [roleMentionable, setRoleMentionable] = useState(false);
  const [rolePermissionModes, setRolePermissionModes] = useState<Record<string, boolean>>({});
  const [newRoleName, setNewRoleName] = useState('');

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close);
    };
  }, []);

  useEffect(() => {
    const loadGuilds = async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/staff/guilds', { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'サーバー一覧を取得できませんでした。');
        const nextGuilds = (data.guilds || []) as GuildSummary[];
        setGuilds(nextGuilds);
        if (initialGuildId && nextGuilds.some((guild) => guild.id === initialGuildId)) setSelectedGuildId(initialGuildId);
        else if (!initialGuildId && nextGuilds[0]) setSelectedGuildId(nextGuilds[0].id);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'サーバー一覧を取得できませんでした。');
      } finally {
        setLoading(false);
      }
    };

    loadGuilds();
  }, [initialGuildId]);

  const loadState = async (guildId: string) => {
    if (!guildId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/channel-manager/${guildId}/state`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'チャンネル管理データを取得できませんでした。');
      const nextState = data as ChannelManagerState;
      setState(nextState);
      setSelectedChannelId((current) => nextState.channels.some((channel) => channel.id === current) ? current : nextState.channels[0]?.id || '');
      setCreateParentId('');
    } catch (loadError) {
      setState(null);
      setError(loadError instanceof Error ? loadError.message : 'チャンネル管理データを取得できませんでした。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedGuildId) loadState(selectedGuildId);
  }, [selectedGuildId]);

  const categories = useMemo(() => (state?.channels || []).filter((channel) => channel.type === 4), [state]);
  const selectedChannel = useMemo(() => state?.channels.find((channel) => channel.id === selectedChannelId) || null, [selectedChannelId, state]);
  const editableRoles = useMemo(() => (state?.roles || []).filter((role) => role.editable), [state]);
  const filteredKeyword = search.trim().toLowerCase();
  const filteredRoleKeyword = roleSearch.trim().toLowerCase();
  const canUseCategoryParent = createKind !== 'category';
  const selectedRole = useMemo(() => state?.roles.find((role) => role.id === selectedRoleId) || null, [selectedRoleId, state]);
  const visibleRoles = useMemo(
    () => (state?.roles || []).filter((role) => !filteredRoleKeyword || role.name.toLowerCase().includes(filteredRoleKeyword)),
    [filteredRoleKeyword, state]
  );
  const canEditSelectedRole = Boolean(selectedRole?.editable && state?.actor.canManageRoles);

  useEffect(() => {
    if (!selectedChannel) {
      setSelectedOverwriteId('');
      return;
    }
    setEditName(selectedChannel.name);
    setEditParentId(selectedChannel.parentId || '');
    setEditTopic(selectedChannel.topic || '');
    setEditNsfw(Boolean(selectedChannel.nsfw));
    setEditSlowmode(selectedChannel.rateLimitPerUser || 0);
    setEditBitrate(selectedChannel.bitrate || 64000);
    setEditUserLimit(selectedChannel.userLimit || 0);

    const firstEditable = selectedChannel.overwrites.find((overwrite) => overwrite.editable && overwrite.type === 'role');
    setSelectedOverwriteId((current) => selectedChannel.overwrites.some((overwrite) => overwrite.id === current) ? current : firstEditable?.id || '');
  }, [selectedChannel]);

  const selectedOverwrite = useMemo(
    () => selectedChannel?.overwrites.find((overwrite) => overwrite.id === selectedOverwriteId) || null,
    [selectedChannel, selectedOverwriteId]
  );
  const selectedOverwriteRole = useMemo(
    () => editableRoles.find((role) => role.id === selectedOverwriteId) || null,
    [editableRoles, selectedOverwriteId]
  );

  useEffect(() => {
    if (!selectedOverwriteId) {
      setPermissionModes({});
      return;
    }
    const nextModes: Record<string, PermissionMode> = {};
    (state?.permissionCatalog || []).forEach((permission) => {
      if (selectedOverwrite?.allowKeys.includes(permission.key)) nextModes[permission.key] = 'allow';
      else if (selectedOverwrite?.denyKeys.includes(permission.key)) nextModes[permission.key] = 'deny';
      else nextModes[permission.key] = 'inherit';
    });
    setPermissionModes(nextModes);
  }, [selectedOverwrite, selectedOverwriteId, state]);

  useEffect(() => {
    if (!selectedRole) return;
    setRoleName(selectedRole.name);
    setRoleColor(`#${selectedRole.color.toString(16).padStart(6, '0')}`);
    setRoleHoist(Boolean(selectedRole.hoist));
    setRoleMentionable(Boolean(selectedRole.mentionable));
    const nextModes: Record<string, boolean> = {};
    (state?.rolePermissionCatalog || []).forEach((permission) => {
      nextModes[permission.key] = selectedRole.permissionsKeys.includes(permission.key);
    });
    setRolePermissionModes(nextModes);
  }, [selectedRole, state]);

  const groupedChannels = useMemo(() => {
    const allChannels = state?.channels || [];
    const matches = (channel: ChannelEntry) => !filteredKeyword || channel.name.toLowerCase().includes(filteredKeyword);
    const uncategorized = allChannels.filter((channel) => channel.type !== 4 && !channel.parentId && matches(channel));
    return categories
      .map((category) => ({
        category,
        children: allChannels.filter((channel) => channel.parentId === category.id && matches(channel)),
      }))
      .filter((group) => matches(group.category) || group.children.length > 0)
      .concat(uncategorized.length > 0 ? [{ category: null, children: uncategorized }] : []);
  }, [categories, filteredKeyword, state]);

  const callApi = async (url: string, options?: RequestInit) => {
    const response = await fetch(url, { credentials: 'include', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '操作に失敗しました。');
    return data;
  };

  const syncChannelPermissions = async () => {
    if (!selectedGuildId || !selectedChannel) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await callApi(`/api/staff/channel-manager/${selectedGuildId}/channels/${selectedChannel.id}/sync-category-permissions`, { method: 'POST' });
      setNotice('カテゴリの権限に同期しました。');
      await loadState(selectedGuildId);
      setSelectedChannelId(selectedChannel.id);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : '同期に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const createChannel = async () => {
    if (!selectedGuildId || !createName.trim()) return;
    setCreating(true);
    setNotice(null);
    setError(null);
    try {
      const data = await callApi(`/api/staff/channel-manager/${selectedGuildId}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: createKind, name: createName.trim(), parentId: canUseCategoryParent ? (createParentId || null) : null }),
      });
      setNotice(`${createName.trim()} を作成しました。`);
      setCreateName('');
      setCreateParentId('');
      await loadState(selectedGuildId);
      if (data.channel?.id) setSelectedChannelId(data.channel.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'チャンネルの作成に失敗しました。');
    } finally {
      setCreating(false);
    }
  };

  const saveChannel = async () => {
    if (!selectedGuildId || !selectedChannel) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      await callApi(`/api/staff/channel-manager/${selectedGuildId}/channels/${selectedChannel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          parentId: selectedChannel.type === 4 ? null : (editParentId || null),
          topic: [0, 5, 15].includes(selectedChannel.type) ? editTopic : undefined,
          nsfw: [0, 5, 15].includes(selectedChannel.type) ? editNsfw : undefined,
          rateLimitPerUser: [0, 15].includes(selectedChannel.type) ? editSlowmode : undefined,
          bitrate: selectedChannel.type === 2 ? editBitrate : undefined,
          userLimit: selectedChannel.type === 2 ? editUserLimit : undefined,
        }),
      });
      setNotice(`${editName || selectedChannel.name} を更新しました。`);
      await loadState(selectedGuildId);
      setSelectedChannelId(selectedChannel.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'チャンネル設定の保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const saveOverwrite = async () => {
    if (!selectedGuildId || !selectedChannel || !selectedOverwriteId) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const allow = Object.entries(permissionModes).filter(([, mode]) => mode === 'allow').map(([key]) => key);
      const deny = Object.entries(permissionModes).filter(([, mode]) => mode === 'deny').map(([key]) => key);
      await callApi(`/api/staff/channel-manager/${selectedGuildId}/channels/${selectedChannel.id}/overwrites/${selectedOverwriteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'role', allow, deny }),
      });
      setNotice('権限上書きを保存しました。');
      await loadState(selectedGuildId);
      setSelectedChannelId(selectedChannel.id);
      setSelectedOverwriteId(selectedOverwriteId);
    } catch (overwriteError) {
      setError(overwriteError instanceof Error ? overwriteError.message : '権限上書きの保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const clearOverwrite = async () => {
    if (!selectedGuildId || !selectedChannel || !selectedOverwriteId) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      await callApi(`/api/staff/channel-manager/${selectedGuildId}/channels/${selectedChannel.id}/overwrites/${selectedOverwriteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'role', allow: [], deny: [] }),
      });
      setNotice('権限上書きを削除しました。');
      await loadState(selectedGuildId);
      setSelectedChannelId(selectedChannel.id);
      setSelectedOverwriteId(selectedOverwriteId);
    } catch (overwriteError) {
      setError(overwriteError instanceof Error ? overwriteError.message : '権限上書きの削除に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const reorderChannel = async (draggedChannelId: string, targetChannel: ChannelEntry) => {
    if (!selectedGuildId || !state) return;
    const draggedChannel = state.channels.find((channel) => channel.id === draggedChannelId);
    if (!draggedChannel || draggedChannelId === targetChannel.id || !draggedChannel.manageable) return;

    const targetParentId = targetChannel.type === 4 ? null : targetChannel.parentId;
    const siblings = state.channels
      .filter((channel) => channel.id !== draggedChannelId && channel.type === draggedChannel.type && channel.parentId === targetParentId)
      .sort((left, right) => left.position - right.position);
    const targetIndex = siblings.findIndex((channel) => channel.id === targetChannel.id);
    if (targetIndex < 0) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await callApi(`/api/staff/channel-manager/${selectedGuildId}/channels/${draggedChannelId}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: targetParentId, position: targetIndex }),
      });
      setNotice(`${draggedChannel.name} の並び順を変更しました。`);
      await loadState(selectedGuildId);
      setSelectedChannelId(draggedChannelId);
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : '並び替えに失敗しました。');
    } finally {
      setSaving(false);
      setDragState(null);
    }
  };

  const duplicateChannel = async (channelId: string) => {
    if (!selectedGuildId) return;
    setSaving(true);
    setContextMenu(null);
    setError(null);
    setNotice(null);
    try {
      const data = await callApi(`/api/staff/channel-manager/${selectedGuildId}/channels/${channelId}/duplicate`, { method: 'POST' });
      setNotice('チャンネルを複製しました。');
      await loadState(selectedGuildId);
      if (data.channel?.id) setSelectedChannelId(data.channel.id);
    } catch (duplicateError) {
      setError(duplicateError instanceof Error ? duplicateError.message : '複製に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const deleteChannel = async (channelId: string) => {
    if (!selectedGuildId || !window.confirm('このチャンネルを削除しますか？')) return;
    setSaving(true);
    setContextMenu(null);
    setError(null);
    setNotice(null);
    try {
      await callApi(`/api/staff/channel-manager/${selectedGuildId}/channels/${channelId}`, { method: 'DELETE' });
      setNotice('チャンネルを削除しました。');
      if (selectedChannelId === channelId) setSelectedChannelId('');
      await loadState(selectedGuildId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '削除に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const createRole = async () => {
    if (!selectedGuildId || !newRoleName.trim()) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const data = await callApi(`/api/staff/channel-manager/${selectedGuildId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRoleName.trim(), color: 0, hoist: false, mentionable: false }),
      });
      setNotice('ロールを作成しました。');
      setNewRoleName('');
      await loadState(selectedGuildId);
      if (data.role?.id) setSelectedRoleId(data.role.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'ロールの作成に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const saveRole = async () => {
    if (!selectedGuildId || !selectedRole) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const permissions = Object.entries(rolePermissionModes).filter(([, enabled]) => enabled).map(([key]) => key);
      await callApi(`/api/staff/channel-manager/${selectedGuildId}/roles/${selectedRole.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: roleName,
          color: parseInt(roleColor.replace('#', ''), 16) || 0,
          hoist: roleHoist,
          mentionable: roleMentionable,
          permissions,
        }),
      });
      setNotice('ロールを更新しました。');
      await loadState(selectedGuildId);
      setSelectedRoleId(selectedRole.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'ロールの更新に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const reorderRole = async (draggedRoleId: string, targetRoleId: string) => {
    if (!selectedGuildId || !state || draggedRoleId === targetRoleId) return;
    const roles = state.roles.filter((role) => role.id !== state.guild.id).sort((a, b) => b.position - a.position);
    const targetIndex = roles.findIndex((role) => role.id === targetRoleId);
    if (targetIndex < 0) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await callApi(`/api/staff/channel-manager/${selectedGuildId}/roles/${draggedRoleId}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: Math.max(1, roles.length - targetIndex) }),
      });
      setNotice('ロールの順番を変更しました。');
      await loadState(selectedGuildId);
      setSelectedRoleId(draggedRoleId);
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : 'ロールの並び替えに失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const deleteRole = async (roleId: string) => {
    if (!selectedGuildId || !window.confirm('このロールを削除しますか？')) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await callApi(`/api/staff/channel-manager/${selectedGuildId}/roles/${roleId}`, { method: 'DELETE' });
      setNotice('ロールを削除しました。');
      await loadState(selectedGuildId);
      if (selectedRoleId === roleId) setSelectedRoleId('');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'ロールの削除に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const duplicateRole = async (roleId: string) => {
    if (!selectedGuildId) return;
    setSaving(true);
    setContextMenu(null);
    setError(null);
    setNotice(null);
    try {
      const data = await callApi(`/api/staff/channel-manager/${selectedGuildId}/roles/${roleId}/duplicate`, { method: 'POST' });
      setNotice('ロールを複製しました。');
      await loadState(selectedGuildId);
      if (data.role?.id) setSelectedRoleId(data.role.id);
    } catch (duplicateError) {
      setError(duplicateError instanceof Error ? duplicateError.message : 'ロールの複製に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const copyId = async (id: string, label: string) => {
    await navigator.clipboard.writeText(id).catch(() => null);
    setNotice(`${label} ID をコピーしました。`);
    setContextMenu(null);
  };

  const openChannelContextMenu = (event: React.MouseEvent, channelId: string) => {
    event.preventDefault();
    setSelectedChannelId(channelId);
    setContextMenu({ x: event.clientX, y: event.clientY, kind: 'channel', targetId: channelId });
  };

  const openRoleContextMenu = (event: React.MouseEvent, roleId: string) => {
    event.preventDefault();
    setSelectedRoleId(roleId);
    setContextMenu({ x: event.clientX, y: event.clientY, kind: 'role', targetId: roleId });
  };

  const renderChannelRow = (channel: ChannelEntry, nested = false) => (
    <button
      key={channel.id}
      className={`${styles.channelRow} ${nested ? styles.channelChild : ''} ${selectedChannelId === channel.id ? styles.channelRowActive : ''} ${dragState?.channelId === channel.id ? styles.channelRowDragging : ''}`}
      onClick={() => setSelectedChannelId(channel.id)}
      onContextMenu={(event) => openChannelContextMenu(event, channel.id)}
      type="button"
      draggable={channel.manageable}
      onDragStart={() => setDragState({ channelId: channel.id })}
      onDragOver={(event) => {
        if (!dragState) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (dragState) reorderChannel(dragState.channelId, channel);
      }}
      onDragEnd={() => setDragState(null)}
    >
      <span className="material-icons">{channelIcon(channel.type)}</span>
      <span className={styles.channelRowMain}>
        <strong>{channel.name}</strong>
        <small>{channelTypeLabel(channel.type)} {channel.manageable ? '・ドラッグ可' : '・閲覧のみ'}</small>
      </span>
      <span className="material-icons">{selectedChannelId === channel.id ? 'chevron_right' : 'more_horiz'}</span>
    </button>
  );

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategoryIds((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId]
    );
  };

  return (
    <div className={styles.page} onContextMenu={(event) => event.preventDefault()}>
      <section className={styles.pageHeader}>
        <div className={styles.pageHeaderCopy}>
          <span className={styles.pageEyebrow}>Staff Channel Manager</span>
          <h1>チャンネル一括管理</h1>
          <p>ドラッグで並び替え、右クリックで便利操作、右側で詳細編集まで一つの画面で回せます。</p>
        </div>
        <div className={styles.pageHeaderActions}>
          <button className={styles.secondaryButton} onClick={() => navigate('/staff')} type="button">
            <span className="material-icons">arrow_back</span>
            <span>スタッフ一覧へ</span>
          </button>
          <button className={styles.secondaryButton} onClick={() => selectedGuildId && loadState(selectedGuildId)} type="button" disabled={!selectedGuildId || loading}>
            <span className="material-icons">refresh</span>
            <span>再取得</span>
          </button>
        </div>
      </section>

      {notice ? <div className={styles.noticeSuccess}>{notice}</div> : null}
      {error ? <div className={styles.noticeError}>{error}</div> : null}

      <section className={styles.topBar}>
        <label className={styles.field}>
          <span>対象サーバー</span>
          <select className={styles.select} value={selectedGuildId} onChange={(event) => setSelectedGuildId(event.target.value)}>
            <option value="">選択してください</option>
            {guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>{activeTab === 'channels' ? 'チャンネル検索' : 'ロール検索'}</span>
          <input className={styles.input} type="text" value={activeTab === 'channels' ? search : roleSearch} onChange={(event) => activeTab === 'channels' ? setSearch(event.target.value) : setRoleSearch(event.target.value)} placeholder="名前で絞り込み" />
        </label>
        <div className={styles.quickStats}>
          <div className={styles.statCard}><span>カテゴリ</span><strong>{categories.length}</strong></div>
          <div className={styles.statCard}><span>チャンネル</span><strong>{(state?.channels || []).filter((channel) => channel.type !== 4).length}</strong></div>
          <div className={styles.statCard}><span>操作中</span><strong>{state?.actor.displayName || '-'}</strong></div>
        </div>
      </section>

      {loading ? (
        <div className={styles.statePanel}>読み込み中...</div>
      ) : !state ? (
        <div className={styles.statePanel}>表示できるデータがありません。</div>
      ) : (
        <>
        <div className={styles.tabRow}>
          <button className={`${styles.tabButton} ${activeTab === 'channels' ? styles.tabButtonActive : ''}`} onClick={() => setActiveTab('channels')} type="button">チャンネル</button>
          <button className={`${styles.tabButton} ${activeTab === 'roles' ? styles.tabButtonActive : ''}`} onClick={() => setActiveTab('roles')} type="button">ロール</button>
        </div>
        {activeTab === 'channels' ? (
        <div className={styles.layout}>
          <section className={styles.treePane}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <span className={styles.panelEyebrow}>Tree</span>
                  <h2>チャンネル一覧</h2>
                  <p>ドラッグで順番変更、右クリックで複製や削除ができます。</p>
                </div>
                <button
                  className={styles.miniButton}
                  onClick={() => setCollapsedCategoryIds(categories.map((category) => category.id))}
                  type="button"
                  disabled={categories.length === 0}
                >
                  全て閉じる
                </button>
              </div>
              <div className={styles.channelTree}>
                {groupedChannels.map((group, index) => (
                  <div key={group.category?.id || `none-${index}`} className={styles.channelGroup}>
                    {group.category ? (
                      <>
                        <button
                          className={`${styles.channelRow} ${selectedChannelId === group.category.id ? styles.channelRowActive : ''}`}
                          onClick={() => {
                            setSelectedChannelId(group.category!.id);
                            toggleCategory(group.category!.id);
                          }}
                          onContextMenu={(event) => openChannelContextMenu(event, group.category!.id)}
                          type="button"
                          draggable={group.category.manageable}
                          onDragStart={() => setDragState({ channelId: group.category!.id })}
                          onDragOver={(event) => {
                            if (!dragState) return;
                            event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (dragState) reorderChannel(dragState.channelId, group.category!);
                          }}
                          onDragEnd={() => setDragState(null)}
                        >
                          <span className="material-icons">{collapsedCategoryIds.includes(group.category.id) ? 'folder' : 'folder_open'}</span>
                          <span className={styles.channelRowMain}>
                            <strong>{group.category.name}</strong>
                            <small>{group.category.manageable ? 'クリックで開閉・ドラッグ可' : 'クリックで開閉'}</small>
                          </span>
                          <span className="material-icons">{collapsedCategoryIds.includes(group.category.id) ? 'expand_more' : 'expand_less'}</span>
                        </button>
                      </>
                    ) : <div className={styles.groupLabel}>カテゴリなし</div>}
                    {group.category && collapsedCategoryIds.includes(group.category.id)
                      ? null
                      : group.children.map((channel) => renderChannelRow(channel, true))}
                  </div>
                ))}
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <span className={styles.panelEyebrow}>Create</span>
                  <h2>新規作成</h2>
                </div>
              </div>
              <div className={styles.createGrid}>
                <label className={styles.field}>
                  <span>種類</span>
                  <select className={styles.select} value={createKind} onChange={(event) => setCreateKind(event.target.value as CreateKind)}>
                    {kindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>名前</span>
                  <input className={styles.input} type="text" value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="new-channel" />
                </label>
                {canUseCategoryParent ? (
                  <label className={styles.field}>
                    <span>親カテゴリ</span>
                    <select className={styles.select} value={createParentId} onChange={(event) => setCreateParentId(event.target.value)}>
                      <option value="">なし</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                ) : null}
                <button className={styles.primaryButton} onClick={createChannel} type="button" disabled={creating || !createName.trim()}>
                  <span className="material-icons">add</span>
                  <span>{creating ? '作成中...' : '作成する'}</span>
                </button>
              </div>
            </article>
          </section>

          <section className={styles.editorPane}>
            {!selectedChannel ? (
              <div className={styles.statePanel}>左の一覧からチャンネルを選択してください。</div>
            ) : (
              <>
                <article className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <div>
                      <span className={styles.panelEyebrow}>General</span>
                      <h2>{selectedChannel.name}</h2>
                      <p>{channelTypeLabel(selectedChannel.type)} の基本設定です。</p>
                    </div>
                  </div>
                  <div className={styles.editorGrid}>
                    <label className={styles.field}><span>名前</span><input className={styles.input} type="text" value={editName} onChange={(event) => setEditName(event.target.value)} disabled={!selectedChannel.manageable} /></label>
                    <label className={styles.field}><span>種類</span><input className={styles.input} type="text" value={channelTypeLabel(selectedChannel.type)} disabled /></label>
                    {selectedChannel.type !== 4 ? (
                      <label className={styles.field}>
                        <span>親カテゴリ</span>
                        <select className={styles.select} value={editParentId} onChange={(event) => setEditParentId(event.target.value)} disabled={!selectedChannel.manageable}>
                          <option value="">なし</option>
                          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                        </select>
                      </label>
                    ) : null}
                    {[0, 5, 15].includes(selectedChannel.type) ? <label className={`${styles.field} ${styles.fieldWide}`}><span>トピック / 説明</span><textarea className={styles.textarea} value={editTopic} onChange={(event) => setEditTopic(event.target.value)} disabled={!selectedChannel.manageable} /></label> : null}
                    {[0, 5, 15].includes(selectedChannel.type) ? <label className={styles.checkField}><input type="checkbox" checked={editNsfw} onChange={(event) => setEditNsfw(event.target.checked)} disabled={!selectedChannel.manageable} /><span>NSFW</span></label> : null}
                    {[0, 15].includes(selectedChannel.type) ? <label className={styles.field}><span>低速モード(秒)</span><input className={styles.input} type="number" min={0} value={editSlowmode} onChange={(event) => setEditSlowmode(Number(event.target.value))} disabled={!selectedChannel.manageable} /></label> : null}
                    {selectedChannel.type === 2 ? <label className={styles.field}><span>ビットレート</span><input className={styles.input} type="number" min={8000} value={editBitrate} onChange={(event) => setEditBitrate(Number(event.target.value))} disabled={!selectedChannel.manageable} /></label> : null}
                    {selectedChannel.type === 2 ? <label className={styles.field}><span>人数上限</span><input className={styles.input} type="number" min={0} value={editUserLimit} onChange={(event) => setEditUserLimit(Number(event.target.value))} disabled={!selectedChannel.manageable} /></label> : null}
                  </div>
                  <div className={styles.buttonRow}>
                    {selectedChannel.parentId ? (
                      <button className={styles.secondaryButton} onClick={syncChannelPermissions} type="button" disabled={saving || !selectedChannel.manageable}>
                        <span className="material-icons">account_tree</span>
                        <span>カテゴリ権限に戻す</span>
                      </button>
                    ) : null}
                    <button className={styles.primaryButton} onClick={saveChannel} type="button" disabled={saving || !selectedChannel.manageable}>
                      <span className="material-icons">save</span>
                      <span>{saving ? '保存中...' : '基本設定を保存'}</span>
                    </button>
                  </div>
                </article>

                <article className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <div>
                      <span className={styles.panelEyebrow}>Permissions</span>
                      <h2>権限上書き</h2>
                      <p>自分が持つ権限の範囲だけ編集できます。</p>
                    </div>
                  </div>
                  <div className={styles.roleStrip}>
                    {editableRoles.map((role) => (
                      <button key={role.id} className={`${styles.roleChip} ${selectedOverwriteId === role.id ? styles.roleChipActive : ''}`} onClick={() => setSelectedOverwriteId(role.id)} type="button">
                        {role.name}
                      </button>
                    ))}
                  </div>
                  {selectedOverwriteRole ? (
                    <>
                      <div className={styles.overwriteSummary}>
                        <strong>{selectedOverwriteRole.name}</strong>
                        <span>{selectedOverwrite ? '既存の上書きを編集中' : 'このロールに新しく上書きを追加できます'}</span>
                      </div>
                      <div className={styles.permissionTable}>
                        {state.permissionCatalog.map((permission) => {
                          const overwriteManageable = selectedOverwrite
                            ? selectedOverwrite.manageableKeys.includes(permission.key)
                            : true;
                          return (
                            <div key={permission.key} className={styles.permissionRow}>
                              <div>
                                <strong>{permission.label}</strong>
                                <div className={styles.permissionKey}>{permission.key}</div>
                              </div>
                              <select className={styles.select} value={permissionModes[permission.key] || 'inherit'} onChange={(event) => setPermissionModes((current) => ({ ...current, [permission.key]: event.target.value as PermissionMode }))} disabled={!selectedChannel.manageable || !selectedOverwrite.editable || !overwriteManageable}>
                                <option value="inherit">継承</option>
                                <option value="allow">許可</option>
                                <option value="deny">拒否</option>
                              </select>
                            </div>
                          );
                        })}
                      </div>
                      <div className={styles.buttonRow}>
                        <button className={styles.primaryButton} onClick={saveOverwrite} type="button" disabled={saving || !selectedChannel.manageable || !selectedOverwriteRole.editable}>
                          <span className="material-icons">verified_user</span>
                          <span>{saving ? '保存中...' : selectedOverwrite ? '権限上書きを保存' : 'このロールに上書きを追加'}</span>
                        </button>
                        <button className={styles.secondaryButton} onClick={clearOverwrite} type="button" disabled={saving || !selectedChannel.manageable || !selectedOverwriteRole.editable}>
                          <span className="material-icons">remove_circle</span>
                          <span>上書きを削除</span>
                        </button>
                      </div>
                    </>
                  ) : <div className={styles.statePanel}>編集したいロールを選択してください。</div>}
                </article>
              </>
            )}
          </section>
        </div>
        ) : (
        <div className={styles.layout}>
          <section className={styles.treePane}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <span className={styles.panelEyebrow}>Roles</span>
                  <h2>ロール一覧</h2>
                  <p>見やすい一覧から選択して、順番と権限をまとめて調整できます。</p>
                </div>
              </div>
              <div className={styles.channelTree}>
                {visibleRoles.filter((role) => role.id !== state.guild.id).map((role) => (
                  <button
                    key={role.id}
                    className={`${styles.channelRow} ${selectedRoleId === role.id ? styles.channelRowActive : ''}`}
                    onClick={() => setSelectedRoleId(role.id)}
                    onContextMenu={(event) => openRoleContextMenu(event, role.id)}
                    type="button"
                    draggable={role.editable}
                    onDragStart={() => setDragState({ channelId: role.id })}
                    onDragOver={(event) => { if (dragState) event.preventDefault(); }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragState) reorderRole(dragState.channelId, role.id);
                    }}
                    onDragEnd={() => setDragState(null)}
                  >
                    <span
                      className="material-icons"
                      style={{ color: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#55707a' }}
                    >
                      shield
                    </span>
                    <span className={styles.channelRowMain}>
                      <strong>{role.name}</strong>
                      <small>{role.editable ? 'ドラッグで並び替え可' : '閲覧のみ'}</small>
                    </span>
                    <span className="material-icons">chevron_right</span>
                  </button>
                ))}
              </div>
            </article>
            <article className={styles.panel}>
              <div className={styles.panelHeader}><div><span className={styles.panelEyebrow}>Create</span><h2>ロール作成</h2></div></div>
              <div className={styles.createGrid}>
                <label className={styles.field}><span>名前</span><input className={styles.input} type="text" value={newRoleName} onChange={(event) => setNewRoleName(event.target.value)} placeholder="new-role" /></label>
                <button className={styles.primaryButton} onClick={createRole} type="button" disabled={saving || !newRoleName.trim()}>
                  <span className="material-icons">add</span><span>作成する</span>
                </button>
              </div>
            </article>
          </section>
          <section className={styles.editorPane}>
            {!selectedRole ? (
              <div className={styles.statePanel}>左の一覧からロールを選択してください。</div>
            ) : (
              <>
                <article className={styles.panel}>
                  <div className={styles.panelHeader}><div><span className={styles.panelEyebrow}>General</span><h2>{selectedRole.name}</h2><p>ロールの基本設定です。</p></div></div>
                  <div className={styles.editorGrid}>
                    <label className={styles.field}><span>名前</span><input className={styles.input} type="text" value={roleName} onChange={(event) => setRoleName(event.target.value)} disabled={!selectedRole.editable} /></label>
                    <label className={styles.field}><span>色</span><input className={`${styles.input} ${styles.colorInput}`} type="color" value={roleColor} onChange={(event) => setRoleColor(event.target.value)} disabled={!canEditSelectedRole} /></label>
                    <label className={styles.checkField}><input className={styles.checkboxInput} type="checkbox" checked={roleHoist} onChange={(event) => setRoleHoist(event.target.checked)} disabled={!canEditSelectedRole} /><span>メンバー一覧に分離表示</span></label>
                    <label className={styles.checkField}><input className={styles.checkboxInput} type="checkbox" checked={roleMentionable} onChange={(event) => setRoleMentionable(event.target.checked)} disabled={!canEditSelectedRole} /><span>メンション可能</span></label>
                  </div>
                  <div className={styles.buttonRow}>
                    <button className={styles.primaryButton} onClick={saveRole} type="button" disabled={saving || !canEditSelectedRole}><span className="material-icons">save</span><span>ロールを保存</span></button>
                    <button className={styles.secondaryButton} onClick={() => deleteRole(selectedRole.id)} type="button" disabled={saving || !canEditSelectedRole}><span className="material-icons">delete</span><span>削除</span></button>
                  </div>
                </article>
                <article className={styles.panel}>
                  <div className={styles.panelHeader}><div><span className={styles.panelEyebrow}>Permissions</span><h2>ロール権限</h2><p>自分が持っている範囲だけ付け外しできます。</p></div></div>
                  <div className={styles.permissionTable}>
                    {state.rolePermissionCatalog.map((permission) => (
                      <label key={permission.key} className={styles.permissionRow}>
                        <div><strong>{permission.label}</strong><div className={styles.permissionKey}>{permission.key}</div></div>
                        <input className={styles.checkboxInput} type="checkbox" checked={Boolean(rolePermissionModes[permission.key])} onChange={(event) => setRolePermissionModes((current) => ({ ...current, [permission.key]: event.target.checked }))} disabled={!canEditSelectedRole || !selectedRole.manageableKeys.includes(permission.key)} />
                      </label>
                    ))}
                  </div>
                </article>
              </>
            )}
          </section>
        </div>
        )}
        </>
      )}

      {contextMenu ? (
        <div className={styles.contextMenu} style={{ left: contextMenu.x, top: contextMenu.y }}>
          {contextMenu.kind === 'channel' ? (
            <>
              <button className={styles.contextItem} onClick={() => duplicateChannel(contextMenu.targetId)} type="button">
                <span className="material-icons">content_copy</span>
                <span>複製</span>
              </button>
              <button className={styles.contextItem} onClick={() => deleteChannel(contextMenu.targetId)} type="button">
                <span className="material-icons">delete</span>
                <span>削除</span>
              </button>
              <button className={styles.contextItem} onClick={() => copyId(contextMenu.targetId, 'チャンネル')} type="button">
                <span className="material-icons">content_paste</span>
                <span>ID をコピー</span>
              </button>
            </>
          ) : (
            <>
              <button className={styles.contextItem} onClick={() => duplicateRole(contextMenu.targetId)} type="button">
                <span className="material-icons">content_copy</span>
                <span>複製</span>
              </button>
              <button className={styles.contextItem} onClick={() => deleteRole(contextMenu.targetId)} type="button">
                <span className="material-icons">delete</span>
                <span>削除</span>
              </button>
              <button className={styles.contextItem} onClick={() => copyId(contextMenu.targetId, 'ロール')} type="button">
                <span className="material-icons">content_paste</span>
                <span>ID をコピー</span>
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default ChannelManagerPage;
