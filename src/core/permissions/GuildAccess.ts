/**
 * One source of truth for guild staff/admin permissions.
 * A configured staff/admin role grants command-level staff access even when
 * Discord native moderation permissions are delegated to the bot.
 * Actual bot permissions and role hierarchy remain mandatory at action time.
 */
import { PermissionFlagsBits } from 'discord.js';
import { database } from '../persistence/Database.js';
import { PermissionLevel } from '../../web/types/permission.js';

type PermissionsLike = { has: (flag: bigint) => boolean };
export type GuildAccessMember = {
    id: string;
    permissions: PermissionsLike;
    roles: { cache: { has: (roleId: string) => boolean } };
};
export type GuildAccessSettings = {
    staffRoleId?: string | null;
    adminRoleId?: string | null;
};
export type GuildAccessSource = {
    id: string;
    ownerId: string;
    members: {
        fetch: (userId: string) => Promise<GuildAccessMember>;
        /** discord.js member cache. When present it is consulted before `fetch`. */
        cache?: { get: (userId: string) => GuildAccessMember | undefined };
    };
};

function hasPermission(member: GuildAccessMember, flag: bigint): boolean {
    try { return !!member.permissions?.has(flag); } catch { return false; }
}

/**
 * Cache-first member lookup: list-style live resolution may touch dozens of
 * guilds, so never spend a gateway request when the member is already cached.
 */
async function fetchGuildMember(
    guild: GuildAccessSource,
    userId: string,
): Promise<GuildAccessMember | null> {
    const cached = guild.members?.cache?.get?.(userId);
    if (cached) return cached;
    return guild.members.fetch(userId).catch(() => null);
}

/**
 * Delegation can only come from explicitly configured staff/admin roles,
 * guild owner, or guild-wide administrator privileges. Individual native
 * permissions (e.g. ManageMessages) do NOT delegate other actions.
 */
export function determineDelegatedGuildPermissionLevel(
    userId: string,
    ownerId: string,
    member: GuildAccessMember | null | undefined,
    settings: GuildAccessSettings | null | undefined,
): PermissionLevel {
    if (!userId || !member || member.id !== userId) return PermissionLevel.ANY;
    if (userId === ownerId) return PermissionLevel.OWNER;
    if (hasPermission(member, PermissionFlagsBits.Administrator)
        || (!!settings?.adminRoleId && member.roles?.cache?.has(settings.adminRoleId))) {
        return PermissionLevel.ADMIN;
    }
    if (!!settings?.staffRoleId && member.roles?.cache?.has(settings.staffRoleId)) {
        return PermissionLevel.STAFF;
    }
    return PermissionLevel.ANY;
}

export function determineGuildPermissionLevel(
    userId: string,
    ownerId: string,
    member: GuildAccessMember | null | undefined,
    settings: GuildAccessSettings | null | undefined,
): PermissionLevel {
    const delegated = determineDelegatedGuildPermissionLevel(userId, ownerId, member, settings);
    if (delegated >= PermissionLevel.STAFF) return delegated;
    if (!member || member.id !== userId) return PermissionLevel.ANY;
    // ManageGuild grants admin UI access, but not bot-delegated moderation.
    if (hasPermission(member, PermissionFlagsBits.ManageGuild)) return PermissionLevel.ADMIN;
    if (hasPermission(member, PermissionFlagsBits.ModerateMembers)
        || hasPermission(member, PermissionFlagsBits.ManageMessages)
        || hasPermission(member, PermissionFlagsBits.ManageChannels)
        || hasPermission(member, PermissionFlagsBits.KickMembers)
        || hasPermission(member, PermissionFlagsBits.BanMembers)) {
        return PermissionLevel.STAFF;
    }
    return PermissionLevel.ANY;
}

export async function resolveGuildPermissionLevel(
    guild: GuildAccessSource | null | undefined,
    userId: string,
): Promise<PermissionLevel> {
    if (!guild || !userId) return PermissionLevel.ANY;
    const member = await fetchGuildMember(guild, userId);
    if (!member) return PermissionLevel.ANY; // fail closed on missing membership
    const settings = await database.get<GuildAccessSettings | null>(
        guild.id, 'Guild/' + guild.id + '/settings', null,
    ).catch(() => null);
    return determineGuildPermissionLevel(userId, guild.ownerId, member, settings);
}

export async function resolveGuildDelegatedLevel(
    guild: GuildAccessSource | null | undefined,
    userId: string,
): Promise<PermissionLevel> {
    if (!guild || !userId) return PermissionLevel.ANY;
    const member = await fetchGuildMember(guild, userId);
    if (!member) return PermissionLevel.ANY;
    const settings = await database.get<GuildAccessSettings | null>(
        guild.id, 'Guild/' + guild.id + '/settings', null,
    ).catch(() => null);
    return determineDelegatedGuildPermissionLevel(userId, guild.ownerId, member, settings);
}

/** Role-delegated staff or the native Discord permission for THIS action. */
export async function canExecuteStaffAction(
    guild: GuildAccessSource | null | undefined,
    userId: string,
    requiredNativeFlag: bigint,
): Promise<boolean> {
    if (!guild || !userId) return false;
    if ((await resolveGuildDelegatedLevel(guild, userId)) >= PermissionLevel.STAFF) return true;
    const member = await fetchGuildMember(guild, userId);
    return !!member && member.id === userId && hasPermission(member, requiredNativeFlag);
}

export async function canUseStaffAction(
    guild: GuildAccessSource | null | undefined,
    userId: string,
): Promise<boolean> {
    return (await resolveGuildPermissionLevel(guild, userId)) >= PermissionLevel.STAFF;
}
