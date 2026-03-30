import { CategoryChannel, ChannelType, Client, Guild, PermissionFlagsBits, Role } from 'discord.js';
import { database } from '../Database.js';
import { Logger } from '../../utils/Logger.js';

export async function ensureCategory(guild: Guild, name: string): Promise<CategoryChannel> {
    const existing = guild.channels.cache.find((channel) => (
        channel.type === ChannelType.GuildCategory && channel.name === name
    )) as CategoryChannel | undefined;

    if (existing) {
        return existing;
    }

    return guild.channels.create({
        name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            {
                id: guild.members.me?.id || guild.client.user.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels]
            }
        ]
    });
}

export async function ensureRole(guild: Guild, roleName: string, reason: string): Promise<Role | null> {
    const existing = guild.roles.cache.find((entry) => entry.name === roleName);
    if (existing) {
        return existing;
    }

    try {
        return await guild.roles.create({
            name: roleName,
            mentionable: false,
            reason
        });
    } catch (error) {
        Logger.warn(`Failed to create role ${roleName}:`, error);
        return null;
    }
}

export async function isStaffMember(guild: Guild, userId: string): Promise<boolean> {
    if (guild.ownerId === userId) {
        return true;
    }

    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (!member) {
        return false;
    }

    const settings = await database.get<{ adminRoleId: string | null; staffRoleId: string | null } | null>(
        guild.id,
        `Guild/${guild.id}/settings`,
        {
            adminRoleId: null,
            staffRoleId: null
        }
    ) || {
        adminRoleId: null,
        staffRoleId: null
    };

    if (settings.staffRoleId && member.roles.cache.has(settings.staffRoleId)) {
        return true;
    }

    if (settings.adminRoleId && member.roles.cache.has(settings.adminRoleId)) {
        return true;
    }

    return false;
}

export async function deleteRoom(
    client: Client | null,
    guildId: string,
    channelId: string,
    categoryId: string,
    reason: string
): Promise<void> {
    if (!client) {
        return;
    }

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
        return;
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel) {
        await channel.delete(reason).catch(() => null);
    }

    const category = await guild.channels.fetch(categoryId).catch(() => null);
    if (category && category.type === ChannelType.GuildCategory && (category as CategoryChannel).children.cache.size === 0) {
        await category.delete(reason).catch(() => null);
    }
}
