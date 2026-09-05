import { exclusionChannelIds, detectorExcluded, normalizeChannelExclusions } from './ExclusionPolicy.js';
import { displayContentExplanation } from './ContentExplanation.js';
import {
    AttachmentBuilder,
    Client,
    Colors,
    EmbedBuilder,
    Guild,
    GuildMember,
    Message,
    MessageResolvable,
    PermissionFlagsBits,
    TextChannel,
    User,
    type PartialMessage
} from 'discord.js';
import { database } from '../persistence/Database.js';
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
import { ContentSafetyDetector } from './detectors/ContentSafetyDetector.js';
import { CONTENT_VERDICT_CACHE_PATH, ContentVerdictCache } from './ContentVerdictCache.js';
import { deleteMatchedContent } from './ContentDeletion.js';
import { CrossChannelSpamDetector } from './detectors/CrossChannelSpamDetector.js';
import { repostWithSpoilers, spoilerText } from './ContentRepost.js';
import { InviteReferralDetector } from './detectors/InviteReferralDetector.js';
import { RedirectLinkDetector } from './detectors/RedirectLinkDetector.js';
import { CopyPasteDetector } from './detectors/CopyPasteDetector.js';
import { EveryoneMentionDetector } from './detectors/EveryoneMentionDetector.js';
import { DuplicateMessageDetector } from './detectors/DuplicateMessageDetector.js';
import { MentionSpamDetector } from './detectors/MentionSpamDetector.js';
import { MentionLimitDetector } from './detectors/MentionLimitDetector.js';
import { MaxLinesDetector } from './detectors/MaxLinesDetector.js';
import { WordFilterDetector } from './detectors/WordFilterDetector.js';
import { GifFlashDetector } from './detectors/GifFlashDetector.js';
import { DuplicateImageDetector } from './detectors/DuplicateImageDetector.js';
import { PunishmentExecutor } from './PunishmentExecutor.js';
import { hasMeaningfulDetection } from './utils.js';

export class AntiCheatManager {
    private detectors: Map<string, Detector> = new Map();
    private client: Client | null = null;
    private readonly MAX_LOGS = 100;
    private readonly detectionCooldownMs = 150;
    private replacedMessages = new Map<string, number>();
    private lastDetectionTimestamps: Map<string, number> = new Map();
    private logChannelCache: Map<string, TextChannel> = new Map();
    private messageProcessingQueues: Map<string, Promise<void>> = new Map();
    private settingsCache: Map<string, GuildAntiCheatSettings> = new Map();
    private settingsLoads: Map<string, Promise<GuildAntiCheatSettings>> = new Map();
    private settingsWriteQueues: Map<string, Promise<void>> = new Map();
    private processedMessageCount = 0;
    private readonly runtimeCleanupInterval = 10_000;

    constructor() {
        this.registerDetector(new CrossChannelSpamDetector());
        this.registerDetector(new ContentSafetyDetector(undefined, new ContentVerdictCache(CONTENT_VERDICT_CACHE_PATH)));
        this.registerDetector(new TextSpamDetector());
        this.registerDetector(new InviteReferralDetector());
        this.registerDetector(new RedirectLinkDetector());
        this.registerDetector(new CopyPasteDetector());
        this.registerDetector(new EveryoneMentionDetector());
        this.registerDetector(new DuplicateMessageDetector());
        this.registerDetector(new MentionSpamDetector());
        this.registerDetector(new MentionLimitDetector());
        this.registerDetector(new MaxLinesDetector());
        this.registerDetector(new WordFilterDetector());
        this.registerDetector(new GifFlashDetector());
        this.registerDetector(new DuplicateImageDetector());
    }

    setClient(client: Client): void {
        this.client = client;
    }

    registerDetector(detector: Detector): void {
        this.detectors.set(detector.name, detector);
        Logger.debug(`Registered AntiCheat detector: ${detector.name}`);
    }
    clearContentCache(guildId: string): number {
        const detector = this.detectors.get('contentSafety');
        return detector instanceof ContentSafetyDetector ? detector.clearCache(guildId) : 0;
    }

    private runDetached(task: Promise<unknown>, context: string): void {
        void task.catch((error) => {
            Logger.error(`Detached AntiCheat task failed (${context}):`, error);
        });
    }
    private enqueueMessageProcessing(key: string, task: () => Promise<void>): Promise<void> {
        const previous = this.messageProcessingQueues.get(key) || Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(task)
            .finally(() => {
                if (this.messageProcessingQueues.get(key) === next) {
                    this.messageProcessingQueues.delete(key);
                }
            });

        this.messageProcessingQueues.set(key, next);
        return next;
    }

    private cleanupRuntimeState(now: number): void {
        for (const [key, timestamp] of this.lastDetectionTimestamps) {
            if (now - timestamp > this.detectionCooldownMs * 4) {
                this.lastDetectionTimestamps.delete(key);
            }
        }
    }

    private enqueueSettingsWrite(guildId: string, settings: GuildAntiCheatSettings): Promise<void> {
        const previous = this.settingsWriteQueues.get(guildId) || Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(async () => {
                const latest = this.settingsCache.get(guildId) || settings;
                const key = `Guild/${guildId}/anticheat`;
                await database.set(guildId, key, this.normalizeSettings(latest));
            })
            .finally(() => {
                if (this.settingsWriteQueues.get(guildId) === next) {
                    this.settingsWriteQueues.delete(guildId);
                }
            });

        this.settingsWriteQueues.set(guildId, next);
        return next;
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

    async onMessage(message: Message, contentOnly = false): Promise<boolean> {
        if (this.replacedMessages.has(message.id)) return true;
        if (message.author.bot || !message.guild) {
            return false;
        }

        const guildId = message.guild.id;
        const settings = await this.getSettings(guildId);
        if (!settings.enabled) {
            return false;
        }

        if (exclusionChannelIds(message).some(id => settings.excludedChannels.includes(id))) {
            return false;
        }

        if (message.member) {
            const hasExcludedRole = settings.excludedRoles.some((roleId) => message.member?.roles.cache.has(roleId));
            if (hasExcludedRole) {
                return false;
            }
        }

        try {
            // Separate queue: cross-channel bursts must be counted/handled while an earlier AI scan is pending.
            if (settings.detectors.crossChannelSpam?.enabled) {
                await this.enqueueMessageProcessing(`${guildId}:${message.author.id}:cross-channel`, async () => {
                    if (!this.replacedMessages.has(message.id)) await this.processMessage(message, settings, contentOnly, true);
                });
                if (this.replacedMessages.has(message.id)) return true;
            }
            await this.enqueueMessageProcessing(
                `${guildId}:${message.author.id}`,
                async () => {
                    if (this.replacedMessages.has(message.id)) return;

                    // Fast, deterministic rules must be fully handled before the slower AI scan starts.
                    // This lets detections such as maxLines reach the log channel without waiting on AI.
                    if (!contentOnly) {
                        await this.processMessage(message, settings, false, false, 'standard');
                    }
                    if (!this.replacedMessages.has(message.id)) {
                        await this.processMessage(message, settings, contentOnly, false, 'ai');
                    }
                }
            );
        } catch (error) {
            Logger.error(`AntiCheat error processing message ${message.id}:`, error);
        }
        return this.replacedMessages.has(message.id);
    }

    async onGuildMemberAdd(member: GuildMember): Promise<void> {
        const settings = await this.getSettings(member.guild.id);
        if (!settings.enabled) {
            return;
        }
        if (settings.excludedRoles.some(id => member.roles.cache.has(id))) return;

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

    async onMessageDelete(message: Message | PartialMessage): Promise<void> {
        const guild = message.guild;
        if (!guild) {
            return;
        }

        const settings = await this.getSettings(guild.id);
        if (!settings.chatLogChannelId || message.channelId === settings.chatLogChannelId) {
            return;
        }

        if (message.author?.bot) {
            return;
        }

        this.runDetached(this.sendChatLog({
            guild,
            settings,
            type: 'delete',
            message
        }), `chatlog-delete:${guild.id}:${message.id}`);
    }

    async onMessageUpdate(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage): Promise<void> {
        const resolvedNewMessage = await this.fetchMessageIfPartial(newMessage);
        // Includes delayed URL embeds. Content moderation must run even with chat logging disabled.
        if (!resolvedNewMessage.partial && resolvedNewMessage.author && !resolvedNewMessage.author.bot) {
            await this.onMessage(resolvedNewMessage as Message, true);
        }
        const guild = resolvedNewMessage.guild || oldMessage.guild;
        if (!guild) {
            return;
        }

        const settings = await this.getSettings(guild.id);
        if (!settings.chatLogChannelId || resolvedNewMessage.channelId === settings.chatLogChannelId) {
            return;
        }

        const author = resolvedNewMessage.author || oldMessage.author;
        if (author?.bot) {
            return;
        }

        const oldContent = this.getMessageContent(oldMessage);
        const newContent = this.getMessageContent(resolvedNewMessage);
        const oldAttachmentSignatures = this.getAttachmentSignatures(oldMessage);
        const newAttachmentSignatures = this.getAttachmentSignatures(resolvedNewMessage);

        if (oldMessage.partial && (resolvedNewMessage as any).editedTimestamp == null) {
            return;
        }

        if (
            oldContent === newContent &&
            this.areStringArraysEqual(oldAttachmentSignatures, newAttachmentSignatures)
        ) {
            return;
        }

        this.runDetached(this.sendChatLog({
            guild,
            settings,
            type: 'update',
            message: resolvedNewMessage,
            oldMessage
        }), `chatlog-update:${guild.id}:${resolvedNewMessage.id}`);
    }

    private async processMessage(
        message: Message,
        settings: GuildAntiCheatSettings,
        contentOnly = false,
        crossChannelOnly = false,
        phase: 'all' | 'standard' | 'ai' = 'all'
    ): Promise<void> {
        const guildId = message.guild!.id;
        const userId = message.author.id;
        const currentTrust = settings.userTrust[userId] || {
            score: 0,
            lastUpdated: new Date().toISOString(),
            history: []
        };
        const context = {
            guildId,
            userId,
            channelId: message.channel.id,
            userTrustScore: currentTrust.score,
            settings
        };
        const detectionStartedAt = Date.now();
        this.processedMessageCount += 1;
        if (this.processedMessageCount % this.runtimeCleanupInterval === 0) {
            this.cleanupRuntimeState(detectionStartedAt);
        }
        const detectorTasks: Array<Promise<{ detector: string; result: DetectionResult } | null>> = [];

        for (const [name, detector] of this.detectors) {
            if (crossChannelOnly ? name !== 'crossChannelSpam' : name === 'crossChannelSpam') continue;
            if (phase === 'standard' && name === 'contentSafety') continue;
            if (phase === 'ai' && name !== 'contentSafety') continue;
            if (!crossChannelOnly && contentOnly && name !== 'contentSafety') continue;
            if (detectorExcluded(message, settings, name)) continue;
            const detectorConfig = settings.detectors[name];
            if (!detectorConfig?.enabled) {
                continue;
            }

            const cooldownKey = `${guildId}:${userId}:${name}`;
            const last = this.lastDetectionTimestamps.get(cooldownKey) || 0;
            if (!['contentSafety', 'crossChannelSpam'].includes(name) && detectionStartedAt - last < this.detectionCooldownMs) {
                continue;
            }

            detectorTasks.push(
                detector.detect(message, context)
                    .then((result) => {
                        if (!hasMeaningfulDetection(result)) {
                            return null;
                        }

                        this.lastDetectionTimestamps.set(cooldownKey, Date.now());
                        return { detector: name, result };
                    })
                    .catch((error) => {
                        Logger.error(`Detector ${name} failed:`, error);
                        return null;
                    })
            );
        }

        const detectionResults = (await Promise.all(detectorTasks))
            .filter((entry): entry is { detector: string; result: DetectionResult } => entry !== null);

        if (detectionResults.length === 0) {
            return;
        }

        const totalScoreDelta = detectionResults.reduce(
            (sum, { result }) => sum + Math.max(0, result.scoreDelta),
            0
        );
        const repost = detectionResults.find(({ result }) => result.spoilerRepost)?.result.spoilerRepost;
        const contentDeletion = detectionResults.find(({ result }) => result.contentDeletion)?.result.contentDeletion;
        let contentDeleted = false;
        let contentDeleteError: string | undefined;
        if (contentDeletion) {
            try { await deleteMatchedContent(message, contentDeletion); contentDeleted = true; }
            catch (error) { contentDeleteError = error instanceof Error ? error.message : 'Content deletion failed'; }
        }
        let replacementId: string | undefined;
        let replacementError: string | undefined;
        if (repost) {
            try {
                replacementId = await repostWithSpoilers(message, repost);
                if (this.replacedMessages.size >= 10000) this.replacedMessages.delete(this.replacedMessages.keys().next().value!);
                this.replacedMessages.set(message.id, Date.now());
            }
            catch (error) {
                replacementError = error instanceof Error ? error.message : 'Repost failed';
                Logger.error(`ContentSafety repost failed for ${message.id}: ${replacementError}`);
            }
        }
        const shouldDeleteMessage = !repost && !contentDeletion && settings.autoDelete.enabled
            && detectionResults.some(({ result }) => result.deleteMessage);
        const messageDeleted = replacementId || contentDeleted ? true : shouldDeleteMessage
            ? await message.delete().then(() => true).catch(() => false)
            : false;
        if ((crossChannelOnly || contentDeletion) && messageDeleted) {
            if (this.replacedMessages.size >= 10000) this.replacedMessages.delete(this.replacedMessages.keys().next().value!);
            this.replacedMessages.set(message.id, Date.now());
        }
        const detectedAt = new Date().toISOString();
        const detectionLatencyMs = Date.now() - detectionStartedAt;

        for (const { detector, result } of detectionResults) {
            this.appendLog(settings, {
                userId,
                messageId: message.id,
                detector,
                scoreDelta: result.scoreDelta,
                reason: [...result.reasons, ...(result.aiExplanation ? [`AI理由：${result.aiExplanation}`] : [])].join('; ') || '検知',
                timestamp: detectedAt,
                status: 'active',
                metadata: {
                    channelId: message.channel.id,
                    deletedMessage: messageDeleted,
                    contentPreview: repost || contentDeletion ? '[コンテンツ保護]' : message.content.slice(0, 160),
                    ...(contentDeletion ? { contentDeleted, contentDeleteError } : {}),
                    ...(repost ? { replacementId, replacementError } : {}),
                    detectionLatencyMs,
                    ...(result.metadata || {})
                }
            });

            if (result.publicNotice && settings.detectors[detector]?.notifyChannel) {
                const noticeTask = this.sendPublicNotice(message, result.publicNotice);
                if (phase === 'standard') {
                    await noticeTask;
                } else {
                    this.runDetached(noticeTask, `public-notice:${guildId}:${message.id}:${detector}`);
                }
            }
        }

        if (totalScoreDelta > 0) {
            await this.applyTrustAdjustment(
                settings,
                guildId,
                userId,
                totalScoreDelta,
                detectionResults
                    .flatMap(({ detector, result }) => result.reasons.length ? result.reasons : [detector])
                    .join('; ')
            );

            if (settings.autoTimeout.enabled) {
                await this.executeAutoTimeout(message.guild!, userId, settings, message.id);
            }

            if (settings.autoDelete.enabled && !repost && !contentDeletion) {
                this.runDetached(
                    this.deleteRecentMessages(message.guild!, userId, settings.autoDelete.windowSeconds)
                        .then((deleted) => {
                            Logger.info(`Auto-deleted ${deleted} messages for user ${userId} in guild ${guildId}`);
                        }),
                    `delete-recent:${guildId}:${userId}:${message.id}`
                );
            }
        }

        this.runDetached(this.setSettings(guildId, settings), `set-settings:${guildId}:${message.id}`);
        const summaryTask = this.sendDetectionSummary(message.guild!, message, settings, totalScoreDelta, detectionResults);
        if (phase === 'standard') {
            // Preserve the ordering contract: standard-rule notification first, AI inference second.
            await summaryTask;
        } else {
            this.runDetached(summaryTask, `detection-summary:${guildId}:${message.id}`);
        }
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

        const explanation = detections.find(({ detector, result }) => detector === 'contentSafety' && result.aiExplanation)?.result.aiExplanation;
        if (explanation) embed.addFields({ name: 'AIの判定理由（参考）', value: displayContentExplanation(explanation).slice(0, 1024) });
        if (message.content) {
            embed.addFields({
                name: 'メッセージ',
                value: detections.some(({ detector }) => detector === 'contentSafety')
                    ? spoilerText(message.content.slice(0, 450)) : message.content.slice(0, 1024),
                inline: false
            });
        }

        await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
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

    private async sendChatLog(options: {
        guild: Guild;
        settings: GuildAntiCheatSettings;
        type: 'delete' | 'update';
        message: Message | PartialMessage;
        oldMessage?: Message | PartialMessage;
    }): Promise<void> {
        const logChannel = await this.fetchLogChannel(options.guild, options.settings.chatLogChannelId);
        if (!logChannel) {
            return;
        }

        const message = options.message;
        const oldMessage = options.oldMessage;
        const isDelete = options.type === 'delete';
        const timestamp = new Date();
        const author = message.author || oldMessage?.author || null;
        const channelId = message.channelId || oldMessage?.channelId || 'unknown';
        const messageId = message.id || oldMessage?.id || 'unknown';
        const beforeContent = isDelete ? this.getMessageContent(message) : oldMessage ? this.getMessageContent(oldMessage) : null;
        const afterContent = isDelete ? null : this.getMessageContent(message);
        const beforeAttachments = isDelete ? this.getAttachmentLines(message) : oldMessage ? this.getAttachmentLines(oldMessage) : [];
        const afterAttachments = isDelete ? [] : this.getAttachmentLines(message);
        const messageUrl = this.buildMessageUrl(options.guild.id, channelId, messageId);

        const embed = new EmbedBuilder()
            .setTitle(isDelete ? '🗑️ メッセージ削除' : '✏️ メッセージ編集')
            .setColor(isDelete ? Colors.Red : Colors.Orange)
            .setTimestamp(timestamp)
            .addFields(
                {
                    name: 'ユーザー',
                    value: author ? `${author.tag}\n${author.toString()}` : '不明',
                    inline: true
                },
                { name: 'チャンネル', value: channelId === 'unknown' ? '不明' : `<#${channelId}>`, inline: true },
                { name: 'メッセージID', value: `\`${messageId}\``, inline: true }
            );

        if (isDelete) {
            embed.addFields({
                name: '削除された内容',
                value: this.formatEmbedContent(beforeContent),
                inline: false
            });
        } else {
            embed.addFields(
                {
                    name: '変更前',
                    value: this.formatEmbedContent(beforeContent),
                    inline: false
                },
                {
                    name: '変更後',
                    value: this.formatEmbedContent(afterContent),
                    inline: false
                }
            );
        }

        if (afterAttachments.length > 0 || beforeAttachments.length > 0) {
            const attachmentPreview = isDelete
                ? beforeAttachments
                : [
                    beforeAttachments.length > 0 ? `変更前:\n${beforeAttachments.join('\n')}` : '変更前: なし',
                    afterAttachments.length > 0 ? `変更後:\n${afterAttachments.join('\n')}` : '変更後: なし'
                ];
            embed.addFields({
                name: '添付ファイル',
                value: attachmentPreview.join('\n').slice(0, 1024),
                inline: false
            });
        }

        if (messageUrl) {
            embed.addFields({ name: 'リンク', value: messageUrl, inline: false });
        }

        const file = new AttachmentBuilder(
            Buffer.from(this.buildChatLogFile({
                type: options.type,
                guild: options.guild,
                channelId,
                messageId,
                authorTag: author?.tag || 'unknown',
                authorId: author?.id || 'unknown',
                loggedAt: timestamp.toISOString(),
                messageUrl,
                beforeContent,
                afterContent,
                beforeAttachments,
                afterAttachments
            }), 'utf8'),
            { name: this.buildChatLogFileName(options.type, timestamp, messageId) }
        );

        if (options.settings.detectors.contentSafety?.enabled) {
            for (const field of embed.data.fields || []) {
                if (['削除された内容', '変更前', '変更後', '添付ファイル'].includes(field.name)) {
                    field.value = spoilerText(field.value.slice(0, 450));
                }
            }
            file.setSpoiler(true);
        }
        await logChannel.send({ embeds: [embed], files: [file], allowedMentions: { parse: [] } }).catch(() => null);
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
        const cached = this.settingsCache.get(guildId);
        if (cached) {
            return cached;
        }

        const pending = this.settingsLoads.get(guildId);
        if (pending) {
            return pending;
        }

        const load = (async () => {
            const key = `Guild/${guildId}/anticheat`;
            const storedSettings = await database.get<GuildAntiCheatSettings>(guildId, key);
            const normalized = this.normalizeSettings(storedSettings);
            this.settingsCache.set(guildId, normalized);

            if (!storedSettings || JSON.stringify(storedSettings) !== JSON.stringify(normalized)) {
                await this.enqueueSettingsWrite(guildId, normalized);
            }

            return normalized;
        })().finally(() => {
            this.settingsLoads.delete(guildId);
        });

        this.settingsLoads.set(guildId, load);
        return load;
    }

    async setSettings(guildId: string, settings: GuildAntiCheatSettings): Promise<void> {
        const normalized = this.normalizeSettings(settings);
        this.settingsCache.set(guildId, normalized);
        await this.enqueueSettingsWrite(guildId, normalized);
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

    async getUserLogs(guildId: string, userId: string, limit: number = 20): Promise<DetectionLog[]> {
        const settings = await this.getSettings(guildId);
        return settings.recentLogs
            .filter((entry) => entry.status !== 'revoked' && entry.userId === userId)
            .slice(-Math.max(1, limit))
            .reverse();
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
            channelDetectorExclusions: normalizeChannelExclusions(settings?.channelDetectorExclusions),
            logChannelId: settings?.logChannelId ?? null,
            avatarLogChannelId: settings?.avatarLogChannelId ?? null,
            chatLogChannelId: settings?.chatLogChannelId ?? null,
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

        const cacheKey = `${guild.id}:${channelId}`;
        const cachedChannel = this.logChannelCache.get(cacheKey);
        if (cachedChannel) {
            return cachedChannel;
        }

        const fromCache = guild.channels.cache.get(channelId);
        if (fromCache?.isTextBased()) {
            const textChannel = fromCache as TextChannel;
            this.logChannelCache.set(cacheKey, textChannel);
            return textChannel;
        }

        const fetchedChannel = await guild.channels.fetch(channelId).then((channel) => channel as TextChannel | null).catch(() => null);
        if (fetchedChannel) {
            this.logChannelCache.set(cacheKey, fetchedChannel);
        }
        return fetchedChannel;
    }

    private async fetchMessageIfPartial(message: Message | PartialMessage): Promise<Message | PartialMessage> {
        if (!message.partial) {
            return message;
        }

        return await message.fetch().catch(() => message);
    }

    private getMessageContent(message: Message | PartialMessage): string | null {
        return typeof message.content === 'string' ? message.content : null;
    }

    private getAttachmentLines(message: Message | PartialMessage): string[] {
        const attachments = Array.from((message.attachments as any)?.values?.() || []) as any[];
        return attachments.map((attachment) => {
            const name = attachment.name || attachment.id || 'unknown';
            const size = typeof attachment.size === 'number' ? ` (${attachment.size} bytes)` : '';
            const url = attachment.url || attachment.proxyURL || 'urlなし';
            return `${name}${size}: ${url}`;
        });
    }

    private getAttachmentSignatures(message: Message | PartialMessage): string[] {
        const attachments = Array.from((message.attachments as any)?.values?.() || []) as any[];
        return attachments.map((attachment) => {
            const id = attachment.id || 'unknown';
            const name = attachment.name || 'unknown';
            const size = typeof attachment.size === 'number' ? String(attachment.size) : 'unknown';
            return `${id}:${name}:${size}`;
        });
    }

    private areStringArraysEqual(left: string[], right: string[]): boolean {
        if (left.length !== right.length) {
            return false;
        }

        return left.every((value, index) => value === right[index]);
    }

    private formatEmbedContent(content: string | null): string {
        if (content === null) {
            return '取得できませんでした';
        }

        if (content.length === 0) {
            return '本文なし';
        }

        return content.slice(0, 1024);
    }

    private buildMessageUrl(guildId: string, channelId: string, messageId: string): string | null {
        if (channelId === 'unknown' || messageId === 'unknown') {
            return null;
        }

        return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
    }

    private buildChatLogFileName(type: 'delete' | 'update', timestamp: Date, messageId: string): string {
        const safeTimestamp = timestamp.toISOString().replace(/[:.]/g, '-');
        return `chatlog-${type}-${safeTimestamp}-${messageId}.txt`;
    }

    private buildChatLogFile(data: {
        type: 'delete' | 'update';
        guild: Guild;
        channelId: string;
        messageId: string;
        authorTag: string;
        authorId: string;
        loggedAt: string;
        messageUrl: string | null;
        beforeContent: string | null;
        afterContent: string | null;
        beforeAttachments: string[];
        afterAttachments: string[];
    }): string {
        const contentUnavailable = '[取得できませんでした]';
        const contentEmpty = '[本文なし]';
        const formatContent = (content: string | null) => {
            if (content === null) return contentUnavailable;
            if (content.length === 0) return contentEmpty;
            return content;
        };
        const formatAttachments = (attachments: string[]) => attachments.length > 0 ? attachments.join('\n') : '[なし]';

        return [
            `Chatlog Type: ${data.type === 'delete' ? 'Message Delete' : 'Message Update'}`,
            `Logged At: ${data.loggedAt}`,
            `Guild: ${data.guild.name} (${data.guild.id})`,
            `Channel ID: ${data.channelId}`,
            `Message ID: ${data.messageId}`,
            `Author: ${data.authorTag} (${data.authorId})`,
            `Message URL: ${data.messageUrl || 'unavailable'}`,
            '',
            '--- Before Content ---',
            formatContent(data.beforeContent),
            '',
            '--- After Content ---',
            data.type === 'delete' ? '[削除済み]' : formatContent(data.afterContent),
            '',
            '--- Before Attachments ---',
            formatAttachments(data.beforeAttachments),
            '',
            '--- After Attachments ---',
            data.type === 'delete' ? '[削除済み]' : formatAttachments(data.afterAttachments),
            ''
        ].join('\n');
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
