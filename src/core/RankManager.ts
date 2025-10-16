import { Client, Guild, TextChannel, EmbedBuilder } from 'discord.js';
import { Database } from './Database.js';
import { Logger } from '../utils/Logger.js';

/**
 * ランク帯の定義
 */
export interface RankTier {
    name: string;
    minXp: number;
    maxXp: number;
    color?: string;
    icon?: string;
}

/**
 * 報酬の定義
 */
export interface RankReward {
    rankName: string;
    giveRoleId?: string;
    notify?: boolean;
    webhookUrl?: string;
    customMessage?: string;
}

/**
 * ランクプリセットの定義
 */
export interface RankPreset {
    name: string;
    description?: string;
    ranks: RankTier[];
    rewards: RankReward[];
}

/**
 * ユーザーXPデータ
 */
export interface UserXpData {
    xp: number;
    lastUpdated: string;
    vcAccumMs?: number;
    lastMessageTime?: number;
    dailyXp?: number;
    dailyXpResetDate?: string;
}

/**
 * ランクパネル情報
 */
export interface RankPanel {
    channelId: string;
    messageId: string;
    preset: string;
    lastUpdate: string;
    topCount?: number;
}

/**
 * XPレート設定
 */
export interface XpRates {
    messageXp: number;
    messageCooldownSec: number;
    vcXpPerMinute: number;
    vcIntervalSec: number;
    dailyXpCap: number;
    excludeChannels: string[];
    excludeRoles: string[];
    globalMultiplier: number;
}

/**
 * ランキング設定
 */
export interface RankSettings {
    notifyChannelId?: string;
    updateIntervalMs: number;
    xpRates: XpRates;
}

/**
 * ランキングデータの完全な構造
 */
export interface RankingData {
    rankPresets: RankPreset[];
    users: Record<string, UserXpData>;
    panels: Record<string, RankPanel>;
    settings: RankSettings;
}

/**
 * デフォルトのXPレート設定
 */
const DEFAULT_XP_RATES: XpRates = {
    messageXp: 5,
    messageCooldownSec: 60,
    vcXpPerMinute: 10,
    vcIntervalSec: 60,
    dailyXpCap: 0, // 0 = unlimited
    excludeChannels: [],
    excludeRoles: [],
    globalMultiplier: 1.0
};

/**
 * デフォルトのランキング設定
 */
const DEFAULT_SETTINGS: RankSettings = {
    updateIntervalMs: 300000, // 5分
    xpRates: DEFAULT_XP_RATES
};

/**
 * ランキングシステムマネージャー
 * ギルドごとのランキングデータを管理し、XP計算、報酬処理、パネル更新を行う
 */
export class RankManager {
    private database: Database;
    private client: Client | null = null;
    private updateTimers: Map<string, NodeJS.Timeout> = new Map();
    private vcStartTimes: Map<string, number> = new Map(); // userId -> startTime

    constructor(database: Database) {
        this.database = database;
    }

    /**
     * Discord クライアントを設定
     */
    setClient(client: Client): void {
        this.client = client;
    }

    /**
     * ギルドのランキングデータを取得
     */
    async getRankingData(guildId: string): Promise<RankingData> {
        const data = await this.database.get<RankingData>(
            guildId,
            `Guild/${guildId}/rankings`,
            this.getDefaultRankingData()
        );
        return data || this.getDefaultRankingData();
    }

    /**
     * ギルドのランキングデータを保存
     */
    async saveRankingData(guildId: string, data: RankingData): Promise<void> {
        await this.database.set(guildId, `Guild/${guildId}/rankings`, data);
    }

    /**
     * デフォルトのランキングデータを取得
     */
    private getDefaultRankingData(): RankingData {
        return {
            rankPresets: [
                {
                    name: 'default',
                    description: 'デフォルトランクプリセット',
                    ranks: [
                        { name: 'Bronze', minXp: 0, maxXp: 999, color: '#CD7F32' },
                        { name: 'Silver', minXp: 1000, maxXp: 4999, color: '#C0C0C0' },
                        { name: 'Gold', minXp: 5000, maxXp: 9999, color: '#FFD700' },
                        { name: 'Platinum', minXp: 10000, maxXp: 999999, color: '#E5E4E2' }
                    ],
                    rewards: []
                }
            ],
            users: {},
            panels: {},
            settings: DEFAULT_SETTINGS
        };
    }

    /**
     * ユーザーのXPを追加
     */
    async addXp(guildId: string, userId: string, xp: number, reason?: string): Promise<void> {
        const data = await this.getRankingData(guildId);
        
        if (!data.users[userId]) {
            data.users[userId] = {
                xp: 0,
                lastUpdated: new Date().toISOString(),
                dailyXp: 0,
                dailyXpResetDate: new Date().toISOString().split('T')[0]
            };
        }

        const userData = data.users[userId];
        
        // 日次リセットチェック
        const today = new Date().toISOString().split('T')[0];
        if (userData.dailyXpResetDate !== today) {
            userData.dailyXp = 0;
            userData.dailyXpResetDate = today;
        }

        // 日次上限チェック
        if (data.settings.xpRates.dailyXpCap > 0) {
            const remainingDaily = data.settings.xpRates.dailyXpCap - (userData.dailyXp || 0);
            if (remainingDaily <= 0) {
                Logger.debug(`User ${userId} reached daily XP cap`);
                return;
            }
            xp = Math.min(xp, remainingDaily);
        }

        // 旧ランクを取得
        const oldRank = this.getUserRank(data, userData.xp);

        // XPを追加（グローバル倍率適用）
        const actualXp = Math.floor(xp * data.settings.xpRates.globalMultiplier);
        userData.xp += actualXp;
        userData.dailyXp = (userData.dailyXp || 0) + actualXp;
        userData.lastUpdated = new Date().toISOString();

        // 新ランクを取得
        const newRank = this.getUserRank(data, userData.xp);

        await this.saveRankingData(guildId, data);

        // ランクアップ処理
        if (oldRank && newRank && oldRank.name !== newRank.name) {
            await this.handleRankUp(guildId, userId, oldRank, newRank, data);
        }

        Logger.debug(`Added ${actualXp} XP to user ${userId} in guild ${guildId}. Reason: ${reason || 'none'}`);
    }

    /**
     * ユーザーの現在のランクを取得
     */
    getUserRank(data: RankingData, xp: number, presetName?: string): RankTier | null {
        const preset = presetName 
            ? data.rankPresets.find(p => p.name === presetName)
            : data.rankPresets[0];

        if (!preset) return null;

        // ランクを降順でソート（高XPから低XPへ）
        const sortedRanks = [...preset.ranks].sort((a, b) => b.minXp - a.minXp);
        
        for (const rank of sortedRanks) {
            if (xp >= rank.minXp && xp <= rank.maxXp) {
                return rank;
            }
        }

        return null;
    }

    /**
     * ユーザーの次のランクを取得
     */
    getNextRank(data: RankingData, xp: number, presetName?: string): RankTier | null {
        const preset = presetName 
            ? data.rankPresets.find(p => p.name === presetName)
            : data.rankPresets[0];

        if (!preset) return null;

        const sortedRanks = [...preset.ranks].sort((a, b) => a.minXp - b.minXp);
        
        for (const rank of sortedRanks) {
            if (xp < rank.minXp) {
                return rank;
            }
        }

        return null;
    }

    /**
     * ランクアップ処理
     */
    private async handleRankUp(
        guildId: string,
        userId: string,
        oldRank: RankTier,
        newRank: RankTier,
        data: RankingData
    ): Promise<void> {
        if (!this.client) return;

        Logger.info(`User ${userId} ranked up from ${oldRank.name} to ${newRank.name} in guild ${guildId}`);

        // 報酬を取得（デフォルトプリセット使用）
        const preset = data.rankPresets[0];
        const rewards = preset.rewards.filter(r => r.rankName === newRank.name);

        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;

        // ロール付与
        for (const reward of rewards) {
            if (reward.giveRoleId) {
                try {
                    const role = guild.roles.cache.get(reward.giveRoleId);
                    if (role && !member.roles.cache.has(reward.giveRoleId)) {
                        await member.roles.add(reward.giveRoleId);
                        Logger.info(`Granted role ${role.name} to user ${userId}`);
                    }
                } catch (error) {
                    Logger.error(`Failed to grant role ${reward.giveRoleId} to user ${userId}:`, error);
                }
            }

            // 通知送信
            if (reward.notify && data.settings.notifyChannelId) {
                try {
                    const channel = guild.channels.cache.get(data.settings.notifyChannelId) as TextChannel;
                    if (channel) {
                        const embed = new EmbedBuilder()
                            .setColor((newRank.color as any) || '#FFD700')
                            .setTitle('🎉 ランクアップ！')
                            .setDescription(
                                reward.customMessage || 
                                `<@${userId}> が **${newRank.name}** ランクに到達しました！`
                            )
                            .addFields(
                                { name: '前のランク', value: oldRank.name, inline: true },
                                { name: '新しいランク', value: newRank.name, inline: true }
                            )
                            .setTimestamp();

                        await channel.send({ embeds: [embed] });
                    }
                } catch (error) {
                    Logger.error('Failed to send rank up notification:', error);
                }
            }
        }
    }

    /**
     * メッセージによるXP付与（クールダウン付き）
     */
    async handleMessageXp(guildId: string, userId: string, channelId: string, roleIds: string[]): Promise<void> {
        const data = await this.getRankingData(guildId);
        
        // 除外チャンネルチェック
        if (data.settings.xpRates.excludeChannels.includes(channelId)) {
            return;
        }

        // 除外ロールチェック
        if (roleIds.some(roleId => data.settings.xpRates.excludeRoles.includes(roleId))) {
            return;
        }

        // クールダウンチェック
        const userData = data.users[userId];
        const now = Date.now();
        if (userData?.lastMessageTime) {
            const elapsed = (now - userData.lastMessageTime) / 1000;
            if (elapsed < data.settings.xpRates.messageCooldownSec) {
                return;
            }
        }

        // XP付与
        await this.addXp(guildId, userId, data.settings.xpRates.messageXp, 'message');
        
        // クールダウン更新
        const updatedData = await this.getRankingData(guildId);
        if (updatedData.users[userId]) {
            updatedData.users[userId].lastMessageTime = now;
            await this.saveRankingData(guildId, updatedData);
        }
    }

    /**
     * VC参加開始
     */
    vcJoin(userId: string): void {
        this.vcStartTimes.set(userId, Date.now());
    }

    /**
     * VC退出（経過時間に基づいてXPを付与）
     */
    async vcLeave(guildId: string, userId: string): Promise<void> {
        const startTime = this.vcStartTimes.get(userId);
        if (!startTime) return;

        const duration = Date.now() - startTime;
        this.vcStartTimes.delete(userId);

        const data = await this.getRankingData(guildId);
        const minutes = Math.floor(duration / (1000 * 60));
        const xp = minutes * data.settings.xpRates.vcXpPerMinute;

        if (xp > 0) {
            await this.addXp(guildId, userId, xp, 'voice-chat');
        }
    }

    /**
     * パネル更新タイマーを開始
     */
    async startPanelUpdateTimer(guildId: string): Promise<void> {
        // 既存のタイマーをクリア
        this.stopPanelUpdateTimer(guildId);

        const data = await this.getRankingData(guildId);
        const interval = data.settings.updateIntervalMs;

        const timer = setInterval(async () => {
            await this.updateAllPanels(guildId);
        }, interval);

        this.updateTimers.set(guildId, timer);
        Logger.info(`Started panel update timer for guild ${guildId} (interval: ${interval}ms)`);
    }

    /**
     * パネル更新タイマーを停止
     */
    stopPanelUpdateTimer(guildId: string): void {
        const timer = this.updateTimers.get(guildId);
        if (timer) {
            clearInterval(timer);
            this.updateTimers.delete(guildId);
            Logger.info(`Stopped panel update timer for guild ${guildId}`);
        }
    }

    /**
     * すべてのパネルを更新
     */
    async updateAllPanels(guildId: string): Promise<void> {
        if (!this.client) return;

        const data = await this.getRankingData(guildId);
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        for (const [panelId, panel] of Object.entries(data.panels)) {
            try {
                await this.updatePanel(guild, panelId, panel, data);
            } catch (error) {
                Logger.error(`Failed to update panel ${panelId}:`, error);
                
                // パネルが削除されている場合はDBから削除
                if (error && typeof error === 'object' && 'code' in error && error.code === 10008) {
                    delete data.panels[panelId];
                    await this.saveRankingData(guildId, data);
                    Logger.info(`Removed deleted panel ${panelId} from database`);
                }
            }
        }
    }

    /**
     * 単一パネルを更新
     */
    private async updatePanel(guild: Guild, _panelId: string, panel: RankPanel, data: RankingData): Promise<void> {
        const channel = guild.channels.cache.get(panel.channelId) as TextChannel;
        if (!channel) {
            throw new Error('Channel not found');
        }

        const message = await channel.messages.fetch(panel.messageId);
        if (!message) {
            throw new Error('Message not found');
        }

        // トップユーザーを取得
        const topUsers = Object.entries(data.users)
            .sort(([, a], [, b]) => b.xp - a.xp)
            .slice(0, panel.topCount || 10);

        const preset = data.rankPresets.find(p => p.name === panel.preset) || data.rankPresets[0];
        
        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle(`🏆 ${preset.name} ランキング`)
            .setDescription('サーバー内のトップランカー')
            .setTimestamp();

        for (let i = 0; i < topUsers.length; i++) {
            const [userId, userData] = topUsers[i];
            const rank = this.getUserRank(data, userData.xp, panel.preset);
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            
            embed.addFields({
                name: `${medal} <@${userId}>`,
                value: `**XP:** ${userData.xp} | **ランク:** ${rank?.name || '未定'}`,
                inline: false
            });
        }

        embed.setFooter({ text: `最終更新: ${new Date().toLocaleString('ja-JP')}` });

        await message.edit({ embeds: [embed] });
        panel.lastUpdate = new Date().toISOString();
    }

    /**
     * リーダーボードを取得
     */
    async getLeaderboard(guildId: string, limit: number = 10, offset: number = 0): Promise<Array<{ userId: string; xp: number; rank: string }>> {
        const data = await this.getRankingData(guildId);
        
        const sorted = Object.entries(data.users)
            .sort(([, a], [, b]) => b.xp - a.xp)
            .slice(offset, offset + limit);

        return sorted.map(([userId, userData]) => {
            const rank = this.getUserRank(data, userData.xp);
            return {
                userId,
                xp: userData.xp,
                rank: rank?.name || '未定'
            };
        });
    }

    /**
     * クリーンアップ
     */
    cleanup(): void {
        for (const timer of this.updateTimers.values()) {
            clearInterval(timer);
        }
        this.updateTimers.clear();
        this.vcStartTimes.clear();
    }
}

// シングルトンインスタンス
export const rankManager = new RankManager(new Database());
