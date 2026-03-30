import {
    Client,
    Colors,
    EmbedBuilder,
    Guild,
    GuildMember,
    Message,
    MessageResolvable,
    PermissionFlagsBits,
    TextChannel,
    User
} from 'discord.js';
import { database } from '../Database.js';
import { CacheManager } from '../../utils/CacheManager.js';
import { Logger } from '../../utils/Logger.js';
import {
    DetectionLog,
    DetectionNotice,
    DetectionResult,
    Detector,
    DetectorConfig,
    DEFAULT_ANTICHEAT_SETTINGS,
    GuildAntiCheatSettings,
    PunishmentAction,
    UserTrustData
} from './types.js';
import { TextSpamDetector } from './detectors/TextSpamDetector.js';
import { InviteReferralDetector } from './detectors/InviteReferralDetector.js';
import { RedirectLinkDetector } from './detectors/RedirectLinkDetector.js';
import { CopyPasteDetector } from './detectors/CopyPasteDetector.js';
import { EveryoneMentionDetector } from './detectors/EveryoneMentionDetector.js';
import { DuplicateMessageDetector } from './detectors/DuplicateMessageDetector.js';
import { MentionLimitDetector } from './detectors/MentionLimitDetector.js';
import { MaxLinesDetector } from './detectors/MaxLinesDetector.js';
import { WordFilterDetector } from './detectors/WordFilterDetector.js';
import { PunishmentExecutor } from './PunishmentExecutor.js';
import { hasMeaningfulDetection } from './utils.js';

export class AntiCheatManager {
    private detectors: Map<string, Detector> = new Map();
    private client: Client | null = null;
    private readonly MAX_LOGS = 100;
    private readonly detectionCooldownMs = 150;
    private lastDetectionTimestamps: Map<string, number> = new Map();

    constructor() {
        this.registerDetector(new TextSpamDetector());
        this.registerDetector(new InviteReferralDetector());
        this.registerDetector(new RedirectLinkDetector());
        this.registerDetector(new CopyPasteDetector());
        this.registerDetector(new EveryoneMentionDetector());
        this.registerDetector(new DuplicateMessageDetector());
        this.registerDetector(new MentionLimitDetector());
        this.registerDetector(new MaxLinesDetector());
        this.registerDetector(new WordFilterDetector());
    }

    setClient(client: Client): void {
        this.client = client;
    }

    registerDetector(detector: Detector): void {
        this.detectors.set(detector.name, detector);
        Logger.debug(`Registered AntiCheat detector: ${detector.name}`);
    }

    mergeSettings(
        base: Partial<GuildAntiCheatSettings> | null | undefined,
        updates: Partial<GuildAntiCheatSettings>
    ): GuildAntiCheatSettings {
        const normalizedBase = this.normalizeSettings(base);
        return this.normalizeSettings({
            ...normalizedBase,
            ...updates,
            detectors: this.mergeDetectorConfigs(normalizedBase.detectors, updates.detectors),
            autoTimeout: {
                ...normalizedBase.autoTimeout,
                ...(updates.autoTimeout || {})
            },
            autoDelete: {
                ...normalizedBase.autoDelete,
                ...(updates.autoDelete || {})
            },
            raidMode: {
                ...normalizedBase.raidMode,
                ...(updates.raidMode || {})
            },
            punishments: updates.punishments !== undefined ? updates.punishments : normalizedBase.punishments,
            excludedRoles: updates.excludedRoles !== undefined ? updates.excludedRoles : normalizedBase.excludedRoles,
            excludedChannels: updates.excludedChannels !== undefined ? updates.excludedChannels : normalizedBase.excludedChannels,
            userTrust: updates.userTrust !== undefined ? updates.userTrust : normalizedBase.userTrust,
            recentLogs: updates.recentLogs !== undefined ? updates.recentLogs : normalizedBase.recentLogs
        });
    }

    async onMessage(message: Message): Promise<void> {
        if (message.author.bot || !message.guild) {
            return;
        }

        const guildId = message.guild.id;
        const settings = await this.getSettings(guildId);
        if (!settings.enabled) {
            return;
        }

        if (settings.excludedChannels.includes(message.channel.id)) {
            return;
        }

        if (message.member) {
            const hasExcludedRole = settings.excludedRoles.some((roleId) => message.member?.roles.cache.has(roleId));
            if (hasExcludedRole) {
                return;
            }
        }

        try {
            await this.processMessage(message, settings);
        } catch (error) {
            Logger.error(`AntiCheat error processing message ${message.id}:`, error);
        }
    }

    async onGuildMemberAdd(member: GuildMember): Promise<void> {
        const settings = await this.getSettings(member.guild.id);
        if (!settings.enabled) {
            return;
        }

        const detectorConfig = settings.detectors.raidDetection;
        if (!detectorConfig?.enabled) {
            return;
        }

        const config = detectorConfig.config || {};
        const joinsPerHour = Number(config.joinsPerHour) || 25;
        const burstCount = Number(config.burstCount) || 10;
        const burstWindowSeconds = Number(config.burstWindowSeconds) || 10;
        const cooldownMinutes = Number(config.cooldownMinutes) || 60;
        const cacheKey = `anticheat:joins:${member.guild.id}`;
        const now = Date.now();
        const previous = (CacheManager.get<number[]>(cacheKey) || []).filter((timestamp) => now - timestamp <= 3600 * 1000);
        const next = [...previous, now];
        CacheManager.set(cacheKey, next, 3600 * 1000);

        const joinsLastHour = next.length;
        const joinsBurst = next.filter((timestamp) => now - timestamp <= burstWindowSeconds * 1000).length;
        const shouldActivate = joinsLastHour >= joinsPerHour || joinsBurst >= burstCount;
        if (!shouldActivate) {
            return;
        }

        const activeAt = settings.raidMode.activatedAt ? new Date(settings.raidMode.activatedAt).getTime() : 0;
        if (settings.raidMode.active && now - activeAt < cooldownMinutes * 60 * 1000) {
            settings.raidMode.recentJoinCount = Math.max(joinsLastHour, joinsBurst);
            settings.raidMode.lastJoinAt = new Date(now).toISOString();
            await this.setSettings(member.guild.id, settings);
            return;
        }

        const reason = joinsBurst >= burstCount
            ? `${burstWindowSeconds}秒以内に ${joinsBurst} 件の参加を検知`
            : `1時間以内に ${joinsLastHour} 件の参加を検知`;

        settings.raidMode = {
            active: true,
            activatedAt: new Date(now).toISOString(),
            reason,
            recentJoinCount: Math.max(joinsLastHour, joinsBurst),
            lastJoinAt: new Date(now).toISOString()
        };

        await this.setSettings(member.guild.id, settings);

        const logChannel = await this.fetchLogChannel(member.guild, settings.logChannelId);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('🚨 AntiCheat レイドモードを有効化')
                .setColor(Colors.Red)
                .setTimestamp()
                .setDescription('自動アンチレイドモードが発動しました。参加頻度を確認してください。')
                .addFields(
                    { name: '理由', value: reason, inline: false },
                    { name: '参加数 (1時間)', value: `${joinsLastHour}`, inline: true },
                    { name: '参加数 (短時間)', value: `${joinsBurst}`, inline: true },
                    { name: '最後の参加', value: `${member.user.tag}`, inline: true }
                );
            await logChannel.send({ embeds: [embed] }).catch(() => null);
        }
    }

    async onGuildMemberUpdate(oldMember: GuildMember, newMember: GuildMember): Promise<void> {
        if (oldMember.avatar === newMember.avatar) {
            return;
        }

        const settings = await this.getSettings(newMember.guild.id);
        if (!settings.avatarLogChannelId) {
            return;
        }

        await this.sendAvatarLog(
            newMember.guild,
            newMember,
            settings.avatarLogChannelId,
            'サーバーアバター変更',
            oldMember.avatarURL({ size: 256 }) || oldMember.user.displayAvatarURL({ size: 256 }),
            newMember.avatarURL({ size: 256 }) || newMember.user.displayAvatarURL({ size: 256 })
        );
    }

    async onUserAvatarUpdate(oldUser: User, newUser: User): Promise<void> {
        if (!this.client || oldUser.avatar === newUser.avatar) {
            return;
        }

        for (const guild of this.client.guilds.cache.values()) {
            try {
                const settings = await this.getSettings(guild.id);
                if (!settings.avatarLogChannelId) {
                    continue;
                }

                const member = await guild.members.fetch(newUser.id).catch(() => null);
                if (!member) {
                    continue;
                }

                await this.sendAvatarLog(
                    guild,
                    member,
                    settings.avatarLogChannelId,
                    'アバター変更',
                    oldUser.displayAvatarURL({ size: 256 }),
                    newUser.displayAvatarURL({ size: 256 })
                );
            } catch {
                continue;
            }
        }
    }

    private async processMessage(message: Message, settings: GuildAntiCheatSettings): Promise<void> {
        const guildId = message.guild!.id;
        const userId = message.author.id;
        const currentTrust = await this.getUserTrust(guildId, userId);
        const context = {
            guildId,
            userId,
            channelId: message.channel.id,
            userTrustScore: currentTrust.score,
            settings
        };

        let totalScoreDelta = 0;
        let messageDeleted = false;
        const allReasons: string[] = [];
        const detectionResults: Array<{ detector: string; result: DetectionResult }> = [];

        for (const [name, detector] of this.detectors) {
            const detectorConfig = settings.detectors[name];
            if (!detectorConfig?.enabled) {
                continue;
            }

            const cooldownKey = `${guildId}:${userId}:${name}`;
            const now = Date.now();
            const last = this.lastDetectionTimestamps.get(cooldownKey) || 0;
            if (now - last < this.detectionCooldownMs) {
                continue;
            }

            try {
                const result = await detector.detect(message, context);
                const triggered = hasMeaningfulDetection(result);
                if (!triggered) {
                    continue;
                }

                this.lastDetectionTimestamps.set(cooldownKey, now);
                totalScoreDelta += result.scoreDelta;
                allReasons.push(...result.reasons);
                detectionResults.push({ detector: name, result });

                if (result.deleteMessage && !messageDeleted) {
                    await message.delete().then(() => {
                        messageDeleted = true;
                    }).catch(() => null);
                }

                this.appendLog(settings, {
                    userId,
                    messageId: message.id,
                    detector: name,
                    scoreDelta: result.scoreDelta,
                    reason: result.reasons.join('; ') || '検知',
                    timestamp: new Date().toISOString(),
                    status: 'active',
                    metadata: {
                        channelId: message.channel.id,
                        deletedMessage: messageDeleted,
                        contentPreview: message.content.slice(0, 160),
                        ...(result.metadata || {})
                    }
                });

                if (result.publicNotice && detectorConfig.notifyChannel) {
                    await this.sendPublicNotice(message, result.publicNotice);
                }
            } catch (error) {
                Logger.error(`Detector ${name} failed:`, error);
            }
        }

        if (detectionResults.length === 0) {
            return;
        }

        if (totalScoreDelta > 0) {
            await this.applyTrustAdjustment(
                settings,
                guildId,
                userId,
                totalScoreDelta,
                allReasons.join('; ')
            );

            if (settings.autoDelete.enabled) {
                try {
                    const deleted = await this.deleteRecentMessages(message.guild!, userId, settings.autoDelete.windowSeconds);
                    Logger.info(`Auto-deleted ${deleted} messages for user ${userId} in guild ${guildId}`);
                } catch (error) {
                    Logger.error('Failed to auto-delete messages:', error);
                }
            }

            if (settings.autoTimeout.enabled) {
                await this.executeAutoTimeout(message.guild!, userId, settings, message.id);
            }
        }

        await this.setSettings(guildId, settings);
        await this.sendDetectionSummary(message.guild!, message, settings, totalScoreDelta, detectionResults);
    }

    private async sendDetectionSummary(
        guild: Guild,
        message: Message,
        settings: GuildAntiCheatSettings,
        totalScoreDelta: number,
        detections: Array<{ detector: string; result: DetectionResult }>
    ): Promise<void> {
        const logChannel = await this.fetchLogChannel(guild, settings.logChannelId);
        if (!logChannel) {
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('🚨 AntiCheat 検知')
            .setColor(totalScoreDelta > 0 ? Colors.Red : Colors.Orange)
            .setTimestamp()
            .addFields(
                { name: 'ユーザー', value: `${message.author.tag}\n${message.author.toString()}`, inline: true },
                { name: 'チャンネル', value: `<#${message.channel.id}>`, inline: true },
                { name: '加算スコア', value: `${totalScoreDelta}`, inline: true },
                {
                    name: '検知内容',
                    value: detections
                        .map(({ detector, result }) => `• ${detector}: ${result.reasons.join(' / ') || '詳細なし'}`)
                        .join('\n')
                        .slice(0, 1024),
                    inline: false
                }
            );

        if (message.content) {
            embed.addFields({
                name: 'メッセージ',
                value: message.content.slice(0, 1024),
                inline: false
            });
        }

        await logChannel.send({ embeds: [embed] }).catch(() => null);
    }

    private async sendPublicNotice(message: Message, notice: DetectionNotice): Promise<void> {
        if (!message.channel || !('send' in message.channel)) {
            return;
        }

        const color = notice.level === 'danger'
            ? Colors.Red
            : notice.level === 'warning'
                ? Colors.Orange
                : Colors.Blue;

        const embed = new EmbedBuilder()
            .setTitle(notice.title)
            .setDescription(notice.description)
            .setColor(color)
            .setTimestamp();

        if (notice.fields?.length) {
            embed.addFields(notice.fields);
        }

        if (notice.footer) {
            embed.setFooter({ text: notice.footer });
        }

        await (message.channel as any).send({ embeds: [embed] }).catch(() => null);
    }

    private async sendAvatarLog(
        guild: Guild,
        member: GuildMember,
        channelId: string,
        title: string,
        beforeUrl: string,
        afterUrl: string
    ): Promise<void> {
        const logChannel = await this.fetchLogChannel(guild, channelId);
        if (!logChannel) {
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(`🖼️ ${title}`)
            .setColor(Colors.Blue)
            .setTimestamp()
            .setThumbnail(afterUrl || null)
            .addFields(
                { name: 'ユーザー', value: `${member.user.tag}\n${member.user.toString()}`, inline: true },
                { name: 'ユーザーID', value: `\`${member.id}\``, inline: true },
                { name: '変更後', value: afterUrl || '未設定', inline: false },
                { name: '変更前', value: beforeUrl || '未設定', inline: false }
            );

        await logChannel.send({ embeds: [embed] }).catch(() => null);
    }

    private appendLog(settings: GuildAntiCheatSettings, log: DetectionLog): void {
        settings.recentLogs = [...settings.recentLogs, log].slice(-this.MAX_LOGS);
    }

    private async executeAutoTimeout(
        guild: Guild,
        userId: string,
        settings: GuildAntiCheatSettings,
        messageId?: string
    ): Promise<boolean> {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            return false;
        }

        const logChannel = await this.fetchLogChannel(guild, settings.logChannelId);
        const action: PunishmentAction = {
            type: 'timeout',
            durationSeconds: settings.autoTimeout.durationSeconds,
            reasonTemplate: 'Auto timeout: AntiCheat violation detected',
            notify: false
        };

        const applied = await PunishmentExecutor.execute(member, action, logChannel);
        if (applied && messageId) {
            settings.recentLogs = settings.recentLogs.map((entry) => {
                if (entry.messageId !== messageId) {
                    return entry;
                }

                return {
                    ...entry,
                    metadata: {
                        ...(entry.metadata || {}),
                        isTimedOut: true,
                        username: member.user.username,
                        displayName: member.displayName || member.user.username
                    }
                };
            });
        }

        return applied;
    }

    async getSettings(guildId: string): Promise<GuildAntiCheatSettings> {
        const key = `Guild/${guildId}/anticheat`;
        const storedSettings = await database.get<GuildAntiCheatSettings>(guildId, key);
        const normalized = this.normalizeSettings(storedSettings);

        if (!storedSettings || JSON.stringify(storedSettings) !== JSON.stringify(normalized)) {
            await database.set(guildId, key, normalized);
        }

        return normalized;
    }

    async setSettings(guildId: string, settings: GuildAntiCheatSettings): Promise<void> {
        const normalized = this.normalizeSettings(settings);
        const key = `Guild/${guildId}/anticheat`;
        await database.set(guildId, key, normalized);
        Logger.info(`Updated AntiCheat settings for guild ${guildId}`);
    }

    async getUserTrust(guildId: string, userId: string): Promise<UserTrustData> {
        const settings = await this.getSettings(guildId);
        return settings.userTrust[userId] || {
            score: 0,
            lastUpdated: new Date().toISOString(),
            history: []
        };
    }

    async adjustTrust(
        guildId: string,
        userId: string,
        delta: number,
        reason: string
    ): Promise<number> {
        const settings = await this.getSettings(guildId);
        const nextScore = await this.applyTrustAdjustment(settings, guildId, userId, delta, reason);
        await this.setSettings(guildId, settings);
        return nextScore;
    }

    private async applyTrustAdjustment(
        settings: GuildAntiCheatSettings,
        guildId: string,
        userId: string,
        delta: number,
        reason: string
    ): Promise<number> {
        const currentTrust = settings.userTrust[userId] || {
            score: 0,
            lastUpdated: new Date().toISOString(),
            history: []
        };

        const previousScore = currentTrust.score || 0;
        const nextScore = Math.max(0, previousScore + delta);

        settings.userTrust[userId] = {
            score: nextScore,
            lastUpdated: new Date().toISOString(),
            history: [
                ...currentTrust.history,
                {
                    delta,
                    reason,
                    timestamp: new Date().toISOString()
                }
            ].slice(-50)
        };

        Logger.debug(`User ${userId} trust: ${previousScore} → ${nextScore} (${reason})`);
        await this.evaluatePunishments(settings, guildId, userId, previousScore, nextScore);
        return nextScore;
    }

    private async evaluatePunishments(
        settings: GuildAntiCheatSettings,
        guildId: string,
        userId: string,
        previousScore: number,
        nextScore: number
    ): Promise<void> {
        if (!this.client || settings.punishments.length === 0) {
            return;
        }

        const guild = await this.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            return;
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            return;
        }

        const logChannel = await this.fetchLogChannel(guild, settings.logChannelId);
        const thresholds = [...settings.punishments].sort((a, b) => a.threshold - b.threshold);

        for (const threshold of thresholds) {
            if (previousScore >= threshold.threshold || nextScore < threshold.threshold) {
                continue;
            }

            for (const action of threshold.actions) {
                const preparedAction: PunishmentAction = {
                    ...action,
                    reasonTemplate: (action.reasonTemplate || 'AntiCheat violation')
                        .replace(/{threshold}/g, String(threshold.threshold))
                };
                const applied = await PunishmentExecutor.execute(member, preparedAction, logChannel);
                if (!applied) {
                    continue;
                }

                Logger.info(`Applied punishment ${action.type} for user ${userId} at threshold ${threshold.threshold}`);

                if (action.type === 'kick' || action.type === 'ban') {
                    delete settings.userTrust[userId];
                    settings.recentLogs = settings.recentLogs.filter((entry) => entry.userId !== userId);
                    return;
                }
            }
        }
    }

    async resetTrust(guildId: string, userId: string): Promise<void> {
        const settings = await this.getSettings(guildId);
        const previousScore = settings.userTrust[userId]?.score || 0;

        settings.userTrust[userId] = {
            score: 0,
            lastUpdated: new Date().toISOString(),
            history: []
        };

        await this.setSettings(guildId, settings);
        Logger.info(`Reset trust for user ${userId} in guild ${guildId}`);

        const guild = await this.client?.guilds.fetch(guildId).catch(() => null);
        if (!guild || !settings.logChannelId) {
            return;
        }

        const logChannel = await this.fetchLogChannel(guild, settings.logChannelId);
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!logChannel || !member) {
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('🔄 信頼スコアをリセット')
            .setColor(Colors.Blue)
            .setTimestamp()
            .addFields(
                { name: 'ユーザー', value: `${member.user.tag}\n${member.user.toString()}`, inline: true },
                { name: '以前のスコア', value: `${previousScore}`, inline: true }
            );

        await logChannel.send({ embeds: [embed] }).catch(() => null);
    }

    async getLogs(guildId: string, limit: number = 50, before?: string): Promise<DetectionLog[]> {
        const settings = await this.getSettings(guildId);
        let logs = settings.recentLogs.filter((entry) => entry.status !== 'revoked');

        if (this.client) {
            const guild = await this.client.guilds.fetch(guildId).catch(() => null);
            if (guild) {
                const staleTimedOutMessageIds: string[] = [];
                for (const log of logs) {
                    if (!log.metadata?.isTimedOut) {
                        continue;
                    }

                    const member = await guild.members.fetch(log.userId).catch(() => null);
                    const isCurrentlyTimedOut = !!member?.communicationDisabledUntil;
                    if (!isCurrentlyTimedOut) {
                        staleTimedOutMessageIds.push(log.messageId);
                    }
                }

                if (staleTimedOutMessageIds.length > 0) {
                    settings.recentLogs = settings.recentLogs.filter((entry) => !staleTimedOutMessageIds.includes(entry.messageId));
                    await this.setSettings(guildId, settings);
                    logs = settings.recentLogs.filter((entry) => entry.status !== 'revoked');
                }
            }
        }

        if (before) {
            const beforeTimestamp = new Date(before).getTime();
            logs = logs.filter((entry) => new Date(entry.timestamp).getTime() < beforeTimestamp);
        }

        return logs.slice(-limit).reverse();
    }

    async getAllUserTrust(guildId: string): Promise<Record<string, UserTrustData>> {
        const settings = await this.getSettings(guildId);
        return settings.userTrust;
    }

    async revokeLog(guildId: string, messageId: string): Promise<void> {
        const settings = await this.getSettings(guildId);
        settings.recentLogs = settings.recentLogs.filter((entry) => entry.messageId !== messageId);
        await this.setSettings(guildId, settings);
    }

    private normalizeSettings(settings?: Partial<GuildAntiCheatSettings> | null): GuildAntiCheatSettings {
        const normalized: GuildAntiCheatSettings = {
            ...DEFAULT_ANTICHEAT_SETTINGS,
            ...(settings || {}),
            detectors: this.mergeDetectorConfigs(DEFAULT_ANTICHEAT_SETTINGS.detectors, settings?.detectors),
            punishments: Array.isArray(settings?.punishments) ? settings!.punishments : DEFAULT_ANTICHEAT_SETTINGS.punishments,
            excludedRoles: Array.isArray(settings?.excludedRoles) ? settings!.excludedRoles : [],
            excludedChannels: Array.isArray(settings?.excludedChannels) ? settings!.excludedChannels : [],
            logChannelId: settings?.logChannelId ?? null,
            avatarLogChannelId: settings?.avatarLogChannelId ?? null,
            autoTimeout: {
                ...DEFAULT_ANTICHEAT_SETTINGS.autoTimeout,
                ...(settings?.autoTimeout || {})
            },
            autoDelete: {
                ...DEFAULT_ANTICHEAT_SETTINGS.autoDelete,
                ...(settings?.autoDelete || {})
            },
            raidMode: {
                ...DEFAULT_ANTICHEAT_SETTINGS.raidMode,
                ...(settings?.raidMode || {})
            },
            userTrust: settings?.userTrust || {},
            recentLogs: Array.isArray(settings?.recentLogs) ? settings.recentLogs.slice(-this.MAX_LOGS) : []
        };

        return normalized;
    }

    private mergeDetectorConfigs(
        base: Record<string, DetectorConfig>,
        overrides?: Record<string, Partial<DetectorConfig>>
    ): Record<string, DetectorConfig> {
        const merged: Record<string, DetectorConfig> = {};
        const overrideEntries = overrides || {};
        const detectorNames = new Set([...Object.keys(base), ...Object.keys(overrideEntries)]);

        for (const name of detectorNames) {
            const baseConfig = base[name] || {
                enabled: false,
                score: 1,
                deleteMessage: false,
                notifyChannel: false,
                config: {}
            };
            const overrideConfig = overrideEntries[name] || {};
            merged[name] = {
                ...baseConfig,
                ...overrideConfig,
                config: {
                    ...(baseConfig.config || {}),
                    ...(overrideConfig.config || {})
                }
            };
        }

        return merged;
    }

    private async fetchLogChannel(guild: Guild, channelId: string | null): Promise<TextChannel | null> {
        if (!channelId) {
            return null;
        }
        return await guild.channels.fetch(channelId).then((channel) => channel as TextChannel | null).catch(() => null);
    }

    private async deleteRecentMessages(guild: Guild, userId: string, windowSeconds: number): Promise<number> {
        const now = Date.now();
        let deletedCount = 0;

        for (const channel of guild.channels.cache.values()) {
            if (!('isTextBased' in channel) || !(channel as any).isTextBased()) {
                continue;
            }

            const textChannel = channel as TextChannel;
            const me = guild.members.me;
            if (!me) {
                continue;
            }

            const permissions = textChannel.permissionsFor(me);
            if (!permissions || !permissions.has(PermissionFlagsBits.ManageMessages)) {
                continue;
            }

            try {
                let before: string | undefined;

                while (true) {
                    const fetched = await textChannel.messages.fetch({ limit: 100, before });
                    if (fetched.size === 0) {
                        break;
                    }

                    const deletable = fetched.filter((entry) => (
                        entry.author.id === userId && (now - entry.createdTimestamp) <= windowSeconds * 1000
                    ));

                    if (deletable.size > 0) {
                        const ids = Array.from(deletable.keys());
                        for (let index = 0; index < ids.length; index += 100) {
                            const chunk = ids.slice(index, index + 100) as readonly MessageResolvable[];
                            const result = await textChannel.bulkDelete(chunk, true).catch(() => null) as any;
                            deletedCount += typeof result?.size === 'number' ? result.size : chunk.length;
                        }
                    }

                    const oldest = fetched.last();
                    if (!oldest || (now - oldest.createdTimestamp) > windowSeconds * 1000 || fetched.size < 100) {
                        break;
                    }

                    before = oldest.id;
                }
            } catch (error) {
                Logger.debug(`Failed scanning channel ${textChannel.id} for deletions: ${String(error)}`);
            }
        }

        return deletedCount;
    }
}

const GLOBAL_KEY = '__antiCheatManager_v2';
if (!(global as any)[GLOBAL_KEY]) {
    (global as any)[GLOBAL_KEY] = new AntiCheatManager();
    Logger.debug(`AntiCheatManager created (pid=${process.pid})`);
} else {
    Logger.debug(`AntiCheatManager reused existing instance (pid=${process.pid})`);
}

export const antiCheatManager: AntiCheatManager = (global as any)[GLOBAL_KEY];
