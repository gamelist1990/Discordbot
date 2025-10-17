import { Request, Response } from 'express';
import { BotClient } from '../../core/BotClient.js';
import { getTriggerManager } from '../../core/TriggerManager.js';
import { Logger } from '../../utils/Logger.js';
import { Trigger } from '../../types/trigger.js';
import crypto from 'crypto';

/**
 * TriggerController
 * トリガー機能のREST APIエンドポイントを処理
 */
export class TriggerController {
    constructor(_botClient: BotClient) {
        // botClient not required by current controller implementation
    }

    /**
     * GET /api/triggers?guildId=...
     * ギルドの全トリガーを取得
     */
    async getAllTriggers(req: Request, res: Response): Promise<void> {
        try {
            const guildId = req.query.guildId as string;
            
            if (!guildId) {
                res.status(400).json({ error: 'guildId is required' });
                return;
            }

            const triggerManager = getTriggerManager();
            const triggers = await triggerManager.getTriggersForGuild(guildId);

            res.json({ triggers });
        } catch (error) {
            Logger.error('Failed to get triggers:', error);
            res.status(500).json({ error: 'Failed to get triggers' });
        }
    }

    /**
     * GET /api/triggers/:id
     * 特定のトリガーを取得
     */
    async getTrigger(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const guildId = req.query.guildId as string;

            if (!guildId) {
                res.status(400).json({ error: 'guildId is required' });
                return;
            }

            const triggerManager = getTriggerManager();
            const trigger = await triggerManager.getTriggerById(guildId, id);

            if (!trigger) {
                res.status(404).json({ error: 'Trigger not found' });
                return;
            }

            res.json({ trigger });
        } catch (error) {
            Logger.error('Failed to get trigger:', error);
            res.status(500).json({ error: 'Failed to get trigger' });
        }
    }

    /**
     * POST /api/triggers
     * 新しいトリガーを作成
     */
    async createTrigger(req: Request, res: Response): Promise<void> {
        try {
            const body = req.body;
            const session = (req as any).session;

            if (!body.guildId || !body.name || !body.eventType) {
                res.status(400).json({ error: 'guildId, name, eventType are required' });
                return;
            }

            // プリセット数制限チェック
            if (body.presets && body.presets.length > 5) {
                res.status(400).json({ error: 'Maximum 5 presets allowed' });
                return;
            }

            // 新しいトリガーを構築
            const trigger: Trigger = {
                id: crypto.randomUUID(),
                guildId: body.guildId,
                name: body.name,
                description: body.description || '',
                enabled: body.enabled !== undefined ? body.enabled : true,
                eventType: body.eventType,
                priority: body.priority || 0,
                conditions: body.conditions || [],
                presets: (body.presets || []).map((p: any, index: number) => ({
                    ...p,
                    id: p.id || crypto.randomUUID(),
                    triggerId: '', // 後で設定
                    index,
                })),
                createdBy: session?.userId || 'unknown',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            // プリセットのtriggerIdを設定
            trigger.presets.forEach((preset) => {
                preset.triggerId = trigger.id;
            });

            const triggerManager = getTriggerManager();
            const created = await triggerManager.createTrigger(trigger);

            res.status(201).json({ trigger: created });
        } catch (error: any) {
            Logger.error('Failed to create trigger:', error);
            res.status(500).json({ error: error.message || 'Failed to create trigger' });
        }
    }

    /**
     * PUT /api/triggers/:id
     * トリガーを更新
     */
    async updateTrigger(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const body = req.body;
            const guildId = req.query.guildId as string;

            if (!guildId) {
                res.status(400).json({ error: 'guildId is required' });
                return;
            }

            // プリセット数制限チェック
            if (body.presets && body.presets.length > 5) {
                res.status(400).json({ error: 'Maximum 5 presets allowed' });
                return;
            }

            const triggerManager = getTriggerManager();
            const updated = await triggerManager.updateTrigger(guildId, id, body);

            if (!updated) {
                res.status(404).json({ error: 'Trigger not found' });
                return;
            }

            res.json({ trigger: updated });
        } catch (error: any) {
            Logger.error('Failed to update trigger:', error);
            res.status(500).json({ error: error.message || 'Failed to update trigger' });
        }
    }

    /**
     * DELETE /api/triggers/:id
     * トリガーを削除
     */
    async deleteTrigger(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const guildId = req.query.guildId as string;

            if (!guildId) {
                res.status(400).json({ error: 'guildId is required' });
                return;
            }

            const triggerManager = getTriggerManager();
            const deleted = await triggerManager.deleteTrigger(guildId, id);

            if (!deleted) {
                res.status(404).json({ error: 'Trigger not found' });
                return;
            }

            res.json({ success: true });
        } catch (error) {
            Logger.error('Failed to delete trigger:', error);
            res.status(500).json({ error: 'Failed to delete trigger' });
        }
    }

    /**
     * POST /api/triggers/:id/test
     * トリガーをテスト実行（モックイベント）
     */
    async testTrigger(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const guildId = req.query.guildId as string;
            // mockEvent currently unused; kept for future extension

            if (!guildId) {
                res.status(400).json({ error: 'guildId is required' });
                return;
            }

            const triggerManager = getTriggerManager();
            const trigger = await triggerManager.getTriggerById(guildId, id);

            if (!trigger) {
                res.status(404).json({ error: 'Trigger not found' });
                return;
            }

            // テスト実行（実際には送信しない）
            // 将来的にはモックイベントを使ってプレビューを生成
            res.json({ 
                success: true, 
                message: 'Test execution is not fully implemented yet',
                trigger 
            });
        } catch (error) {
            Logger.error('Failed to test trigger:', error);
            res.status(500).json({ error: 'Failed to test trigger' });
        }
    }

    /**
     * POST /api/triggers/import
     * トリガーをインポート
     */
    async importTriggers(req: Request, res: Response): Promise<void> {
        try {
            const { guildId, triggers } = req.body;

            if (!guildId || !triggers || !Array.isArray(triggers)) {
                res.status(400).json({ error: 'guildId and triggers array are required' });
                return;
            }

            const triggerManager = getTriggerManager();
            const imported: Trigger[] = [];

            for (const triggerData of triggers) {
                try {
                    const trigger: Trigger = {
                        ...triggerData,
                        id: crypto.randomUUID(),
                        guildId,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    };
                    const created = await triggerManager.createTrigger(trigger);
                    imported.push(created);
                } catch (error) {
                    Logger.error(`Failed to import trigger: ${triggerData.name}`, error);
                }
            }

            res.json({ imported, count: imported.length });
        } catch (error) {
            Logger.error('Failed to import triggers:', error);
            res.status(500).json({ error: 'Failed to import triggers' });
        }
    }

    /**
     * POST /api/triggers/export
     * トリガーをエクスポート
     */
    async exportTriggers(req: Request, res: Response): Promise<void> {
        try {
            const { guildId } = req.body;

            if (!guildId) {
                res.status(400).json({ error: 'guildId is required' });
                return;
            }

            const triggerManager = getTriggerManager();
            const triggers = await triggerManager.getTriggersForGuild(guildId);

            res.json({ triggers, count: triggers.length });
        } catch (error) {
            Logger.error('Failed to export triggers:', error);
            res.status(500).json({ error: 'Failed to export triggers' });
        }
    }

    /**
     * GET /api/triggers/live-buffer
     * ライブバッファ（実行履歴）を取得
     */
    async getLiveBuffer(_req: Request, res: Response): Promise<void> {
        try {
            const triggerManager = getTriggerManager();
            const buffer = triggerManager.getLiveBuffer();

            res.json({ buffer });
        } catch (error) {
            Logger.error('Failed to get live buffer:', error);
            res.status(500).json({ error: 'Failed to get live buffer' });
        }
    }

    /**
     * DELETE /api/triggers/live-buffer
     * ライブバッファをクリア
     */
    async clearLiveBuffer(_req: Request, res: Response): Promise<void> {
        try {
            const triggerManager = getTriggerManager();
            triggerManager.clearLiveBuffer();

            res.json({ success: true });
        } catch (error) {
            Logger.error('Failed to clear live buffer:', error);
            res.status(500).json({ error: 'Failed to clear live buffer' });
        }
    }
}
