import { Request, Response } from 'express';
import { rankManager, RankPreset } from '../../core/RankManager.js';
import { SettingsSession } from '../types/index.js';
import { BotClient } from '../../core/BotClient.js';
import { Logger } from '../../utils/Logger.js';
import { PermissionManager } from '../../utils/PermissionManager.js';
import { CacheManager } from '../../utils/CacheManager.js';

/**
 * ランク管理コントローラー
 */
export class RankController {
    constructor(_botClient: BotClient) {
        // BotClient is provided for future use
    }

    /**
     * プリセット一覧を取得
     */
    async getPresets(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.params.guildId || req.query.guildId as string;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        // 権限チェック (STAFF以上)
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        const permissionError = PermissionManager.checkPermission(level, 1, '権限がありません');
        if (permissionError) {
            res.status(permissionError.status).json({ error: permissionError.error });
            return;
        }

        try {
            const cacheKey = `rank_presets_${guildId}`;
            const cached = CacheManager.get<RankPreset[]>(cacheKey);
            if (cached) {
                res.json(cached);
                return;
            }

            const data = await rankManager.getRankingData(guildId);
            CacheManager.set(cacheKey, data.rankPresets, 5 * 60 * 1000);
            res.json(data.rankPresets);
        } catch (error) {
            Logger.error('Failed to get rank presets:', error);
            res.status(500).json({ error: 'Failed to fetch rank presets' });
        }
    }

    /**
     * プリセット作成
     */
    async createPreset(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.body.guildId;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        // 権限チェック
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        const permissionError = PermissionManager.checkPermission(level, 1, '権限がありません');
        if (permissionError) {
            res.status(permissionError.status).json({ error: permissionError.error });
            return;
        }

        try {
            const { name, description, ranks, rewards } = req.body;

            if (!name || !ranks || !Array.isArray(ranks)) {
                res.status(400).json({ error: 'Invalid preset data' });
                return;
            }

            const data = await rankManager.getRankingData(guildId);

            // 重複チェック
            if (data.rankPresets.find(p => p.name === name)) {
                res.status(400).json({ error: 'Preset name already exists' });
                return;
            }

            // ランク範囲の検証
            for (let i = 0; i < ranks.length; i++) {
                if (ranks[i].minXp >= ranks[i].maxXp) {
                    res.status(400).json({ error: `Invalid XP range for rank ${ranks[i].name}` });
                    return;
                }
            }

            const newPreset: RankPreset = {
                name,
                description,
                ranks,
                rewards: rewards || []
            };

            data.rankPresets.push(newPreset);
            await rankManager.saveRankingData(guildId, data);

            // キャッシュクリア
            CacheManager.delete(`rank_presets_${guildId}`);

            res.json({ success: true, preset: newPreset });
            Logger.info(`Created rank preset: ${name} in guild ${guildId}`);
        } catch (error) {
            Logger.error('Failed to create preset:', error);
            res.status(500).json({ error: 'Failed to create preset' });
        }
    }

    /**
     * プリセット更新
     */
    async updatePreset(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.body.guildId;
        const presetName = req.params.presetName;

        if (!guildId || !presetName) {
            res.status(400).json({ error: 'guildId and presetName are required' });
            return;
        }

        // 権限チェック
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        const permissionError = PermissionManager.checkPermission(level, 1, '権限がありません');
        if (permissionError) {
            res.status(permissionError.status).json({ error: permissionError.error });
            return;
        }

        try {
            const { description, ranks, rewards } = req.body;
            const data = await rankManager.getRankingData(guildId);
            
            const index = data.rankPresets.findIndex(p => p.name === presetName);
            if (index === -1) {
                res.status(404).json({ error: 'Preset not found' });
                return;
            }

            // ランク範囲の検証
            if (ranks) {
                for (let i = 0; i < ranks.length; i++) {
                    if (ranks[i].minXp >= ranks[i].maxXp) {
                        res.status(400).json({ error: `Invalid XP range for rank ${ranks[i].name}` });
                        return;
                    }
                }
            }

            // 更新
            if (description !== undefined) data.rankPresets[index].description = description;
            if (ranks) data.rankPresets[index].ranks = ranks;
            if (rewards) data.rankPresets[index].rewards = rewards;

            await rankManager.saveRankingData(guildId, data);

            // キャッシュクリア
            CacheManager.delete(`rank_presets_${guildId}`);

            res.json({ success: true, preset: data.rankPresets[index] });
            Logger.info(`Updated rank preset: ${presetName} in guild ${guildId}`);
        } catch (error) {
            Logger.error('Failed to update preset:', error);
            res.status(500).json({ error: 'Failed to update preset' });
        }
    }

    /**
     * プリセット削除
     */
    async deletePreset(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.query.guildId as string;
        const presetName = req.params.presetName;

        if (!guildId || !presetName) {
            res.status(400).json({ error: 'guildId and presetName are required' });
            return;
        }

        // 権限チェック
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        const permissionError = PermissionManager.checkPermission(level, 1, '権限がありません');
        if (permissionError) {
            res.status(permissionError.status).json({ error: permissionError.error });
            return;
        }

        try {
            const data = await rankManager.getRankingData(guildId);
            const index = data.rankPresets.findIndex(p => p.name === presetName);

            if (index === -1) {
                res.status(404).json({ error: 'Preset not found' });
                return;
            }

            // 最後のプリセットは削除不可
            if (data.rankPresets.length === 1) {
                res.status(400).json({ error: 'Cannot delete the last preset' });
                return;
            }

            data.rankPresets.splice(index, 1);
            await rankManager.saveRankingData(guildId, data);

            // キャッシュクリア
            CacheManager.delete(`rank_presets_${guildId}`);

            res.json({ success: true });
            Logger.info(`Deleted rank preset: ${presetName} from guild ${guildId}`);
        } catch (error) {
            Logger.error('Failed to delete preset:', error);
            res.status(500).json({ error: 'Failed to delete preset' });
        }
    }

    /**
     * パネル一覧を取得
     */
    async getPanels(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.params.guildId || req.query.guildId as string;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        // 権限チェック
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        const permissionError = PermissionManager.checkPermission(level, 1, '権限がありません');
        if (permissionError) {
            res.status(permissionError.status).json({ error: permissionError.error });
            return;
        }

        try {
            const data = await rankManager.getRankingData(guildId);
            res.json(data.panels);
        } catch (error) {
            Logger.error('Failed to get panels:', error);
            res.status(500).json({ error: 'Failed to fetch panels' });
        }
    }

    /**
     * パネル削除
     */
    async deletePanel(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.query.guildId as string;
        const panelId = req.params.panelId;

        if (!guildId || !panelId) {
            res.status(400).json({ error: 'guildId and panelId are required' });
            return;
        }

        // 権限チェック
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        const permissionError = PermissionManager.checkPermission(level, 1, '権限がありません');
        if (permissionError) {
            res.status(permissionError.status).json({ error: permissionError.error });
            return;
        }

        try {
            const data = await rankManager.getRankingData(guildId);

            if (!data.panels[panelId]) {
                res.status(404).json({ error: 'Panel not found' });
                return;
            }

            delete data.panels[panelId];
            await rankManager.saveRankingData(guildId, data);

            res.json({ success: true });
            Logger.info(`Deleted panel ${panelId} from guild ${guildId}`);
        } catch (error) {
            Logger.error('Failed to delete panel:', error);
            res.status(500).json({ error: 'Failed to delete panel' });
        }
    }

    /**
     * 設定を取得
     */
    async getSettings(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.params.guildId || req.query.guildId as string;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        // 権限チェック
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        const permissionError = PermissionManager.checkPermission(level, 1, '権限がありません');
        if (permissionError) {
            res.status(permissionError.status).json({ error: permissionError.error });
            return;
        }

        try {
            const data = await rankManager.getRankingData(guildId);
            res.json(data.settings);
        } catch (error) {
            Logger.error('Failed to get settings:', error);
            res.status(500).json({ error: 'Failed to fetch settings' });
        }
    }

    /**
     * 設定を更新
     */
    async updateSettings(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.body.guildId;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        // 権限チェック
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        const permissionError = PermissionManager.checkPermission(level, 1, '権限がありません');
        if (permissionError) {
            res.status(permissionError.status).json({ error: permissionError.error });
            return;
        }

        try {
            const data = await rankManager.getRankingData(guildId);
            const { notifyChannelId, updateIntervalMs, xpRates } = req.body;

            // 更新
            if (notifyChannelId !== undefined) data.settings.notifyChannelId = notifyChannelId;
            if (updateIntervalMs !== undefined && updateIntervalMs >= 60000) {
                data.settings.updateIntervalMs = updateIntervalMs;
            }
            if (xpRates) {
                // XPレート設定のバリデーション
                if (xpRates.messageXp !== undefined && xpRates.messageXp >= 0) {
                    data.settings.xpRates.messageXp = xpRates.messageXp;
                }
                if (xpRates.messageCooldownSec !== undefined && xpRates.messageCooldownSec >= 1) {
                    data.settings.xpRates.messageCooldownSec = xpRates.messageCooldownSec;
                }
                if (xpRates.vcXpPerMinute !== undefined && xpRates.vcXpPerMinute >= 0) {
                    data.settings.xpRates.vcXpPerMinute = xpRates.vcXpPerMinute;
                }
                if (xpRates.dailyXpCap !== undefined && xpRates.dailyXpCap >= 0) {
                    data.settings.xpRates.dailyXpCap = xpRates.dailyXpCap;
                }
                if (xpRates.globalMultiplier !== undefined && xpRates.globalMultiplier > 0) {
                    data.settings.xpRates.globalMultiplier = xpRates.globalMultiplier;
                }
                if (xpRates.excludeChannels) {
                    data.settings.xpRates.excludeChannels = xpRates.excludeChannels;
                }
                if (xpRates.excludeRoles) {
                    data.settings.xpRates.excludeRoles = xpRates.excludeRoles;
                }
            }

            await rankManager.saveRankingData(guildId, data);

            // タイマーを再起動
            if (updateIntervalMs !== undefined) {
                await rankManager.startPanelUpdateTimer(guildId);
            }

            res.json({ success: true, settings: data.settings });
            Logger.info(`Updated rank settings for guild ${guildId}`);
        } catch (error) {
            Logger.error('Failed to update settings:', error);
            res.status(500).json({ error: 'Failed to update settings' });
        }
    }

    /**
     * リーダーボードを取得
     */
    async getLeaderboard(req: Request, res: Response): Promise<void> {
        const guildId = req.params.guildId || req.query.guildId as string;
        const limit = parseInt(req.query.limit as string) || 10;
        const offset = parseInt(req.query.offset as string) || 0;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        try {
            const leaderboard = await rankManager.getLeaderboard(guildId, limit, offset);
            res.json(leaderboard);
        } catch (error) {
            Logger.error('Failed to get leaderboard:', error);
            res.status(500).json({ error: 'Failed to fetch leaderboard' });
        }
    }

    /**
     * ユーザーのXPを追加
     */
    async addUserXp(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.body.guildId;
        const userId = req.body.userId;
        const xp = req.body.xp;

        if (!guildId || !userId || xp === undefined) {
            res.status(400).json({ error: 'guildId, userId, and xp are required' });
            return;
        }

        // 権限チェック
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        const permissionError = PermissionManager.checkPermission(level, 1, '権限がありません');
        if (permissionError) {
            res.status(permissionError.status).json({ error: permissionError.error });
            return;
        }

        try {
            await rankManager.addXp(guildId, userId, xp, 'web-api');
            res.json({ success: true });
            Logger.info(`Added ${xp} XP to user ${userId} in guild ${guildId} (web API)`);
        } catch (error) {
            Logger.error('Failed to add XP:', error);
            res.status(500).json({ error: 'Failed to add XP' });
        }
    }
}
