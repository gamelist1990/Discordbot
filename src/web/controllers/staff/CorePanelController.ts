import { Request, Response } from 'express';
import { ChannelType, TextChannel } from 'discord.js';
import { BotClient } from '../../../core/BotClient.js';
import { coreFeatureManager } from '../../../core/corepanel/CoreFeatureManager.js';
import { buildCorePanelEmbed } from '../../../core/corepanel/panelMessage.js';
import { CoreFeaturePanelKind } from '../../../core/corepanel/types.js';

type SessionLike = {
    userId: string;
    guildId?: string;
    guildIds?: string[];
    guilds?: Array<{ id?: string; guildId?: string }>;
    permissions?: Array<{ guildId?: string }>;
};

export class CorePanelController {
    constructor(private botClient: BotClient) {}

    getConfig = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const panelKind = readPanelKind(req.query.panelKind);
            const session = (req as any).session as SessionLike | undefined;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const config = await coreFeatureManager.getPanelConfig(guildId, panelKind);
            res.json({
                panelKind,
                config,
                panelUrl: buildPanelUrl(guildId, config?.channelId || null, config?.messageId || null)
            });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get core panel config' });
        }
    };

    saveConfig = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const panelKind = readPanelKind(req.body?.panelKind);
            const session = (req as any).session as SessionLike | undefined;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const { channelId, spectatorRoleId } = req.body as {
                channelId?: string;
                spectatorRoleId?: string | null;
            };
            const existing = await coreFeatureManager.getPanelConfig(guildId, panelKind);
            const nextChannelId = typeof channelId === 'string' && channelId.trim()
                ? channelId.trim()
                : existing?.channelId || null;

            if (!nextChannelId) {
                res.status(400).json({ error: 'channelId is required' });
                return;
            }

            const config = {
                panelKind,
                guildId,
                channelId: nextChannelId,
                messageId: existing?.channelId === nextChannelId ? existing?.messageId || null : null,
                spectatorRoleId: panelKind === 'personality'
                    ? null
                    : spectatorRoleId === undefined
                        ? existing?.spectatorRoleId || null
                        : spectatorRoleId || null,
                updatedBy: session.userId,
                updatedAt: new Date().toISOString()
            };

            await coreFeatureManager.savePanelConfig(guildId, config, panelKind);
            res.json({
                success: true,
                panelKind,
                config,
                panelUrl: buildPanelUrl(guildId, config.channelId, config.messageId)
            });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save core panel config' });
        }
    };

    postPanel = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const panelKind = readPanelKind(req.body?.panelKind);
            const session = (req as any).session as SessionLike | undefined;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const { channelId, spectatorRoleId } = req.body as { channelId?: string; spectatorRoleId?: string | null };
            const existing = await coreFeatureManager.getPanelConfig(guildId, panelKind);
            const targetChannelId = typeof channelId === 'string' && channelId.trim()
                ? channelId.trim()
                : existing?.channelId || null;
            const nextSpectatorRoleId = panelKind === 'personality'
                ? null
                : spectatorRoleId === undefined
                    ? existing?.spectatorRoleId || null
                    : spectatorRoleId || null;

            if (!targetChannelId) {
                res.status(400).json({ error: 'channelId is required' });
                return;
            }

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const channel = await guild.channels.fetch(targetChannelId).catch(() => null);
            if (!channel || channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildCategory || !('send' in channel)) {
                res.status(400).json({ error: 'A text channel is required' });
                return;
            }

            const payload = {
                embeds: [buildCorePanelEmbed(panelKind, nextSpectatorRoleId)],
                components: coreFeatureManager.buildPanelRows(guildId, panelKind)
            };

            let message = null as Awaited<ReturnType<TextChannel['send']>> | null;
            if (existing?.messageId && existing.channelId === targetChannelId) {
                const existingMessage = await (channel as TextChannel).messages.fetch(existing.messageId).catch(() => null);
                if (existingMessage) {
                    message = await existingMessage.edit(payload).catch(() => null);
                }
            }

            if (!message) {
                message = await (channel as TextChannel).send(payload);
            }

            const config = {
                panelKind,
                guildId,
                channelId: targetChannelId,
                messageId: message.id,
                spectatorRoleId: nextSpectatorRoleId,
                updatedBy: session.userId,
                updatedAt: new Date().toISOString()
            };

            await coreFeatureManager.savePanelConfig(guildId, config, panelKind);
            res.json({
                success: true,
                panelKind,
                config,
                panelUrl: buildPanelUrl(guildId, config.channelId, config.messageId)
            });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to post core panel' });
        }
    };
}

function readPanelKind(value: unknown): CoreFeaturePanelKind {
    return value === 'personality' || value === 'debate' || value === 'request' ? value : 'combined';
}

function buildPanelUrl(guildId: string, channelId: string | null, messageId: string | null): string | null {
    if (!channelId || !messageId) {
        return null;
    }

    return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function hasAccessToGuild(session: SessionLike, guildId: string): boolean {
    try {
        if (!guildId) {
            return false;
        }
        if (session.guildId && session.guildId === guildId) {
            return true;
        }
        if (Array.isArray(session.guildIds) && session.guildIds.includes(guildId)) {
            return true;
        }
        if (Array.isArray(session.guilds) && session.guilds.some((guild) => guild?.id === guildId || guild?.guildId === guildId)) {
            return true;
        }
        if (Array.isArray(session.permissions) && session.permissions.some((permission) => permission?.guildId === guildId)) {
            return true;
        }
    } catch {
        return false;
    }

    return false;
}
