import type { SettingsSession } from '../types/index.js';
import type { BotClient } from '../../core/platform/BotClient.js';
import type { Guild } from 'discord.js';
import { resolveGuildPermissionLevel, resolveGuildDelegatedLevel } from '../../core/permissions/GuildAccess.js';
import { PermissionLevel } from '../types/permission.js';

export type LiveStaffGuild = {
    id: string;
    name: string;
    icon: string | null;
    /** Live-resolved level (OWNER/ADMIN/STAFF) for the session user in this guild. */
    permissionLevel: PermissionLevel;
};

/** Bot guild from cache; the REST fetch is only a fallback for a cold cache. */
async function findBotGuild(botClient: BotClient, guildId: string): Promise<Guild | null> {
    const cached = botClient.client.guilds.cache.get(guildId);
    if (cached) return cached;
    return await botClient.client.guilds.fetch(guildId).catch(() => null);
}

/**
 * Persist a live-resolved level on the settings session.
 *
 * This is a cache repair, never an authorization decision: callers must use the
 * returned live level. Unknown guilds gain an entry only when the user actually
 * holds staff access; known guilds are refreshed in both directions so a guild
 * whose level dropped to ANY stops looking reachable until it is resolved again.
 */
export function applySessionGuildPermissionLevel(
    session: SettingsSession | undefined | null,
    guildId: string,
    level: PermissionLevel | number,
): void {
    if (!session || !guildId) return;
    if (!Array.isArray(session.permissions)) session.permissions = [];
    const stored = session.permissions.find(p => p && p.guildId === guildId);
    if (stored) stored.level = level;
    else if (level >= PermissionLevel.STAFF) session.permissions.push({ guildId, level });
    if (level >= PermissionLevel.STAFF) {
        if (!Array.isArray(session.guildIds)) session.guildIds = [];
        if (!session.guildIds.includes(guildId)) session.guildIds.push(guildId);
    }
    if (session.guildId === guildId) session.permission = level;
}

async function resolveLiveLevel(
    session: SettingsSession | undefined | null,
    guild: Guild | null,
    guildId: string,
): Promise<PermissionLevel> {
    if (!session?.userId || !guildId) return PermissionLevel.ANY;
    if (!guild) return PermissionLevel.ANY;
    const level = await resolveGuildPermissionLevel(guild, session.userId);
    applySessionGuildPermissionLevel(session, guildId, level);
    return level;
}

/**
 * Live level for the session user in one guild.
 *
 * The OAuth login snapshot (`guildIds`/`permissions`) is deliberately NOT a
 * precondition: the bot's current guild list and the user's current Discord
 * membership decide. Resolving also repairs the snapshot so snapshot-gated
 * helpers keep working without a re-login.
 */
export async function getLiveGuildPermissionLevel(
    botClient: BotClient,
    session: SettingsSession | undefined | null,
    guildId: string,
): Promise<number> {
    if (!session?.userId || !guildId) return PermissionLevel.ANY;
    const guild = await findBotGuild(botClient, guildId);
    return await resolveLiveLevel(session, guild, guildId);
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
    return await getLiveGuildPermissionLevel(botClient, session, guildId);
}

/** Role-delegated staff or native guild administrator; not an unrelated native moderator bit. */
export async function getLiveGuildManagementLevel(
    botClient: BotClient,
    session: SettingsSession | undefined | null,
    guildId: string,
): Promise<number> {
    const level = await getLiveGuildPermissionLevel(botClient, session, guildId);
    if (level >= 2 || !session?.userId || level === 0) return level;
    const guild = await findBotGuild(botClient, guildId);
    if (!guild) return 0;
    return resolveGuildDelegatedLevel(guild, session.userId);
}

/** Keep gateway traffic bounded when resolving a whole guild list. */
const LIST_RESOLVE_CONCURRENCY = 4;

/**
 * Staff guild list from the BOT's current guilds, with the session user's live
 * level resolved per guild (cache-first member lookup). Guilds the user cannot
 * be resolved in, or that resolve below STAFF, are excluded. A session that was
 * created before the bot joined a guild still sees it after the first load.
 */
export async function listLiveStaffGuilds(
    botClient: BotClient,
    session: SettingsSession | undefined | null,
): Promise<LiveStaffGuild[]> {
    if (!session?.userId) return [];
    const guilds = Array.from(botClient.client.guilds.cache.values());
    const levels = new Array<PermissionLevel>(guilds.length).fill(PermissionLevel.ANY);
    let next = 0;
    const workers = Array.from(
        { length: Math.min(LIST_RESOLVE_CONCURRENCY, guilds.length) },
        async () => {
            while (next < guilds.length) {
                const index = next++;
                const guild = guilds[index];
                levels[index] = await resolveLiveLevel(session, guild, guild.id);
            }
        },
    );
    await Promise.all(workers);

    const result: LiveStaffGuild[] = [];
    guilds.forEach((guild, index) => {
        const level = levels[index];
        if (level < PermissionLevel.STAFF) return;
        result.push({
            id: guild.id,
            name: guild.name?.trim() ? guild.name : '名称未取得',
            icon: guild.icon ?? null,
            permissionLevel: level,
        });
    });
    return result;
}
