import type { SettingsSession } from '../types/index.js';
import type { BotClient } from '../../core/platform/BotClient.js';
import { resolveGuildPermissionLevel, resolveGuildDelegatedLevel } from '../../core/permissions/GuildAccess.js';
import { isGuildAccessible } from './auth.js';

/** OAuth session values are only hints; every authorization uses live Discord membership. */
export async function getLiveGuildPermissionLevel(
    botClient: BotClient,
    session: SettingsSession | undefined | null,
    guildId: string,
): Promise<number> {
    if (!session?.userId || !isGuildAccessible(session, guildId)) return 0;
    const guild = botClient.client.guilds.cache.get(guildId)
        ?? await botClient.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return 0;
    return resolveGuildPermissionLevel(guild, session.userId);
}

/**
 * Synchronize the per-guild UI session privilege with reality (including revocation).
 * This is not an authorization shortcut: callers must check the returned level.
 */
export async function refreshSessionGuildPermissionLevel(
    botClient: BotClient,
    session: SettingsSession | undefined | null,
    guildId: string,
): Promise<number> {
    const level = await getLiveGuildPermissionLevel(botClient, session, guildId);
    if (!session || !isGuildAccessible(session, guildId)) return 0;
    if (!session.permissions) session.permissions = [];
    const stored = session.permissions.find(p => p.guildId === guildId);
    if (stored) stored.level = level;
    else session.permissions.push({ guildId, level });
    if (session.guildId === guildId) session.permission = level;
    return level;
}

/** Role-delegated staff or native guild administrator; not an unrelated native moderator bit. */
export async function getLiveGuildManagementLevel(
    botClient: BotClient,
    session: SettingsSession | undefined | null,
    guildId: string,
): Promise<number> {
    const level = await getLiveGuildPermissionLevel(botClient, session, guildId);
    if (level >= 2 || !session?.userId || level === 0) return level;
    const guild = botClient.client.guilds.cache.get(guildId)
        ?? await botClient.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return 0;
    return resolveGuildDelegatedLevel(guild, session.userId);
}
