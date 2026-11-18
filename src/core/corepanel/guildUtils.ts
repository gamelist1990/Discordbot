import { CategoryChannel, ChannelType, Client, Guild, PermissionFlagsBits, Role } from 'discord.js';
import { canUseStaffAction } from '../permissions/GuildAccess.js';
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
    return canUseStaffAction(guild, userId);
}

export async function deleteRoom(
    client: Client | null,
    guildId: string,
    channelId: string,
    categoryId: string,
    reason: string
): Promise<void> {
    if (!client) {
        throw new Error('Discord client is not ready for room cleanup.');
    }

    const guild = await client.guilds.fetch(guildId);

    const channel = await guild.channels.fetch(channelId).catch((error) => {
        if (error.code === 10003) return null;
        throw error;
    });
    if (channel) {
        await channel.delete(reason).catch((error) => {
            if (error.code !== 10003) throw error;
        });
    }

    const category = await guild.channels.fetch(categoryId).catch(() => null);
    if (category && category.type === ChannelType.GuildCategory && (category as CategoryChannel).children.cache.size === 0) {
        await category.delete(reason).catch(() => null);
    }
}
