import { exclusionChannelIds, detectorExcluded, normalizeChannelExclusions } from './ExclusionPolicy.js';
import { contentFailureReason } from './ContentScanFailure.js';
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
import { CONTENT_CATEGORIES, CONTENT_LABELS, ContentSafetyDetector } from './detectors/ContentSafetyDetector.js';
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
import { messageRevision, snapshotMessage } from './MessageSnapshot.js';
import {
    RAID_JOIN_WINDOW_MS,
    RAID_KICK_LOG_WINDOW_MS,
    RAID_KICK_REASON,
    formatRaidKickLines,
    raidKickSkipReason,
    readRaidDetectionConfig,
    readRaidJoinRecords,
    type RaidJoinRecord,
    type RaidKickReport
} from './RaidEnforcement.js';
import {
    WATCH_JOIN_WINDOW_MS,
    WATCH_KICK_REASON,
    WATCH_SIGNAL_LABELS,
    formatWatchSignals,
    isWatchBurst,
    matchWatchSignals,
    normalizeWatchName,
    normalizeWatchUserEntries,
    pruneWatchDangerPoints,
    readWatchJoinRecords,
    readWatchSettings,
    selectWatchPeers,
    watchDangerPointTotal,
    type WatchJoinRecord,
    type WatchPeerCandidate
} from './WatchUsers.js';
import type { WatchDangerPoint, WatchSettings, WatchSource, WatchUserEntry } from './types.js';
import { recordRiskKicksSafely } from './RiskKicks.js';
import type { WebAuthMatch } from '../webauth/types.js';

type Detection = { detector: string; result: DetectionResult };
type MessageWork = { revision: string; timestamp: number; task: Promise<boolean>; current: boolean };
const SLOW_DETECTORS = new Set(['redirectLink', 'gifFlash', 'duplicateImage', 'contentSafety']);

export class AntiCheatManager {
    private detectors: Map<string, Detector> = new Map();
    private client: Client | null = null;
    private readonly MAX_LOGS = 100;
    private replacedMessages = new Map<string, number>();
    private deletedMessages = new Map<string, number>();
    private logChannelCache: Map<string, TextChannel> = new Map();
    private messageProcessingQueues: Map<string, Promise<void>> = new Map();
    private messageVersions = new Map<string, MessageWork>();
    private moderationClaims = new Map<string, string>();
    private recentDeletionTasks = new Map<string, Promise<number>>();
    private timeoutTasks = new Map<string, Promise<boolean>>();
    // Kicks from consecutive raid joins are merged into one log embed per batch.
    private raidKickBatches = new Map<string, {
        guild: Guild;
        logChannelId: string | null;
        report: RaidKickReport;
        timer?: ReturnType<typeof setTimeout>;
    }>();
    // Transient moderation failures must re-run the entire message handling path.
    // A cached verdict alone would never apply the original moderation action.
    private contentRetries = new Map<string, { attempts: number; timer?: ReturnType<typeof setTimeout> }>();
    // 警戒ユーザー: lazy re-checks are throttled per member so ordinary chat
    // does not rescan the 24 h join set on every message.
    private watchChecks = new Map<string, number>();
    // One danger-kick pipeline per user; later detections ride on it.
    private watchDangerTasks = new Map<string, Promise<void>>();

    private settingsCache: Map<string, GuildAntiCheatSettings> = new Map();
    private settingsLoads: Map<string, Promise<GuildAntiCheatSettings>> = new Map();
    private settingsWriteQueues: Map<string, Promise<void>> = new Map();
    private dirtySettings = new Set<string>();
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
    private cancelContentRetry(id: string): void {
        const pending = this.contentRetries.get(id);
        if (pending?.timer) clearTimeout(pending.timer);
        this.contentRetries.delete(id);
    }

    private scheduleContentRetry(message: Message, error: unknown): void {
        const reason = contentFailureReason(error);
        const transient = /^(?:(?:Moderation API|Media) HTTP (?:408|425|429|5\d\d)|(?:TimeoutError|AbortError|ECONN|ENET|EAI_AGAIN|ETIMEDOUT|UND_ERR)|Network request failed|Invalid JSON response|Invalid jev decision|Invalid moderation|Truncated moderation response|Moderation queue|Unrecognized processing error)/.test(reason);
        if (!transient || !message.guild || typeof message.fetch !== 'function' ||
            this.replacedMessages.has(message.id) || this.deletedMessages.has(message.id)) {
            Logger.warn(`[ContentSafety] scan-unresolved message=${message.id} reason=${reason}; original preserved`);
            return;
        }
        const previous = this.contentRetries.get(message.id);
        if (previous?.timer) return;
        const attempts = (previous?.attempts ?? 0) + 1;
        const entry: { attempts: number; timer?: ReturnType<typeof setTimeout> } = { attempts };
        this.contentRetries.set(message.id, entry);
        // Keep retrying until the scan succeeds or the Discord post disappears.
        // Cap both the delay and exponent so a long outage cannot overflow the
        // calculation or hammer the inference service when it comes back.
        const delay = Math.min(15 * 60_000, 5_000 * 2 ** Math.min(attempts - 1, 20));
        entry.timer = setTimeout(() => {
            entry.timer = undefined;
            if (this.replacedMessages.has(message.id) || this.deletedMessages.has(message.id)) {
                this.cancelContentRetry(message.id);
                return;
            }
            // Refetch the latest version. Deleted messages must not be reprocessed.
            void message.fetch().then(
                fresh => this.onMessage(fresh, true),
                () => { this.cancelContentRetry(message.id); }
            ).catch(retryError => Logger.warn(
                `[ContentSafety] retry-dispatch-failed message=${message.id} reason=${contentFailureReason(retryError)}`
            ));
        }, delay);
        entry.timer.unref?.();
        Logger.warn(`[ContentSafety] retry-scheduled message=${message.id} attempt=${attempts} delayMs=${delay} reason=${reason}`);
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
        for (const [id, entry] of this.messageVersions) {
            if (now - entry.timestamp > 10 * 60_000) {
                this.messageVersions.delete(id);
                this.moderationClaims.delete(id);
            }
        }
        for (const [id, timestamp] of this.deletedMessages) {
            if (now - timestamp > 10 * 60 * 1000) this.deletedMessages.delete(id);
        }
        for (const [id, timestamp] of this.replacedMessages) {
            if (now - timestamp > 10 * 60_000) this.replacedMessages.delete(id);
        }
    }

    private enqueueSettingsWrite(guildId: string, settings: GuildAntiCheatSettings): Promise<void> {
        this.dirtySettings.add(guildId);
        const pending = this.settingsWriteQueues.get(guildId);
        if (pending) return pending;
        // Merge bursts of log/score updates into the latest snapshot instead
        // of writing the same guild file once for every message in the burst.
        const next = Promise.resolve().then(async () => {
            try {
                while (this.dirtySettings.delete(guildId)) {
                    const latest = this.settingsCache.get(guildId) || settings;
                    await database.set(guildId, `Guild/${guildId}/anticheat`, this.normalizeSettings(latest));
                }
            } finally {
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
            watch: {
                ...normalizedBase.watch,
                ...(updates.watch || {})
            },
            punishments: updates.punishments !== undefined ? updates.punishments : normalizedBase.punishments,
            excludedRoles: updates.excludedRoles !== undefined ? updates.excludedRoles : normalizedBase.excludedRoles,
            excludedChannels: updates.excludedChannels !== undefined ? updates.excludedChannels : normalizedBase.excludedChannels,
            userTrust: updates.userTrust !== undefined ? updates.userTrust : normalizedBase.userTrust,
            watchUsers: updates.watchUsers !== undefined ? updates.watchUsers : normalizedBase.watchUsers,
            recentLogs: updates.recentLogs !== undefined ? updates.recentLogs : normalizedBase.recentLogs
        });
    }

    onMessage(message: Message, contentOnly = false): Promise<boolean> {
        if (this.replacedMessages.has(message.id) || this.deletedMessages.has(message.id)) return Promise.resolve(true);
        if (message.author.bot || !message.guild) return Promise.resolve(false);
        const receivedAt = Date.now();
        const input = snapshotMessage(message);
        const revision = messageRevision(input);
        const previous = this.messageVersions.get(message.id);
        if (!contentOnly && previous?.revision === revision) return previous.task;
        if (previous) previous.current = false;
        this.processedMessageCount++;
        if (this.processedMessageCount % this.runtimeCleanupInterval === 0) this.cleanupRuntimeState(receivedAt);
        if (!previous && this.messageVersions.size >= 10_000) {
            const oldest = this.messageVersions.keys().next().value!;
            this.messageVersions.delete(oldest);
            this.moderationClaims.delete(oldest);
        }
        // Evicting the bounded duplicate-event cache must never cancel an
        // accepted event. Only a newer revision explicitly invalidates its work.
        const work: MessageWork = { revision, timestamp: receivedAt, current: true, task: Promise.resolve(false) };
        this.messageVersions.set(message.id, work);
        work.task = this.processIncomingMessage(input, work, contentOnly).catch(error => {
            if (this.messageVersions.get(message.id) === work) this.messageVersions.delete(message.id);
            Logger.error(`AntiCheat error processing message ${message.id}:`, error);
            return this.replacedMessages.has(message.id);
        });
        return work.task;
    }

    private async processIncomingMessage(message: Message, work: MessageWork, contentOnly: boolean): Promise<boolean> {
        const { revision, timestamp: receivedAt } = work;
        const guildId = message.guild!.id;
        let settings = await this.getSettings(guildId);
        const forgetSkipped = () => {
            if (this.messageVersions.get(message.id)?.revision === revision) this.messageVersions.delete(message.id);
        };
        if (!settings.enabled) {
            forgetSkipped();
            return false;
        }

        if (exclusionChannelIds(message).some(id => settings.excludedChannels.includes(id))) {
            forgetSkipped();
            return false;
        }

        if (message.member) {
            const hasExcludedRole = settings.excludedRoles.some((roleId) => message.member?.roles.cache.has(roleId));
            if (hasExcludedRole) {
                forgetSkipped();
                return false;
            }
        }

        // Lazy 警戒ユーザー evaluation covers members that existed before the
        // feature was enabled. Throttled per member, and it never blocks on the
        // flag log embed (that is detached inside evaluateWatchMember). Watch
        // evaluation must never break message processing.
        if (settings.watch.enabled) {
            try {
                await this.evaluateWatchOnMessage(message, settings);
            } catch (error) {
                Logger.debug(`[WatchUsers] lazy evaluation skipped for ${message.id}: ${String(error)}`);
            }
            settings = this.settingsCache.get(guildId) || settings;
        }

        if (![...this.detectors.keys()].some(name => (!contentOnly || name === 'contentSafety')
            && settings.detectors[name]?.enabled && !detectorExcluded(message, settings, name))) {
            forgetSkipped();
            return false;
        }

        const isCurrent = () => work.current
            && !this.deletedMessages.has(message.id) && !this.replacedMessages.has(message.id);
        let immediate: Detection[] = [];
        if (!contentOnly) {
            // Only in-memory evaluation is ordered per author. REST requests,
            // persistence, notifications and slow detectors never hold this lane.
            await this.enqueueMessageProcessing(`${guildId}:${message.author.id}:realtime`, async () => {
                if (!isCurrent()) return;
                immediate = await this.detectMessage(message, settings, receivedAt,
                    [...this.detectors.keys()].filter(name => !SLOW_DETECTORS.has(name)), isCurrent);
            });
        }
        if (!isCurrent()) return this.replacedMessages.has(message.id);
        if (immediate.length) {
            await this.applyDetections(message, settings, immediate, receivedAt, revision, true, isCurrent);
        } else {
            // Each slow detector has its own ordered lane. A stalled URL fetch
            // cannot delay GIF protection, AI, or any subsequent realtime rule.
            await Promise.all([...SLOW_DETECTORS].filter(name => !contentOnly || name === 'contentSafety').map(async name => {
                if (!settings.detectors[name]?.enabled || detectorExcluded(message, settings, name)) return;
                await this.enqueueMessageProcessing(`${guildId}:${message.author.id}:${name}`, async () => {
                    if (!isCurrent() || this.moderationClaims.get(message.id) === revision) return;
                    const results = await this.detectMessage(message, settings, receivedAt, [name], isCurrent);
                    if (isCurrent() && results.length)
                        await this.applyDetections(message, settings, results, receivedAt, revision, false, isCurrent);
                });
            }));
        }
        return this.replacedMessages.has(message.id);
    }

    async onGuildMemberAdd(member: GuildMember): Promise<void> {
        const guild = member.guild;
        const settings = await this.getSettings(guild.id);
        if (!settings.enabled) {
            return;
        }
        // Excluded-role members are never counted, kicked or reported.
        if (settings.excludedRoles.some(id => member.roles.cache.has(id))) return;

        // 警戒ユーザー tier runs before (and independently of) raid detection.
        const joinedAt = Date.now();
        if (settings.watch.enabled && !member.user.bot) {
            this.recordWatchJoin(guild.id, member, joinedAt);
            await this.evaluateWatchMember(member, settings, 'join', joinedAt).catch((error) => {
                Logger.warn(`[WatchUsers] evaluation failed for ${member.id} in ${guild.id}: ${String(error)}`);
            });
        }

        const detectorConfig = settings.detectors.raidDetection;
        if (!detectorConfig?.enabled) {
            return;
        }

        const config = readRaidDetectionConfig(detectorConfig.config);
        const now = Date.now();
        const cacheKey = `anticheat:joins:${guild.id}`;

        // Lazy expiry: any join that arrives after cooldownMinutes of silence
        // ends the previous raid before this join is evaluated.
        if (settings.raidMode.active) {
            const lastActivity = new Date(settings.raidMode.lastJoinAt || settings.raidMode.activatedAt || 0).getTime() || 0;
            if (now - lastActivity >= config.cooldownMinutes * 60 * 1000) {
                settings.raidMode = {
                    active: false,
                    activatedAt: null,
                    reason: null,
                    recentJoinCount: 0,
                    lastJoinAt: null
                };
                await this.setSettings(guild.id, settings);
                await this.logRaidDeactivation(guild, settings, config.cooldownMinutes);
            }
        }

        const previous = readRaidJoinRecords(CacheManager.get(cacheKey), now);
        const joins: RaidJoinRecord[] = [...previous, { userId: member.id, ts: now }];
        CacheManager.set(cacheKey, joins, RAID_JOIN_WINDOW_MS);

        const joinsLastHour = joins.length;
        const joinsBurst = joins.filter((record) => now - record.ts <= config.burstWindowSeconds * 1000).length;

        if (settings.raidMode.active) {
            settings.raidMode.recentJoinCount = Math.max(joinsLastHour, joinsBurst);
            settings.raidMode.lastJoinAt = new Date(now).toISOString();
            await this.setSettings(guild.id, settings);
            if (config.autoKick) await this.enforceRaidKick(guild, [member], settings);
            return;
        }

        const shouldActivate = joinsLastHour >= config.joinsPerHour || joinsBurst >= config.burstCount;
        if (!shouldActivate) {
            return;
        }

        const reason = joinsBurst >= config.burstCount
            ? `${config.burstWindowSeconds}秒以内に ${joinsBurst} 件の参加を検知`
            : `1時間以内に ${joinsLastHour} 件の参加を検知`;

        settings.raidMode = {
            active: true,
            activatedAt: new Date(now).toISOString(),
            reason,
            recentJoinCount: Math.max(joinsLastHour, joinsBurst),
            lastJoinAt: new Date(now).toISOString()
        };

        await this.setSettings(guild.id, settings);
        await this.sendRaidActivationLog(guild, settings, config, reason, joinsLastHour, joinsBurst, member);

        if (!config.autoKick) {
            return;
        }

        const candidates = await this.collectRaidKickCandidates(guild, joins, config.kickWindowSeconds * 1000, now);
        await this.enforceRaidKick(guild, candidates, settings);
        // Activation must not wait for the coalescing window.
        await this.flushRaidKickBatch(guild.id);
    }

    private async sendRaidActivationLog(
        guild: Guild,
        settings: GuildAntiCheatSettings,
        config: ReturnType<typeof readRaidDetectionConfig>,
        reason: string,
        joinsLastHour: number,
        joinsBurst: number,
        member: GuildMember
    ): Promise<void> {
        const logChannel = await this.fetchLogChannel(guild, settings.logChannelId);
        if (!logChannel) {
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('🚨 AntiCheat レイドモードを有効化')
            .setColor(Colors.Red)
            .setTimestamp()
            .setDescription('自動アンチレイドモードが発動しました。参加頻度を確認してください。')
            .addFields(
                { name: '理由', value: reason, inline: false },
                { name: '参加数 (1時間)', value: `${joinsLastHour}`, inline: true },
                { name: '参加数 (短時間)', value: `${joinsBurst}`, inline: true },
                { name: '最後の参加', value: `${member.user.tag}`, inline: true },
                {
                    name: '自動キック',
                    value: config.autoKick
                        ? `有効（直近 ${config.kickWindowSeconds} 秒の参加者が対象）`
                        : '無効（ログのみ）',
                    inline: false
                }
            );
        await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    }

    private async logRaidDeactivation(guild: Guild, settings: GuildAntiCheatSettings, cooldownMinutes: number): Promise<void> {
        const logChannel = await this.fetchLogChannel(guild, settings.logChannelId);
        if (!logChannel) {
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('🛡️ AntiCheat レイドモードを解除')
            .setColor(Colors.Green)
            .setTimestamp()
            .setDescription(`${cooldownMinutes}分間 新しい参加がなかったため、レイドモードを自動解除しました。`);
        await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    }

    /**
     * Members to kick on activation. The join cache only covers the current
     * process, so members whose join timestamp is recent are included as well.
     */
    private async collectRaidKickCandidates(
        guild: Guild,
        joins: RaidJoinRecord[],
        windowMs: number,
        now: number
    ): Promise<GuildMember[]> {
        const ids = new Set(
            joins.filter((record) => now - record.ts <= windowMs).map((record) => record.userId)
        );
        for (const cached of guild.members.cache.values()) {
            const joinedAt = cached.joinedTimestamp;
            if (typeof joinedAt === 'number' && now - joinedAt <= windowMs) {
                ids.add(cached.id);
            }
        }

        const members: GuildMember[] = [];
        for (const id of ids) {
            const member = guild.members.cache.get(id)
                || await guild.members.fetch(id).catch(() => null);
            if (member) members.push(member);
        }
        return members;
    }

    private async enforceRaidKick(
        guild: Guild,
        members: GuildMember[],
        settings: GuildAntiCheatSettings
    ): Promise<void> {
        const report = await this.kickRaidJoiners(guild, members, settings);
        if (!report.kicked.length && !report.skipped.length) {
            return;
        }
        this.queueRaidKickReport(guild, settings, report);
    }

    /** Kick without DMs. Every non-kick is recorded with its reason. */
    private async kickRaidJoiners(
        guild: Guild,
        members: GuildMember[],
        settings: GuildAntiCheatSettings
    ): Promise<RaidKickReport> {
        const report: RaidKickReport = { kicked: [], skipped: [] };
        if (!members.length) {
            return report;
        }

        const ownerId = guild.ownerId
            || await guild.fetchOwner().then((owner) => owner.id).catch(() => null);
        const seen = new Set<string>();
        for (const member of members) {
            if (seen.has(member.id)) continue;
            seen.add(member.id);

            const tag = member.user?.tag || member.user?.username || member.id;
            const skipReason = raidKickSkipReason(member, ownerId, settings.excludedRoles);
            if (skipReason) {
                report.skipped.push({ id: member.id, tag, reason: skipReason });
                continue;
            }

            try {
                await member.kick(RAID_KICK_REASON);
                report.kicked.push({ id: member.id, tag });
                Logger.info(`[AntiRaid] kicked ${tag} (${member.id}) in guild ${guild.id}`);
            } catch (error: any) {
                // Already gone by the time the batch ran: not a failure.
                if (error?.code === 10007 || error?.code === 10013) continue;
                const reason = error instanceof Error ? error.message : String(error);
                report.skipped.push({ id: member.id, tag, reason: `キック失敗: ${reason}` });
                Logger.warn(`[AntiRaid] kick failed for ${member.id} in guild ${guild.id}: ${reason}`);
            }
        }
        if (this.client && report.kicked.length) {
            // Durable fact used by the WebAuth correlation later (the guild
            // settings do not keep raid kick history). The client guard keeps
            // unit tests from touching the real ledger.
            await recordRiskKicksSafely(guild.id, report.kicked.map((entry) => entry.id), 'raid', RAID_KICK_REASON);
        }
        return report;
    }

    private queueRaidKickReport(
        guild: Guild,
        settings: GuildAntiCheatSettings,
        report: RaidKickReport
    ): void {
        const existing = this.raidKickBatches.get(guild.id);
        const batch = existing || {
            guild,
            logChannelId: settings.logChannelId,
            report: { kicked: [], skipped: [] } as RaidKickReport
        };
        batch.guild = guild;
        batch.logChannelId = settings.logChannelId;
        batch.report.kicked.push(...report.kicked);
        batch.report.skipped.push(...report.skipped);
        if (!batch.timer) {
            // One embed per kick batch instead of one message per kick.
            batch.timer = setTimeout(() => {
                batch.timer = undefined;
                this.runDetached(this.flushRaidKickBatch(guild.id), `raid-kick-summary:${guild.id}`);
            }, RAID_KICK_LOG_WINDOW_MS);
            batch.timer.unref?.();
        }
        this.raidKickBatches.set(guild.id, batch);
    }

    private async flushRaidKickBatch(guildId: string): Promise<void> {
        const batch = this.raidKickBatches.get(guildId);
        if (!batch) return;
        this.raidKickBatches.delete(guildId);
        if (batch.timer) clearTimeout(batch.timer);
        batch.timer = undefined;
        await this.sendRaidKickSummary(batch.guild, batch.logChannelId, batch.report);
    }

    private async sendRaidKickSummary(
        guild: Guild,
        logChannelId: string | null,
        report: RaidKickReport
    ): Promise<void> {
        if (!report.kicked.length && !report.skipped.length) return;
        const logChannel = await this.fetchLogChannel(guild, logChannelId);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('🚨 AntiRaid 自動キック')
            .setColor(report.kicked.length ? Colors.Red : Colors.Orange)
            .setTimestamp()
            .setDescription(`レイド検知により ${report.kicked.length} 人をキックしました。`);
        if (report.kicked.length) {
            embed.addFields({
                name: `キック (${report.kicked.length})`,
                value: formatRaidKickLines(report.kicked),
                inline: false
            });
        }
        if (report.skipped.length) {
            embed.addFields({
                name: `スキップ (${report.skipped.length})`,
                value: formatRaidKickLines(report.skipped),
                inline: false
            });
        }
        await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    }

    // ---------------------------------------------------------------------
    // 警戒ユーザー (watch tier)
    // ---------------------------------------------------------------------

    /** Watch entries that staff have not dismissed. */
    private activeWatchEntry(settings: GuildAntiCheatSettings, userId: string): WatchUserEntry | null {
        if (!settings.watch?.enabled) return null;
        const entry = settings.watchUsers?.[userId];
        if (!entry || entry.dismissed) return null;
        return entry;
    }

    private watchJoinCacheKey(guildId: string): string {
        return `anticheat:watch-joins:${guildId}`;
    }

    private readWatchJoins(guildId: string, now: number): WatchJoinRecord[] {
        return readWatchJoinRecords(CacheManager.get(this.watchJoinCacheKey(guildId)), now);
    }

    /** Join cache entry: name + custom-avatar hash are needed for correlation. */
    private recordWatchJoin(guildId: string, member: GuildMember, now: number): void {
        // Bounded: a very large raid must not grow this list without limit.
        const records = this.readWatchJoins(guildId, now)
            .filter((record) => record.userId !== member.id)
            .slice(-2000);
        const displayName = member.displayName || member.user?.username || member.id;
        records.push({
            userId: member.id,
            ts: now,
            displayName,
            normalizedName: normalizeWatchName(displayName) || normalizeWatchName(member.user?.username),
            avatarHash: member.user?.avatar || null,
            accountCreatedAt: Number(member.user?.createdTimestamp) || 0
        });
        CacheManager.set(this.watchJoinCacheKey(guildId), records, WATCH_JOIN_WINDOW_MS);
    }

    /**
     * Comparison set for batch-creation / shared-avatar / similar-name:
     * joins and watch entries from the last 24 h. Clean joiners only qualify
     * while a join burst is in progress (see selectWatchPeers).
     */
    private buildWatchPeers(
        settings: GuildAntiCheatSettings,
        guildId: string,
        excludeUserId: string,
        now: number
    ): ReturnType<typeof selectWatchPeers> {
        const joins = this.readWatchJoins(guildId, now);
        const burstActive = isWatchBurst(joins, now);
        const candidates = new Map<string, WatchPeerCandidate>();

        for (const join of joins) {
            if (join.userId === excludeUserId) continue;
            candidates.set(join.userId, {
                userId: join.userId,
                normalizedName: join.normalizedName || normalizeWatchName(join.displayName),
                avatarHash: join.avatarHash ?? null,
                accountCreatedAt: join.accountCreatedAt || 0,
                joinedAt: join.ts,
                flagged: false
            });
        }

        for (const [userId, entry] of Object.entries(settings.watchUsers || {})) {
            if (userId === excludeUserId || entry.dismissed) continue;
            const since = Date.parse(entry.since || '');
            if (!Number.isFinite(since) || now - since > WATCH_JOIN_WINDOW_MS) continue;
            const createdAt = Date.parse(entry.accountCreatedAt || '');
            const existing = candidates.get(userId);
            candidates.set(userId, {
                userId,
                normalizedName: entry.normalizedName || existing?.normalizedName || '',
                avatarHash: entry.avatarHash ?? existing?.avatarHash ?? null,
                accountCreatedAt: Number.isFinite(createdAt) ? createdAt : (existing?.accountCreatedAt || 0),
                joinedAt: existing?.joinedAt,
                flagged: true
            });
        }

        return selectWatchPeers([...candidates.values()], burstActive);
    }

    /** Lazy check from a member's first processed message (throttled). */
    private async evaluateWatchOnMessage(message: Message, settings: GuildAntiCheatSettings): Promise<void> {
        const guild = message.guild;
        const userId = message.author.id;
        if (!guild || message.author.bot) return;

        const now = Date.now();
        const key = `${guild.id}:${userId}`;
        const existing = settings.watchUsers?.[userId];
        if (!existing) {
            const last = this.watchChecks.get(key) || 0;
            if (now - last < 10 * 60_000) return;
            if (this.watchChecks.size >= 10_000) this.watchChecks.clear();
            this.watchChecks.set(key, now);
        }

        const member = message.member
            || (typeof (guild.members as any)?.fetch === 'function'
                ? await guild.members.fetch(userId).catch(() => null)
                : null);
        if (!member) return;
        await this.evaluateWatchMember(member, this.settingsCache.get(guild.id) || settings, 'message', now);
    }

    /**
     * Classifies a member against the watch signals. Flags, refreshes, or
     * removes the entry, and notifies the log channel when notifyOnFlag is on.
     */
    private async evaluateWatchMember(
        member: GuildMember,
        settings: GuildAntiCheatSettings,
        source: WatchSource,
        now: number = Date.now()
    ): Promise<void> {
        const guild = member.guild;
        if (!guild) return;
        if (!settings.enabled || !settings.watch.enabled) return;
        // Never flag: bots, owner, Administrator/ManageGuild, excluded roles.
        if (member.user?.bot) return;
        if (settings.excludedRoles.some((roleId) => member.roles?.cache?.has(roleId))) return;
        if (member.permissions?.has(PermissionFlagsBits.Administrator)
            || member.permissions?.has(PermissionFlagsBits.ManageGuild)) return;
        const ownerId = guild.ownerId
            || await guild.fetchOwner().then((owner) => owner.id).catch(() => null);
        if (ownerId && member.id === ownerId) return;

        const config = readWatchSettings(settings.watch, DEFAULT_ANTICHEAT_SETTINGS.watch);
        const username = member.user?.username || '';
        const displayName = (member.displayName || member.user?.globalName || username || member.id).trim();
        const accountCreatedAt = Number(member.user?.createdTimestamp) || 0;
        const avatarHash = member.user?.avatar || null;
        const peers = this.buildWatchPeers(settings, guild.id, member.id, now);
        const signals = [...matchWatchSignals({
            userId: member.id,
            username,
            displayName,
            accountCreatedAt,
            avatarHash,
            now,
            newAccountDays: config.newAccountDays,
            peers
        })];

        const latest = this.settingsCache.get(guild.id) || settings;
        const existing = latest.watchUsers?.[member.id] || null;

        // A WebAuth IP/device match is a hard correlation signal: keep it until
        // staff explicitly dismisses the entry, even if none of the heuristic
        // signals match on this re-evaluation.
        if (
            existing
            && !existing.dismissed
            && (existing.source === 'webauth-match' || existing.signals?.includes('webauth-match'))
            && !signals.includes('webauth-match')
        ) {
            signals.push('webauth-match');
        }

        // Nothing matches any more: the auto entry ages out, like the name
        // signals. Dismissed tombstones are dropped as well once clean.
        if (!signals.length) {
            if (existing) {
                delete latest.watchUsers[member.id];
                await this.setSettings(guild.id, latest);
            }
            this.watchChecks.delete(`${guild.id}:${member.id}`);
            return;
        }

        // Staff dismissal holds while the name snapshot is unchanged.
        if (existing?.dismissed && existing.dismissed === displayName) return;

        const previouslyFlagged = !!existing && !existing.dismissed;
        const nextEntry: WatchUserEntry = {
            reason: formatWatchSignals(signals),
            signals,
            since: previouslyFlagged ? existing!.since : new Date(now).toISOString(),
            source: previouslyFlagged ? existing!.source : source,
            nameSnapshot: displayName,
            accountCreatedAt: accountCreatedAt ? new Date(accountCreatedAt).toISOString() : null,
            avatarHash,
            normalizedName: normalizeWatchName(displayName) || normalizeWatchName(username),
            dismissed: null,
            dangerPoints: pruneWatchDangerPoints(existing?.dangerPoints, now),
            lastDangerAt: existing?.lastDangerAt ?? null
        };

        const changed = !previouslyFlagged || JSON.stringify(existing) !== JSON.stringify(nextEntry);
        latest.watchUsers[member.id] = nextEntry;
        if (changed) {
            await this.setSettings(guild.id, latest);
        }
        if (!previouslyFlagged && config.notifyOnFlag) {
            await this.sendWatchFlagLog(guild, latest, member, nextEntry);
        }
        Logger.info(`[WatchUsers] flagged ${member.id} in ${guild.id}: ${nextEntry.reason}`);
    }

    private async sendWatchFlagLog(
        guild: Guild,
        settings: GuildAntiCheatSettings,
        member: GuildMember,
        entry: WatchUserEntry
    ): Promise<void> {
        const logChannel = await this.fetchLogChannel(guild, settings.logChannelId);
        if (!logChannel) return;

        const created = entry.accountCreatedAt ? new Date(entry.accountCreatedAt) : null;
        const ageDays = created ? Math.floor((Date.now() - created.getTime()) / (24 * 60 * 60 * 1000)) : null;
        const signalLines = entry.signals
            .map((signal) => `• ${WATCH_SIGNAL_LABELS[signal as keyof typeof WATCH_SIGNAL_LABELS] || signal} (${signal})`)
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle('🚨 警戒ユーザーを検出')
            .setColor(Colors.Orange)
            .setTimestamp()
            .setDescription('捨てアカウント／一斉作成アカウントの特徴に一致したため、警戒ユーザーとして監視します。')
            .addFields(
                { name: 'ユーザー', value: `${member.user?.tag || member.id}\n${member.id}`, inline: true },
                { name: '表示名 / ユーザー名', value: `${entry.nameSnapshot} / ${member.user?.username || '不明'}`.slice(0, 1024), inline: true },
                { name: 'シグナル', value: (signalLines || entry.reason).slice(0, 1024), inline: false },
                {
                    name: 'アカウント作成日',
                    value: created
                        ? `${created.toISOString()}${ageDays !== null ? `（${ageDays}日前）` : ''}`
                        : '不明',
                    inline: true
                },
                { name: '評価の由来', value: entry.source, inline: true }
            );

        await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    }

    /**
     * Folds applied detection points into the watch entry's rolling 24 h
     * counter. Returns true when the danger-kick pipeline was started (the
     * caller then skips the normal autoTimeout, which the pipeline owns).
     */
    private recordWatchDangerPoints(
        guild: Guild,
        settings: GuildAntiCheatSettings,
        userId: string,
        points: number,
        detections: Detection[],
        messageId?: string
    ): boolean {
        const current = this.settingsCache.get(guild.id) || settings;
        const entry = this.activeWatchEntry(current, userId);
        if (!entry) return false;

        const config = readWatchSettings(current.watch, DEFAULT_ANTICHEAT_SETTINGS.watch);
        const now = Date.now();
        const pruned = pruneWatchDangerPoints(entry.dangerPoints, now);
        pruned.push({
            ts: now,
            points,
            detector: detections.map(({ detector }) => detector).join(','),
            reason: detections
                .flatMap(({ detector, result }) => result.reasons.length ? result.reasons : [detector])
                .join('; ')
                .slice(0, 300)
        });
        current.watchUsers[userId] = { ...current.watchUsers[userId], dangerPoints: pruned };

        const total = watchDangerPointTotal(pruned);
        if (total < config.kickThresholdPoints) {
            this.runDetached(this.setSettings(guild.id, current), `watch-points:${guild.id}:${userId}`);
            return false;
        }

        const key = `${guild.id}:${userId}`;
        if (this.watchDangerTasks.has(key)) return true;
        const snapshotEntry = { ...current.watchUsers[userId], dangerPoints: [...pruned] };
        const task = this.executeWatchDanger(guild, current, userId, snapshotEntry, config, total, messageId)
            .catch((error) => {
                Logger.error(`[WatchUsers] danger handling failed for ${userId} in ${guild.id}:`, error);
            })
            .finally(() => this.watchDangerTasks.delete(key));
        this.watchDangerTasks.set(key, task);
        return true;
    }

    /**
     * Danger rule: purge messages, then kick (unless disabled/protected), then
     * one log embed. A skipped kick falls back to the normal punishment path.
     */
    private async executeWatchDanger(
        guild: Guild,
        settings: GuildAntiCheatSettings,
        userId: string,
        entry: WatchUserEntry,
        config: WatchSettings,
        total: number,
        messageId?: string
    ): Promise<void> {
        const latest = this.settingsCache.get(guild.id) || settings;
        // Staff dismissal / removal cancels the escalation.
        if (!latest.watchUsers?.[userId] || latest.watchUsers[userId].dismissed) return;

        const member = guild.members.cache?.get(userId)
            || await guild.members.fetch(userId).catch(() => null);
        const tag = member?.user?.tag || member?.user?.username || userId;

        // 1. Purge the user's recent messages (runs even when the kick is skipped).
        let purged = 0;
        let purgeError: string | undefined;
        try {
            purged = await this.deleteRecentMessages(guild, userId, config.purgeWindowHours * 3600);
        } catch (error) {
            purgeError = error instanceof Error ? error.message : String(error);
            Logger.warn(`[WatchUsers] purge failed for ${userId} in ${guild.id}: ${purgeError}`);
        }

        // 2. Kick unless gated off or protected.
        let kicked = false;
        let skipReason: string | null = null;
        if (!config.autoKickOnDanger) {
            skipReason = '自動キックが無効（watch.autoKickOnDanger）';
        } else if (!member) {
            skipReason = 'メンバーを取得できない（退出済み）';
        } else {
            const ownerId = guild.ownerId
                || await guild.fetchOwner().then((owner) => owner.id).catch(() => null);
            skipReason = raidKickSkipReason(member, ownerId, latest.excludedRoles);
            if (!skipReason) {
                try {
                    await member.kick(WATCH_KICK_REASON);
                    kicked = true;
                } catch (error: any) {
                    // Already gone by the time the pipeline ran: treat as kicked.
                    if (error?.code === 10007 || error?.code === 10013) kicked = true;
                    else skipReason = `キック失敗: ${error instanceof Error ? error.message : String(error)}`;
                }
            }
        }

        // 3. State: a successful kick removes the entry; a skip restarts the
        // counter so the next threshold window can act again.
        const after = this.settingsCache.get(guild.id) || latest;
        if (kicked) {
            if (this.client) {
                await recordRiskKicksSafely(guild.id, [userId], 'watch-danger', WATCH_KICK_REASON);
            }
            delete after.watchUsers[userId];
            delete after.userTrust[userId];
            after.recentLogs = after.recentLogs.filter((log) => log.userId !== userId);
        } else if (after.watchUsers?.[userId]) {
            after.watchUsers[userId] = {
                ...after.watchUsers[userId],
                dangerPoints: [],
                lastDangerAt: new Date().toISOString()
            };
        }
        if (!kicked) {
            const autoApplied = after.autoTimeout.enabled
                ? await this.executeAutoTimeout(guild, userId, after, messageId).catch(() => false)
                : false;
            await this.setSettings(guild.id, after);
            await this.sendWatchDangerLog(guild, after, {
                userId, tag, entry, points: entry.dangerPoints || [], total, config,
                purged, purgeError, kicked, skipReason, autoApplied
            });
            return;
        }

        await this.setSettings(guild.id, after);
        await this.sendWatchDangerLog(guild, after, {
            userId, tag, entry, points: entry.dangerPoints || [], total, config,
            purged, purgeError, kicked, skipReason: null, autoApplied: false
        });
    }

    private async sendWatchDangerLog(
        guild: Guild,
        settings: GuildAntiCheatSettings,
        report: {
            userId: string;
            tag: string;
            entry: WatchUserEntry;
            points: WatchDangerPoint[];
            total: number;
            config: WatchSettings;
            purged: number;
            purgeError?: string;
            kicked: boolean;
            skipReason: string | null;
            autoApplied: boolean;
        }
    ): Promise<void> {
        const logChannel = await this.fetchLogChannel(guild, settings.logChannelId);
        if (!logChannel) return;

        const pointLines = report.points
            .slice(-8)
            .map((point) => `• ${point.points}点 ${point.detector || '検知'}: ${point.reason || '詳細なし'}`)
            .join('\n');
        const created = report.entry.accountCreatedAt ? new Date(report.entry.accountCreatedAt) : null;
        const resultLine = report.kicked
            ? `キックしました（${WATCH_KICK_REASON}）`
            : `キックをスキップ: ${report.skipReason || '理由不明'}${report.autoApplied ? '\n通常の自動タイムアウトを適用しました。' : ''}`;

        const embed = new EmbedBuilder()
            .setTitle(report.kicked ? '🚨 警戒ユーザーを危険判定によりキック' : '🚨 警戒ユーザーの危険判定（キックなし）')
            .setColor(report.kicked ? Colors.Red : Colors.Orange)
            .setTimestamp()
            .setDescription(`${report.purged} 件のメッセージを削除しました（${report.config.purgeWindowHours}時間以内）。`)
            .addFields(
                { name: 'ユーザー', value: `${report.tag}\n${report.userId}`, inline: true },
                { name: '警戒理由', value: report.entry.reason.slice(0, 1024), inline: false },
                { name: `蓄積ポイント（24時間）`, value: `${report.total} / ${report.config.kickThresholdPoints}`, inline: true },
                { name: 'アカウント作成日', value: created ? created.toISOString() : '不明', inline: true },
                { name: 'メッセージ削除', value: `${report.purged} 件${report.purgeError ? `（一部失敗: ${report.purgeError}）` : ''}`, inline: false },
                { name: 'トリガー検知', value: (pointLines || '記録なし').slice(0, 1024), inline: false },
                { name: '結果', value: resultLine.slice(0, 1024), inline: false }
            );

        await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    }

    /** Entries for the Staff 警戒ユーザー section (dismissed ones excluded). */
    async getWatchUsers(guildId: string): Promise<Array<WatchUserEntry & { userId: string; dangerPoints24h: number }>> {
        const settings = await this.getSettings(guildId);
        const now = Date.now();
        return Object.entries(settings.watchUsers || {})
            .filter(([, entry]) => !entry.dismissed)
            .map(([userId, entry]) => {
                const dangerPoints = pruneWatchDangerPoints(entry.dangerPoints, now);
                return {
                    userId,
                    ...entry,
                    dangerPoints,
                    dangerPoints24h: watchDangerPointTotal(dangerPoints)
                };
            })
            .sort((left, right) => new Date(right.since).getTime() - new Date(left.since).getTime());
    }

    /** Staff dismissal: the current name snapshot is not re-flagged. */
    async dismissWatchUser(guildId: string, userId: string, nameSnapshot?: string): Promise<boolean> {
        const settings = await this.getSettings(guildId);
        if (!settings.watchUsers?.[userId]) return false;
        const latest = this.settingsCache.get(guildId) || settings;
        latest.watchUsers[userId] = {
            ...latest.watchUsers[userId],
            dismissed: nameSnapshot || latest.watchUsers[userId].nameSnapshot
        };
        await this.setSettings(guildId, latest);
        Logger.info(`[WatchUsers] dismissed ${userId} in ${guildId}`);
        return true;
    }

    /**
     * Correlation flag from the WebAuth flow. Sticky until staff dismisses it
     * (see the webauth-match preservation in evaluateWatchMember).
     */
    async flagWatchUserFromWebAuth(
        guildId: string,
        userId: string,
        details: { matchCount: number; matches: WebAuthMatch[] }
    ): Promise<boolean> {
        const settings = await this.getSettings(guildId);
        if (!settings.enabled) return false;

        const guild = this.client
            ? (this.client.guilds.cache.get(guildId) || await this.client.guilds.fetch(guildId).catch(() => null))
            : null;
        const member = guild
            ? (guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null))
            : null;

        const latest = this.settingsCache.get(guildId) || settings;
        const existing = latest.watchUsers?.[userId] || null;
        const now = Date.now();
        const displayName = (member?.displayName || existing?.nameSnapshot || '').trim();
        const createdAt = Number(member?.user?.createdTimestamp) || 0;

        latest.watchUsers[userId] = {
            reason: 'webauth-match',
            signals: ['webauth-match'],
            since: existing && !existing.dismissed ? existing.since : new Date(now).toISOString(),
            source: 'webauth-match',
            nameSnapshot: displayName,
            accountCreatedAt: createdAt ? new Date(createdAt).toISOString() : (existing?.accountCreatedAt ?? null),
            avatarHash: member?.user?.avatar ?? existing?.avatarHash ?? null,
            normalizedName: normalizeWatchName(displayName) || normalizeWatchName(member?.user?.username) || existing?.normalizedName || '',
            dismissed: null,
            dangerPoints: existing?.dangerPoints || [],
            lastDangerAt: existing?.lastDangerAt ?? null
        };
        await this.setSettings(guildId, latest);
        Logger.info(`[WatchUsers] flagged ${userId} in ${guildId} via webauth-match (${details.matchCount} matches)`);
        return true;
    }

    /** One log embed naming the matched accounts and hash types; never raw values. */
    async sendWebAuthCorrelationLog(
        guildId: string,
        userId: string,
        matches: WebAuthMatch[]
    ): Promise<void> {
        if (!matches.length) return;
        const guild = this.client
            ? (this.client.guilds.cache.get(guildId) || await this.client.guilds.fetch(guildId).catch(() => null))
            : null;
        if (!guild) return;
        const settings = this.settingsCache.get(guildId) || await this.getSettings(guildId);
        const logChannel = await this.fetchLogChannel(guild, settings.logChannelId);
        if (!logChannel) return;

        const selfMember = guild.members.cache.get(userId)
            || await guild.members.fetch(userId).catch(() => null);
        const riskLabels: Record<string, string> = {
            'raid-kick': 'AntiRaidでキック済み',
            'watch-danger-kick': '警戒ユーザーの危険判定でキック済み',
            'watch-flagged': '現在の警戒ユーザー'
        };
        const lines: string[] = [];
        for (const match of matches.slice(0, 15)) {
            const member = guild.members.cache.get(match.userId)
                || await guild.members.fetch(match.userId).catch(() => null);
            const label = member?.user?.tag || member?.user?.username || match.userId;
            const hashes = [
                match.hashTypes.includes('ip') ? 'IP' : '',
                match.hashTypes.includes('fp') ? '端末' : ''
            ].filter(Boolean).join('・');
            const risks = match.risks.map((risk) => riskLabels[risk] || risk).join(' / ');
            lines.push(`• ${label} (${match.userId})\n  一致: ${hashes || '不明'} / 理由: ${risks || '不明'}`);
        }

        const embed = new EmbedBuilder()
            .setTitle('🚨 Web認証で同一IP/端末の警戒アカウントと一致')
            .setColor(Colors.Red)
            .setTimestamp()
            .setDescription('Web認証されたアカウントが、キック済みまたは警戒中のアカウントと同一のIP/端末ハッシュを持っています。')
            .addFields(
                {
                    name: '認証したユーザー',
                    value: `${selfMember?.user?.tag || userId}\n${userId}`.slice(0, 1024),
                    inline: true
                },
                { name: '一致したアカウント数', value: `${matches.length}`, inline: true },
                { name: '一致したアカウント', value: lines.join('\n').slice(0, 1024), inline: false }
            );

        await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    }

    async onGuildMemberUpdate(oldMember: GuildMember, newMember: GuildMember): Promise<void> {
        // Nickname / display-name changes are a 警戒ユーザー re-evaluation point:
        // an auto flag is removed once none of the signals match any more, and a
        // dismissed flag re-applies when the name changes and still matches.
        const nameChanged = oldMember.displayName !== newMember.displayName
            || oldMember.user?.username !== newMember.user?.username;
        const avatarChanged = oldMember.avatar !== newMember.avatar;
        const settings = await this.getSettings(newMember.guild.id);
        if ((nameChanged || avatarChanged) && settings.enabled && settings.watch.enabled && !newMember.user?.bot) {
            await this.evaluateWatchMember(newMember, settings, 'member-update').catch((error) => {
                Logger.warn(`[WatchUsers] re-evaluation failed for ${newMember.id}: ${String(error)}`);
            });
        }

        if (!avatarChanged || !settings.avatarLogChannelId) {
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
        if (this.deletedMessages.size >= 10000) this.deletedMessages.delete(this.deletedMessages.keys().next().value!);
        this.deletedMessages.set(message.id, Date.now());
        this.cancelContentRetry(message.id);
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
        oldMessage = oldMessage.partial ? oldMessage : snapshotMessage(oldMessage as Message);
        const resolvedNewMessage = newMessage.partial
            ? await this.fetchMessageIfPartial(newMessage) : snapshotMessage(newMessage as Message);
        // Includes delayed URL embeds. Content moderation must run even with chat logging disabled.
        if (!resolvedNewMessage.partial && resolvedNewMessage.author && !resolvedNewMessage.author.bot) {
            await this.onMessage(resolvedNewMessage as Message);
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

    private async detectMessage(
        message: Message,
        settings: GuildAntiCheatSettings,
        receivedAt: number,
        names: string[],
        isCurrent: () => boolean
    ): Promise<Detection[]> {
        const guildId = message.guild!.id;
        const userId = message.author.id;
        const currentTrust = settings.userTrust[userId] || {
            score: 0,
            lastUpdated: new Date().toISOString(),
            history: []
        };
        // 警戒ユーザー never get trust-based leniency in detector context.
        const watched = this.activeWatchEntry(settings, userId);
        const context = {
            guildId,
            userId,
            channelId: message.channel.id,
            userTrustScore: watched ? 0 : currentTrust.score,
            settings,
            receivedAt,
            isMessageDeleted: () => !isCurrent()
        };
        const detectorTasks: Array<Promise<{ detector: string; result: DetectionResult } | null>> = [];

        for (const name of names) {
            const detector = this.detectors.get(name);
            if (!detector) continue;
            if (detectorExcluded(message, settings, name)) continue;
            const detectorConfig = settings.detectors[name];
            if (!detectorConfig?.enabled) {
                continue;
            }

            const aiStartedAt = Date.now();
            detectorTasks.push(
                Promise.resolve().then(() => detector.detect(message, context))
                    .then((result) => {
                        if (name === 'contentSafety') {
                            this.cancelContentRetry(message.id);
                            if (settings.aiLogChannelId) {
                                this.runDetached(this.sendAiDecisionLog(message, settings.aiLogChannelId, result, Date.now() - aiStartedAt), 'AI decision log');
                            }
                        }
                        if (!hasMeaningfulDetection(result)) {
                            return null;
                        }

                        return { detector: name, result };
                    })
                    .catch((error) => {
                        if (name === 'contentSafety') this.scheduleContentRetry(message, error);
                        if (name === 'contentSafety' && settings.aiLogChannelId) {
                            this.runDetached(this.sendAiDecisionLog(message, settings.aiLogChannelId, {
                                scoreDelta: 0, reasons: [], metadata: error?.auditMetadata,
                            }, Date.now() - aiStartedAt, contentFailureReason(error)), 'AI failure log');
                        }
                        Logger.error(`Detector ${name} failed:`, error);
                        return null;
                    })
            );
        }

        return (await Promise.all(detectorTasks))
            .filter((entry): entry is { detector: string; result: DetectionResult } => entry !== null);
    }

    private async applyDetections(
        message: Message, settings: GuildAntiCheatSettings, detectionResults: Detection[],
        detectionStartedAt: number, revision: string, realtime: boolean, current: () => boolean
    ): Promise<boolean> {
        const guildId = message.guild!.id;
        const userId = message.author.id;
        // A gateway delete event may arrive while AI or media processing is in
        // flight. Do not repost, score, log, notify, or otherwise act on it.
        const isCurrent = () => current()
            && this.moderationClaims.get(message.id) !== revision;
        if (!isCurrent()) return false;

        // Slow results may be stale. Realtime rules use gateway state and send
        // DELETE directly; an extra GET would delay containment and double REST load.
        if (!realtime && typeof message.fetch === 'function') {
            let fresh: Message;
            try { fresh = await message.fetch(); }
            catch (error: any) {
                if (error?.code === 10008 || /Unknown Message/i.test(String(error))) {
                    this.deletedMessages.set(message.id, Date.now());
                } else {
                    Logger.warn(`AntiCheat revalidation failed for ${message.id}: ${String(error)}`);
                    this.scheduleContentRetry(message, error);
                }
                return false;
            }
            if (messageRevision(snapshotMessage(fresh)) !== revision) return false;
        }
        if (!isCurrent()) return false;
        settings = this.settingsCache.get(guildId) || settings;
        if (!settings.enabled || exclusionChannelIds(message).some(id => settings.excludedChannels.includes(id))) return false;
        if (settings.excludedRoles.some(id => message.member?.roles.cache.has(id))) return false;
        detectionResults = detectionResults.filter(({ detector }) => settings.detectors[detector]?.enabled && !detectorExcluded(message, settings, detector));
        if (!detectionResults.length) return false;
        if (!this.moderationClaims.has(message.id) && this.moderationClaims.size >= 10_000)
            this.moderationClaims.delete(this.moderationClaims.keys().next().value!);
        this.moderationClaims.set(message.id, revision);
        const decisionLatencyMs = Date.now() - detectionStartedAt;

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
        let messageGone = false;
        let deleteError: string | undefined;
        const messageDeleted = replacementId || contentDeleted ? true : shouldDeleteMessage
            ? await message.delete().then(() => true).catch(error => {
                messageGone = error?.code === 10008;
                if (!messageGone) {
                    deleteError = String(error);
                    Logger.warn(`AntiCheat delete failed for ${message.id}: ${deleteError}`);
                }
                return false;
            })
            : false;
        if (messageGone) { this.deletedMessages.set(message.id, Date.now()); return false; }
        if (messageDeleted) {
            if (this.replacedMessages.size >= 10000) this.replacedMessages.delete(this.replacedMessages.keys().next().value!);
            this.replacedMessages.set(message.id, Date.now());
        }
        const detectedAt = new Date().toISOString();
        const detectionLatencyMs = Date.now() - detectionStartedAt;
        // Other detections can commit while this message's DELETE is pending.
        settings = this.settingsCache.get(guildId) || settings;
        const watchEntry = this.activeWatchEntry(settings, userId);
        const watchMarker = watchEntry ? `【🚨警戒ユーザー】${watchEntry.reason}` : null;

        for (const { detector, result } of detectionResults) {
            const reason = [...result.reasons, ...(result.aiExplanation ? [`AI理由：${result.aiExplanation}`] : [])].join('; ') || '検知';
            this.appendLog(settings, {
                userId,
                messageId: message.id,
                detector,
                scoreDelta: result.scoreDelta,
                reason: watchMarker ? `${watchMarker} / ${reason}` : reason,
                timestamp: detectedAt,
                status: 'active',
                metadata: {
                    channelId: message.channel.id,
                    deletedMessage: messageDeleted,
                    deleteError,
                    decisionLatencyMs,
                    processingLane: realtime ? 'realtime' : 'background',
                    contentPreview: repost || contentDeletion ? '[コンテンツ保護]' : message.content.slice(0, 160),
                    ...(contentDeletion ? { contentDeleted, contentDeleteError } : {}),
                    ...(repost ? { replacementId, replacementError } : {}),
                    detectionLatencyMs,
                    ...(watchEntry ? { watchUser: true, watchReason: watchEntry.reason, watchSignals: watchEntry.signals } : {}),
                    ...(result.metadata || {})
                }
            });

            if (result.publicNotice && settings.detectors[detector]?.notifyChannel) {
                const noticeTask = this.sendPublicNotice(message, result.publicNotice);
                this.runDetached(noticeTask, `public-notice:${guildId}:${message.id}:${detector}`);
            }
        }

        // Rolling watch counter uses the APPLIED points (same total as the
        // trust adjustment below) and can escalate to the danger kick.
        const watchDanger = totalScoreDelta > 0 && watchEntry
            ? this.recordWatchDangerPoints(message.guild!, settings, userId, totalScoreDelta, detectionResults, message.id)
            : false;

        if (totalScoreDelta > 0) {
            const trustTask = this.applyTrustAdjustment(
                settings,
                guildId,
                userId,
                totalScoreDelta,
                detectionResults
                    .flatMap(({ detector, result }) => result.reasons.length ? result.reasons : [detector])
                    .join('; ')
            );
            // On a danger event the kick pipeline owns the fallback punishment.
            if (settings.autoTimeout.enabled && !watchDanger) {
                const key = `${guildId}:${userId}`;
                if (!this.timeoutTasks.has(key)) {
                    const task = this.executeAutoTimeout(message.guild!, userId, settings, message.id)
                        .then(async applied => {
                            if (applied) await this.setSettings(guildId, this.settingsCache.get(guildId) || settings);
                            return applied;
                        })
                        .finally(() => this.timeoutTasks.delete(key));
                    this.timeoutTasks.set(key, task);
                    this.runDetached(task, `auto-timeout:${key}`);
                }
            }
            this.runDetached(trustTask.then(() => this.setSettings(guildId, this.settingsCache.get(guildId) || settings)),
                `trust-adjustment:${guildId}:${userId}`);

            if (settings.autoDelete.enabled && !repost && !contentDeletion) {
                const key = `${guildId}:${userId}`;
                if (!this.recentDeletionTasks.has(key)) {
                    const task = this.deleteRecentMessages(message.guild!, userId, settings.autoDelete.windowSeconds)
                        .then((deleted) => {
                            Logger.info(`Auto-deleted ${deleted} messages for user ${userId} in guild ${guildId}`);
                            return deleted;
                        }).finally(() => this.recentDeletionTasks.delete(key));
                    this.recentDeletionTasks.set(key, task);
                    this.runDetached(task, `delete-recent:${key}`);
                }
            }
        }

        this.runDetached(this.setSettings(guildId, settings), `set-settings:${guildId}:${message.id}`);
        const summaryTask = this.sendDetectionSummary(message.guild!, message, settings, totalScoreDelta, detectionResults);
        this.runDetached(summaryTask, `detection-summary:${guildId}:${message.id}`);
        return true;
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
        const watchEntry = this.activeWatchEntry(settings, message.author.id);
        if (watchEntry) {
            embed.addFields({
                name: '🚨警戒ユーザー',
                value: `${watchEntry.reason}\n登録: ${new Date(watchEntry.since).toISOString()} / 由来: ${watchEntry.source}`.slice(0, 1024),
                inline: false
            });
        }
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
        const member = guild.members.cache?.get(userId) || await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            return false;
        }

        const action: PunishmentAction = {
            type: 'timeout',
            durationSeconds: settings.autoTimeout.durationSeconds,
            reasonTemplate: 'Auto timeout: AntiCheat violation detected',
            notify: false
        };

        const applied = (member.communicationDisabledUntilTimestamp || 0) > Date.now() + 1000
            || await PunishmentExecutor.execute(member, action);
        if (applied && messageId) {
            settings = this.settingsCache.get(guild.id) || settings;
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
                this.runDetached(this.enqueueSettingsWrite(guildId, normalized), `settings-migration:${guildId}`);
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
        // 警戒ユーザー gain no positive trust; penalties still apply.
        const watched = this.activeWatchEntry(settings, userId);
        const appliedDelta = watched ? Math.min(0, delta) : delta;
        const nextScore = Math.max(0, previousScore + appliedDelta);

        settings.userTrust[userId] = {
            score: nextScore,
            lastUpdated: new Date().toISOString(),
            history: [
                ...currentTrust.history,
                {
                    delta: appliedDelta,
                    reason: watched && delta > 0 ? `${reason}（警戒ユーザーのため加点停止）` : reason,
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
                    const latest = this.settingsCache.get(guildId) || settings;
                    delete latest.userTrust[userId];
                    latest.recentLogs = latest.recentLogs.filter((entry) => entry.userId !== userId);
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
            aiLogChannelId: settings?.aiLogChannelId ?? null,
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
            watch: readWatchSettings(settings?.watch, DEFAULT_ANTICHEAT_SETTINGS.watch),
            userTrust: settings?.userTrust || {},
            watchUsers: normalizeWatchUserEntries(settings?.watchUsers),
            recentLogs: Array.isArray(settings?.recentLogs) ? settings.recentLogs.slice(-this.MAX_LOGS) : []
        };

        // Migrate the former overly-sensitive image default. This also makes
        // existing guilds receive the balanced setting without a manual save.
        const contentConfig = normalized.detectors.contentSafety?.config;
        if (contentConfig?.imageSuggestiveThreshold === 0.2) {
            contentConfig.imageSuggestiveThreshold = 0.65;
        }

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

    private async sendAiDecisionLog(message: Message, channelId: string, result: DetectionResult, elapsedMs: number, error?: string): Promise<void> {
        if (!message.guild) return;
        const channel = await this.fetchLogChannel(message.guild, channelId);
        if (!channel || typeof channel.send !== 'function') return;
        const metadata = result.metadata || {};
        const analyses = Array.isArray(metadata.analyses) ? metadata.analyses : [];
        const status = error ? '判定失敗（安全判定ではありません）'
            : metadata.stoppedBecauseDeleted ? '投稿削除により中止'
            : result.reasons.length ? '検知あり'
            : metadata.errors?.length ? '一部の判定が未完了'
            : analyses.length ? '検知なし' : '判定対象なし';
        const explanations = analyses.map((item: any) => `${item.source}: ${item.scores?.explanation || '理由の返却なし'}`);
        const requests = metadata.requests || analyses.flatMap((item: any) => item.requests || []);
        const thresholds = metadata.thresholds || {};
        const scoreLines = analyses.map((item: any) => {
            const isImage = item.source !== 'text';
            const scores = item.scores || {};
            const enabled = new Set(Array.isArray(metadata.enabledCategories) ? metadata.enabledCategories : CONTENT_CATEGORIES);
            const values = CONTENT_CATEGORIES
                .filter(category => enabled.has(category) && typeof scores[category] === 'number')
                .map(category => {
                    const threshold = category === 'suggestive'
                        ? (isImage ? thresholds.imageSuggestive : thresholds.textSuggestive)
                        : (isImage ? thresholds.image : thresholds.text);
                    const thresholdText = typeof threshold === 'number' ? threshold.toFixed(2) : '?';
                    return `${CONTENT_LABELS[category]} ${scores[category].toFixed(2)}/${thresholdText}`;
                });
            const matched = Array.isArray(item.matchedCategories) && item.matchedCategories.length
                ? item.matchedCategories.map((category: string) => CONTENT_LABELS[category as keyof typeof CONTENT_LABELS] || category).join('、')
                : 'なし';
            return `${item.source}: ${values.join('｜') || 'スコア取得不可'}\n検知: ${matched}`;
        });
        const count = (key: string) => requests.length && requests.every((item: any) => typeof item[key] === 'number')
            ? requests.reduce((sum: number, item: any) => sum + item[key], 0).toString() : '取得不可';
        const details = {
            loggedAt: new Date().toISOString(), guildId: message.guild.id,
            channelId: message.channelId, messageId: message.id, userId: message.author.id,
            messageUrl: message.url, status, totalElapsedMs: elapsedMs,
            reasons: result.reasons, appliedPoints: result.scoreDelta, error,
            ...metadata,
        };
        const embed = new EmbedBuilder()
            .setTitle('AI判定ログ')
            .setColor(error ? Colors.Orange : result.reasons.length ? Colors.Red : Colors.Blue)
            .setTimestamp()
            .setDescription((error || explanations.join('\n') || status).slice(0, 2000))
            .addFields(
                { name: '判定', value: status, inline: true },
                { name: 'モデル', value: String(metadata.model || '取得不可').slice(0, 100), inline: true },
                { name: '経過時間（待機含む）', value: `${(elapsedMs / 1000).toFixed(3)} 秒`, inline: true },
                { name: '投稿', value: `[メッセージ](${message.url})\nユーザーID: ${message.author.id}`, inline: false },
                { name: 'カテゴリ別スコア / しきい値', value: (scoreLines.join('\n') || '判定スコアなし').slice(0, 1024), inline: false },
                { name: 'トークン（入力 / 出力 / 合計）', value: `${count('inputTokens')} / ${count('outputTokens')} / ${count('totalTokens')}`, inline: false },
                { name: 'tok/s（出力数 ÷ リクエスト全体時間）', value: (requests.map((item: any, index: number) => `${index + 1}: ${typeof item.tokensPerSecond === 'number' ? item.tokensPerSecond.toFixed(2) : '取得不可'}`).join(' / ') || 'API呼び出しなし').slice(0, 1024), inline: false },
                { name: 'キャッシュ', value: (analyses.map((item: any) => `${item.source}: ${item.cache}`).join(' / ') || 'なし').slice(0, 1024), inline: false },
                { name: '加点 / リクエスト数', value: `${result.scoreDelta} 点 / ${requests.length} 回`, inline: true },
            );
        await channel.send({
            embeds: [embed], allowedMentions: { parse: [] },
            files: [new AttachmentBuilder(Buffer.from(JSON.stringify(details, null, 2), 'utf8'), { name: `ai-decision-${message.id}.json` })],
        });
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
