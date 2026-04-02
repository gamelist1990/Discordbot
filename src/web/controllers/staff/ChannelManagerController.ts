import { Request, Response } from 'express';
import {
    ChannelType,
    Guild,
    GuildChannel,
    OverwriteType,
    PermissionFlagsBits,
    PermissionsBitField,
    Role
} from 'discord.js';
import { BotClient } from '../../../core/BotClient.js';
import { SettingsSession } from '../../types/index.js';

type SessionLike = SettingsSession & {
    guilds?: Array<{ id?: string; guildId?: string }>;
};

type ManagedPermissionKey =
    | 'ViewChannel'
    | 'SendMessages'
    | 'ReadMessageHistory'
    | 'ManageMessages'
    | 'ManageChannels'
    | 'ManageThreads'
    | 'CreatePublicThreads'
    | 'CreatePrivateThreads'
    | 'SendMessagesInThreads'
    | 'EmbedLinks'
    | 'AttachFiles'
    | 'AddReactions'
    | 'UseExternalEmojis'
    | 'UseExternalStickers'
    | 'MentionEveryone'
    | 'UseApplicationCommands'
    | 'Connect'
    | 'Speak'
    | 'Stream'
    | 'UseVAD';

type CreateChannelType =
    | ChannelType.GuildCategory
    | ChannelType.GuildText
    | ChannelType.GuildVoice
    | ChannelType.GuildAnnouncement
    | ChannelType.GuildForum;

type ManagedRolePermissionKey =
    | 'Administrator'
    | 'ManageGuild'
    | 'ViewAuditLog'
    | 'ManageChannels'
    | 'ManageRoles'
    | 'ManageMessages'
    | 'ManageThreads'
    | 'ModerateMembers'
    | 'KickMembers'
    | 'BanMembers'
    | 'MentionEveryone'
    | 'ManageWebhooks'
    | 'UseApplicationCommands'
    | 'ManageNicknames'
    | 'ChangeNickname'
    | 'MoveMembers'
    | 'MuteMembers'
    | 'DeafenMembers'
    | 'PrioritySpeaker'
    | 'CreateInstantInvite';

const MANAGED_PERMISSIONS: Array<{ key: ManagedPermissionKey; label: string }> = [
    { key: 'ViewChannel', label: 'チャンネルを見る' },
    { key: 'SendMessages', label: 'メッセージ送信' },
    { key: 'ReadMessageHistory', label: '履歴を見る' },
    { key: 'ManageMessages', label: 'メッセージ管理' },
    { key: 'ManageChannels', label: 'チャンネル管理' },
    { key: 'ManageThreads', label: 'スレッド管理' },
    { key: 'CreatePublicThreads', label: '公開スレッド作成' },
    { key: 'CreatePrivateThreads', label: '非公開スレッド作成' },
    { key: 'SendMessagesInThreads', label: 'スレッド送信' },
    { key: 'EmbedLinks', label: '埋め込みリンク' },
    { key: 'AttachFiles', label: 'ファイル添付' },
    { key: 'AddReactions', label: 'リアクション追加' },
    { key: 'UseExternalEmojis', label: '外部絵文字' },
    { key: 'UseExternalStickers', label: '外部スタンプ' },
    { key: 'MentionEveryone', label: '@everyone / @here' },
    { key: 'UseApplicationCommands', label: 'アプリコマンド使用' },
    { key: 'Connect', label: 'VC接続' },
    { key: 'Speak', label: 'VC発言' },
    { key: 'Stream', label: '画面共有' },
    { key: 'UseVAD', label: '音声感知' }
];

const MANAGED_ROLE_PERMISSIONS: Array<{ key: ManagedRolePermissionKey; label: string }> = [
    { key: 'Administrator', label: '管理者' },
    { key: 'ManageGuild', label: 'サーバー管理' },
    { key: 'ViewAuditLog', label: '監査ログを見る' },
    { key: 'ManageChannels', label: 'チャンネル管理' },
    { key: 'ManageRoles', label: 'ロール管理' },
    { key: 'ManageMessages', label: 'メッセージ管理' },
    { key: 'ManageThreads', label: 'スレッド管理' },
    { key: 'ModerateMembers', label: 'メンバーをタイムアウト' },
    { key: 'KickMembers', label: 'キック' },
    { key: 'BanMembers', label: 'BAN' },
    { key: 'MentionEveryone', label: '@everyone / @here' },
    { key: 'ManageWebhooks', label: 'Webhook 管理' },
    { key: 'UseApplicationCommands', label: 'アプリコマンド使用' },
    { key: 'ManageNicknames', label: 'ニックネーム管理' },
    { key: 'ChangeNickname', label: '自分のニックネーム変更' },
    { key: 'MoveMembers', label: 'VC移動' },
    { key: 'MuteMembers', label: 'VCミュート' },
    { key: 'DeafenMembers', label: 'VC聞こえない化' },
    { key: 'PrioritySpeaker', label: '優先スピーカー' },
    { key: 'CreateInstantInvite', label: '招待作成' }
];

export class ChannelManagerController {
    constructor(private botClient: BotClient) {}

    getState = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const session = (req as any).session as SessionLike;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const actor = await guild.members.fetch(session.userId).catch(() => null);
            if (!actor) {
                res.status(403).json({ error: 'Guild member not found' });
                return;
            }

            const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
            const canManageChannels = !!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)
                && (actor.permissions.has(PermissionFlagsBits.ManageChannels) || actor.permissions.has(PermissionFlagsBits.Administrator));
            const canManageRoles = !!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)
                && (actor.permissions.has(PermissionFlagsBits.ManageRoles) || actor.permissions.has(PermissionFlagsBits.Administrator));
            if (!canManageChannels && !canManageRoles) {
                res.status(403).json({ error: 'Manage Channels or Manage Roles permission is required' });
                return;
            }

            const actorPermissionBits = getActorManagedPermissions(actor.permissions);
            const actorRolePermissionBits = getActorRolePermissions(actor.permissions);
            const highestRolePosition = actor.roles.highest?.position || 0;
            const channels = guild.channels.cache
                .filter((channel) => 'rawPosition' in channel)
                .sort((left: any, right: any) => left.rawPosition - right.rawPosition)
                .map((channel) => serializeChannel(channel as GuildChannel, guild, actor, actorPermissionBits, highestRolePosition));

            const roles = guild.roles.cache
                .sort((left, right) => right.position - left.position)
                .map((role) => serializeRole(role, guild, actor, highestRolePosition, actorRolePermissionBits));

            res.json({
                guild: {
                    id: guild.id,
                    name: guild.name,
                    icon: guild.iconURL()
                },
                actor: {
                    id: actor.id,
                    displayName: actor.displayName,
                    canManageChannels,
                    canManageRoles,
                    highestRolePosition,
                    manageablePermissionBits: actorPermissionBits.bitfield.toString(),
                    manageableRolePermissionBits: actorRolePermissionBits.bitfield.toString()
                },
                permissionCatalog: MANAGED_PERMISSIONS.map((permission) => ({
                    ...permission,
                    bit: String(PermissionFlagsBits[permission.key])
                })),
                rolePermissionCatalog: MANAGED_ROLE_PERMISSIONS.map((permission) => ({
                    ...permission,
                    bit: String(PermissionFlagsBits[permission.key])
                })),
                roles,
                channels
            });
        } catch (error) {
            console.error('ChannelManagerController.getState failed:', error);
            res.status(500).json({ error: 'Failed to load channel manager state' });
        }
    };

    createChannel = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const session = (req as any).session as SessionLike;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const actor = await requireActorWithManageChannels(guild, session.userId);
            if (!actor.ok) {
                res.status(actor.status).json({ error: actor.error });
                return;
            }

            const { name, kind, parentId } = req.body as { name?: string; kind?: string; parentId?: string | null };
            const trimmedName = (name || '').trim();
            if (!trimmedName) {
                res.status(400).json({ error: 'name is required' });
                return;
            }

            const parent = parentId ? await guild.channels.fetch(parentId).catch(() => null) : null;
            if (parentId && (!parent || parent.type !== ChannelType.GuildCategory)) {
                res.status(400).json({ error: 'parentId must be a category channel' });
                return;
            }
            if (parent && !canManageChannel(actor.member, parent as GuildChannel)) {
                res.status(403).json({ error: 'You cannot create channels in that category' });
                return;
            }

            const type = parseCreateChannelType(kind);
            if (type === null) {
                res.status(400).json({ error: 'Unsupported channel kind' });
                return;
            }

            const created = await guild.channels.create({
                name: trimmedName,
                type,
                parent: parent && type !== ChannelType.GuildCategory ? parent.id : undefined
            });

            res.json({ success: true, channel: serializeChannel(created as GuildChannel, guild, actor.member, actor.actorPermissionBits, actor.highestRolePosition) });
        } catch (error) {
            console.error('ChannelManagerController.createChannel failed:', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create channel' });
        }
    };

    updateChannel = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, channelId } = req.params;
            const session = (req as any).session as SessionLike;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const actor = await requireActorWithManageChannels(guild, session.userId);
            if (!actor.ok) {
                res.status(actor.status).json({ error: actor.error });
                return;
            }

            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel || !('edit' in channel)) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            if (!canManageChannel(actor.member, channel as GuildChannel)) {
                res.status(403).json({ error: 'You cannot edit this channel' });
                return;
            }

            const body = req.body as {
                name?: string;
                parentId?: string | null;
                topic?: string | null;
                nsfw?: boolean;
                rateLimitPerUser?: number;
                bitrate?: number;
                userLimit?: number;
            };

            const parent = body.parentId ? await guild.channels.fetch(body.parentId).catch(() => null) : null;
            if (body.parentId && (!parent || parent.type !== ChannelType.GuildCategory)) {
                res.status(400).json({ error: 'parentId must be a category channel' });
                return;
            }
            if (parent && !canManageChannel(actor.member, parent as GuildChannel)) {
                res.status(403).json({ error: 'You cannot move this channel to that category' });
                return;
            }

            const patch: Record<string, unknown> = {};
            if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
            if (body.parentId !== undefined) patch.parent = body.parentId || null;
            if (typeof body.topic === 'string' || body.topic === null) patch.topic = body.topic || null;
            if (typeof body.nsfw === 'boolean') patch.nsfw = body.nsfw;
            if (typeof body.rateLimitPerUser === 'number') patch.rateLimitPerUser = Math.max(0, body.rateLimitPerUser);
            if (typeof body.bitrate === 'number') patch.bitrate = Math.max(8000, body.bitrate);
            if (typeof body.userLimit === 'number') patch.userLimit = Math.max(0, body.userLimit);

            const updated = await (channel as any).edit(patch);
            res.json({ success: true, channel: serializeChannel(updated as GuildChannel, guild, actor.member, actor.actorPermissionBits, actor.highestRolePosition) });
        } catch (error) {
            console.error('ChannelManagerController.updateChannel failed:', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update channel' });
        }
    };

    moveChannel = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, channelId } = req.params;
            const session = (req as any).session as SessionLike;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const actor = await requireActorWithManageChannels(guild, session.userId);
            if (!actor.ok) {
                res.status(actor.status).json({ error: actor.error });
                return;
            }

            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel || !('setPosition' in channel)) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            if (!canManageChannel(actor.member, channel as GuildChannel)) {
                res.status(403).json({ error: 'You cannot move this channel' });
                return;
            }

            const { direction } = req.body as { direction?: 'up' | 'down' };
            if (direction !== 'up' && direction !== 'down') {
                res.status(400).json({ error: 'direction must be up or down' });
                return;
            }

            const siblings = guild.channels.cache
                .filter((entry) => entry.parentId === channel.parentId && entry.type === channel.type)
                .sort((left: any, right: any) => left.rawPosition - right.rawPosition)
                .toJSON() as GuildChannel[];
            const index = siblings.findIndex((entry) => entry.id === channel.id);
            const targetIndex = direction === 'up' ? index - 1 : index + 1;
            const target = index >= 0 ? siblings[targetIndex] : null;

            if (!target) {
                res.status(400).json({ error: 'Channel cannot be moved further in that direction' });
                return;
            }
            if (!canManageChannel(actor.member, target as GuildChannel)) {
                res.status(403).json({ error: 'You cannot swap with that channel' });
                return;
            }

            await (channel as GuildChannel).setPosition(target.rawPosition);
            res.json({ success: true });
        } catch (error) {
            console.error('ChannelManagerController.moveChannel failed:', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to move channel' });
        }
    };

    reorderChannel = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, channelId } = req.params;
            const session = (req as any).session as SessionLike;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const actor = await requireActorWithManageChannels(guild, session.userId);
            if (!actor.ok) {
                res.status(actor.status).json({ error: actor.error });
                return;
            }

            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel || !('setPosition' in channel)) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            if (!canManageChannel(actor.member, channel as GuildChannel)) {
                res.status(403).json({ error: 'You cannot move this channel' });
                return;
            }

            const { parentId, position } = req.body as { parentId?: string | null; position?: number };
            const targetParent = parentId ? await guild.channels.fetch(parentId).catch(() => null) : null;
            if (parentId && (!targetParent || targetParent.type !== ChannelType.GuildCategory)) {
                res.status(400).json({ error: 'parentId must be a category channel' });
                return;
            }
            if (targetParent && !canManageChannel(actor.member, targetParent as GuildChannel)) {
                res.status(403).json({ error: 'You cannot move this channel into that category' });
                return;
            }

            if ((channel as GuildChannel).type !== ChannelType.GuildCategory && parentId !== undefined) {
                await (channel as GuildChannel).setParent(parentId || null, { lockPermissions: false });
            }

            const siblingChannels = guild.channels.cache
                .filter((entry) =>
                    entry.id !== channel.id
                    && entry.type === channel.type
                    && entry.parentId === (channel.type === ChannelType.GuildCategory ? null : (parentId !== undefined ? (parentId || null) : channel.parentId))
                )
                .sort((left: any, right: any) => left.rawPosition - right.rawPosition)
                .toJSON() as GuildChannel[];

            const boundedPosition = Math.max(0, Math.min(Number(position) || 0, siblingChannels.length));
            await (channel as GuildChannel).setPosition(boundedPosition);

            res.json({ success: true });
        } catch (error) {
            console.error('ChannelManagerController.reorderChannel failed:', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to reorder channel' });
        }
    };

    syncChannelPermissions = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, channelId } = req.params;
            const session = (req as any).session as SessionLike;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const actor = await requireActorWithManageChannels(guild, session.userId);
            if (!actor.ok) {
                res.status(actor.status).json({ error: actor.error });
                return;
            }

            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel || !('lockPermissions' in channel)) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            if (!(channel as GuildChannel).parentId) {
                res.status(400).json({ error: 'This channel does not belong to a category' });
                return;
            }
            if (!canManageChannel(actor.member, channel as GuildChannel)) {
                res.status(403).json({ error: 'You cannot sync this channel' });
                return;
            }

            await (channel as any).lockPermissions();
            res.json({ success: true });
        } catch (error) {
            console.error('ChannelManagerController.syncChannelPermissions failed:', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to sync permissions' });
        }
    };

    duplicateChannel = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, channelId } = req.params;
            const session = (req as any).session as SessionLike;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const actor = await requireActorWithManageChannels(guild, session.userId);
            if (!actor.ok) {
                res.status(actor.status).json({ error: actor.error });
                return;
            }

            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel || !('name' in channel)) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            if (!canManageChannel(actor.member, channel as GuildChannel)) {
                res.status(403).json({ error: 'You cannot duplicate this channel' });
                return;
            }

            const source = channel as GuildChannel;
            const permissionOverwrites = source.permissionOverwrites.cache
                .filter((overwrite) => {
                    if (overwrite.type !== OverwriteType.Role) return false;
                    if (overwrite.id === guild.id) return true;
                    const role = guild.roles.cache.get(overwrite.id);
                    return !!role && canEditRole(actor.member, role, actor.highestRolePosition);
                })
                .map((overwrite) => ({
                    id: overwrite.id,
                    allow: overwrite.allow,
                    deny: overwrite.deny,
                    type: overwrite.type
                }));

            const cloned = await guild.channels.create({
                name: `${source.name}-copy`,
                type: source.type as CreateChannelType,
                parent: source.type === ChannelType.GuildCategory ? undefined : ((source.parentId || undefined) as string | undefined),
                topic: ('topic' in source ? (source.topic || undefined) : undefined) as string | undefined,
                nsfw: 'nsfw' in source ? Boolean((source as any).nsfw) : undefined,
                rateLimitPerUser: 'rateLimitPerUser' in source ? Number((source as any).rateLimitPerUser || 0) : undefined,
                bitrate: 'bitrate' in source ? Number((source as any).bitrate || 0) : undefined,
                userLimit: 'userLimit' in source ? Number((source as any).userLimit || 0) : undefined,
                permissionOverwrites
            });

            res.json({
                success: true,
                channel: serializeChannel(cloned as GuildChannel, guild, actor.member, actor.actorPermissionBits, actor.highestRolePosition)
            });
        } catch (error) {
            console.error('ChannelManagerController.duplicateChannel failed:', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to duplicate channel' });
        }
    };

    deleteChannel = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, channelId } = req.params;
            const session = (req as any).session as SessionLike;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const actor = await requireActorWithManageChannels(guild, session.userId);
            if (!actor.ok) {
                res.status(actor.status).json({ error: actor.error });
                return;
            }

            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel || !('delete' in channel)) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            if (!canManageChannel(actor.member, channel as GuildChannel)) {
                res.status(403).json({ error: 'You cannot delete this channel' });
                return;
            }

            await (channel as GuildChannel).delete('Deleted from staff channel manager');
            res.json({ success: true });
        } catch (error) {
            console.error('ChannelManagerController.deleteChannel failed:', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete channel' });
        }
    };

    updateOverwrite = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, channelId, targetId } = req.params;
            const session = (req as any).session as SessionLike;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const actor = await requireActorWithManageChannels(guild, session.userId);
            if (!actor.ok) {
                res.status(actor.status).json({ error: actor.error });
                return;
            }

            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel || !('permissionOverwrites' in channel)) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            if (!canManageChannel(actor.member, channel as GuildChannel)) {
                res.status(403).json({ error: 'You cannot edit permissions on this channel' });
                return;
            }

            const body = req.body as { allow?: string[]; deny?: string[]; type?: 'role' | 'member' };
            if (body.type === 'member') {
                res.status(400).json({ error: 'Only role overwrites are supported in this UI' });
                return;
            }

            const targetRole = guild.roles.cache.get(targetId);
            if (!targetRole) {
                res.status(404).json({ error: 'Role not found' });
                return;
            }
            if (!canEditRole(actor.member, targetRole, actor.highestRolePosition)) {
                res.status(403).json({ error: 'You cannot edit overwrites for that role' });
                return;
            }

            const allowKeys = toPermissionKeys(body.allow || [], actor.actorPermissionBits);
            const denyKeys = toPermissionKeys(body.deny || [], actor.actorPermissionBits);

            if (allowKeys.some((key) => denyKeys.includes(key))) {
                res.status(400).json({ error: 'A permission cannot be both allowed and denied' });
                return;
            }

            if (allowKeys.length === 0 && denyKeys.length === 0) {
                await (channel as GuildChannel).permissionOverwrites.delete(targetId).catch(() => null);
            } else {
                const overwritePatch: Record<string, boolean | null> = {};
                for (const permission of MANAGED_PERMISSIONS) {
                    overwritePatch[permission.key] = allowKeys.includes(permission.key)
                        ? true
                        : denyKeys.includes(permission.key)
                            ? false
                            : null;
                }
                await (channel as GuildChannel).permissionOverwrites.edit(targetId, {
                    ...overwritePatch
                });
            }

            const refreshed = await guild.channels.fetch(channelId).catch(() => null);
            res.json({
                success: true,
                channel: refreshed ? serializeChannel(refreshed as GuildChannel, guild, actor.member, actor.actorPermissionBits, actor.highestRolePosition) : null
            });
        } catch (error) {
            console.error('ChannelManagerController.updateOverwrite failed:', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update overwrite' });
        }
    };

    createRole = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const session = (req as any).session as SessionLike;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }
            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }
            const actor = await requireActorWithManageRoles(guild, session.userId);
            if (!actor.ok) {
                res.status(actor.status).json({ error: actor.error });
                return;
            }
            const { name, color, hoist, mentionable } = req.body as { name?: string; color?: number; hoist?: boolean; mentionable?: boolean };
            if (!name?.trim()) {
                res.status(400).json({ error: 'name is required' });
                return;
            }
            const role = await guild.roles.create({
                name: name.trim(),
                color: typeof color === 'number' ? color : 0,
                hoist: Boolean(hoist),
                mentionable: Boolean(mentionable),
                permissions: []
            });
            res.json({ success: true, role: serializeRole(role, guild, actor.member, actor.highestRolePosition, actor.actorRolePermissionBits) });
        } catch (error) {
            console.error('ChannelManagerController.createRole failed:', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create role' });
        }
    };

    updateRole = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, roleId } = req.params;
            const session = (req as any).session as SessionLike;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }
            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }
            const actor = await requireActorWithManageRoles(guild, session.userId);
            if (!actor.ok) {
                res.status(actor.status).json({ error: actor.error });
                return;
            }
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                res.status(404).json({ error: 'Role not found' });
                return;
            }
            if (!canEditRole(actor.member, role, actor.highestRolePosition)) {
                res.status(403).json({ error: 'You cannot edit this role' });
                return;
            }
            const body = req.body as { name?: string; color?: number; hoist?: boolean; mentionable?: boolean; permissions?: string[] };
            const patch: Record<string, unknown> = {};
            if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
            if (typeof body.color === 'number') patch.color = body.color;
            if (typeof body.hoist === 'boolean') patch.hoist = body.hoist;
            if (typeof body.mentionable === 'boolean') patch.mentionable = body.mentionable;
            if (Array.isArray(body.permissions)) {
                patch.permissions = new PermissionsBitField(toRolePermissionKeys(body.permissions, actor.actorRolePermissionBits).map((key) => PermissionFlagsBits[key]));
            }
            const updated = await role.edit(patch);
            res.json({ success: true, role: serializeRole(updated, guild, actor.member, actor.highestRolePosition, actor.actorRolePermissionBits) });
        } catch (error) {
            console.error('ChannelManagerController.updateRole failed:', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update role' });
        }
    };

    reorderRole = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, roleId } = req.params;
            const session = (req as any).session as SessionLike;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }
            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }
            const actor = await requireActorWithManageRoles(guild, session.userId);
            if (!actor.ok) {
                res.status(actor.status).json({ error: actor.error });
                return;
            }
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                res.status(404).json({ error: 'Role not found' });
                return;
            }
            if (!canEditRole(actor.member, role, actor.highestRolePosition)) {
                res.status(403).json({ error: 'You cannot move this role' });
                return;
            }
            const { position } = req.body as { position?: number };
            await role.setPosition(Math.max(1, Number(position) || 1));
            res.json({ success: true });
        } catch (error) {
            console.error('ChannelManagerController.reorderRole failed:', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to reorder role' });
        }
    };

    duplicateRole = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, roleId } = req.params;
            const session = (req as any).session as SessionLike;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }
            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }
            const actor = await requireActorWithManageRoles(guild, session.userId);
            if (!actor.ok) {
                res.status(actor.status).json({ error: actor.error });
                return;
            }
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                res.status(404).json({ error: 'Role not found' });
                return;
            }
            if (!canEditRole(actor.member, role, actor.highestRolePosition)) {
                res.status(403).json({ error: 'You cannot duplicate this role' });
                return;
            }

            const duplicated = await guild.roles.create({
                name: `${role.name}-copy`,
                color: role.color,
                hoist: role.hoist,
                mentionable: role.mentionable,
                permissions: role.permissions
            });

            res.json({ success: true, role: serializeRole(duplicated, guild, actor.member, actor.highestRolePosition, actor.actorRolePermissionBits) });
        } catch (error) {
            console.error('ChannelManagerController.duplicateRole failed:', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to duplicate role' });
        }
    };

    deleteRole = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, roleId } = req.params;
            const session = (req as any).session as SessionLike;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }
            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }
            const actor = await requireActorWithManageRoles(guild, session.userId);
            if (!actor.ok) {
                res.status(actor.status).json({ error: actor.error });
                return;
            }
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                res.status(404).json({ error: 'Role not found' });
                return;
            }
            if (!canEditRole(actor.member, role, actor.highestRolePosition)) {
                res.status(403).json({ error: 'You cannot delete this role' });
                return;
            }
            await role.delete('Deleted from staff channel manager');
            res.json({ success: true });
        } catch (error) {
            console.error('ChannelManagerController.deleteRole failed:', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete role' });
        }
    };
}

function serializeChannel(
    channel: GuildChannel,
    guild: Guild,
    actor: any,
    actorPermissionBits: PermissionsBitField,
    highestRolePosition: number
) {
    const overwrites = channel.permissionOverwrites.cache.map((overwrite) => {
        const role = overwrite.type === OverwriteType.Role ? guild.roles.cache.get(overwrite.id) : null;
        const editable = overwrite.id === guild.id || (role ? canEditRole(actor, role, highestRolePosition) : false);
        return {
            id: overwrite.id,
            type: overwrite.type === OverwriteType.Role ? 'role' : 'member',
            targetName: overwrite.id === guild.id ? '@everyone' : role?.name || overwrite.id,
            editable,
            allow: overwrite.allow.bitfield.toString(),
            deny: overwrite.deny.bitfield.toString(),
            allowKeys: MANAGED_PERMISSIONS.filter((permission) => overwrite.allow.has(PermissionFlagsBits[permission.key])).map((permission) => permission.key),
            denyKeys: MANAGED_PERMISSIONS.filter((permission) => overwrite.deny.has(PermissionFlagsBits[permission.key])).map((permission) => permission.key),
            manageableKeys: actorPermissionBits.toArray().filter((key) => MANAGED_PERMISSIONS.some((permission) => permission.key === key))
        };
    }).sort((left, right) => {
        if (left.id === guild.id) return -1;
        if (right.id === guild.id) return 1;
        return left.targetName.localeCompare(right.targetName, 'ja');
    });

    return {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parentId,
        position: channel.rawPosition,
        manageable: canManageChannel(actor, channel),
        topic: 'topic' in channel ? (channel.topic || '') : '',
        nsfw: 'nsfw' in channel ? Boolean((channel as any).nsfw) : false,
        rateLimitPerUser: 'rateLimitPerUser' in channel ? Number((channel as any).rateLimitPerUser || 0) : 0,
        bitrate: 'bitrate' in channel ? Number((channel as any).bitrate || 0) : 0,
        userLimit: 'userLimit' in channel ? Number((channel as any).userLimit || 0) : 0,
        overwrites
    };
}

function serializeRole(role: Role, guild: Guild, actor: any, highestRolePosition: number, actorRolePermissionBits?: PermissionsBitField) {
    return {
        id: role.id,
        name: role.id === guild.id ? '@everyone' : role.name,
        position: role.position,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissionsKeys: MANAGED_ROLE_PERMISSIONS.filter((permission) => role.permissions.has(PermissionFlagsBits[permission.key])).map((permission) => permission.key),
        manageableKeys: actorRolePermissionBits ? actorRolePermissionBits.toArray().filter((key) => MANAGED_ROLE_PERMISSIONS.some((permission) => permission.key === key)) : [],
        editable: role.id === guild.id || canEditRole(actor, role, highestRolePosition)
    };
}

function canManageChannel(member: any, channel: GuildChannel): boolean {
    return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissionsIn(channel).has(PermissionFlagsBits.ManageChannels);
}

function canEditRole(member: any, role: Role, highestRolePosition: number): boolean {
    if (role.id === role.guild.id) return true;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    return role.position < highestRolePosition;
}

async function requireActorWithManageChannels(guild: Guild, userId: string) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
        return { ok: false as const, status: 403, error: 'Guild member not found' };
    }
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return { ok: false as const, status: 403, error: 'Bot lacks Manage Channels permission' };
    }
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return { ok: false as const, status: 403, error: 'Manage Channels permission is required' };
    }

    return {
        ok: true as const,
        member,
        actorPermissionBits: getActorManagedPermissions(member.permissions),
        highestRolePosition: member.roles.highest?.position || 0
    };
}

async function requireActorWithManageRoles(guild: Guild, userId: string) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
        return { ok: false as const, status: 403, error: 'Guild member not found' };
    }
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return { ok: false as const, status: 403, error: 'Bot lacks Manage Roles permission' };
    }
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return { ok: false as const, status: 403, error: 'Manage Roles permission is required' };
    }
    return {
        ok: true as const,
        member,
        actorRolePermissionBits: getActorRolePermissions(member.permissions),
        highestRolePosition: member.roles.highest?.position || 0
    };
}

function getActorManagedPermissions(permissions: PermissionsBitField): PermissionsBitField {
    if (permissions.has(PermissionFlagsBits.Administrator)) {
        return new PermissionsBitField(MANAGED_PERMISSIONS.map((permission) => PermissionFlagsBits[permission.key]));
    }

    const allowed = MANAGED_PERMISSIONS
        .map((permission) => permission.key)
        .filter((key) => permissions.has(PermissionFlagsBits[key]))
        .map((key) => PermissionFlagsBits[key]);
    return new PermissionsBitField(allowed);
}

function getActorRolePermissions(permissions: PermissionsBitField): PermissionsBitField {
    if (permissions.has(PermissionFlagsBits.Administrator)) {
        return new PermissionsBitField(MANAGED_ROLE_PERMISSIONS.map((permission) => PermissionFlagsBits[permission.key]));
    }
    const allowed = MANAGED_ROLE_PERMISSIONS
        .map((permission) => permission.key)
        .filter((key) => permissions.has(PermissionFlagsBits[key]))
        .map((key) => PermissionFlagsBits[key]);
    return new PermissionsBitField(allowed);
}

function parseCreateChannelType(kind?: string): CreateChannelType | null {
    switch (kind) {
        case 'category':
            return ChannelType.GuildCategory;
        case 'text':
            return ChannelType.GuildText;
        case 'voice':
            return ChannelType.GuildVoice;
        case 'announcement':
            return ChannelType.GuildAnnouncement;
        case 'forum':
            return ChannelType.GuildForum;
        default:
            return null;
    }
}

function toPermissionKeys(keys: string[], actorPermissionBits: PermissionsBitField): ManagedPermissionKey[] {
    return keys
        .filter((key): key is ManagedPermissionKey => MANAGED_PERMISSIONS.some((permission) => permission.key === key))
        .filter((key) => actorPermissionBits.has(PermissionFlagsBits[key]))
}

function toRolePermissionKeys(keys: string[], actorPermissionBits: PermissionsBitField): ManagedRolePermissionKey[] {
    return keys
        .filter((key): key is ManagedRolePermissionKey => MANAGED_ROLE_PERMISSIONS.some((permission) => permission.key === key))
        .filter((key) => actorPermissionBits.has(PermissionFlagsBits[key]));
}

function hasAccessToGuild(session: SessionLike, guildId: string): boolean {
    try {
        if (!guildId) return false;
        if (session.guildId && session.guildId === guildId) return true;
        if (Array.isArray(session.guildIds) && session.guildIds.includes(guildId)) return true;
        if (Array.isArray(session.guilds) && session.guilds.some((g) => g && (g.id === guildId || g.guildId === guildId))) return true;
        if (Array.isArray(session.permissions) && session.permissions.some((p) => p && p.guildId === guildId)) return true;
    } catch {
        return false;
    }
    return false;
}
