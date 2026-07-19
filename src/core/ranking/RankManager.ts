import { Client, Guild, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Database } from '../persistence/Database.js';
import { Logger } from '../../utils/Logger.js';
import { config } from '../../config.js';

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
 * XP獲得条件ルールの定義
 */
export interface XpConditionRule {
    id: string; // ユニーク ID
    name: string; // ルール名
    actionType: 'message' | 'reaction' | 'voiceChat' | 'invite' | 'custom'; // アクション種別
    description?: string;
    channels?: string[]; // 対象チャンネル（指定時のみ）
    roles?: string[]; // 対象ロール（指定時のみ）
    xpReward: number; // 獲得XP（従来の単一値）
    // ランダムレンジ（指定すると xpReward より優先してランダムに付与される）
    xpRewardMin?: number;
    xpRewardMax?: number;
    cooldownSec?: number; // クールダウン（秒）
    maxPerDay?: number; // 1日の最大獲得回数
    isActive: boolean; // 有効化フラグ
}

/**
 * 報酬の定義
 */
export interface RankReward {
    rankName: string;
    giveRoleId?: string;
    notify?: boolean;
    webhookUrl?: string; // 外部API Webhook URL
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
    xpConditionRules?: XpConditionRule[]; // XP獲得条件ルール
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
 * プリセット別ユーザーXPデータ
 */
export interface PresetUserXpMap {
    [presetName: string]: UserXpData;
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
    // メッセージXPのレンジ（未指定時は messageXp を使用）
    messageXpMin?: number;
    messageXpMax?: number;
    vcXpPerMinute: number;
    vcIntervalSec: number;
    // VC分給のレンジ（未指定時は vcXpPerMinute を使用）
    vcXpPerMinuteMin?: number;
    vcXpPerMinuteMax?: number;
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
    users: Record<string, PresetUserXpMap>; // userId -> { presetName -> UserXpData }
    panels: Record<string, RankPanel>;
    settings: RankSettings;
}

/**
 * デフォルトのXPレート設定
 */
const DEFAULT_XP_RATES: XpRates = {
    messageXp: 5,
    messageXpMin: 5,
    messageXpMax: 5,
    messageCooldownSec: 60,
    vcXpPerMinute: 10,
    vcXpPerMinuteMin: 10,
    vcXpPerMinuteMax: 10,
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
    // ルール毎の最後の実行時間を保持: userId -> (ruleId -> timestampMs)
    private ruleLastTrigger: Map<string, Map<string, number>> = new Map();
    // ルール毎の日次カウントを保持: "userId:ruleId" -> { date, count }
    private ruleDailyCount: Map<string, { date: string; count: number }> = new Map();

    constructor(database: Database) {
        this.database = database;
    }

    /**
     * テキスト内の {emoji:ID} プレースホルダーをギルド絵文字に展開する
     * 見つからない場合は元のプレースホルダーを残す
     */
    private replaceEmojiPlaceholders(text: string, guild: Guild): string {
        if (!text) return text;

        // {emoji:123456789012345678}
        text = text.replace(/\{emoji:([0-9]+)\}/g, (match, id) => {
            try {
                const emoji = guild.emojis.cache.get(id);
                if (emoji) {
                    const animatedFlag = emoji.animated ? 'a' : '';
                    return `<${animatedFlag}:${emoji.name}:${id}>`;
                }
            } catch (e) {
                // ignore
            }
            return match;
        });

        // 従来の {emoji} 単体は汎用絵文字にフォールバック
        return text.replace(/\{emoji\}/g, '🎉');
    }

    /**
     * 指定された XpRates からメッセージXPをランダムに計算する
     */
    private computeRandomXpForMessage(xpRates: XpRates): number {
        const min = typeof xpRates.messageXpMin === 'number' ? xpRates.messageXpMin : xpRates.messageXp;
        const max = typeof xpRates.messageXpMax === 'number' ? xpRates.messageXpMax : xpRates.messageXp;
        if (min >= max) return min;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /**
     * 指定された XpRates から VC の1分あたりXPをランダムに計算する
     */
    private computeRandomVcXpPerMinute(xpRates: XpRates): number {
        const min = typeof xpRates.vcXpPerMinuteMin === 'number' ? xpRates.vcXpPerMinuteMin : xpRates.vcXpPerMinute;
        const max = typeof xpRates.vcXpPerMinuteMax === 'number' ? xpRates.vcXpPerMinuteMax : xpRates.vcXpPerMinute;
        if (min >= max) return min;
        return Math.floor(Math.random() * (max - min + 1)) + min;
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
    async addXp(guildId: string, userId: string, xp: number, presetName?: string, reason?: string): Promise<void> {
        const data = await this.getRankingData(guildId);
        
        // ユーザーデータを初期化（未存在の場合）
        if (!data.users[userId]) {
            data.users[userId] = {};
        }

        // presetNameが指定されていない場合、すべてのプリセットに追加
        const targetPresets = presetName ? [presetName] : data.rankPresets.map(p => p.name);
        
        // XPを追加（グローバル倍率適用）
        const actualXp = Math.floor(xp * data.settings.xpRates.globalMultiplier);

        for (const preset of targetPresets) {
            // プリセット別のユーザーデータを初期化
            if (!data.users[userId][preset]) {
                data.users[userId][preset] = {
                    xp: 0,
                    lastUpdated: new Date().toISOString(),
                    dailyXp: 0,
                    dailyXpResetDate: new Date().toISOString().split('T')[0],
                    lastMessageTime: undefined,
                    vcAccumMs: 0
                };
            }

            const userData = data.users[userId][preset];
            
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
                    Logger.debug(`User ${userId} reached daily XP cap for preset ${preset}`);
                    continue;
                }
            }

            // 旧ランクを取得
            const oldRank = this.getUserRank(data, userData.xp, preset);

            // XPを追加
            userData.xp += actualXp;
            userData.dailyXp = (userData.dailyXp || 0) + actualXp;
            userData.lastUpdated = new Date().toISOString();

            // 新ランクを取得
            const newRank = this.getUserRank(data, userData.xp, preset);

            // ランクアップ処理
            if (oldRank && newRank && oldRank.name !== newRank.name) {
                await this.handleRankUp(guildId, userId, oldRank, newRank, data);
            }

            Logger.debug(`Added ${actualXp} XP to user ${userId} in guild ${guildId} (preset: ${preset}). Reason: ${reason || 'none'}`);
        }

        await this.saveRankingData(guildId, data);
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
                        // プレースホルダーの置換
                        const user = await guild.members.fetch(userId).catch(() => null);
                        const userName = user?.user.username || `User${userId}`;
                        const now = new Date();
                        
                        // デフォルトではメンションを含める（埋め込み内のメンションは通知されないため、content に明示的にメンションを入れる）
                        let description = reward.customMessage || `<@${userId}> が **${newRank.name}** ランクに到達しました！`;

                        // プレースホルダーの置換（複数の形式に対応）
                        // {mention} を追加してメンション表現をテンプレートで使えるようにする
                        description = description
                            .replace(/{rank}/g, newRank.name)
                            .replace(/{user}/g, userName)
                            .replace(/{mention}/g, (member && member.toString()) || `<@${userId}>`)
                            .replace(/{oldRank}/g, oldRank.name)
                            .replace(/{newRank}/g, newRank.name)
                            .replace(/{userId}/g, userId)
                            .replace(/{date}/g, now.toLocaleDateString('ja-JP'))
                            .replace(/{time}/g, now.toLocaleTimeString('ja-JP'))
                            .replace(/{timestamp}/g, now.toISOString())
                            .replace(/{emoji}/g, '🎉');

                        // ギルド絵文字（{emoji:ID}）を展開
                        description = this.replaceEmojiPlaceholders(description, guild);

                        const embed = new EmbedBuilder()
                            .setColor((newRank.color as any) || '#FFD700')
                            .setTitle('🎉 ランクアップ！')
                            .setDescription(description)
                            .addFields(
                                { name: '前のランク', value: oldRank.name, inline: true },
                                { name: '新しいランク', value: newRank.name, inline: true }
                            )
                            .setTimestamp();

                        // content にメンションを付けるかどうかを判断する。
                        // 注意: 埋め込み内に {mention} 等のプレースホルダーを入れている場合、
                        // content 側に再度メンションを入れると二重メンションになるため、
                        // カスタムメッセージが指定されている場合は content 側でのメンションを行わないようにする。
                        // （デフォルトメッセージの場合のみ content にメンションを含める）
                        const wantsMention = !reward.customMessage;
                        const content = wantsMention ? (member ? member.toString() : `<@${userId}>`) : undefined;

                        await channel.send({ content, embeds: [embed], allowedMentions: { users: content ? [userId] : [] } });
                    }
                } catch (error) {
                    Logger.error('Failed to send rank up notification:', error);
                }
            }

            // Webhook 送信
            if (reward.webhookUrl) {
                try {
                    // プレースホルダーの置換
                    const user = await guild.members.fetch(userId).catch(() => null);
                    const userName = user?.user.username || `User${userId}`;
                    const now = new Date();
                    let customMsg = reward.customMessage || `User ${userId} ranked up to ${newRank.name}`;
                    
                    customMsg = customMsg
                        .replace(/{rank}/g, newRank.name)
                        .replace(/{user}/g, userName)
                        .replace(/{oldRank}/g, oldRank.name)
                        .replace(/{newRank}/g, newRank.name)
                        .replace(/{userId}/g, userId)
                        .replace(/{date}/g, now.toLocaleDateString('ja-JP'))
                        .replace(/{time}/g, now.toLocaleTimeString('ja-JP'))
                        .replace(/{timestamp}/g, now.toISOString())
                        .replace(/{emoji}/g, '🎉');

                    // ギルド絵文字（{emoji:ID}）を展開
                    customMsg = this.replaceEmojiPlaceholders(customMsg, guild);

                    const webhookPayload = {
                        event: 'rank-up',
                        guildId,
                        userId,
                        oldRank: oldRank.name,
                        newRank: newRank.name,
                        timestamp: new Date().toISOString(),
                        customMessage: customMsg
                    };

                    const response = await fetch(reward.webhookUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(webhookPayload)
                    });

                    if (!response.ok) {
                        Logger.warn(`Webhook request failed with status ${response.status}: ${reward.webhookUrl}`);
                    }
                } catch (error) {
                    Logger.error(`Failed to send webhook to ${reward.webhookUrl}:`, error);
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

        // クールダウンチェック（全プリセットの lastMessageTime の最新値を使う）
        const now = Date.now();
        const presetNames = data.rankPresets.map(p => p.name);
        let latestLastMessage = 0;
        for (const preset of presetNames) {
            const ud = data.users[userId]?.[preset];
            if (ud?.lastMessageTime && ud.lastMessageTime > latestLastMessage) {
                latestLastMessage = ud.lastMessageTime;
            }
        }

        if (latestLastMessage) {
            const elapsed = (now - latestLastMessage) / 1000;
            if (elapsed < data.settings.xpRates.messageCooldownSec) {
                return;
            }
        }

        // XP付与（ランダム対応） - 全プリセットへ配布するため presetName を指定しない
        const messageXp = this.computeRandomXpForMessage(data.settings.xpRates);
        await this.addXp(guildId, userId, messageXp, undefined, 'message');

        // 各プリセットの lastMessageTime を更新
        const updatedData = await this.getRankingData(guildId);
        if (!updatedData.users[userId]) updatedData.users[userId] = {};
        for (const preset of updatedData.rankPresets.map(p => p.name)) {
            if (!updatedData.users[userId][preset]) {
                updatedData.users[userId][preset] = {
                    xp: 0,
                    lastUpdated: new Date().toISOString(),
                    dailyXp: 0,
                    dailyXpResetDate: new Date().toISOString().split('T')[0],
                    lastMessageTime: now,
                    vcAccumMs: 0
                };
            } else {
                updatedData.users[userId][preset].lastMessageTime = now;
            }
        }
        await this.saveRankingData(guildId, updatedData);
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
        const perMinute = this.computeRandomVcXpPerMinute(data.settings.xpRates);
        const xp = minutes * perMinute;

        if (xp > 0) {
            // 全プリセットに付与
            await this.addXp(guildId, userId, xp, undefined, 'voice-chat');

            // 各プリセットの vcAccumMs をリセット
            const updatedData = await this.getRankingData(guildId);
            if (updatedData.users[userId]) {
                for (const preset of updatedData.rankPresets.map(p => p.name)) {
                    if (updatedData.users[userId][preset]) {
                        updatedData.users[userId][preset].vcAccumMs = 0;
                    }
                }
                await this.saveRankingData(guildId, updatedData);
            }
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
     * Bot起動時にすべてのギルドのパネルタイマーを再開
     */
    async restorePanelUpdateTimers(): Promise<void> {
        if (!this.client) return;

        try {
            const guilds = this.client.guilds.cache;
            Logger.info(`📊 ${guilds.size} ギルドのパネルタイマーを復元します...`);

            for (const [guildId, guild] of guilds) {
                try {
                    const data = await this.getRankingData(guildId);
                    
                    // パネルが存在する場合のみタイマーを開始
                    if (Object.keys(data.panels).length > 0) {
                        await this.startPanelUpdateTimer(guildId);
                        Logger.info(`✅ ギルド ${guild.name} (${guildId}) のパネルタイマーを復元しました（${Object.keys(data.panels).length}個のパネル）`);
                    }
                } catch (error) {
                    Logger.error(`ギルド ${guildId} のパネルタイマー復元に失敗:`, error);
                }
            }

            Logger.success('✅ すべてのパネルタイマーの復元が完了しました');
        } catch (error) {
            Logger.error('パネルタイマー復元中にエラーが発生:', error);
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
                
                // パネルが削除されている場合やチャンネルが見つからない場合はDBから削除
                if (error && typeof error === 'object' && 'code' in error) {
                    const discordError = error as any;
                    if (discordError.code === 10008 || discordError.code === 10003) { // Unknown Message or Unknown Channel
                        delete data.panels[panelId];
                        await this.saveRankingData(guildId, data);
                        Logger.info(`Removed invalid panel ${panelId} from database (code: ${discordError.code})`);
                    }
                }
            }
        }
    }

    /**
     * 単一パネルを更新
     */
    private async updatePanel(guild: Guild, panelId: string, panel: RankPanel, data: RankingData): Promise<void> {
        const channel = guild.channels.cache.get(panel.channelId) as TextChannel;
        if (!channel) {
            Logger.warn(`Channel ${panel.channelId} not found for panel ${panelId}, removing panel`);
            delete data.panels[panelId];
            await this.saveRankingData(guild.id, data);
            return;
        }

        const message = await channel.messages.fetch(panel.messageId);
        if (!message) {
            Logger.warn(`Message ${panel.messageId} not found for panel ${panelId}, removing panel`);
            delete data.panels[panelId];
            await this.saveRankingData(guild.id, data);
            return;
        }

        // トップユーザーを取得
        const topUsers = Object.entries(data.users || {})
            .map(([userId, presetMap]) => ({
                userId,
                xp: presetMap[panel.preset]?.xp || 0
            }))
            .sort((a, b) => b.xp - a.xp)
            .slice(0, panel.topCount || 10);

        const preset = data.rankPresets.find(p => p.name === panel.preset) || data.rankPresets[0];
        
        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle(`🏆 ${preset.name} ランキング`)
            .setDescription('サーバー内のトップランカー')
            .setTimestamp();

        for (let i = 0; i < topUsers.length; i++) {
            const { userId, xp } = topUsers[i];
            const rank = this.getUserRank(data, xp, panel.preset);
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            
            // ユーザー名を取得（見つからない場合はIDを表示）
            let userName = userId;
            try {
                const member = await guild.members.fetch(userId);
                userName = member.displayName || member.user.username;
            } catch (error) {
                // ユーザーが見つからない場合はIDのまま
                Logger.warn(`Failed to fetch user ${userId} for ranking display:`, error);
            }
            
            embed.addFields({
                name: `${medal} ${userName}`,
                value: `**XP:** ${xp} | **ランク:** ${rank?.name || '未定'}`,
                inline: false
            });
        }

        embed.setFooter({ text: `最終更新: ${new Date().toLocaleString('ja-JP')}` });

        // ウェブランキングへのリンクボタンを作成
        const webUrl = config.WEB_BASE_URL;
        const rankUrl = `${webUrl}/rank/${guild.id}/${panelId}`;
        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('ウェブで詳細を見る')
                    .setStyle(ButtonStyle.Link)
                    .setURL(rankUrl)
                    .setEmoji('🌐')
            );

        await message.edit({ embeds: [embed], components: [row] });
        panel.lastUpdate = new Date().toISOString();
    }

    /**
     * リーダーボードを取得
     */
    async getLeaderboard(guildId: string, limit: number = 10, offset: number = 0, presetName?: string): Promise<Array<{ userId: string; xp: number; rank: string; preset?: string }>> {
        const data = await this.getRankingData(guildId);
        
        // データ検証
        if (!data || !data.users) {
            Logger.warn(`No ranking data for guild ${guildId}`);
            return [];
        }

        // プリセットが指定されている場合は、そのプリセット用のランキングを取得
        const targetPreset = presetName || data.rankPresets[0]?.name || 'default';
        const preset = data.rankPresets.find(p => p.name === targetPreset);

        if (!preset && presetName) {
            Logger.warn(`Preset ${presetName} not found in guild ${guildId}`);
            return [];
        }

        // ユーザーをプリセット別のXPでソート
        const sorted = Object.entries(data.users || {})
            .map(([userId, presetMap]) => ({
                userId,
                xp: presetMap[targetPreset]?.xp || 0
            }))
            .sort((a, b) => b.xp - a.xp)
            .slice(offset, offset + limit);

        return sorted.map(({ userId, xp }) => {
            const rank = this.getUserRank(data, xp, targetPreset);
            return {
                userId,
                xp,
                rank: rank?.name || '未定',
                preset: targetPreset
            };
        });
    }

    /**
     * プリセット別のランキング統計を取得
     * @param guildId - ギルド ID
     * @param presetName - プリセット名
     * @returns プリセット別ランキング統計
     */
    async getPresetLeaderboardStats(guildId: string, presetName: string): Promise<{
        preset: RankPreset;
        totalUsers: number;
        leaderboard: Array<{ userId: string; xp: number; rank: string; rankIndex: number }>;
    }> {
        const data = await this.getRankingData(guildId);
        
        if (!data || !data.users) {
            throw new Error(`No ranking data for guild ${guildId}`);
        }

        const preset = data.rankPresets.find(p => p.name === presetName);

        if (!preset) {
            throw new Error(`Preset ${presetName} not found`);
        }

        // 全ユーザーをプリセット別XPでソート
        const sorted = Object.entries(data.users || {})
            .map(([userId, presetMap]) => ({
                userId,
                xp: presetMap[presetName]?.xp || 0
            }))
            .sort((a, b) => b.xp - a.xp)
            .map((entry, index) => {
                const rank = this.getUserRank(data, entry.xp, presetName);
                return {
                    userId: entry.userId,
                    xp: entry.xp,
                    rank: rank?.name || '未定',
                    rankIndex: index + 1
                };
            });

        return {
            preset,
            totalUsers: Object.keys(data.users || {}).length,
            leaderboard: sorted
        };
    }

    /**
     * 複数プリセット別ランキングを一括取得
     * @param guildId - ギルド ID
     * @returns 全プリセットのランキング統計
     */
    async getAllPresetLeaderboards(guildId: string): Promise<Array<{
        preset: RankPreset;
        totalUsers: number;
        topUsers: Array<{ userId: string; xp: number; rank: string }>;
    }>> {
        const data = await this.getRankingData(guildId);
        
        if (!data || !data.users) {
            return [];
        }

        return data.rankPresets.map(preset => {
            const sorted = Object.entries(data.users || {})
                .map(([userId, presetMap]) => ({
                    userId,
                    xp: presetMap[preset.name]?.xp || 0
                }))
                .sort((a, b) => b.xp - a.xp)
                .slice(0, 10) // Top 10
                .map(({ userId, xp }) => {
                    const rank = this.getUserRank(data, xp, preset.name);
                    return {
                        userId,
                        xp,
                        rank: rank?.name || '未定'
                    };
                });

            return {
                preset,
                totalUsers: Object.keys(data.users || {}).length,
                topUsers: sorted
            };
        });
    }

    /**
     * ユーザーのランクをリセット
     * @param guildId - ギルド ID
     * @param userId - ユーザー ID（指定時のみそのユーザーをリセット、未指定で全員リセット）
     */
    async resetRank(guildId: string, userId?: string): Promise<void> {
        const data = await this.getRankingData(guildId);

        if (userId) {
            // 特定ユーザーのリセット（全プリセット）
            if (data.users[userId]) {
                const presets = data.rankPresets.map(p => p.name);
                const resetData: PresetUserXpMap = {};
                
                for (const preset of presets) {
                    resetData[preset] = {
                        xp: 0,
                        lastUpdated: new Date().toISOString(),
                        dailyXp: 0,
                        dailyXpResetDate: new Date().toISOString().split('T')[0],
                        lastMessageTime: undefined,
                        vcAccumMs: 0
                    };
                }
                
                data.users[userId] = resetData;
                Logger.info(`Reset rank for user ${userId} in guild ${guildId}`);
            }
        } else {
            // 全員リセット（全プリセット）
            for (const userId of Object.keys(data.users)) {
                const presets = data.rankPresets.map(p => p.name);
                const resetData: PresetUserXpMap = {};
                
                for (const preset of presets) {
                    resetData[preset] = {
                        xp: 0,
                        lastUpdated: new Date().toISOString(),
                        dailyXp: 0,
                        dailyXpResetDate: new Date().toISOString().split('T')[0],
                        lastMessageTime: undefined,
                        vcAccumMs: 0
                    };
                }
                
                data.users[userId] = resetData;
            }
            Logger.info(`Reset all ranks in guild ${guildId}`);
        }

        await this.saveRankingData(guildId, data);
    }

    /**
     * XP条件ルールを追加
     */
    async addXpConditionRule(guildId: string, presetName: string, rule: XpConditionRule): Promise<void> {
        const data = await this.getRankingData(guildId);
        const preset = data.rankPresets.find(p => p.name === presetName);

        if (!preset) {
            throw new Error(`Preset ${presetName} not found`);
        }

        if (!preset.xpConditionRules) {
            preset.xpConditionRules = [];
        }

        // ID が重複していないか確認
        if (preset.xpConditionRules.some(r => r.id === rule.id)) {
            throw new Error(`Rule with ID ${rule.id} already exists`);
        }

        preset.xpConditionRules.push(rule);
        await this.saveRankingData(guildId, data);
        Logger.info(`Added XP condition rule: ${rule.id} to preset ${presetName}`);
    }

    /**
     * XP条件ルールを更新
     */
    async updateXpConditionRule(guildId: string, presetName: string, ruleId: string, updates: Partial<XpConditionRule>): Promise<void> {
        const data = await this.getRankingData(guildId);
        const preset = data.rankPresets.find(p => p.name === presetName);

        if (!preset || !preset.xpConditionRules) {
            throw new Error(`Preset ${presetName} or rules not found`);
        }

        const rule = preset.xpConditionRules.find(r => r.id === ruleId);
        if (!rule) {
            throw new Error(`Rule with ID ${ruleId} not found`);
        }

        Object.assign(rule, updates);
        await this.saveRankingData(guildId, data);
        Logger.info(`Updated XP condition rule: ${ruleId}`);
    }

    /**
     * XP条件ルールを削除
     */
    async deleteXpConditionRule(guildId: string, presetName: string, ruleId: string): Promise<void> {
        const data = await this.getRankingData(guildId);
        const preset = data.rankPresets.find(p => p.name === presetName);

        if (!preset || !preset.xpConditionRules) {
            throw new Error(`Preset ${presetName} or rules not found`);
        }

        const index = preset.xpConditionRules.findIndex(r => r.id === ruleId);
        if (index === -1) {
            throw new Error(`Rule with ID ${ruleId} not found`);
        }

        preset.xpConditionRules.splice(index, 1);
        await this.saveRankingData(guildId, data);
        Logger.info(`Deleted XP condition rule: ${ruleId}`);
    }

    /**
     * XP条件ルールを取得
     */
    async getXpConditionRules(guildId: string, presetName: string): Promise<XpConditionRule[]> {
        const data = await this.getRankingData(guildId);
        const preset = data.rankPresets.find(p => p.name === presetName);

        if (!preset || !preset.xpConditionRules) {
            return [];
        }

        return preset.xpConditionRules;
    }

    /**
     * 条件ルールに基づいて XP を付与
     */
    async applyXpFromRule(guildId: string, userId: string, ruleId: string, presetName?: string): Promise<boolean> {
        const data = await this.getRankingData(guildId);
        const preset = presetName 
            ? data.rankPresets.find(p => p.name === presetName)
            : data.rankPresets[0];

        if (!preset || !preset.xpConditionRules) {
            return false;
        }

        const rule = preset.xpConditionRules.find(r => r.id === ruleId && r.isActive);
        if (!rule) {
            return false;
        }

        // クールダウンチェック
        const targetPreset = preset.name;
        if (!data.users[userId]) {
            data.users[userId] = {};
        }

        if (!data.users[userId][targetPreset]) {
            data.users[userId][targetPreset] = {
                xp: 0,
                lastUpdated: new Date().toISOString(),
                dailyXp: 0,
                dailyXpResetDate: new Date().toISOString().split('T')[0],
                lastMessageTime: undefined,
                vcAccumMs: 0
            };
        }

        const userData = data.users[userId][targetPreset];
        const now = Date.now();

        // ルール毎のクールダウンをチェック（userId -> (ruleId -> lastTs)）
        const userRuleMap = this.ruleLastTrigger.get(userId) || new Map<string, number>();
        const lastTs = userRuleMap.get(ruleId) || 0;
        if (rule.cooldownSec) {
            const elapsed = (now - lastTs) / 1000;
            if (elapsed < rule.cooldownSec) {
                return false;
            }
        }

        // 1日の上限チェック（userId:ruleId 単位でカウント）
        if (rule.maxPerDay) {
            const dayKey = `${userId}:${ruleId}`;
            const today = new Date().toISOString().split('T')[0];
            const entry = this.ruleDailyCount.get(dayKey);
            if (!entry || entry.date !== today) {
                this.ruleDailyCount.set(dayKey, { date: today, count: 0 });
            }
            const current = this.ruleDailyCount.get(dayKey)!;
            if (current.count >= rule.maxPerDay) {
                return false;
            }
            // カウントは XP 付与成功時にインクリメントする
        }

        // XPを決定（ランダムレンジがある場合はそれを使用）
        let xpToGrant = rule.xpReward;
        if (typeof rule.xpRewardMin === 'number' && typeof rule.xpRewardMax === 'number') {
            const min = Math.min(rule.xpRewardMin, rule.xpRewardMax);
            const max = Math.max(rule.xpRewardMin, rule.xpRewardMax);
            xpToGrant = Math.floor(Math.random() * (max - min + 1)) + min;
        }

        // XP付与
        await this.addXp(guildId, userId, xpToGrant, targetPreset, `rule:${ruleId}`);

        // クールダウンと日次カウントの更新
        userRuleMap.set(ruleId, now);
        this.ruleLastTrigger.set(userId, userRuleMap);

        if (rule.maxPerDay) {
            const dayKey = `${userId}:${ruleId}`;
            const current = this.ruleDailyCount.get(dayKey)!;
            current.count += 1;
            this.ruleDailyCount.set(dayKey, current);
        }

        userData.lastMessageTime = now;
        await this.saveRankingData(guildId, data);

        return true;
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
