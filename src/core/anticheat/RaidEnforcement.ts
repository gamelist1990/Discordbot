import { PermissionFlagsBits } from 'discord.js';
import type { RaidDetectionConfig } from './types.js';
import { readJoinEntropyConfig } from './JoinEntropy.js';

/** Reason attached to every anti-raid kick. */
export const RAID_KICK_REASON = 'AntiRaid: レイド検知による自動キック';
/** Join history window kept in the join cache. */
export const RAID_JOIN_WINDOW_MS = 60 * 60 * 1000;
/** Window used to merge kicks from consecutive joins into one log embed. */
export const RAID_KICK_LOG_WINDOW_MS = 5 * 1000;

export interface RaidJoinRecord {
    userId: string;
    ts: number;
}

export interface RaidKickedEntry {
    id: string;
    tag: string;
}

export interface RaidSkippedEntry {
    id: string;
    tag: string;
    reason: string;
}

export interface RaidKickReport {
    kicked: RaidKickedEntry[];
    skipped: RaidSkippedEntry[];
}

/** Minimal member shape needed for the kick decision (GuildMember compatible). */
export interface RaidMemberLike {
    id: string;
    user?: { bot?: boolean; tag?: string; username?: string } | null;
    permissions?: { has(permission: bigint): boolean } | null;
    roles?: { cache?: { has(id: string): boolean } } | null;
    kickable?: boolean;
}

const positiveNumber = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Read a UI/legacy toggle. The Staff UI stores 1/0, but older or hand-edited
 * configs may hold booleans or strings, so all of them are accepted.
 */
export function readToggle(value: unknown, fallback: boolean): boolean {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value !== 0 : fallback;
    const text = String(value).trim().toLowerCase();
    if (['false', '0', 'off', 'no'].includes(text)) return false;
    if (['true', '1', 'on', 'yes'].includes(text)) return true;
    return fallback;
}

export function readRaidDetectionConfig(config: Record<string, any> | null | undefined): RaidDetectionConfig {
    return {
        joinsPerHour: Math.max(1, Math.floor(positiveNumber(config?.joinsPerHour, 20))),
        burstCount: Math.max(1, Math.floor(positiveNumber(config?.burstCount, 8))),
        burstWindowSeconds: Math.max(1, Math.floor(positiveNumber(config?.burstWindowSeconds, 60))),
        cooldownMinutes: Math.max(1, Math.floor(positiveNumber(config?.cooldownMinutes, 60))),
        autoKick: readToggle(config?.autoKick, true),
        kickWindowSeconds: Math.max(1, Math.floor(positiveNumber(config?.kickWindowSeconds, 60))),
        automation: readJoinEntropyConfig(config?.automation)
    };
}

export function readRaidJoinRecords(value: unknown, now: number): RaidJoinRecord[] {
    if (!Array.isArray(value)) return [];
    const records: RaidJoinRecord[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const { userId, ts } = entry as Partial<RaidJoinRecord>;
        if (typeof userId !== 'string' || !userId || !Number.isFinite(ts)) continue;
        if (now - Number(ts) > RAID_JOIN_WINDOW_MS || Number(ts) > now) continue;
        records.push({ userId, ts: Number(ts) });
    }
    return records;
}

/**
 * Returns the reason a raid joiner must not be kicked, or null when the kick
 * is allowed. Excluded roles are reported like every other skip.
 */
export function raidKickSkipReason(
    member: RaidMemberLike,
    ownerId: string | null | undefined,
    excludedRoles: string[]
): string | null {
    if (member.user?.bot === true) return 'BOTアカウント';
    if (ownerId && member.id === ownerId) return 'サーバー所有者';
    const permissions = member.permissions;
    if (permissions && (permissions.has(PermissionFlagsBits.Administrator) || permissions.has(PermissionFlagsBits.ManageGuild))) {
        return '管理者権限（Administrator/ManageGuild）';
    }
    if (excludedRoles.some((roleId) => member.roles?.cache?.has(roleId))) return '除外ロール';
    if (member.kickable !== true) return 'キック不可（権限またはロール階層）';
    return null;
}

export function formatRaidKickLines(
    entries: Array<{ tag: string; id: string; reason?: string }>,
    limit = 1000
): string {
    const lines: string[] = [];
    let length = 0;
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        const line = entry.reason
            ? `• ${entry.tag} (${entry.id}) — ${entry.reason}`
            : `• ${entry.tag} (${entry.id})`;
        if (length + line.length > limit) {
            lines.push(`…他 ${entries.length - index} 件`);
            break;
        }
        lines.push(line);
        length += line.length + 1;
    }
    return lines.join('\n').slice(0, 1024) || 'なし';
}
