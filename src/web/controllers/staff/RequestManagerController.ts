import { Request, Response } from 'express';
import { BotClient } from '../../../core/BotClient.js';
import { database } from '../../../core/Database.js';

type SessionLike = {
    userId: string;
    guildId?: string;
    guildIds?: string[];
    guilds?: Array<{ id?: string; guildId?: string }>;
    permissions?: Array<{ guildId?: string }>;
};

type RequestConfig = {
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

function getRequestItemsKey(guildId: string): string {
    return `Guild/${guildId}/corefeature/request/items`;
}

export class RequestManagerController {
    private botClient: BotClient;
    constructor(botClient: BotClient) {
        this.botClient = botClient;
    }

    getConfig = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const session = (req as any).session as SessionLike | undefined;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const config = await database.get<RequestConfig | null>(guildId, getRequestConfigKey(guildId), null);
            res.json({ config });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get request config' });
        }
    };

    saveConfig = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const session = (req as any).session as SessionLike | undefined;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const { categoryName, labels, doneChannelId, staffRoleId, trackingChannelId, cooldownSeconds, description, instructions } = req.body as {
                categoryName?: string;
                labels?: string[];
                doneChannelId?: string | null;
                staffRoleId?: string | null;
                trackingChannelId?: string | null;
                cooldownSeconds?: number;
                description?: string;
                instructions?: string;
            };

            const existing = await database.get<RequestConfig | null>(guildId, getRequestConfigKey(guildId), null);

            const parsedCooldown = typeof cooldownSeconds === 'number'
                ? cooldownSeconds
                : (typeof cooldownSeconds === 'string' ? Number(cooldownSeconds) : NaN);

            const config: RequestConfig = {
                guildId,
                categoryName: typeof categoryName === 'string' && categoryName.trim()
                    ? categoryName.trim()
                    : existing?.categoryName || '作成カテゴリ名',
                labels: Array.isArray(labels)
                    ? labels
                        .filter((entry) => typeof entry === 'string')
                        .map((entry) => entry.trim().slice(0, 10))
                        .filter(Boolean)
                        .slice(0, 20)
                    : existing?.labels || [],
                doneChannelId: doneChannelId === undefined
                    ? existing?.doneChannelId || null
                    : doneChannelId || null,
                staffRoleId: staffRoleId === undefined
                    ? existing?.staffRoleId || null
                    : staffRoleId || null,
                trackingChannelId: trackingChannelId === undefined
                    ? existing?.trackingChannelId || null
                    : trackingChannelId || null,
                cooldownSeconds: Number.isFinite(parsedCooldown)
                    ? Math.max(30, Math.min(86400, Math.floor(parsedCooldown)))
                    : (existing?.cooldownSeconds || 300),
                description: typeof description === 'string' && description.trim()
                    ? description.trim()
                    : existing?.description || 'このパネルから機能リクエスト、バグ報告、その他の要望を送信できます。',
                instructions: typeof instructions === 'string' && instructions.trim()
                    ? instructions.trim()
                    : existing?.instructions || '1. 必要ならラベルを設定してください\n2. 件名を入力してください\n3. 詳細な内容を記述してください',
                updatedBy: session.userId,
                updatedAt: new Date().toISOString()
            };

            await database.set(guildId, getRequestConfigKey(guildId), config);

            // Also update the core panel config to use these values
            const corePanelKeys = ['combined', 'personality', 'debate', 'request'] as const;
            for (const panelKind of corePanelKeys) {
                const panelMapKey = `Guild/${guildId}/corefeature/panels`;
                const panelMap = await database.get<Record<string, any> | null>(guildId, panelMapKey, {});

                if (panelMap && panelMap[panelKind]) {
                    panelMap[panelKind] = {
                        ...panelMap[panelKind],
                        requestCategoryName: config.categoryName,
                        requestLabels: config.labels,
                        requestDoneChannelId: config.doneChannelId,
                    };
                    await database.set(guildId, panelMapKey, panelMap);
                }
            }

            res.json({
                success: true,
                config
            });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save request config' });
        }
    };

    listItems = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const session = (req as any).session as SessionLike | undefined;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const items = await database.get<Array<{
                id: string;
                title?: string;
                label?: string;
                channelId?: string;
                status?: string;
                createdAt?: string;
            }> | null>(guildId, getRequestItemsKey(guildId), []);

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            const rows = await Promise.all((items || []).map(async (item) => {
                const channelId = item.channelId || null;
                let exists = false;
                if (guild && channelId) {
                    const channel = await guild.channels.fetch(channelId).catch(() => null);
                    exists = Boolean(channel);
                }
                return {
                    id: item.id,
                    title: item.title || '',
                    label: item.label || '',
                    status: item.status || 'undecided',
                    statusLabel: getRequestStatusLabel(item.status || 'undecided'),
                    statusColor: getRequestStatusColor(item.status || 'undecided'),
                    createdAt: item.createdAt || null,
                    channelId,
                    exists,
                    url: channelId ? `https://discord.com/channels/${guildId}/${channelId}` : null
                };
            }));

            res.json({ items: rows });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list request items' });
        }
    };

    cleanupMissingItems = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId } = req.params;
            const session = (req as any).session as SessionLike | undefined;
            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const items = await database.get<Array<{ channelId?: string } & Record<string, any>> | null>(guildId, getRequestItemsKey(guildId), []);
            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const kept: Array<Record<string, any>> = [];
            let removed = 0;
            for (const item of items || []) {
                const channelId = typeof item.channelId === 'string' ? item.channelId : '';
                if (!channelId) {
                    removed += 1;
                    continue;
                }
                const channel = await guild.channels.fetch(channelId).catch(() => null);
                if (!channel) {
                    removed += 1;
                    continue;
                }
                kept.push(item);
            }

            await database.set(guildId, getRequestItemsKey(guildId), kept);
            res.json({ success: true, removed, remaining: kept.length });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to cleanup missing request items' });
        }
    };
}

function getRequestStatusLabel(status: string): string {
    switch (status) {
        case 'waiting':
            return '情報待ち';
        case 'planned':
            return '計画';
        case 'working':
            return '作業中';
        case 'done':
            return '完了';
        case 'closed':
            return 'クローズ';
        default:
            return '未定';
    }
}

function getRequestStatusColor(status: string): number {
    switch (status) {
        case 'waiting':
            return 0xf59e0b;
        case 'planned':
            return 0x2563eb;
        case 'working':
            return 0xd97706;
        case 'done':
            return 0x16a34a;
        case 'closed':
            return 0x6b7280;
        default:
            return 0x7c3aed;
    }
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
