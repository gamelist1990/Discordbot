import { PermissionFlagsBits } from 'discord.js';
import { readToggle } from './RaidEnforcement.js';
import {
    ANTINUKE_AUTO_RESTORE_MODES,
    DEFAULT_ANTINUKE_SETTINGS,
    type AntiNukeAutoRestoreMode,
    type AntiNukeSettings,
    type NukeAction,
    type NukeVelocityRule
} from './types.js';

export type {
    AntiNukeAutoRestoreMode,
    AntiNukeInstantRules,
    AntiNukeSelfDefense,
    AntiNukeSettings,
    NukeAction,
    NukeVelocityRule
} from './types.js';

/**
 * AntiNuke: destruction detection for guild structure (channels, roles,
 * members, webhooks, emojis) plus instant administrator-escalation rules.
 *
 * This file holds the settings shape, the pure velocity-window counter and the
 * exemption/instant-rule decisions. The Discord side lives in AntiNukeManager.
 */

export const NUKE_ACTIONS = [
    'channelDelete',
    'roleDelete',
    'memberBan',
    'memberKick',
    'channelCreate',
    'roleCreate',
    'webhookCreate',
    'emojiDelete'
] as const satisfies readonly NukeAction[];

/** Every rule that can produce an incident (velocity, instant, self-defense). */
export type NukeRuleKey =
    | NukeAction
    | 'adminRoleGrant'
    | 'adminBotInvite'
    | 'vanityNameChange'
    | 'selfTamper'
    | 'selfKick';


export const NUKE_RULE_LABELS: Record<NukeRuleKey, string> = {
    channelDelete: 'チャンネル削除',
    roleDelete: 'ロール削除',
    memberBan: 'メンバーBAN',
    memberKick: 'メンバーキック',
    channelCreate: 'チャンネル作成',
    roleCreate: 'ロール作成',
    webhookCreate: 'Webhook作成',
    emojiDelete: '絵文字・ステッカー削除',
    adminRoleGrant: 'Administratorロールの付与',
    adminBotInvite: 'Administrator付きBOTの追加',
    vanityNameChange: 'BOTによるサーバー名/バニティURL変更',
    selfTamper: 'このBotへの権限改変',
    selfKick: 'このBotのキック'
};

/** Reason prefix attached to every ban (brief AN1 §B). */
export const ANTINUKE_BAN_PREFIX = 'AntiNuke';

const isEnabled = readToggle;

const positiveInt = (value: unknown, fallback: number, min = 1, max = 100_000): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const readIdList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const entry of value) {
        const id = typeof entry === 'string' ? entry.trim() : '';
        if (!id || !/^\d{5,25}$/.test(id)) continue;
        seen.add(id);
    }
    return Array.from(seen);
};

export function readAntiNukeSettings(value: unknown): AntiNukeSettings {
    const source = (value && typeof value === 'object' ? value : {}) as Partial<AntiNukeSettings>;
    const defaults = DEFAULT_ANTINUKE_SETTINGS;
    const rules = {} as Record<NukeAction, NukeVelocityRule>;
    for (const action of NUKE_ACTIONS) {
        const raw = source.rules?.[action] as Partial<NukeVelocityRule> | undefined;
        const fallback = defaults.rules[action];
        rules[action] = {
            enabled: isEnabled(raw?.enabled, fallback.enabled),
            threshold: positiveInt(raw?.threshold, fallback.threshold, 2, 1000),
            windowSeconds: positiveInt(raw?.windowSeconds, fallback.windowSeconds, 5, 3600)
        };
    }

    return {
        enabled: isEnabled(source.enabled, defaults.enabled),
        whitelistUsers: readIdList(source.whitelistUsers),
        whitelistRoles: readIdList(source.whitelistRoles),
        whitelistBots: readIdList(source.whitelistBots),
        rules,
        instant: {
            adminRoleGrant: isEnabled(source.instant?.adminRoleGrant, defaults.instant.adminRoleGrant),
            adminBotInvite: isEnabled(source.instant?.adminBotInvite, defaults.instant.adminBotInvite),
            vanityNameChange: isEnabled(source.instant?.vanityNameChange, defaults.instant.vanityNameChange)
        },
        selfDefense: {
            enabled: isEnabled(source.selfDefense?.enabled, defaults.selfDefense.enabled),
            positionAudit: isEnabled(source.selfDefense?.positionAudit, defaults.selfDefense.positionAudit),
            ownerDm: isEnabled(source.selfDefense?.ownerDm, defaults.selfDefense.ownerDm)
        },
        snapshots: {
            enabled: isEnabled(source.snapshots?.enabled, defaults.snapshots.enabled),
            intervalHours: positiveInt(source.snapshots?.intervalHours, defaults.snapshots.intervalHours, 1, 168),
            keep: positiveInt(source.snapshots?.keep, defaults.snapshots.keep, 1, 50),
            includeBans: isEnabled(source.snapshots?.includeBans, defaults.snapshots.includeBans),
            includeEmojis: isEnabled(source.snapshots?.includeEmojis, defaults.snapshots.includeEmojis),
            includeMemberRoles: isEnabled(source.snapshots?.includeMemberRoles, defaults.snapshots.includeMemberRoles),
            memberRoleCap: positiveInt(source.snapshots?.memberRoleCap, defaults.snapshots.memberRoleCap, 100, 50_000)
        },
        // Brief AN3: invalid/absent values fall back to the default ('full').
        autoRestore: readAutoRestoreMode(source.autoRestore)
    };
}

/** 'off' | 'cleanup' | 'full'; the stored value is matched case-insensitively. */
export function readAutoRestoreMode(value: unknown): AntiNukeAutoRestoreMode {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return (ANTINUKE_AUTO_RESTORE_MODES as readonly string[]).includes(raw)
        ? raw as AntiNukeAutoRestoreMode
        : DEFAULT_ANTINUKE_SETTINGS.autoRestore;
}

export interface VelocityHit {
    count: number;
    threshold: number;
    windowSeconds: number;
    exceeded: boolean;
    /** Timestamp of the oldest event inside the current window. */
    windowStart: number;
}

/**
 * Sliding-window velocity counter keyed by guild + action + actor.
 * Pure and time-injected so tests can advance the clock.
 */
export class NukeVelocityTracker {
    private hits = new Map<string, number[]>();

    private static key(guildId: string, action: NukeAction, actorId: string): string {
        return `${guildId}:${action}:${actorId}`;
    }

    record(
        guildId: string,
        action: NukeAction,
        actorId: string,
        now: number,
        threshold: number,
        windowMs: number
    ): VelocityHit {
        const key = NukeVelocityTracker.key(guildId, action, actorId);
        const cutoff = now - windowMs;
        const kept = (this.hits.get(key) || []).filter((timestamp) => timestamp > cutoff);
        kept.push(now);
        this.hits.set(key, kept);
        return {
            count: kept.length,
            threshold,
            windowSeconds: Math.round(windowMs / 1000),
            exceeded: kept.length >= threshold,
            windowStart: kept[0]
        };
    }

    count(guildId: string, action: NukeAction, actorId: string, now: number, windowMs: number): number {
        const key = NukeVelocityTracker.key(guildId, action, actorId);
        const cutoff = now - windowMs;
        const kept = (this.hits.get(key) || []).filter((timestamp) => timestamp >= cutoff);
        if (kept.length) this.hits.set(key, kept);
        else this.hits.delete(key);
        return kept.length;
    }

    resetGuild(guildId: string): void {
        const prefix = `${guildId}:`;
        for (const key of this.hits.keys()) {
            if (key.startsWith(prefix)) this.hits.delete(key);
        }
    }

    /** Drop stale buckets so a long-running process does not leak memory. */
    prune(now: number, maxWindowMs = 60 * 60 * 1000): void {
        for (const [key, timestamps] of this.hits) {
            const kept = timestamps.filter((timestamp) => now - timestamp <= maxWindowMs);
            if (kept.length) this.hits.set(key, kept);
            else this.hits.delete(key);
        }
    }
}

/** Minimal actor shape shared by the manager and its pure decisions. */
export interface NukeActorLike {
    id: string;
    tag: string | null;
    isBot: boolean;
    roleIds: string[];
    member: unknown;
}

export interface ExemptionInput {
    actorId: string;
    guildOwnerId: string | null | undefined;
    selfId: string | null | undefined;
    isBot: boolean;
    roleIds: readonly string[];
    settings: AntiNukeSettings;
}

/** Returns the exemption label, or null when the actor is not exempt. */
export function nukeExemptionReason(input: ExemptionInput): string | null {
    if (!input.actorId) return null;
    if (input.guildOwnerId && input.actorId === input.guildOwnerId) return 'サーバー所有者';
    if (input.selfId && input.actorId === input.selfId) return 'このBot自身';
    if (input.settings.whitelistUsers.includes(input.actorId)) return 'ホワイトリスト（ユーザー）';
    if (input.isBot && input.settings.whitelistBots.includes(input.actorId)) return 'ホワイトリスト（BOT）';
    const role = input.roleIds.find((id) => input.settings.whitelistRoles.includes(id));
    if (role) return `ホワイトリスト（ロール ${role}）`;
    return null;
}

const ADMIN = PermissionFlagsBits.Administrator;

export function hasAdministrator(permissions: bigint | null | undefined): boolean {
    return typeof permissions === 'bigint' ? (permissions & ADMIN) === ADMIN : false;
}

/** A bot created/granted an Administrator role (or this bot received it). */
export function isAdminRoleGrantTrigger(input: {
    gainedAdministrator: boolean;
    actorIsBot: boolean;
    targetIsSelf: boolean;
}): boolean {
    if (!input.gainedAdministrator) return false;
    return input.actorIsBot || input.targetIsSelf;
}

/** A bot joined with Administrator and the adder is not trusted. */
export function isAdminBotInviteTrigger(input: {
    addedBotHasAdministrator: boolean;
    actorExempt: boolean;
}): boolean {
    return input.addedBotHasAdministrator && !input.actorExempt;
}

/** Bot-driven guild name / vanity URL change. */
export function isVanityNameChangeTrigger(input: { actorIsBot: boolean; changed: boolean }): boolean {
    return input.changed && input.actorIsBot;
}

/** Dangerous permissions used by the role-position audit (brief AN1 §C3). */
export const POSITION_AUDIT_PERMISSIONS = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.BanMembers
] as const;

/**
 * Permissions this bot needs for AntiNuke + baseline moderation. Used for the
 * re-invite OAuth URL sent after a self-kick.
 */
export const ANTINUKE_INVITE_PERMISSIONS =
    PermissionFlagsBits.ViewAuditLog
    | PermissionFlagsBits.ManageGuild
    | PermissionFlagsBits.ManageRoles
    | PermissionFlagsBits.ManageChannels
    | PermissionFlagsBits.ManageWebhooks
    | PermissionFlagsBits.ManageEmojisAndStickers
    | PermissionFlagsBits.BanMembers
    | PermissionFlagsBits.KickMembers
    | PermissionFlagsBits.ModerateMembers
    | PermissionFlagsBits.SendMessages
    | PermissionFlagsBits.EmbedLinks
    | PermissionFlagsBits.ReadMessageHistory;

export function buildReinviteUrl(clientId: string): string {
    return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&scope=bot%20applications.commands&permissions=${ANTINUKE_INVITE_PERMISSIONS}`;
}

/** Rule text used in the ban reason: `AntiNuke: <rule>`. */
export function banReason(rule: NukeRuleKey, detail?: string): string {
    return detail ? `${ANTINUKE_BAN_PREFIX}: ${rule} (${detail})` : `${ANTINUKE_BAN_PREFIX}: ${rule}`;
}

export interface DiscordErrorInfo {
    code: number | null;
    status: number | null;
    hierarchy: boolean;
    message: string;
}

/** Turn a discord.js/HTTP error into a short, honest hierarchy/permission reason. */
export function discordErrorInfo(error: unknown): DiscordErrorInfo {
    const candidate = (error || {}) as {
        code?: unknown;
        status?: unknown;
        message?: unknown;
        rawError?: { code?: unknown; message?: unknown };
    };
    const rawCode = candidate.code ?? candidate.rawError?.code;
    const code = typeof rawCode === 'number' ? rawCode : Number.isFinite(Number(rawCode)) && rawCode !== undefined
        ? Number(rawCode)
        : null;
    const status = typeof candidate.status === 'number' ? candidate.status : null;
    const message = String(candidate.message ?? candidate.rawError?.message ?? error ?? '').slice(0, 300);
    const hierarchy = code === 50013 || status === 403;
    return {
        code,
        status,
        hierarchy,
        message: hierarchy
            ? `権限不足またはロール階層が低いため実行できません（${code ?? status ?? 'unknown'}）`
            : message || 'Discord APIエラー'
    };
}
