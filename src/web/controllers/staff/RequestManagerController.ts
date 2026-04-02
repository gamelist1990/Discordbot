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
    description: string;
    instructions: string;
    updatedBy: string;
    updatedAt: string;
};

function getRequestConfigKey(guildId: string): string {
    return `Guild/${guildId}/corefeature/request/config`;
}

export class RequestManagerController {
    constructor(_botClient: BotClient) {
        // BotClient may be used in future methods
        void _botClient;
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

            const { categoryName, labels, doneChannelId, description, instructions } = req.body as {
                categoryName?: string;
                labels?: string[];
                doneChannelId?: string | null;
                description?: string;
                instructions?: string;
            };

            const existing = await database.get<RequestConfig | null>(guildId, getRequestConfigKey(guildId), null);

            const config: RequestConfig = {
                guildId,
                categoryName: typeof categoryName === 'string' && categoryName.trim()
                    ? categoryName.trim()
                    : existing?.categoryName || 'Request',
                labels: Array.isArray(labels)
                    ? labels.filter((entry) => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean).slice(0, 20)
                    : existing?.labels || ['機能リクエスト', 'バグ修正', 'その他'],
                doneChannelId: doneChannelId === undefined
                    ? existing?.doneChannelId || null
                    : doneChannelId || null,
                description: typeof description === 'string' && description.trim()
                    ? description.trim()
                    : existing?.description || 'このパネルから機能リクエスト、バグ報告、その他の要望を送信できます。',
                instructions: typeof instructions === 'string' && instructions.trim()
                    ? instructions.trim()
                    : existing?.instructions || '1. ラベルを選択してください\n2. 件名を入力してください\n3. 詳細な内容を記述してください',
                updatedBy: session.userId,
                updatedAt: new Date().toISOString()
            };

            await database.set(guildId, getRequestConfigKey(guildId), config);

            // Also update the core panel config to use these values
            const corePanelKeys = ['combined', 'personality', 'debate'] as const;
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
