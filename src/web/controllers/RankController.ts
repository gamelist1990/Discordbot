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
    private botClient: BotClient;

    constructor(botClient: BotClient) {
        this.botClient = botClient;
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
                if (xpRates.messageXpMin !== undefined && xpRates.messageXpMin >= 0) {
                    data.settings.xpRates.messageXpMin = xpRates.messageXpMin;
                }
                if (xpRates.messageXpMax !== undefined && xpRates.messageXpMax >= 0) {
                    data.settings.xpRates.messageXpMax = xpRates.messageXpMax;
                }
                if (xpRates.vcXpPerMinuteMin !== undefined && xpRates.vcXpPerMinuteMin >= 0) {
                    data.settings.xpRates.vcXpPerMinuteMin = xpRates.vcXpPerMinuteMin;
                }
                if (xpRates.vcXpPerMinuteMax !== undefined && xpRates.vcXpPerMinuteMax >= 0) {
                    data.settings.xpRates.vcXpPerMinuteMax = xpRates.vcXpPerMinuteMax;
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
        const preset = req.query.preset as string;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        try {
            const leaderboard = await rankManager.getLeaderboard(guildId, limit, offset, preset);
            
            // ユーザー情報をエンリッチ（ユーザー名とアバターを取得）
            const guild = this.botClient.client.guilds.cache.get(guildId);
            const enrichedLeaderboard: Array<{userId: string, username: string, avatar: string | null, xp: number, rank: string}> = [];

            for (const entry of leaderboard) {
                try {
                    const member = guild?.members.cache.get(entry.userId);
                    const user = member?.user;
                    enrichedLeaderboard.push({
                        userId: entry.userId,
                        username: member?.displayName || user?.username || entry.userId,
                        avatar: user?.avatarURL() || user?.defaultAvatarURL || null,
                        xp: entry.xp,
                        rank: entry.rank
                    });
                } catch (error) {
                    // ユーザー情報が取得できない場合は基本情報のみ
                    enrichedLeaderboard.push({
                        userId: entry.userId,
                        username: entry.userId,
                        avatar: null,
                        xp: entry.xp,
                        rank: entry.rank
                    });
                }
            }

            res.json({ leaderboard: enrichedLeaderboard });
        } catch (error) {
            Logger.error('Failed to get leaderboard:', error);
            res.status(500).json({ error: 'Failed to fetch leaderboard' });
        }
    }

    /**
     * プリセット別ランキングを取得
     */
    async getPresetLeaderboard(req: Request, res: Response): Promise<void> {
        const guildId = req.params.guildId || req.query.guildId as string;
        const presetName = req.params.presetName as string;

        if (!guildId || !presetName) {
            res.status(400).json({ error: 'guildId and presetName are required' });
            return;
        }

        try {
            const stats = await rankManager.getPresetLeaderboardStats(guildId, presetName);
            
            // ユーザー情報をエンリッチ
            const guild = this.botClient.client.guilds.cache.get(guildId);
            const enrichedLeaderboard: Array<{
                rankIndex: number;
                userId: string;
                username: string;
                avatar: string | null;
                xp: number;
                rank: string;
            }> = [];

            for (const entry of stats.leaderboard) {
                try {
                    const member = guild?.members.cache.get(entry.userId);
                    const user = member?.user;
                    enrichedLeaderboard.push({
                        rankIndex: entry.rankIndex,
                        userId: entry.userId,
                        username: member?.displayName || user?.username || entry.userId,
                        avatar: user?.avatarURL() || user?.defaultAvatarURL || null,
                        xp: entry.xp,
                        rank: entry.rank
                    });
                } catch (error) {
                    enrichedLeaderboard.push({
                        rankIndex: entry.rankIndex,
                        userId: entry.userId,
                        username: entry.userId,
                        avatar: null,
                        xp: entry.xp,
                        rank: entry.rank
                    });
                }
            }

            res.json({
                preset: stats.preset,
                totalUsers: stats.totalUsers,
                leaderboard: enrichedLeaderboard
            });
        } catch (error) {
            Logger.error('Failed to get preset leaderboard:', error);
            res.status(500).json({ error: 'Failed to fetch preset leaderboard' });
        }
    }

    /**
     * 全プリセットランキングを取得
     */
    async getAllPresetLeaderboards(req: Request, res: Response): Promise<void> {
        const guildId = req.params.guildId || req.query.guildId as string;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        try {
            const allStats = await rankManager.getAllPresetLeaderboards(guildId);
            const guild = this.botClient.client.guilds.cache.get(guildId);

            const enrichedStats = allStats.map(stat => {
                const enrichedLeaderboard: Array<{
                    userId: string;
                    username: string;
                    avatar: string | null;
                    xp: number;
                    rank: string;
                }> = [];

                for (const entry of stat.topUsers) {
                    try {
                        const member = guild?.members.cache.get(entry.userId);
                        const user = member?.user;
                        enrichedLeaderboard.push({
                            userId: entry.userId,
                            username: member?.displayName || user?.username || entry.userId,
                            avatar: user?.avatarURL() || user?.defaultAvatarURL || null,
                            xp: entry.xp,
                            rank: entry.rank
                        });
                    } catch (error) {
                        enrichedLeaderboard.push({
                            userId: entry.userId,
                            username: entry.userId,
                            avatar: null,
                            xp: entry.xp,
                            rank: entry.rank
                        });
                    }
                }

                return {
                    preset: stat.preset,
                    totalUsers: stat.totalUsers,
                    topUsers: enrichedLeaderboard
                };
            });

            res.json({ presets: enrichedStats });
        } catch (error) {
            Logger.error('Failed to get all preset leaderboards:', error);
            res.status(500).json({ error: 'Failed to fetch preset leaderboards' });
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
        const presetName = req.body.presetName; // オプション

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
            await rankManager.addXp(guildId, userId, xp, presetName, 'web-api');
            res.json({ success: true });
            Logger.info(`Added ${xp} XP to user ${userId} in guild ${guildId} (preset: ${presetName || 'default'}, web API)`);
        } catch (error) {
            Logger.error('Failed to add XP:', error);
            res.status(500).json({ error: 'Failed to add XP' });
        }
    }

    /**
     * ユーザーの参加しているギルド一覧を取得（ウェブランキングボード用）
     */
    async getUserGuilds(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;

        try {
            const guildIds = session.guildIds || [];
            Logger.info(`getUserGuilds: session.guildIds = ${JSON.stringify(guildIds)}`);
            const rankGuilds: Array<{id: string, name: string, icon: string | null, hasRankings: boolean}> = [];

            for (const guildId of guildIds) {
                try {
                    const guild = this.botClient.client.guilds.cache.get(guildId);
                    if (!guild) continue;

                    // ランキングデータが存在するかチェック
                    const rankingData = await rankManager.getRankingData(guildId);
                    if (Object.keys(rankingData.users).length > 0 || rankingData.panels) {
                        rankGuilds.push({
                            id: guild.id,
                            name: guild.name,
                            icon: guild.iconURL(),
                            hasRankings: true
                        });
                    }
                } catch (error) {
                    // ランキングデータがない場合はスキップ
                    continue;
                }
            }

            res.json({ guilds: rankGuilds });
        } catch (error) {
            Logger.error('Failed to get user guilds:', error);
            res.status(500).json({ error: 'Failed to get user guilds' });
        }
    }

    /**
     * ギルドのランキング情報を取得（ウェブランキングボード用）
     */
    async getGuildRankings(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { id: guildId } = req.params;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        // ユーザーがこのギルドのメンバーかチェック
        const isMember = session.guildIds?.includes(guildId);
        if (!isMember) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }

        try {
            const rankingData = await rankManager.getRankingData(guildId);
            const leaderboard = await rankManager.getLeaderboard(guildId, 50); // トップ50を取得

            // ユーザー情報を取得
            const guild = this.botClient.client.guilds.cache.get(guildId);
            const enrichedLeaderboard: Array<{userId: string, username: string, avatar: string | null, xp: number, rank: string}> = [];

            for (const entry of leaderboard) {
                try {
                    const member = guild?.members.cache.get(entry.userId);
                    const user = member?.user;
                    enrichedLeaderboard.push({
                        userId: entry.userId,
                        username: member?.displayName || user?.username || entry.userId,
                        avatar: user?.avatarURL() || user?.defaultAvatarURL || null,
                        xp: entry.xp,
                        rank: entry.rank
                    });
                } catch (error) {
                    // ユーザー情報が取得できない場合は基本情報のみ
                    enrichedLeaderboard.push({
                        userId: entry.userId,
                        username: entry.userId,
                        avatar: null,
                        xp: entry.xp,
                        rank: entry.rank
                    });
                }
            }

            const guildInfo = guild ? {
                id: guild.id,
                name: guild.name,
                iconURL: guild.iconURL()
            } : {
                id: guildId,
                name: 'Unknown Guild',
                iconURL: null
            };

            res.json({
                guild: guildInfo,
                leaderboard: enrichedLeaderboard,
                presets: rankingData.rankPresets,
                panels: Object.entries(rankingData.panels || {}).map(([panelId, panel]) => ({
                    id: panelId,
                    channelId: panel.channelId,
                    messageId: panel.messageId,
                    preset: panel.preset,
                    lastUpdate: panel.lastUpdate,
                    topCount: panel.topCount
                }))
            });
        } catch (error) {
            Logger.error('Failed to get guild rankings:', error);
            res.status(500).json({ error: 'Failed to get guild rankings' });
        }
    }

    /**
     * ギルドのパネル一覧を取得（ウェブランキングボード用）
     */
    async getGuildPanels(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const { guildId } = req.params;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        // ユーザーがこのギルドのメンバーかチェック
        const isMember = session.guildIds?.includes(guildId);
        if (!isMember) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }

        try {
            const rankingData = await rankManager.getRankingData(guildId);
            const panels = Object.entries(rankingData.panels || {}).map(([panelId, panel]) => ({
                id: panelId,
                name: `${panel.preset}ランキング`, // パネル名としてプリセット名を使用
                preset: panel.preset,
                channelId: panel.channelId,
                topCount: panel.topCount || 10,
                lastUpdate: panel.lastUpdate
            }));

            const guild = this.botClient.client.guilds.cache.get(guildId);
            const guildInfo = guild ? {
                id: guild.id,
                name: guild.name,
                iconURL: guild.iconURL()
            } : {
                id: guildId,
                name: 'Unknown Guild',
                iconURL: null
            };

            res.json({
                guild: guildInfo,
                panels
            });
        } catch (error) {
            Logger.error('Failed to get guild panels:', error);
            res.status(500).json({ error: 'Failed to get guild panels' });
        }
    }

    /**
     * パネルのリーダーボードを取得（ウェブランキングボード用）
     */
    async getPanelLeaderboard(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession | undefined;
        const { guildId, panelId } = req.params;

        if (!guildId || !panelId) {
            res.status(400).json({ error: 'guildId and panelId are required' });
            return;
        }

        // ユーザーがこのギルドのメンバーかチェック（セッションが存在する場合のみ）
        if (session && !session.guildIds?.includes(guildId)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }

        try {
            const rankingData = await rankManager.getRankingData(guildId);
            const panel = rankingData.panels?.[panelId];

            if (!panel) {
                res.status(404).json({ error: 'Panel not found' });
                return;
            }

            const leaderboard = await rankManager.getLeaderboard(guildId, panel.topCount || 10, 0, panel.preset);

            // ユーザー情報を取得
            const guild = this.botClient.client.guilds.cache.get(guildId);
            const enrichedLeaderboard: Array<{userId: string, username: string, avatar: string | null, xp: number, rank: string}> = [];

            for (const entry of leaderboard) {
                try {
                    const member = guild?.members.cache.get(entry.userId);
                    const user = member?.user;
                    enrichedLeaderboard.push({
                        userId: entry.userId,
                        username: member?.displayName || user?.username || entry.userId,
                        avatar: user?.avatarURL() || user?.defaultAvatarURL || null,
                        xp: entry.xp,
                        rank: entry.rank
                    });
                } catch (error) {
                    // ユーザー情報が取得できない場合は基本情報のみ
                    enrichedLeaderboard.push({
                        userId: entry.userId,
                        username: entry.userId,
                        avatar: null,
                        xp: entry.xp,
                        rank: entry.rank
                    });
                }
            }

            const preset = rankingData.rankPresets.find(p => p.name === panel.preset) || rankingData.rankPresets[0];
            const guildInfo = guild ? {
                id: guild.id,
                name: guild.name,
                iconURL: guild.iconURL()
            } : {
                id: guildId,
                name: 'Unknown Guild',
                iconURL: null
            };

            res.json({
                guild: guildInfo,
                panel: {
                    id: panelId,
                    name: `${panel.preset}ランキング`,
                    preset: panel.preset,
                    topCount: panel.topCount || 10,
                    lastUpdate: panel.lastUpdate || new Date().toISOString()
                },
                preset,
                leaderboard: enrichedLeaderboard
            });
        } catch (error) {
            Logger.error('Failed to get panel leaderboard:', error);
            res.status(500).json({ error: 'Failed to get panel leaderboard' });
        }
    }

    /**
     * ランクをリセット
     */
    async resetRank(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.params.guildId;
        const { userId } = req.body;

        if (!guildId) {
            res.status(400).json({ error: 'guildId is required' });
            return;
        }

        // 権限チェック (ADMIN以上)
        let level = 0;
        if (Array.isArray(session.permissions)) {
            const found = session.permissions.find(p => p.guildId === guildId);
            if (found) level = found.level;
        } else if (session.permission !== undefined) {
            level = session.permission;
        }

        const permissionError = PermissionManager.checkPermission(level, 2, '権限がありません');
        if (permissionError) {
            res.status(permissionError.status).json({ error: permissionError.error });
            return;
        }

        try {
            await rankManager.resetRank(guildId, userId);

            // キャッシュクリア
            CacheManager.delete(`rank_presets_${guildId}`);
            CacheManager.delete(`rank_leaderboard_${guildId}`);

            res.json({ 
                success: true, 
                message: userId 
                    ? `User ${userId} rank has been reset` 
                    : 'All ranks have been reset'
            });
            Logger.info(`Reset rank in guild ${guildId}. User: ${userId || 'all'}`);
        } catch (error) {
            Logger.error('Failed to reset rank:', error);
            res.status(500).json({ error: 'Failed to reset rank' });
        }
    }

    /**
     * XP条件ルールを追加
     */
    async addXpConditionRule(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.params.guildId;
        const presetName = req.params.presetName;
        const rule = req.body;

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
            if (!rule.id || !rule.name || !rule.actionType) {
                res.status(400).json({ error: 'id, name, and actionType are required' });
                return;
            }

            await rankManager.addXpConditionRule(guildId, presetName, rule);

            CacheManager.delete(`rank_presets_${guildId}`);

            res.json({ success: true, rule });
            Logger.info(`Added XP condition rule: ${rule.id} to preset ${presetName}`);
        } catch (error) {
            Logger.error('Failed to add XP condition rule:', error);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            res.status(400).json({ error: errorMsg });
        }
    }

    /**
     * XP条件ルールを更新
     */
    async updateXpConditionRule(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.params.guildId;
        const presetName = req.params.presetName;
        const ruleId = req.params.ruleId;
        const updates = req.body;

        if (!guildId || !presetName || !ruleId) {
            res.status(400).json({ error: 'guildId, presetName, and ruleId are required' });
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
            await rankManager.updateXpConditionRule(guildId, presetName, ruleId, updates);

            CacheManager.delete(`rank_presets_${guildId}`);

            res.json({ success: true });
            Logger.info(`Updated XP condition rule: ${ruleId}`);
        } catch (error) {
            Logger.error('Failed to update XP condition rule:', error);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            res.status(400).json({ error: errorMsg });
        }
    }

    /**
     * XP条件ルールを削除
     */
    async deleteXpConditionRule(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.params.guildId;
        const presetName = req.params.presetName;
        const ruleId = req.params.ruleId;

        if (!guildId || !presetName || !ruleId) {
            res.status(400).json({ error: 'guildId, presetName, and ruleId are required' });
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
            await rankManager.deleteXpConditionRule(guildId, presetName, ruleId);

            CacheManager.delete(`rank_presets_${guildId}`);

            res.json({ success: true });
            Logger.info(`Deleted XP condition rule: ${ruleId}`);
        } catch (error) {
            Logger.error('Failed to delete XP condition rule:', error);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            res.status(400).json({ error: errorMsg });
        }
    }

    /**
     * XP条件ルール一覧を取得
     */
    async getXpConditionRules(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const guildId = req.params.guildId;
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
            const rules = await rankManager.getXpConditionRules(guildId, presetName);
            res.json(rules);
        } catch (error) {
            Logger.error('Failed to get XP condition rules:', error);
            res.status(500).json({ error: 'Failed to fetch XP condition rules' });
        }
    }
}
