import { Request, Response } from 'express';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { BotClient } from '../../../core/platform/BotClient.js';
import {
    DEFAULT_JOIN_LOG_SETTINGS,
    JoinLogSettings,
    joinLogManager
} from '../../../core/join/JoinLogManager.js';
import { SettingsSession } from '../../types/index.js';
import {
    getSessionGuildPermissionLevel,
    isGuildAccessible
} from '../../middleware/auth.js';

const MAX_TITLE_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 4096;

function parseColor(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff) {
        return value;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
            return Number.parseInt(normalized, 16);
        }
    }

    return fallback;
}

function normalizeText(value: unknown, fallback: string, maxLength: number): string {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim();
    return normalized ? normalized.slice(0, maxLength) : fallback;
}

export class JoinLogController {
    constructor(private readonly botClient: BotClient) {}

    getState = async (req: Request, res: Response): Promise<void> => {
        const access = await this.resolveAccess(req, res);
        if (!access) return;

        const settings = await joinLogManager.getSettings(access.guild.id);
        const channels = access.guild.channels.cache
            .filter((channel: any) => channel.type === ChannelType.GuildText)
            .sort((left: any, right: any) => (left.rawPosition ?? left.position ?? 0) - (right.rawPosition ?? right.position ?? 0))
            .map((channel: any) => ({
                id: channel.id,
                name: channel.name,
                position: channel.rawPosition ?? channel.position ?? 0
            }));

        res.json({
            guild: {
                id: access.guild.id,
                name: access.guild.name,
                icon: typeof access.guild.iconURL === 'function' ? access.guild.iconURL() : null
            },
            settings,
            defaults: DEFAULT_JOIN_LOG_SETTINGS,
            channels: Array.from(channels),
            placeholders: [
                '{user}', '{display_name}', '{tag}', '{mention}', '{id}',
                '{server}', '{member_count}', '{roles}', '{joined_duration}',
                '{account_created}'
            ]
        });
    };

    saveState = async (req: Request, res: Response): Promise<void> => {
        const access = await this.resolveAccess(req, res);
        if (!access) return;

        const current = await joinLogManager.getSettings(access.guild.id);
        const body = req.body || {};
        const channelId = body.channelId === null || body.channelId === ''
            ? null
            : typeof body.channelId === 'string' ? body.channelId : current.channelId;

        if (channelId) {
            const channel = await access.guild.channels.fetch(channelId).catch(() => null);
            if (!channel || channel.type !== ChannelType.GuildText) {
                res.status(400).json({ error: '送信先にはテキストチャンネルを指定してください。' });
                return;
            }
        }

        const settings: JoinLogSettings = {
            enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
            channelId,
            logBots: typeof body.logBots === 'boolean' ? body.logBots : current.logBots,
            joinTitle: normalizeText(body.joinTitle, current.joinTitle, MAX_TITLE_LENGTH),
            joinDescription: normalizeText(body.joinDescription, current.joinDescription, MAX_DESCRIPTION_LENGTH),
            leaveTitle: normalizeText(body.leaveTitle, current.leaveTitle, MAX_TITLE_LENGTH),
            leaveDescription: normalizeText(body.leaveDescription, current.leaveDescription, MAX_DESCRIPTION_LENGTH),
            joinColor: parseColor(body.joinColor, current.joinColor),
            leaveColor: parseColor(body.leaveColor, current.leaveColor)
        };

        if (settings.enabled && !settings.channelId) {
            res.status(400).json({ error: '有効化するには送信先チャンネルが必要です。' });
            return;
        }

        await joinLogManager.saveSettings(access.guild.id, settings);
        res.json({ success: true, settings });
    };

    resetState = async (req: Request, res: Response): Promise<void> => {
        const access = await this.resolveAccess(req, res);
        if (!access) return;

        const current = await joinLogManager.getSettings(access.guild.id);
        const settings: JoinLogSettings = {
            ...DEFAULT_JOIN_LOG_SETTINGS,
            enabled: current.enabled,
            channelId: current.channelId,
            logBots: current.logBots
        };
        await joinLogManager.saveSettings(access.guild.id, settings);
        res.json({ success: true, settings });
    };

    private async resolveAccess(req: Request, res: Response): Promise<{ guild: any; session: SettingsSession } | null> {
        const guildId = req.params.guildId;
        const session = (req as any).session as SettingsSession | undefined;
        if (!session || !guildId || !isGuildAccessible(session, guildId)) {
            res.status(403).json({ error: 'このサーバーへのアクセス権限がありません。' });
            return null;
        }

        const sessionLevel = getSessionGuildPermissionLevel(session, guildId);
        const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            res.status(404).json({ error: 'サーバーが見つかりません。' });
            return null;
        }

        if (sessionLevel < 2) {
            const member = await guild.members.fetch(session.userId).catch(() => null);
            const canManage = member?.permissions?.has(PermissionFlagsBits.Administrator)
                || member?.permissions?.has(PermissionFlagsBits.ManageGuild);
            if (!canManage) {
                res.status(403).json({ error: 'サーバー管理権限が必要です。' });
                return null;
            }
        }

        return { guild, session };
    }
}
