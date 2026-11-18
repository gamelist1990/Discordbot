import { PermissionFlagsBits } from 'discord.js';

/**
 * Safely parse a permission bitfield returned from Discord's API which may
 * be a string, number or bigint. Returns a JS number fallback (0 on parse error).
 */
export function parsePermissionBitfield(input: unknown): bigint {
    if (typeof input === 'bigint') return input >= 0n ? input : 0n;
    if (typeof input === 'string' && /^\d+$/.test(input)) {
        try { return BigInt(input); } catch { return 0n; }
    }
    if (typeof input === 'number' && Number.isSafeInteger(input) && input >= 0) {
        return BigInt(input);
    }
    return 0n;
}

export function userHasAdminOrManageFlag(guildInfo: any): boolean {
    if (!guildInfo) return false;
    if (guildInfo.owner === true) return true;
    const perms = parsePermissionBitfield(guildInfo.permissions_new ?? guildInfo.permissions);
    return (perms & (PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild)) !== 0n;
}

export default { parsePermissionBitfield, userHasAdminOrManageFlag };
