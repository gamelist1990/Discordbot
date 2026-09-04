import type { Guild, Message } from 'discord.js';
import type { GuildAntiCheatSettings } from './types.js';

export function exclusionChannelIds(message: Message): string[] {
    const channel = message.channel as any;
    return [...new Set([channel.id, channel.parentId, channel.parent?.parentId].filter((id): id is string => typeof id === 'string'))];
}

export function detectorExcluded(message: Message, settings: GuildAntiCheatSettings, detector: string): boolean {
    return exclusionChannelIds(message).some(id => settings.channelDetectorExclusions?.[id]?.includes(detector));
}

export function normalizeChannelExclusions(value: unknown): Record<string, string[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([id, names]) => /^[1-9]\d{0,19}$/.test(id) && Array.isArray(names))
        .map(([id, names]) => [id, [...new Set((names as unknown[]).filter((name): name is string => typeof name === 'string'))]]));
}

// Existing deleted targets may be retained/removed; every newly added target must belong to this guild.
export async function validateExclusions(updates: Partial<GuildAntiCheatSettings>, current: GuildAntiCheatSettings, guild: Guild): Promise<string | null> {
    const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length <= 500 && ids.every(id => typeof id === 'string' && /^[1-9]\d{0,19}$/.test(id));
    for (const field of ['excludedRoles', 'excludedChannels'] as const) {
        if (updates[field] !== undefined && !validIds(updates[field])) return '除外IDは20桁以内の数値ID一覧で指定してください。';
    }
    const policies = updates.channelDetectorExclusions;
    if (policies !== undefined) {
        if (!policies || typeof policies !== 'object' || Array.isArray(policies) || !validIds(Object.keys(policies))) return 'チャンネル別除外設定が不正です。';
        for (const names of Object.values(policies)) {
            if (!Array.isArray(names) || names.length > Object.keys(current.detectors).length || names.some(name => typeof name !== 'string' || !Object.hasOwn(current.detectors, name) || name === 'raidDetection')) return 'チャンネル単位で除外できない検知が指定されています。';
        }
    }
    for (const id of updates.excludedRoles || []) {
        if (!current.excludedRoles.includes(id) && !await guild.roles.fetch(id).catch(() => null)) return `ロール ${id} はこのサーバーに存在しません。`;
    }
    const previous = new Set([...current.excludedChannels, ...Object.keys(current.channelDetectorExclusions || {})]);
    const next = new Set([...(updates.excludedChannels || []), ...Object.keys(policies || {})]);
    for (const id of next) {
        if (previous.has(id)) continue;
        const channel = await guild.channels.fetch(id).catch(() => null);
        if (!channel || channel.guildId !== guild.id) return `チャンネル ${id} はこのサーバーに存在しません。`;
    }
    return null;
}
