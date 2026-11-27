import {
    ChannelType,
    Client,
    Colors,
    EmbedBuilder,
    Events,
    Guild,
    OverwriteType,
    PermissionsBitField,
    Routes,
    TextChannel,
    type ColorResolvable,
    type GuildMember,
    type Role
} from 'discord.js';
import { Logger } from '../../utils/Logger.js';
import { database } from '../persistence/Database.js';
import { antiCheatManager } from './AntiCheatManager.js';
import { antiNukeManager, ANTINUKE_SNAPSHOTS_KEY } from './AntiNukeManager.js';
import { discordErrorInfo, type AntiNukeSettings } from './AntiNuke.js';
import {
    DEFAULT_SNAPSHOT_KEEP,
    DISCORD_CHANNEL_LIMIT,
    DISCORD_ROLE_LIMIT,
    RESTORE_LIMITATIONS,
    THREAD_CHANNEL_TYPES,
    addSnapshotToIndex,
    applyIdMap,
    capacityNotes,
    countSnapshot,
    emptyRestoreReport,
    finalizeRestoreReport,
    formatRestoreTotals,
    normalizeSnapshot,
    planRestoreOrder,
    readSnapshotIndex,
    recordRestore,
    selectRebanTargets,
    selectUnbanTargets,
    SNAPSHOT_VERSION,
    snapshotMeta,
    type GuildSnapshot,
    type RestoreReport,
    type RoleIdMap,
    type SnapshotBan,
    type SnapshotChannel,
    type SnapshotCounts,
    type SnapshotEmoji,
    type SnapshotIndex,
    type SnapshotMemberRoles,
    type SnapshotRole,
    type SnapshotTrigger,
    type UnbanSelection
} from './GuildSnapshot.js';

/** Snapshot documents and restore jobs live in the bot DB, outside Discord. */export const ANTINUKE_SNAPSHOT_DOC_KEY = (guildId: string, snapshotId: string) =>
    `Guild/${guildId}/antinuke/snapshot/${snapshotId}`;
export const ANTINUKE_RESTORE_JOBS_KEY = (guildId: string) => `Guild/${guildId}/antinuke/restores`;

const MAX_RESTORE_JOBS = 5;
const SCHEDULER_TICK_MS = 5 * 60_000;
/** Sequential creates with a small gap; Discord's REST layer owns 429 retries. */
const RESTORE_PACE_MS = 250;
const BAN_FETCH_LIMIT = 1000;

export type RestoreJobStatus = 'running' | 'done' | 'failed';

export interface RestoreOptions {
    /** Lift bans the attack added (default true). */
    unbanAdded: boolean;
    /** Explicit opt-in only: re-ban users the snapshot listed that are unbanned now. */
    rebanSnapshotBans: boolean;
    /** Incident ids that define the attack window; empty = every open incident. */
    incidentIds: string[];
}

export interface RestoreJob {
    id: string;
    guildId: string;
    snapshotId: string;
    safetySnapshotId: string | null;
    status: RestoreJobStatus;
    startedAt: string;
    finishedAt: string | null;
    requestedBy: string | null;
    options: RestoreOptions;
    phase: string;
    progress: { done: number; total: number };
    report: RestoreReport | null;
    error: string | null;
}

export interface RestorePreview {
    snapshotId: string;
    guildName: string;
    createdAt: string;
    ageSeconds: number;
    counts: SnapshotCounts;
    recreate: {
        roles: number;
        categories: number;
        channels: number;
        emojis: number;
        memberRoleHolders: number;
        bansInSnapshot: number;
    };
    limitations: string[];
    notes: string[];
    unban: UnbanSelection;
    rebanCandidates: string[];
    incidentWindowStart: string;
    incidents: Array<{ id: string; rule: string; detectedAt: string; windowStart: string }>;
}

const DEFAULT_RESTORE_OPTIONS: RestoreOptions = {
    unbanAdded: true,
    rebanSnapshotBans: false,
    incidentIds: []
};

/**
 * AntiNuke snapshot + restore manager (brief AN2).
 *
 * Snapshots are captured per guild (scheduled every N hours, on demand, and
 * automatically before a restore) into the bot's Database, so they survive the
 * bot being kicked. Restores run as a tracked background job: the request
 * returns a job id immediately and the staff UI polls progress.
 */
export class SnapshotManager {
    private client: Client | null = null;
    private wired = false;
    private timer: ReturnType<typeof setInterval> | null = null;
    private writes = new Map<string, Promise<void>>();
    private running = new Set<string>();
    private now: () => number = () => Date.now();
    private paceMs = RESTORE_PACE_MS;
    private incidentSource: (guildId: string) => Promise<IncidentLike[]> =
        (guildId) => antiNukeManager.readIncidents(guildId);
    private incidentCloser: (guildId: string, ids: string[]) => Promise<number> =
        (guildId, ids) => antiNukeManager.markIncidentsRestored(guildId, ids);

    setClient(client: Client): void {
        this.client = client;
        if (this.wired) return;
        this.wired = true;
        const start = () => this.startScheduler();
        if (client.isReady()) queueMicrotask(start);
        else client.once(Events.ClientReady, start);
        client.on(Events.GuildCreate, (guild: Guild) => {
            // Only the first snapshot for a guild is taken on join. A rejoin
            // after a self-kick must not replace the pre-attack snapshot that
            // AN1's rejoin notice points at.
            void this.readIndex(guild.id)
                .then(async (index) => {
                    if (index.snapshots.length) return;
                    await this.captureAndStore(guild, 'scheduled', null);
                })
                .catch((error) => {
                    Logger.debug(`[Snapshot] initial capture failed guild=${guild.id}: ${String(error)}`);
                });
        });
    }

    /** Test seam: replace the clock. */
    setClock(now: () => number): void {
        this.now = now;
    }

    /** Test seam: pause between sequential creates (default 250 ms). */
    setPaceMs(ms: number): void {
        this.paceMs = Math.max(0, ms);
    }

    /** Test seam: replace the incident reader (default: AntiNuke incidents). */
    setIncidentSource(source: (guildId: string) => Promise<IncidentLike[]>): void {
        this.incidentSource = source;
    }

    /** Test seam: replace the incident closer (default: AntiNuke incidents). */
    setIncidentCloser(closer: (guildId: string, ids: string[]) => Promise<number>): void {
        this.incidentCloser = closer;
    }

    isRestoring(guildId: string): boolean {
        return this.running.has(guildId);
    }

    private startScheduler(): void {
        if (this.timer) return;
        const tick = () => {
            void this.runScheduledPass().catch((error) => {
                Logger.warn(`[Snapshot] scheduled pass failed: ${String(error)}`);
            });
        };
        this.timer = setInterval(tick, SCHEDULER_TICK_MS);
        this.timer.unref?.();
        tick();
    }

    private async getSettings(guildId: string): Promise<AntiNukeSettings> {
        return (await antiCheatManager.getSettings(guildId)).antiNuke;
    }

    /**
     * Capture every guild whose newest snapshot is older than its interval.
     * A guild with no snapshot is captured on the first tick, which is also how
     * AN1's rejoin announcement gets a real snapshot id.
     */
    async runScheduledPass(): Promise<string[]> {
        const client = this.client;
        if (!client?.isReady()) return [];
        const captured: string[] = [];
        for (const guild of client.guilds.cache.values()) {
            try {
                const settings = await this.getSettings(guild.id);
                if (!settings.snapshots.enabled) continue;
                const index = await this.readIndex(guild.id);
                const latest = index.snapshots[0];
                const intervalMs = settings.snapshots.intervalHours * 60 * 60 * 1000;
                if (latest && this.now() - Date.parse(latest.createdAt) < intervalMs) continue;
                if (this.running.has(guild.id)) continue;
                await this.captureAndStore(guild, 'scheduled', null, settings);
                captured.push(guild.id);
            } catch (error) {
                Logger.warn(`[Snapshot] scheduled capture failed guild=${guild.id}: ${String(error)}`);
            }
        }
        return captured;
    }

    // ------------------------------------------------------------------
    // Capture (brief AN2 §A)
    // ------------------------------------------------------------------

    async captureGuild(
        guild: Guild,
        trigger: SnapshotTrigger,
        requestedBy: string | null,
        settingsOverride?: AntiNukeSettings
    ): Promise<GuildSnapshot> {
        const settings = settingsOverride ?? await this.getSettings(guild.id);
        const snapshotSettings = settings.snapshots;
        const warnings: string[] = [];
        const createdAt = new Date(this.now()).toISOString();
        const id = `snap-${guild.id}-${this.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const roles = await guild.roles.fetch();
        const capturedRoles: SnapshotRole[] = [];
        for (const role of roles.values()) {
            capturedRoles.push({
                id: role.id,
                name: role.name,
                permissions: role.permissions.bitfield.toString(),
                color: role.color,
                hoist: role.hoist,
                mentionable: role.mentionable,
                position: role.position,
                everyone: role.id === guild.id,
                managed: role.managed,
                unicodeEmoji: role.unicodeEmoji ?? null,
                iconUrl: safeRoleIconUrl(role)
            });
        }

        const channels = await guild.channels.fetch();
        const capturedChannels: SnapshotChannel[] = [];
        for (const channel of channels.values()) {
            if (!channel) continue;
            if (THREAD_CHANNEL_TYPES.includes(channel.type)) continue;
            capturedChannels.push({
                id: channel.id,
                name: channel.name,
                type: channel.type,
                topic: 'topic' in channel ? (channel.topic as string | null) ?? null : null,
                position: channel.position,
                parentId: channel.parentId ?? null,
                overwrites: channel.permissionOverwrites.cache.map((overwrite) => ({
                    targetId: overwrite.id,
                    type: overwrite.type === OverwriteType.Role ? 'role' : 'member',
                    allow: overwrite.allow.bitfield.toString(),
                    deny: overwrite.deny.bitfield.toString()
                })),
                nsfw: 'nsfw' in channel ? Boolean(channel.nsfw) : false,
                rateLimitPerUser: 'rateLimitPerUser' in channel
                    ? (channel.rateLimitPerUser as number | null) ?? null
                    : null,
                bitrate: 'bitrate' in channel ? Number(channel.bitrate) : null,
                userLimit: 'userLimit' in channel ? Number(channel.userLimit) : null,
                rtcRegion: 'rtcRegion' in channel ? (channel.rtcRegion as string | null) ?? null : null,
                forumTags: 'availableTags' in channel && Array.isArray(channel.availableTags)
                    ? channel.availableTags.map((tag: { name: string }) => tag.name)
                    : []
            });
        }

        const emojis: SnapshotEmoji[] = [];
        if (snapshotSettings.includeEmojis) {
            const fetched = await guild.emojis.fetch().catch(() => null);
            if (fetched) {
                for (const emoji of fetched.values()) {
                    emojis.push({
                        id: emoji.id,
                        name: emoji.name ?? null,
                        url: emoji.imageURL({ size: 128 }),
                        animated: emoji.animated === true
                    });
                }
            } else {
                warnings.push('絵文字一覧を取得できませんでした');
            }
        }

        const bans: SnapshotBan[] = [];
        let bansTruncated = false;
        if (snapshotSettings.includeBans) {
            const fetched = await guild.bans.fetch({ limit: BAN_FETCH_LIMIT }).catch(() => null);
            if (fetched) {
                for (const ban of fetched.values()) {
                    bans.push({ userId: ban.user.id, reason: ban.reason ?? null });
                }
                bansTruncated = fetched.size >= BAN_FETCH_LIMIT;
                if (bansTruncated) warnings.push(`BAN一覧は${BAN_FETCH_LIMIT}件で打ち切りました`);
            } else {
                warnings.push('BAN一覧を取得できませんでした（BANメンバー権限を確認してください）');
            }
        }

        const memberRoles: SnapshotMemberRoles[] = [];
        let membersScanned = 0;
        let memberRolesTruncated = false;
        if (snapshotSettings.includeMemberRoles) {
            const cap = snapshotSettings.memberRoleCap;
            let after: string | undefined;
            while (membersScanned < cap) {
                const page = await guild.members.list({
                    limit: Math.min(1000, cap - membersScanned),
                    after
                }).catch(() => null);
                if (!page || page.size === 0) break;
                for (const member of page.values()) {
                    membersScanned += 1;
                    const roleIds = member.roles.cache
                        .filter((role: Role) => role.id !== guild.id && !role.managed)
                        .map((role: Role) => role.id);
                    if (roleIds.length) memberRoles.push({ memberId: member.id, roleIds });
                }
                after = page.last()?.id;
                if (page.size < 1000) break;
            }
            if (guild.memberCount > membersScanned) memberRolesTruncated = true;
            if (memberRolesTruncated) {
                warnings.push(`メンバーのロールは${membersScanned}人まで取得しました（上限${cap}人）`);
            }
        } else {
            warnings.push('メンバーのロール割り当ては設定で無効のため取得していません');
        }

        let description: string | null = null;
        try {
            const raw = await guild.client.rest.get(Routes.guild(guild.id)) as { description?: string | null };
            description = typeof raw?.description === 'string' ? raw.description : null;
        } catch {
            warnings.push('サーバー説明を取得できませんでした');
        }

        const snapshot: GuildSnapshot = {
            version: SNAPSHOT_VERSION,
            id,
            guildId: guild.id,
            guildName: guild.name,
            createdAt,
            trigger,
            requestedBy,
            counts: {
                roles: capturedRoles.filter((role) => !role.everyone).length,
                categories: capturedChannels.filter((channel) => channel.type === ChannelType.GuildCategory).length,
                channels: capturedChannels.filter((channel) => channel.type !== ChannelType.GuildCategory).length,
                emojis: emojis.length,
                bans: bans.length,
                membersWithRoles: memberRoles.length
            },
            limits: {
                memberRoleCap: snapshotSettings.memberRoleCap,
                membersScanned,
                memberCount: guild.memberCount,
                memberRolesTruncated,
                banCap: BAN_FETCH_LIMIT,
                bansTruncated
            },
            guild: {
                name: guild.name,
                iconUrl: guild.iconURL({ size: 1024, extension: 'png' }),
                description,
                verificationLevel: guild.verificationLevel,
                defaultMessageNotifications: guild.defaultMessageNotifications,
                explicitContentFilter: guild.explicitContentFilter,
                afkChannelId: guild.afkChannelId ?? null,
                afkTimeout: guild.afkTimeout,
                systemChannelId: guild.systemChannelId ?? null,
                systemChannelFlags: guild.systemChannelFlags.bitfield,
                preferredLocale: guild.preferredLocale ?? null
            },
            roles: capturedRoles,
            channels: capturedChannels,
            emojis,
            bans,
            memberRoles,
            warnings
        };
        snapshot.counts = countSnapshot(snapshot);
        return snapshot;
    }

    /** Capture and persist, pruning everything beyond the guild's keep count. */
    async captureAndStore(
        guild: Guild,
        trigger: SnapshotTrigger,
        requestedBy: string | null,
        settingsOverride?: AntiNukeSettings
    ): Promise<GuildSnapshot> {
        const settings = settingsOverride ?? await this.getSettings(guild.id);
        const snapshot = await this.captureGuild(guild, trigger, requestedBy, settings);
        await this.enqueue(guild.id, async () => {
            await database.set(guild.id, ANTINUKE_SNAPSHOT_DOC_KEY(guild.id, snapshot.id), snapshot);
            const index = await this.readIndex(guild.id);
            const { index: next, pruned } = addSnapshotToIndex(
                index,
                snapshotMeta(snapshot),
                settings.snapshots.keep ?? DEFAULT_SNAPSHOT_KEEP
            );
            await database.set(guild.id, ANTINUKE_SNAPSHOTS_KEY(guild.id), next);
            for (const snapshotId of pruned) {
                await database.delete(guild.id, ANTINUKE_SNAPSHOT_DOC_KEY(guild.id, snapshotId)).catch(() => false);
            }
            if (pruned.length) {
                Logger.debug(`[Snapshot] pruned ${pruned.length} old snapshot(s) guild=${guild.id}`);
            }
        });
        Logger.info(
            `[Snapshot] captured ${snapshot.id} guild=${guild.id} trigger=${trigger} `
            + `roles=${snapshot.counts.roles} channels=${snapshot.counts.categories + snapshot.counts.channels} `
            + `membersWithRoles=${snapshot.counts.membersWithRoles} bans=${snapshot.counts.bans}`
        );
        return snapshot;
    }

    private enqueue(guildId: string, task: () => Promise<void>): Promise<void> {
        const previous = this.writes.get(guildId) || Promise.resolve();
        const next = previous.catch(() => undefined).then(task);
        this.writes.set(guildId, next);
        return next;
    }

    async readIndex(guildId: string): Promise<SnapshotIndex> {
        const stored = await database.get<unknown>(guildId, ANTINUKE_SNAPSHOTS_KEY(guildId)).catch(() => null);
        return readSnapshotIndex(stored);
    }

    async listSnapshots(guildId: string): Promise<SnapshotIndex> {
        return this.readIndex(guildId);
    }

    async getSnapshot(guildId: string, snapshotId: string): Promise<GuildSnapshot | null> {
        const stored = await database
            .get<unknown>(guildId, ANTINUKE_SNAPSHOT_DOC_KEY(guildId, snapshotId))
            .catch(() => null);
        const snapshot = stored ? normalizeSnapshot(stored) : null;
        return snapshot && snapshot.guildId === guildId ? snapshot : null;
    }

    // ------------------------------------------------------------------
    // Restore preview (brief AN2 §B1)
    // ------------------------------------------------------------------

    async previewRestore(guild: Guild, snapshotId: string, incidentIds: string[] = []): Promise<RestorePreview> {
        const snapshot = await this.getSnapshot(guild.id, snapshotId);
        if (!snapshot) throw new Error('スナップショットが見つかりません（削除された可能性があります）');

        const incidents = await this.incidentSource(guild.id);
        const relevant = selectIncidents(incidents, incidentIds);
        const windowStart = incidentWindowStart(relevant) ?? snapshot.createdAt;

        const attackerIds = relevant.map((incident) => incident.actorId).filter((id): id is string => Boolean(id));
        const incidentBanned = unique(relevant.flatMap((incident) => incident.affected?.membersBanned ?? []));
        const currentBans = await guild.bans.fetch({ limit: BAN_FETCH_LIMIT }).catch(() => null);
        const currentBannedIds = currentBans ? Array.from(currentBans.keys()) : [];
        const protectIds = [
            ...attackerIds,
            guild.ownerId,
            this.client?.user?.id ?? ''
        ].filter(Boolean);

        const unban = selectUnbanTargets({
            incidentBannedIds: incidentBanned,
            snapshotBannedIds: snapshot.bans.map((ban) => ban.userId),
            currentBannedIds,
            protectIds
        });

        const order = planRestoreOrder(snapshot);
        const totalChannels = order.categories.length + order.channels.length;
        const notes = capacityNotes(totalChannels, order.roles.length + 1);
        if (!currentBans) {
            notes.push('BAN一覧を取得できなかったため、BAN解除の対象は判定できませんでした');
        }

        return {
            snapshotId: snapshot.id,
            guildName: snapshot.guildName,
            createdAt: snapshot.createdAt,
            ageSeconds: Math.max(0, Math.floor((this.now() - Date.parse(snapshot.createdAt)) / 1000)),
            counts: snapshot.counts,
            recreate: {
                roles: order.roles.length,
                categories: order.categories.length,
                channels: order.channels.length,
                emojis: snapshot.emojis.length,
                memberRoleHolders: snapshot.memberRoles.length,
                bansInSnapshot: snapshot.bans.length
            },
            limitations: [...RESTORE_LIMITATIONS],
            notes,
            unban,
            rebanCandidates: selectRebanTargets({
                snapshotBannedIds: snapshot.bans.map((ban) => ban.userId),
                currentBannedIds
            }),
            incidentWindowStart: windowStart,
            incidents: relevant.map((incident) => ({
                id: incident.id,
                rule: incident.rule,
                detectedAt: incident.detectedAt,
                windowStart: incident.windowStart
            }))
        };
    }

    // ------------------------------------------------------------------
    // Restore job (brief AN2 §B2-B4)
    // ------------------------------------------------------------------

    async startRestore(
        guild: Guild,
        snapshotId: string,
        options: Partial<RestoreOptions> | null,
        requestedBy: string | null
    ): Promise<RestoreJob> {
        if (this.running.has(guild.id)) throw new Error('このサーバーでは既に復元が実行中です');
        const snapshot = await this.getSnapshot(guild.id, snapshotId);
        if (!snapshot) throw new Error('スナップショットが見つかりません（削除された可能性があります）');

        const job: RestoreJob = {
            id: `restore-${guild.id}-${this.now()}-${Math.random().toString(36).slice(2, 8)}`,
            guildId: guild.id,
            snapshotId: snapshot.id,
            safetySnapshotId: null,
            status: 'running',
            startedAt: new Date(this.now()).toISOString(),
            finishedAt: null,
            requestedBy,
            options: { ...DEFAULT_RESTORE_OPTIONS, ...(options || {}) },
            phase: 'starting',
            progress: { done: 0, total: 0 },
            report: null,
            error: null
        };
        this.running.add(guild.id);
        await this.persistJob(job);
        void this.runRestore(guild, snapshot, job).catch(async (error) => {
            const info = discordErrorInfo(error);
            job.status = 'failed';
            job.error = info.message;
            job.finishedAt = new Date(this.now()).toISOString();
            this.running.delete(guild.id);
            await this.persistJob(job).catch(() => undefined);
            Logger.error(`[Snapshot] restore failed guild=${guild.id} job=${job.id}:`, error);
        });
        return job;
    }

    private async runRestore(guild: Guild, snapshot: GuildSnapshot, job: RestoreJob): Promise<void> {
        const settings = await this.getSettings(guild.id);
        const report = emptyRestoreReport(null, job.startedAt);
        const order = planRestoreOrder(snapshot);
        const estimate = order.roles.length + order.categories.length + order.channels.length
            + 9 + snapshot.emojis.length + snapshot.memberRoles.length + snapshot.bans.length;
        job.progress = { done: 0, total: estimate };

        const touch = async (phase: string) => {
            job.phase = phase;
            job.progress = { done: report.entries.length, total: estimate };
            job.report = report;
            await this.persistJob(job).catch(() => undefined);
        };
        const pace = () => new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, this.paceMs);
            timer.unref?.();
        });

        try {
            // 1. Safety snapshot of the current state before touching anything.
            await touch('safety-snapshot');
            const safety = await this.captureAndStore(guild, 'prerestore', job.requestedBy, settings);
            job.safetySnapshotId = safety.id;
            report.safetySnapshotId = safety.id;

            // 2. Roles, bottom-up, building the old→new map.
            await touch('roles');
            // @everyone is applied in place, but its id must still resolve for
            // channel overwrites that target it.
            const idMap: RoleIdMap = { [guild.id]: guild.id };
            if (order.everyone) {
                try {
                    const permissions = new PermissionsBitField(BigInt(order.everyone.permissions));
                    await guild.roles.everyone.setPermissions(permissions, 'AntiNuke restore: @everyone permissions');
                    recordRestore(report, {
                        kind: 'role',
                        name: '@everyone',
                        sourceId: guild.id,
                        targetId: guild.id,
                        outcome: 'restored'
                    });
                } catch (error) {
                    recordRestore(report, {
                        kind: 'role',
                        name: '@everyone',
                        sourceId: guild.id,
                        targetId: guild.id,
                        outcome: 'failed',
                        reason: discordErrorInfo(error).message
                    });
                }
            }

            for (const role of order.roles) {
                await this.restoreRole(guild, role, idMap, report);
                await pace();
                if (report.entries.length % 10 === 0) await touch('roles');
            }

            // 3. Categories first, then channels in position order.
            await touch('channels');
            const channelIdMap: Record<string, string> = {};
            for (const category of order.categories) {
                await this.restoreChannel(guild, category, null, idMap, channelIdMap, report);
                await pace();
            }
            for (const channel of order.channels) {
                const parentId = channel.parentId ? channelIdMap[channel.parentId] ?? null : null;
                await this.restoreChannel(guild, channel, parentId, idMap, channelIdMap, report);
                await pace();
            }

            // 4. Guild settings + icon.
            await this.restoreGuildSettings(guild, snapshot, channelIdMap, report);

            // 5. Bans: mass-ban undo (default), re-ban only on explicit request.
            await touch('bans');
            await this.restoreBans(guild, snapshot, job, report);

            // 6. Member role assignments for members still present.
            await touch('member-roles');
            await this.restoreMemberRoles(guild, snapshot, idMap, report);

            // 7. Emojis up to the available slots.
            await touch('emojis');
            await this.restoreEmojis(guild, snapshot, report);

            finalizeRestoreReport(report, new Date(this.now()).toISOString());
            // The restore consumed this attack's incidents: close them so the
            // next unban window starts from the next incident.
            const consumed = selectIncidents(await this.incidentSource(guild.id).catch(() => []), job.options.incidentIds);
            await this.incidentCloser(guild.id, consumed.map((incident) => incident.id)).catch(() => 0);
            job.status = 'done';
            job.phase = 'done';
            job.finishedAt = report.finishedAt;
            job.report = report;
            job.progress = { done: report.entries.length, total: estimate };
            await this.persistJob(job);
            await this.postRestoreReport(guild, job, report);
            Logger.info(
                `[Snapshot] restore done guild=${guild.id} job=${job.id} snapshot=${snapshot.id} `
                + `entries=${report.entries.length} unbanned=${report.unbanned.length}`
            );
        } finally {
            this.running.delete(guild.id);
        }
    }

    private async restoreRole(
        guild: Guild,
        role: SnapshotRole,
        idMap: RoleIdMap,
        report: RestoreReport
    ): Promise<void> {
        const existingById = guild.roles.cache.get(role.id);
        if (existingById) {
            idMap[role.id] = existingById.id;
            report.roleIdMap.push({ oldId: role.id, newId: existingById.id, mode: 'reused' });
            recordRestore(report, {
                kind: 'role', name: role.name, sourceId: role.id, targetId: existingById.id,
                outcome: 'skipped', reason: '元のロールが残っているため再利用'
            });
            return;
        }
        if (role.managed) {
            recordRestore(report, {
                kind: 'role', name: role.name, sourceId: role.id, targetId: null,
                outcome: 'skipped', reason: '管理ロール（Bot・連携）は作成できません'
            });
            return;
        }
        const sameName = guild.roles.cache.find((live: Role) =>
            live.name === role.name
            && !live.managed
            && live.permissions.bitfield.toString() === role.permissions
        );
        if (sameName) {
            idMap[role.id] = sameName.id;
            report.roleIdMap.push({ oldId: role.id, newId: sameName.id, mode: 'reused' });
            recordRestore(report, {
                kind: 'role', name: role.name, sourceId: role.id, targetId: sameName.id,
                outcome: 'skipped', reason: '同名・同権限のロールが存在するため再利用'
            });
            return;
        }
        if (guild.roles.cache.size >= DISCORD_ROLE_LIMIT) {
            recordRestore(report, {
                kind: 'role', name: role.name, sourceId: role.id, targetId: null,
                outcome: 'skipped', reason: `ロール上限（${DISCORD_ROLE_LIMIT}件）に達しています`
            });
            return;
        }
        const permissions = new PermissionsBitField(BigInt(role.permissions));
        let created: Role | null = null;
        let lastError: unknown = null;
        for (const icon of role.iconUrl ? [role.iconUrl, null] : [null]) {
            try {
                created = await guild.roles.create({
                    name: role.name,
                    color: role.color,
                    hoist: role.hoist,
                    mentionable: role.mentionable,
                    permissions,
                    position: role.position,
                    unicodeEmoji: role.unicodeEmoji,
                    icon,
                    reason: 'AntiNuke restore'
                });
                break;
            } catch (error) {
                lastError = error;
            }
        }
        if (!created) {
            recordRestore(report, {
                kind: 'role', name: role.name, sourceId: role.id, targetId: null,
                outcome: 'failed', reason: discordErrorInfo(lastError).message
            });
            return;
        }
        idMap[role.id] = created.id;
        report.roleIdMap.push({ oldId: role.id, newId: created.id, mode: 'recreated' });
        recordRestore(report, {
            kind: 'role', name: role.name, sourceId: role.id, targetId: created.id, outcome: 'restored'
        });
    }

    private async restoreChannel(
        guild: Guild,
        channel: SnapshotChannel,
        parentId: string | null,
        idMap: RoleIdMap,
        channelIdMap: Record<string, string>,
        report: RestoreReport
    ): Promise<void> {
        const isCategory = channel.type === ChannelType.GuildCategory;
        const existing = guild.channels.cache.get(channel.id);
        if (existing) {
            channelIdMap[channel.id] = existing.id;
            recordRestore(report, {
                kind: isCategory ? 'category' : 'channel',
                name: channel.name,
                sourceId: channel.id,
                targetId: existing.id,
                outcome: 'skipped',
                reason: '元のチャンネルが残っているため再利用'
            });
            return;
        }
        if (guild.channels.cache.size >= DISCORD_CHANNEL_LIMIT) {
            recordRestore(report, {
                kind: isCategory ? 'category' : 'channel',
                name: channel.name,
                sourceId: channel.id,
                targetId: null,
                outcome: 'skipped',
                reason: `チャンネル上限（${DISCORD_CHANNEL_LIMIT}件）に達しています`
            });
            return;
        }

        const mapped = applyIdMap(
            channel.overwrites,
            idMap,
            (memberId) => guild.members.cache.has(memberId)
        );
        for (const skipped of mapped.skipped) {
            recordRestore(report, {
                kind: 'overwrite',
                name: `${channel.name} / ${skipped.type === 'role' ? 'ロール' : 'メンバー'} ${skipped.targetId}`,
                sourceId: skipped.targetId,
                targetId: null,
                outcome: 'skipped',
                reason: skipped.reason === 'role-not-restored'
                    ? '対応するロールが復元されていないため上書きを再現できません'
                    : 'メンバーがサーバーに存在しないため上書きを再現できません'
            });
        }
        const permissionOverwrites = mapped.applied.map((overwrite) => ({
            id: overwrite.targetId,
            type: overwrite.type === 'role' ? OverwriteType.Role : OverwriteType.Member,
            allow: BigInt(overwrite.allow),
            deny: BigInt(overwrite.deny)
        }));

        const options: Record<string, unknown> = {
            name: channel.name,
            type: channel.type,
            position: channel.position,
            permissionOverwrites,
            reason: 'AntiNuke restore'
        };
        if (parentId) options.parent = parentId;
        if (channel.topic !== null) options.topic = channel.topic;
        if (channel.nsfw) options.nsfw = true;
        if (channel.rateLimitPerUser !== null && channel.type !== ChannelType.GuildVoice) {
            options.rateLimitPerUser = channel.rateLimitPerUser;
        }
        if (channel.bitrate !== null && isVoiceLike(channel.type)) options.bitrate = channel.bitrate;
        if (channel.userLimit !== null && isVoiceLike(channel.type)) options.userLimit = channel.userLimit;
        if (channel.rtcRegion !== null && isVoiceLike(channel.type)) options.rtcRegion = channel.rtcRegion;
        if (channel.forumTags.length && channel.type === ChannelType.GuildForum) {
            options.availableTags = channel.forumTags.map((name) => ({ name }));
        }

        try {
            const created = await guild.channels.create(options as never);
            channelIdMap[channel.id] = created.id;
            recordRestore(report, {
                kind: isCategory ? 'category' : 'channel',
                name: channel.name,
                sourceId: channel.id,
                targetId: created.id,
                outcome: 'restored'
            });
            if (mapped.applied.length) {
                recordRestore(report, {
                    kind: 'overwrite',
                    name: `${channel.name}（権限上書き ${mapped.applied.length}件）`,
                    sourceId: channel.id,
                    targetId: created.id,
                    outcome: 'restored'
                });
            }
        } catch (error) {
            recordRestore(report, {
                kind: isCategory ? 'category' : 'channel',
                name: channel.name,
                sourceId: channel.id,
                targetId: null,
                outcome: 'failed',
                reason: discordErrorInfo(error).message
            });
        }
    }

    private async restoreGuildSettings(
        guild: Guild,
        snapshot: GuildSnapshot,
        channelIdMap: Record<string, string>,
        report: RestoreReport
    ): Promise<void> {
        const record = (name: string, outcome: 'restored' | 'skipped' | 'failed', reason?: string) =>
            recordRestore(report, { kind: 'guildSettings', name, sourceId: null, targetId: null, outcome, reason });

        if (snapshot.guild.name && snapshot.guild.name !== guild.name) {
            try {
                await guild.setName(snapshot.guild.name, 'AntiNuke restore');
                record('サーバー名', 'restored');
            } catch (error) {
                record('サーバー名', 'failed', discordErrorInfo(error).message);
            }
        } else {
            record('サーバー名', 'skipped', '変更なし');
        }

        if (snapshot.guild.iconUrl) {
            try {
                const response = await fetch(snapshot.guild.iconUrl);
                if (!response.ok) throw new Error(`アイコン画像の取得に失敗（HTTP ${response.status}）`);
                const buffer = Buffer.from(await response.arrayBuffer());
                await guild.setIcon(buffer, 'AntiNuke restore');
                record('サーバーアイコン', 'restored');
            } catch (error) {
                record('サーバーアイコン', 'failed', discordErrorInfo(error).message);
            }
        } else {
            record('サーバーアイコン', 'skipped', 'スナップショットにアイコンがないため変更しません');
        }

        if (snapshot.guild.description !== null) {
            try {
                await guild.client.rest.patch(Routes.guild(guild.id), {
                    body: { description: snapshot.guild.description },
                    reason: 'AntiNuke restore'
                });
                record('サーバー説明', 'restored');
            } catch (error) {
                record('サーバー説明', 'failed', discordErrorInfo(error).message);
            }
        } else {
            record('サーバー説明', 'skipped', 'APIから取得できなかったため復元しません');
        }

        try {
            await guild.setVerificationLevel(snapshot.guild.verificationLevel as never, 'AntiNuke restore');
            record('認証レベル', 'restored');
        } catch (error) {
            record('認証レベル', 'failed', discordErrorInfo(error).message);
        }
        try {
            await guild.setDefaultMessageNotifications(snapshot.guild.defaultMessageNotifications as never, 'AntiNuke restore');
            record('既定の通知設定', 'restored');
        } catch (error) {
            record('既定の通知設定', 'failed', discordErrorInfo(error).message);
        }
        try {
            await guild.setExplicitContentFilter(snapshot.guild.explicitContentFilter as never, 'AntiNuke restore');
            record('メディアフィルター', 'restored');
        } catch (error) {
            record('メディアフィルター', 'failed', discordErrorInfo(error).message);
        }

        const afkId = resolveChannelId(snapshot.guild.afkChannelId, guild, channelIdMap);
        if (snapshot.guild.afkChannelId && !afkId) {
            record('AFKチャンネル', 'skipped', '対応するボイスチャンネルが復元されていないため設定できません');
        } else {
            try {
                await guild.setAFKChannel(afkId, 'AntiNuke restore');
                await guild.setAFKTimeout(snapshot.guild.afkTimeout, 'AntiNuke restore');
                record('AFKチャンネル/タイムアウト', 'restored');
            } catch (error) {
                record('AFKチャンネル/タイムアウト', 'failed', discordErrorInfo(error).message);
            }
        }

        const systemId = resolveChannelId(snapshot.guild.systemChannelId, guild, channelIdMap);
        if (snapshot.guild.systemChannelId && !systemId) {
            record('システムチャンネル', 'skipped', '対応するチャンネルが復元されていないため設定できません');
        } else {
            try {
                await guild.setSystemChannel(systemId, 'AntiNuke restore');
                await guild.setSystemChannelFlags(snapshot.guild.systemChannelFlags, 'AntiNuke restore');
                record('システムチャンネル', 'restored');
            } catch (error) {
                record('システムチャンネル', 'failed', discordErrorInfo(error).message);
            }
        }
    }

    private async restoreBans(
        guild: Guild,
        snapshot: GuildSnapshot,
        job: RestoreJob,
        report: RestoreReport
    ): Promise<void> {
        const incidents = selectIncidents(await this.incidentSource(guild.id), job.options.incidentIds);
        const windowStart = incidentWindowStart(incidents) ?? snapshot.createdAt;
        report.incidentWindowStart = windowStart;
        const attackerIds = incidents.map((incident) => incident.actorId).filter((id): id is string => Boolean(id));
        const incidentBanned = unique(incidents.flatMap((incident) => incident.affected?.membersBanned ?? []));
        const current = await guild.bans.fetch({ limit: BAN_FETCH_LIMIT }).catch(() => null);
        if (!current) {
            recordRestore(report, {
                kind: 'ban', name: 'BAN一覧の取得', sourceId: null, targetId: null,
                outcome: 'failed', reason: 'BAN一覧を取得できません（BANメンバー権限を確認してください）'
            });
            return;
        }
        if (!job.options.unbanAdded) {
            recordRestore(report, {
                kind: 'ban', name: '攻撃で追加されたBANの解除', sourceId: null, targetId: null,
                outcome: 'skipped', reason: 'スタッフがBAN解除を選択しなかったため未実行'
            });
        } else {
            const selection = selectUnbanTargets({
                incidentBannedIds: incidentBanned,
                snapshotBannedIds: snapshot.bans.map((ban) => ban.userId),
                currentBannedIds: Array.from(current.keys()),
                protectIds: [...attackerIds, guild.ownerId, this.client?.user?.id ?? ''].filter(Boolean)
            });
            report.alreadyLifted.push(...selection.alreadyLifted);
            report.keptFromSnapshot.push(...selection.keptFromSnapshot);
            report.protectedUsers = selection.protectedUsers;

            for (const userId of selection.unban) {
                try {
                    await guild.bans.remove(userId, 'AntiNuke restore: 攻撃で追加されたBANの解除');
                    report.unbanned.push(userId);
                    recordRestore(report, {
                        kind: 'ban', name: `BAN解除 ${userId}`, sourceId: userId, targetId: null, outcome: 'restored'
                    });
                } catch (error) {
                    recordRestore(report, {
                        kind: 'ban', name: `BAN解除 ${userId}`, sourceId: userId, targetId: null,
                        outcome: 'failed', reason: discordErrorInfo(error).message
                    });
                }
            }
            for (const userId of selection.alreadyLifted) {
                recordRestore(report, {
                    kind: 'ban', name: `BAN解除 ${userId}`, sourceId: userId, targetId: null,
                    outcome: 'skipped', reason: '既に解除されています'
                });
            }
        }

        if (!job.options.rebanSnapshotBans) {
            recordRestore(report, {
                kind: 'ban', name: 'スナップショットのBAN再適用', sourceId: null, targetId: null,
                outcome: 'skipped', reason: '既定では再BANしません（スタッフが明示した場合のみ）'
            });
            return;
        }
        const reban = selectRebanTargets({
            snapshotBannedIds: snapshot.bans.map((ban) => ban.userId),
            currentBannedIds: Array.from(current.keys())
        });
        const reasonById = new Map(snapshot.bans.map((ban) => [ban.userId, ban.reason]));
        for (const userId of reban) {
            try {
                await guild.bans.create(userId, {
                    reason: `AntiNuke restore: ${reasonById.get(userId) || 'snapshot ban'}`
                });
                report.rebanned.push(userId);
                recordRestore(report, {
                    kind: 'ban', name: `再BAN ${userId}`, sourceId: userId, targetId: null, outcome: 'restored'
                });
            } catch (error) {
                recordRestore(report, {
                    kind: 'ban', name: `再BAN ${userId}`, sourceId: userId, targetId: null,
                    outcome: 'failed', reason: discordErrorInfo(error).message
                });
            }
        }
    }

    private async restoreMemberRoles(
        guild: Guild,
        snapshot: GuildSnapshot,
        idMap: RoleIdMap,
        report: RestoreReport
    ): Promise<void> {
        // One paged scan instead of a fetch per member: a 5,000-member snapshot
        // must not become 5,000 sequential requests.
        const present = new Map<string, GuildMember>();
        for (const member of guild.members.cache.values()) present.set(member.id, member);
        let after: string | undefined;
        for (let page = 0; page < 25; page += 1) {
            const listed = await guild.members.list({ limit: 1000, after }).catch(() => null);
            if (!listed || listed.size === 0) break;
            for (const member of listed.values()) present.set(member.id, member);
            after = listed.last()?.id;
            if (listed.size < 1000) break;
        }

        for (const entry of snapshot.memberRoles) {
            const member: GuildMember | null = present.get(entry.memberId) ?? null;
            if (!member) {
                recordRestore(report, {
                    kind: 'memberRoles', name: `メンバー ${entry.memberId}`, sourceId: entry.memberId,
                    targetId: null, outcome: 'skipped', reason: '退出済みのため復元できません'
                });
                continue;
            }
            const mapped = entry.roleIds.map((roleId) => idMap[roleId]).filter((roleId): roleId is string => Boolean(roleId));
            const missing = entry.roleIds.length - mapped.length;
            if (!mapped.length) {
                recordRestore(report, {
                    kind: 'memberRoles', name: `メンバー ${entry.memberId}`, sourceId: entry.memberId,
                    targetId: member.id, outcome: 'skipped', reason: '付与できるロールが復元されていません'
                });
                continue;
            }
            if (!member.manageable) {
                recordRestore(report, {
                    kind: 'memberRoles', name: `メンバー ${entry.memberId}`, sourceId: entry.memberId,
                    targetId: member.id, outcome: 'failed', reason: 'ロール階層が低いため付与できません'
                });
                continue;
            }
            try {
                await member.roles.add(mapped, 'AntiNuke restore');
                recordRestore(report, {
                    kind: 'memberRoles', name: `メンバー ${entry.memberId}`, sourceId: entry.memberId,
                    targetId: member.id, outcome: 'restored',
                    reason: missing ? `${missing}件のロールは復元されず付与できませんでした` : undefined
                });
            } catch (error) {
                recordRestore(report, {
                    kind: 'memberRoles', name: `メンバー ${entry.memberId}`, sourceId: entry.memberId,
                    targetId: member.id, outcome: 'failed', reason: discordErrorInfo(error).message
                });
            }
        }
    }

    private async restoreEmojis(guild: Guild, snapshot: GuildSnapshot, report: RestoreReport): Promise<void> {
        const slots = emojiSlots(guild);
        const existingNames = new Set(guild.emojis.cache.map((emoji) => emoji.name).filter(Boolean) as string[]);
        for (const emoji of snapshot.emojis) {
            if (emoji.name && existingNames.has(emoji.name)) {
                recordRestore(report, {
                    kind: 'emoji', name: emoji.name, sourceId: emoji.id, targetId: null,
                    outcome: 'skipped', reason: '同名の絵文字が既に存在します'
                });
                continue;
            }
            const bucket = emoji.animated ? slots.animated : slots.static;
            if (bucket.remaining <= 0) {
                recordRestore(report, {
                    kind: 'emoji', name: emoji.name || emoji.id, sourceId: emoji.id, targetId: null,
                    outcome: 'skipped', reason: `空きスロットがないため追加できません（上限${bucket.limit}件）`
                });
                continue;
            }
            try {
                const created = await guild.emojis.create({
                    attachment: emoji.url,
                    name: emoji.name || `emoji_${emoji.id}`,
                    reason: 'AntiNuke restore'
                });
                bucket.remaining -= 1;
                existingNames.add(created.name ?? '');
                recordRestore(report, {
                    kind: 'emoji', name: created.name || emoji.id, sourceId: emoji.id,
                    targetId: created.id, outcome: 'restored'
                });
            } catch (error) {
                recordRestore(report, {
                    kind: 'emoji', name: emoji.name || emoji.id, sourceId: emoji.id, targetId: null,
                    outcome: 'failed', reason: discordErrorInfo(error).message
                });
            }
        }
    }

    // ------------------------------------------------------------------
    // Job persistence + report
    // ------------------------------------------------------------------

    private async persistJob(job: RestoreJob): Promise<void> {
        await this.enqueue(job.guildId, async () => {
            const key = ANTINUKE_RESTORE_JOBS_KEY(job.guildId);
            const stored = await database.get<RestoreJob[]>(job.guildId, key).catch(() => null);
            const list = Array.isArray(stored) ? stored.slice() : [];
            const index = list.findIndex((entry) => entry?.id === job.id);
            const record: RestoreJob = { ...job, report: job.report ? summarizeReport(job.report) : null };
            if (index >= 0) list[index] = record;
            else list.unshift(record);
            await database.set(job.guildId, key, list.slice(0, MAX_RESTORE_JOBS));
        });
    }

    async listJobs(guildId: string): Promise<RestoreJob[]> {
        const stored = await database.get<RestoreJob[]>(guildId, ANTINUKE_RESTORE_JOBS_KEY(guildId)).catch(() => null);
        return Array.isArray(stored) ? stored : [];
    }

    async getJob(guildId: string, jobId: string): Promise<RestoreJob | null> {
        const jobs = await this.listJobs(guildId);
        return jobs.find((job) => job.id === jobId) ?? null;
    }

    private buildRestoreEmbed(job: RestoreJob, report: RestoreReport): EmbedBuilder {
        const color: ColorResolvable = job.status === 'done'
            ? (report.totals.channel.failed || report.totals.role.failed ? Colors.Orange : Colors.Green)
            : Colors.Red;
        const lines = formatRestoreTotals(report.totals);
        const embed = new EmbedBuilder()
            .setTitle('🛠️ AntiNuke 復元レポート')
            .setColor(color)
            .setTimestamp(new Date(report.finishedAt ?? new Date().toISOString()))
            .setDescription('スナップショットからの復元結果です。復元できなかった項目は理由付きで記録しています。')
            .addFields(
                {
                    name: 'スナップショット',
                    value: `復元元: \`${job.snapshotId}\`\n安全スナップショット: ${job.safetySnapshotId ? `\`${job.safetySnapshotId}\`` : '取得できませんでした'}`,
                    inline: false
                },
                { name: '集計', value: lines.join('\n').slice(0, 1024), inline: false },
                {
                    name: 'BAN解除',
                    value: report.unbanned.length
                        ? `${report.unbanned.length}件を解除しました（攻撃で追加されたBANのみ）`
                        : '解除したBANはありません（攻撃で追加されたBANのみを対象にしています）',
                    inline: false
                },
                {
                    name: '復元できないもの',
                    value: RESTORE_LIMITATIONS.map((line) => `・${line}`).join('\n').slice(0, 1024),
                    inline: false
                }
            )
            .setFooter({ text: `AntiNuke / restore ${job.id}` });

        const failures = report.entries.filter((entry) => entry.outcome === 'failed').slice(0, 10);
        if (failures.length) {
            embed.addFields({
                name: '失敗した項目（先頭10件）',
                value: failures.map((entry) => `・${entry.name}: ${entry.reason || '理由不明'}`).join('\n').slice(0, 1024),
                inline: false
            });
        }
        return embed;
    }

    private async postRestoreReport(guild: Guild, job: RestoreJob, report: RestoreReport): Promise<void> {
        try {
            const settings = await antiCheatManager.getSettings(guild.id);
            const channelId = settings.logChannelId;
            if (!channelId) return;
            const cached = guild.channels.cache.get(channelId);
            const channel = cached?.isTextBased()
                ? cached as TextChannel
                : await guild.channels.fetch(channelId).then((value) => value as TextChannel | null).catch(() => null);
            if (!channel?.isTextBased()) return;
            await channel.send({ embeds: [this.buildRestoreEmbed(job, report)], allowedMentions: { parse: [] } });
        } catch (error) {
            Logger.debug(`[Snapshot] restore report post failed guild=${guild.id}: ${String(error)}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unique<T>(values: readonly T[]): T[] {
    return Array.from(new Set(values));
}

function isVoiceLike(type: number): boolean {
    return type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice;
}

function safeRoleIconUrl(role: Role): string | null {
    try {
        return role.iconURL({ size: 128, extension: 'png' }) ?? null;
    } catch {
        return null;
    }
}

function resolveChannelId(
    snapshotId: string | null,
    guild: Guild,
    channelIdMap: Record<string, string>
): string | null {
    if (!snapshotId) return null;
    if (channelIdMap[snapshotId]) return channelIdMap[snapshotId];
    if (guild.channels.cache.has(snapshotId)) return snapshotId;
    return null;
}

function emojiSlots(guild: Guild): { static: { limit: number; remaining: number }; animated: { limit: number; remaining: number } } {
    const tier = String(guild.premiumTier);
    const base = tier === 'TIER_3' ? 250 : tier === 'TIER_2' ? 150 : tier === 'TIER_1' ? 100 : 50;
    let usedStatic = 0;
    let usedAnimated = 0;
    for (const emoji of guild.emojis.cache.values()) {
        if (emoji.animated) usedAnimated += 1;
        else usedStatic += 1;
    }
    return {
        static: { limit: base, remaining: Math.max(0, base - usedStatic) },
        animated: { limit: base, remaining: Math.max(0, base - usedAnimated) }
    };
}

/** Persisted reports stay bounded: totals + the first 200 entries. */function summarizeReport(report: RestoreReport): RestoreReport {
    return {
        ...report,
        entries: report.entries.slice(0, 200)
    };
}

type IncidentLike = {
    id: string;
    rule: string;
    actorId: string | null;
    windowStart: string;
    detectedAt: string;
    affected?: { membersBanned?: string[] };
    status?: string;
};

function selectIncidents(incidents: IncidentLike[], incidentIds: string[]): IncidentLike[] {
    if (incidentIds.length) {
        return incidents.filter((incident) => incidentIds.includes(incident.id));
    }
    return incidents.filter((incident) => incident.status === 'open' || incident.status === undefined);
}

function incidentWindowStart(incidents: IncidentLike[]): string | null {
    const times = incidents
        .map((incident) => Date.parse(incident.windowStart))
        .filter((time) => Number.isFinite(time));
    if (!times.length) return null;
    return new Date(Math.min(...times)).toISOString();
}

const GLOBAL_KEY = '__antiNukeSnapshotManager_v1';
if (!(global as any)[GLOBAL_KEY]) {
    (global as any)[GLOBAL_KEY] = new SnapshotManager();
}
export const snapshotManager: SnapshotManager = (global as any)[GLOBAL_KEY];
