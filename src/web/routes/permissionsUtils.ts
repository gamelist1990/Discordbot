import { PermissionFlagsBits } from 'discord.js';

/**
 * Safely parse a permission bitfield returned from Discord's API which may
 * be a string, number or bigint. Returns a JS number fallback (0 on parse error).
 */
export function parsePermissionBitfield(p: any): number {
    if (p === undefined || p === null) return 0;
    if (typeof p === 'number') return p;
    if (typeof p === 'bigint') return Number(p);
    if (typeof p === 'string') {
        const n = parseInt(p, 10);
        return Number.isNaN(n) ? 0 : n;
    }
    return 0;
}

/**
 * Return whether the guild membership info suggests the user has administrative
 * access. This checks owner flag or typical admin/manage_guild permissions.
 */
export function userHasAdminOrManageFlag(guildInfo: any): boolean {
    if (!guildInfo) return false;
    if (guildInfo.owner === true) return true;
    const perms = parsePermissionBitfield(guildInfo.permissions);
    // PermissionFlagsBits constants can be bigint, convert to number for bitwise ops
    const admin = Number(PermissionFlagsBits.Administrator);
    const manageGuild = Number((PermissionFlagsBits as any).ManageGuild || (PermissionFlagsBits as any).ManageGuildPermissions || 0);
    return !!(perms & admin) || !!(perms & manageGuild);
}

export default { parsePermissionBitfield, userHasAdminOrManageFlag };
