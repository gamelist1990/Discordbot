import { Request, Response } from 'express';
import { ChannelType, TextChannel } from 'discord.js';
import { BotClient } from '../../../core/BotClient.js';
import { coreFeatureManager } from '../../../core/corepanel/CoreFeatureManager.js';
import { buildCorePanelEmbed } from '../../../core/corepanel/panelMessage.js';
import { CoreFeaturePanelKind } from '../../../core/corepanel/types.js';
import { database } from '../../../core/Database.js';

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
            const requestConfig = supportsRequestSettings(panelKind) ? await getRequestConfig(guildId) : null;
            res.json({
                panelKind,
                config: mergeRequestSettings(config, requestConfig),
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

            const { channelId, spectatorRoleId, requestDoneChannelId, requestCategoryName, requestStaffRoleId } = req.body as {
                channelId?: string;
                spectatorRoleId?: string | null;
                requestDoneChannelId?: string | null;
                requestCategoryName?: string | null;
                requestStaffRoleId?: string | null;
            };
            const existing = await coreFeatureManager.getPanelConfig(guildId, panelKind);
            const existingRequestConfig = supportsRequestSettings(panelKind) ? await getRequestConfig(guildId) : null;
            const nextChannelId = typeof channelId === 'string' && channelId.trim()
                ? channelId.trim()
                : existing?.channelId || null;
            const nextRequestDoneChannelId = resolveRequestDoneChannelId(panelKind, requestDoneChannelId, existing?.requestDoneChannelId);
            const nextRequestCategoryName = resolveRequestCategoryName(panelKind, requestCategoryName, existingRequestConfig?.categoryName, existing?.requestCategoryName);
            const nextRequestStaffRoleId = resolveRequestStaffRoleId(panelKind, requestStaffRoleId, existingRequestConfig?.staffRoleId);

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
                requestCategoryName: nextRequestCategoryName,
                requestLabels: existing?.requestLabels,
                requestDoneChannelId: nextRequestDoneChannelId,
                requestStaffRoleId: nextRequestStaffRoleId,
                updatedBy: session.userId,
                updatedAt: new Date().toISOString()
            };

            if (supportsRequestSettings(panelKind)) {
                await saveRequestConfig(guildId, session.userId, {
                    categoryName: nextRequestCategoryName,
                    doneChannelId: nextRequestDoneChannelId,
                    staffRoleId: nextRequestStaffRoleId
                });
            }

            await coreFeatureManager.savePanelConfig(guildId, config, panelKind);
            res.json({
                success: true,
                panelKind,
                config: mergeRequestSettings(config, supportsRequestSettings(panelKind) ? await getRequestConfig(guildId) : null),
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

            const { channelId, spectatorRoleId, requestDoneChannelId, requestCategoryName, requestStaffRoleId } = req.body as {
                channelId?: string;
                spectatorRoleId?: string | null;
                requestDoneChannelId?: string | null;
                requestCategoryName?: string | null;
                requestStaffRoleId?: string | null;
            };
            const existing = await coreFeatureManager.getPanelConfig(guildId, panelKind);
            const existingRequestConfig = supportsRequestSettings(panelKind) ? await getRequestConfig(guildId) : null;
            const targetChannelId = typeof channelId === 'string' && channelId.trim()
                ? channelId.trim()
                : existing?.channelId || null;
            const nextSpectatorRoleId = panelKind === 'personality'
                ? null
                : spectatorRoleId === undefined
                    ? existing?.spectatorRoleId || null
                    : spectatorRoleId || null;
            const nextRequestDoneChannelId = resolveRequestDoneChannelId(panelKind, requestDoneChannelId, existing?.requestDoneChannelId);
            const nextRequestCategoryName = resolveRequestCategoryName(panelKind, requestCategoryName, existingRequestConfig?.categoryName, existing?.requestCategoryName);
            const nextRequestStaffRoleId = resolveRequestStaffRoleId(panelKind, requestStaffRoleId, existingRequestConfig?.staffRoleId);

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
                requestCategoryName: nextRequestCategoryName,
                requestLabels: existing?.requestLabels,
                requestDoneChannelId: nextRequestDoneChannelId,
                requestStaffRoleId: nextRequestStaffRoleId,
                updatedBy: session.userId,
                updatedAt: new Date().toISOString()
            };

            if (supportsRequestSettings(panelKind)) {
                await saveRequestConfig(guildId, session.userId, {
                    categoryName: nextRequestCategoryName,
                    doneChannelId: nextRequestDoneChannelId,
                    staffRoleId: nextRequestStaffRoleId
                });
            }

            await coreFeatureManager.savePanelConfig(guildId, config, panelKind);
            res.json({
                success: true,
                panelKind,
                config: mergeRequestSettings(config, supportsRequestSettings(panelKind) ? await getRequestConfig(guildId) : null),
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

function resolveRequestDoneChannelId(
    panelKind: CoreFeaturePanelKind,
    requestDoneChannelId: unknown,
    existingRequestDoneChannelId: string | null | undefined
): string | null {
    if (!supportsRequestSettings(panelKind)) {
        return existingRequestDoneChannelId || null;
    }
    if (requestDoneChannelId === undefined) {
        return existingRequestDoneChannelId || null;
    }
    if (typeof requestDoneChannelId === 'string' && requestDoneChannelId.trim()) {
        return requestDoneChannelId.trim();
    }
    return null;
}

function supportsRequestSettings(panelKind: CoreFeaturePanelKind): boolean {
    return panelKind === 'combined' || panelKind === 'request';
}

type StoredRequestConfig = {
    guildId: string;
    categoryName: string;
    labels: string[];
    doneChannelId: string | null;
    staffRoleId: string | null;
    trackingChannelId: string | null;
    cooldownSeconds: number;
    description: string;
    instructions: string;
    updatedBy: string;
    updatedAt: string;
};

function getRequestConfigKey(guildId: string): string {
    return `Guild/${guildId}/corefeature/request/config`;
}

async function getRequestConfig(guildId: string): Promise<StoredRequestConfig | null> {
    return await database.get<StoredRequestConfig | null>(guildId, getRequestConfigKey(guildId), null);
}

async function saveRequestConfig(
    guildId: string,
    userId: string,
    updates: { categoryName: string | null; doneChannelId: string | null; staffRoleId: string | null }
): Promise<StoredRequestConfig> {
    const existing = await getRequestConfig(guildId);
    const nextConfig: StoredRequestConfig = {
        guildId,
        categoryName: updates.categoryName || existing?.categoryName || 'Request',
        labels: existing?.labels || ['機能リクエスト', 'バグ修正', 'その他'],
        doneChannelId: updates.doneChannelId === undefined ? existing?.doneChannelId || null : updates.doneChannelId || null,
        staffRoleId: updates.staffRoleId === undefined ? existing?.staffRoleId || null : updates.staffRoleId || null,
        trackingChannelId: existing?.trackingChannelId || null,
        cooldownSeconds: existing?.cooldownSeconds || 300,
        description: existing?.description || 'このパネルから機能リクエスト、バグ報告、その他の要望を送信できます。',
        instructions: existing?.instructions || '1. ラベルを選択してください\n2. 件名を入力してください\n3. 詳細な内容を記述してください',
        updatedBy: userId,
        updatedAt: new Date().toISOString()
    };

    await database.set(guildId, getRequestConfigKey(guildId), nextConfig);
    return nextConfig;
}

function resolveRequestCategoryName(
    panelKind: CoreFeaturePanelKind,
    requestCategoryName: unknown,
    existingCategoryName: string | null | undefined,
    existingPanelCategoryName: string | null | undefined
): string | null {
    if (!supportsRequestSettings(panelKind)) {
        return existingPanelCategoryName || null;
    }
    if (typeof requestCategoryName === 'string' && requestCategoryName.trim()) {
        return requestCategoryName.trim();
    }
    return existingCategoryName || existingPanelCategoryName || 'Request';
}

function resolveRequestStaffRoleId(
    panelKind: CoreFeaturePanelKind,
    requestStaffRoleId: unknown,
    existingStaffRoleId: string | null | undefined
): string | null {
    if (!supportsRequestSettings(panelKind)) {
        return null;
    }
    if (requestStaffRoleId === undefined) {
        return existingStaffRoleId || null;
    }
    if (typeof requestStaffRoleId === 'string' && requestStaffRoleId.trim()) {
        return requestStaffRoleId.trim();
    }
    return null;
}

function mergeRequestSettings(config: any, requestConfig: StoredRequestConfig | null) {
    if (!config) {
        return config;
    }

    return {
        ...config,
        requestCategoryName: requestConfig?.categoryName || config.requestCategoryName || null,
        requestDoneChannelId: requestConfig?.doneChannelId || config.requestDoneChannelId || null,
        requestStaffRoleId: requestConfig?.staffRoleId || config.requestStaffRoleId || null
    };
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
