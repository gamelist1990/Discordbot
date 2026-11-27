import {
    AuditLogEvent,
    Client,
    Colors,
    EmbedBuilder,
    Events,
    Guild,
    GuildMember,
    PermissionFlagsBits,
    TextChannel,
    type ColorResolvable,
    type User
} from 'discord.js';
import { Logger } from '../../utils/Logger.js';
import { database } from '../persistence/Database.js';
import { antiCheatManager } from './AntiCheatManager.js';
import {
    AuditAttribution,
    attributeAuditAction,
    collectActorAuditEntries
} from './AuditAttribution.js';
import {
    AntiNukeSettings,
    NukeAction,
    NukeActorLike,
    NukeRuleKey,
    NukeVelocityTracker,
    VelocityHit,
    banReason,
    buildReinviteUrl,
    discordErrorInfo,
    hasAdministrator,
    isAdminBotInviteTrigger,
    isAdminRoleGrantTrigger,
    isVanityNameChangeTrigger,
    NUKE_RULE_LABELS,
    nukeExemptionReason,
    POSITION_AUDIT_PERMISSIONS
} from './AntiNuke.js';

/** DB keys: incidents and snapshot pointers survive the bot being kicked. */
export const ANTINUKE_INCIDENTS_KEY = (guildId: string) => `Guild/${guildId}/antinuke/incidents`;
export const ANTINUKE_SNAPSHOTS_KEY = (guildId: string) => `Guild/${guildId}/antinuke/snapshots`;
const MAX_INCIDENTS_PER_GUILD = 50;
/** One response per actor+rule per window; stops ban spam from parallel events. */
const TRIGGER_COOLDOWN_MS = 10_000;
const POSITION_AUDIT_DEBOUNCE_MS = 5_000;

export interface AntiNukeAffected {
    channelsDeleted: string[];
    rolesDeleted: string[];
    membersBanned: string[];
    membersKicked: string[];
    channelsCreated: string[];
    rolesCreated: string[];
    webhooksCreated: string[];
    emojisDeleted: string[];
}

export type NukeIncidentKind = 'velocity' | 'instant' | 'selfTamper' | 'selfKick' | 'positionAudit';

export interface AntiNukeIncidentActions {
    ban: 'success' | 'failed' | 'skipped';
    banError?: string;
    rolesStripped: boolean;
    stripError?: string;
    logPosted: boolean;
    ownerDm: 'sent' | 'failed' | 'skipped';
    ownerDmError?: string;
}

export interface AntiNukeIncident {
    id: string;
    guildId: string;
    guildName: string;
    rule: NukeRuleKey;
    ruleLabel: string;
    kind: NukeIncidentKind;
    actorId: string | null;
    actorTag: string | null;
    actorIsBot: boolean;
    /** For adminBotInvite: who added the bot. */
    addedById?: string | null;
    count?: number;
    threshold?: number;
    windowSeconds?: number;
    /** Start of the attack window (earliest counted event / window start). */
    windowStart: string;
    startedAt: string;
    detectedAt: string;
    snapshotId: string | null;
    affected: AntiNukeAffected;
    actions: AntiNukeIncidentActions;
    status: 'open' | 'resolved' | 'restored';
    attribution: 'audit' | 'event' | 'none';
}

const emptyAffected = (): AntiNukeAffected => ({
    channelsDeleted: [],
    rolesDeleted: [],
    membersBanned: [],
    membersKicked: [],
    channelsCreated: [],
    rolesCreated: [],
    webhooksCreated: [],
    emojisDeleted: []
});

interface AuditOptions {
    type: AuditLogEvent;
    since: number;
    match?: (entry: any) => boolean;
    attempts?: number;
    delayMs?: number;
    /** Routine events (e.g. ordinary leaves) must not spam the warning log. */
    quiet?: boolean;
}

interface TriggerInput {
    guild: Guild;
    settings: AntiNukeSettings;
    rule: NukeRuleKey;
    kind: NukeIncidentKind;
    actor: NukeActorLike;
    hit?: VelocityHit;
    attribution?: AuditAttribution | null;
    addedBy?: { id: string; tag: string | null } | null;
}

/**
 * AntiNuke manager: gateway-event detection, audit-log attribution, immediate
 * ban (with role-strip fallback), incident persistence and self-defense.
 *
 * Ordering on trigger (brief AN1 §B): snapshot marker → ban → log + owner DM →
 * persist the incident record AN2's restore consumes. The draft incident is
 * written before the ban so a crash mid-response still leaves a record.
 */
export class AntiNukeManager {
    private client: Client | null = null;
    private wired = false;
    private tracker = new NukeVelocityTracker();
    private consumedEntries = new Map<string, number>();
    private triggerCooldowns = new Map<string, number>();
    private incidentWrites = new Map<string, Promise<void>>();
    private positionStates = new Map<string, string>();
    private positionTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private selfDangerousRoleIds = new Map<string, Set<string>>();
    private announcedRejoins = new Set<string>();
    private now: () => number = () => Date.now();
    private responseHooks: {
        ban?: (guild: Guild, actorId: string, reason: string) => Promise<{ ok: boolean; error?: string }>;
        strip?: (guild: Guild, actorId: string, reason: string) => Promise<{ ok: boolean; error?: string }>;
    } = {};

    setClient(client: Client): void {
        this.client = client;
        this.wire(client);
        const run = () => {
            void this.runStartupChecks();
        };
        if (client.isReady()) {
            queueMicrotask(run);
        } else {
            client.once(Events.ClientReady, () => run());
        }
    }

    /** Test seam: replace the clock. */
    setClock(now: () => number): void {
        this.now = now;
    }

    /** Test seam: observe/replace the ban and role-strip side effects. */
    setResponseHooks(hooks: AntiNukeManager['responseHooks']): void {
        this.responseHooks = hooks;
    }

    private wire(client: Client): void {
        if (this.wired) return;
        this.wired = true;

        client.on(Events.ChannelCreate, (channel: any) => {
            void this.guard('channelCreate', () => this.onChannelCreate(channel));
        });
        client.on(Events.ChannelDelete, (channel: any) => {
            void this.guard('channelDelete', () => this.onChannelDelete(channel));
        });
        client.on(Events.GuildRoleCreate, (role: any) => {
            void this.guard('roleCreate', () => this.onRoleCreate(role));
        });
        client.on(Events.GuildRoleDelete, (role: any) => {
            void this.guard('roleDelete', () => this.onRoleDelete(role));
        });
        client.on(Events.GuildRoleUpdate, (oldRole: any, newRole: any) => {
            void this.guard('roleUpdate', () => this.onRoleUpdate(oldRole, newRole));
        });
        client.on(Events.GuildMemberAdd, (member: any) => {
            void this.guard('memberAdd', () => this.onMemberAdd(member));
        });
        client.on(Events.GuildMemberUpdate, (oldMember: any, newMember: any) => {
            void this.guard('memberUpdate', () => this.onMemberUpdate(oldMember, newMember));
        });
        client.on(Events.GuildMemberRemove, (member: any) => {
            void this.guard('memberRemove', () => this.onMemberRemove(member));
        });
        client.on(Events.GuildBanAdd, (ban: any) => {
            void this.guard('banAdd', () => this.onBanAdd(ban));
        });
        client.on(Events.GuildUpdate, (oldGuild: any, newGuild: any) => {
            void this.guard('guildUpdate', () => this.onGuildUpdate(oldGuild, newGuild));
        });
        client.on(Events.WebhooksUpdate, (channel: any) => {
            void this.guard('webhooksUpdate', () => this.onWebhooksUpdate(channel));
        });
        client.on(Events.GuildEmojiDelete, (emoji: any) => {
            void this.guard('emojiDelete', () => this.onEmojiDelete(emoji, AuditLogEvent.EmojiDelete));
        });
        client.on(Events.GuildStickerDelete, (sticker: any) => {
            void this.guard('stickerDelete', () => this.onEmojiDelete(sticker, AuditLogEvent.StickerDelete));
        });
        client.on(Events.GuildDelete, (guild: any) => {
            void this.guard('guildDelete', () => this.onGuildDelete(guild));
        });
        client.on(Events.GuildCreate, (guild: any) => {
            void this.guard('guildCreate', () => this.onGuildCreate(guild));
        });
    }

    private async guard(context: string, task: () => Promise<void>): Promise<void> {
        try {
            await task();
            this.tracker.prune(this.now());
            this.pruneRuntimeState(this.now());
        } catch (error) {
            Logger.error(`[AntiNuke] ${context} failed:`, error);
        }
    }

    private pruneRuntimeState(now: number): void {
        for (const [id, timestamp] of this.consumedEntries) {
            if (now - timestamp > 10 * 60_000) this.consumedEntries.delete(id);
        }
        for (const [key, timestamp] of this.triggerCooldowns) {
            if (timestamp <= now) this.triggerCooldowns.delete(key);
        }
    }

    private async getSettings(guildId: string): Promise<AntiNukeSettings> {
        const settings = await antiCheatManager.getSettings(guildId);
        return settings.antiNuke;
    }

    private isConsumed(entryId: string): boolean {
        return this.consumedEntries.has(entryId);
    }

    private claimEntry(entryId: string): boolean {
        if (this.consumedEntries.has(entryId)) return false;
        this.consumedEntries.set(entryId, this.now());
        return true;
    }

    /**
     * Attribute one gateway event to its executor and claim the audit entry so
     * two gateway events cannot count the same entry twice.
     */
    private async attribute(guild: Guild, options: AuditOptions): Promise<AuditAttribution | null> {
        const attribution = await attributeAuditAction(guild, {
            type: options.type,
            since: options.since,
            match: options.match,
            attempts: options.attempts,
            delayMs: options.delayMs,
            isConsumed: (id) => this.isConsumed(id)
        });
        if (!attribution) return null;
        if (!this.claimEntry(attribution.entryId)) return null;
        return attribution;
    }

    private async resolveActor(
        guild: Guild,
        attribution: AuditAttribution
    ): Promise<NukeActorLike> {
        const member = guild.members.cache.get(attribution.executorId)
            || await guild.members.fetch(attribution.executorId).catch(() => null);
        const user = member?.user
            || await this.client?.users.fetch(attribution.executorId).catch(() => null)
            || null;
        const roleIds = member ? Array.from(member.roles.cache.keys()) : [];
        return {
            id: attribution.executorId,
            tag: attribution.executorTag || user?.tag || null,
            isBot: user?.bot === true || attribution.executorIsBot === true,
            roleIds,
            member: member || null
        };
    }

    private exemptionReason(actor: NukeActorLike, guild: Guild, settings: AntiNukeSettings): string | null {
        return nukeExemptionReason({
            actorId: actor.id,
            guildOwnerId: guild.ownerId,
            selfId: this.client?.user?.id,
            isBot: actor.isBot,
            roleIds: actor.roleIds,
            settings
        });
    }

    private async countWithAttribution(
        guild: Guild,
        action: NukeAction,
        settings: AntiNukeSettings,
        actor: NukeActorLike,
        attribution: AuditAttribution
    ): Promise<void> {
        const rule = settings.rules[action];
        if (!rule.enabled) return;
        const exemption = this.exemptionReason(actor, guild, settings);
        if (exemption) {
            Logger.debug(`[AntiNuke] skip ${action} by ${actor.id}: ${exemption}`);
            return;
        }
        const hit = this.tracker.record(
            guild.id,
            action,
            actor.id,
            this.now(),
            rule.threshold,
            rule.windowSeconds * 1000
        );
        Logger.debug(
            `[AntiNuke] ${guild.id} ${action} by ${actor.id}: ${hit.count}/${hit.threshold} in ${hit.windowSeconds}s`
        );
        if (!hit.exceeded) return;
        await this.trigger({ guild, settings, rule: action, kind: 'velocity', actor, hit, attribution });
    }

    private async attributeAndCount(
        guild: Guild,
        action: NukeAction,
        settings: AntiNukeSettings,
        options: AuditOptions
    ): Promise<void> {
        if (!settings.rules[action].enabled) return;
        const attribution = await this.attribute(guild, options);
        if (!attribution) {
            if (!options.quiet) {
                Logger.warn(`[AntiNuke] unattributed ${action} guild=${guild.id} (audit log empty or not visible)`);
            }
            return;
        }
        const actor = await this.resolveActor(guild, attribution);
        await this.countWithAttribution(guild, action, settings, actor, attribution);
    }

    private async onChannelCreate(channel: any): Promise<void> {
        const guild: Guild | undefined = channel?.guild;
        if (!guild) return;
        const settings = await this.getSettings(guild.id);
        if (!settings.enabled) return;
        await this.attributeAndCount(guild, 'channelCreate', settings, {
            type: AuditLogEvent.ChannelCreate,
            since: this.now(),
            match: (entry) => entry.targetId === channel.id
        });
    }

    private async onChannelDelete(channel: any): Promise<void> {
        const guild: Guild | undefined = channel?.guild;
        if (!guild) return;
        const settings = await this.getSettings(guild.id);
        if (!settings.enabled) return;
        await this.attributeAndCount(guild, 'channelDelete', settings, {
            type: AuditLogEvent.ChannelDelete,
            since: this.now(),
            match: (entry) => entry.targetId === channel.id
        });
        this.schedulePositionAudit(guild);
    }

    private async onRoleCreate(role: any): Promise<void> {
        const guild: Guild | undefined = role?.guild;
        if (!guild) return;
        const settings = await this.getSettings(guild.id);
        if (!settings.enabled) return;

        const attribution = await this.attribute(guild, {
            type: AuditLogEvent.RoleCreate,
            since: this.now(),
            match: (entry) => entry.targetId === role.id
        });
        if (attribution) {
            const actor = await this.resolveActor(guild, attribution);
            if (
                settings.instant.adminRoleGrant
                && hasAdministrator(role.permissions?.bitfield)
                && isAdminRoleGrantTrigger({ gainedAdministrator: true, actorIsBot: actor.isBot, targetIsSelf: false })
                && !this.exemptionReason(actor, guild, settings)
            ) {
                await this.trigger({
                    guild,
                    settings,
                    rule: 'adminRoleGrant',
                    kind: 'instant',
                    actor,
                    attribution
                });
                return;
            }
            await this.countWithAttribution(guild, 'roleCreate', settings, actor, attribution);
        } else {
            Logger.warn(`[AntiNuke] unattributed roleCreate guild=${guild.id}`);
        }
        this.schedulePositionAudit(guild);
    }

    private async onRoleDelete(role: any): Promise<void> {
        const guild: Guild | undefined = role?.guild;
        if (!guild) return;
        const settings = await this.getSettings(guild.id);
        if (!settings.enabled) return;

        const attribution = await this.attribute(guild, {
            type: AuditLogEvent.RoleDelete,
            since: this.now(),
            match: (entry) => entry.targetId === role.id
        });
        if (!attribution) {
            Logger.warn(`[AntiNuke] unattributed roleDelete guild=${guild.id}`);
            return;
        }
        const actor = await this.resolveActor(guild, attribution);
        const wasSelfDangerousRole = this.selfDangerousRoleIds.get(guild.id)?.has(role.id) === true;

        if (settings.selfDefense.enabled && wasSelfDangerousRole
            && !this.exemptionReason(actor, guild, settings)) {
            this.refreshSelfRoles(guild);
            await this.trigger({
                guild,
                settings,
                rule: 'selfTamper',
                kind: 'selfTamper',
                actor,
                attribution
            });
            return;
        }
        await this.countWithAttribution(guild, 'roleDelete', settings, actor, attribution);
        this.refreshSelfRoles(guild);
        this.schedulePositionAudit(guild);
    }

    private async onRoleUpdate(oldRole: any, newRole: any): Promise<void> {
        const guild: Guild | undefined = newRole?.guild;
        if (!guild) return;
        const settings = await this.getSettings(guild.id);
        if (!settings.enabled) return;

        const before = oldRole?.permissions?.bitfield ?? null;
        const after = newRole?.permissions?.bitfield ?? null;
        const gainedAdmin = hasAdministrator(after) && !hasAdministrator(before);
        const lostDangerous = hasDangerous(before) && !hasDangerous(after);
        const selfHasRole = guild.members.me?.roles.cache.has(newRole.id) === true;
        if (!gainedAdmin && !lostDangerous) return;

        const attribution = await this.attribute(guild, {
            type: AuditLogEvent.RoleUpdate,
            since: this.now(),
            match: (entry) => entry.targetId === newRole.id
        });
        if (!attribution) {
            Logger.warn(`[AntiNuke] unattributed roleUpdate guild=${guild.id}`);
            return;
        }
        const actor = await this.resolveActor(guild, attribution);

        if (settings.instant.adminRoleGrant
            && isAdminRoleGrantTrigger({ gainedAdministrator: gainedAdmin, actorIsBot: actor.isBot, targetIsSelf: selfHasRole })
            && !this.exemptionReason(actor, guild, settings)) {
            await this.trigger({
                guild,
                settings,
                rule: 'adminRoleGrant',
                kind: 'instant',
                actor,
                attribution
            });
            return;
        }

        if (settings.selfDefense.enabled && selfHasRole && (lostDangerous || gainedAdmin)
            && !this.exemptionReason(actor, guild, settings)) {
            await this.trigger({
                guild,
                settings,
                rule: 'selfTamper',
                kind: 'selfTamper',
                actor,
                attribution
            });
        }
        if (selfHasRole) this.refreshSelfRoles(guild);
        this.schedulePositionAudit(guild);
    }

    private async onMemberUpdate(oldMember: any, newMember: any): Promise<void> {
        const guild: Guild | undefined = newMember?.guild;
        if (!guild || !newMember?.user || newMember.partial) return;
        const settings = await this.getSettings(guild.id);
        if (!settings.enabled) return;

        const selfId = this.client?.user?.id;
        if (selfId === newMember.id) this.refreshSelfRoles(guild);
        const gainedAdmin = hasAdministrator(newMember.permissions?.bitfield)
            && !hasAdministrator(oldMember?.permissions?.bitfield);
        const selfLostRoles = selfId === newMember.id
            && oldMember?.roles?.cache
            && newMember.roles?.cache
            && oldMember.roles.cache.some((role: any) => !newMember.roles.cache.has(role.id));

        if (!gainedAdmin && !selfLostRoles) {
            if (!newMember.user.bot) return;
            this.schedulePositionAudit(guild);
            return;
        }

        const attribution = await this.attribute(guild, {
            type: AuditLogEvent.MemberRoleUpdate,
            since: this.now(),
            match: (entry) => entry.targetId === newMember.id
        });
        if (!attribution) {
            if (selfLostRoles && settings.selfDefense.enabled) {
                // Attribution failed but the defender is being stripped: warn
                // without inventing an actor.
                await this.trigger({
                    guild,
                    settings,
                    rule: 'selfTamper',
                    kind: 'selfTamper',
                    actor: unknownActor(newMember.id, newMember.user.bot === true),
                    attribution: null
                });
            } else {
                Logger.warn(`[AntiNuke] unattributed memberUpdate guild=${guild.id}`);
            }
            return;
        }
        const actor = await this.resolveActor(guild, attribution);

        if (settings.selfDefense.enabled && selfLostRoles
            && !this.exemptionReason(actor, guild, settings)) {
            await this.trigger({
                guild,
                settings,
                rule: 'selfTamper',
                kind: 'selfTamper',
                actor,
                attribution
            });
            return;
        }

        if (gainedAdmin && newMember.user.bot && settings.instant.adminRoleGrant
            && isAdminRoleGrantTrigger({ gainedAdministrator: true, actorIsBot: actor.isBot, targetIsSelf: selfId === newMember.id })
            && !this.exemptionReason(actor, guild, settings)) {
            await this.trigger({
                guild,
                settings,
                rule: 'adminRoleGrant',
                kind: 'instant',
                actor,
                attribution
            });
        }
        this.schedulePositionAudit(guild);
    }

    private async onMemberAdd(member: any): Promise<void> {
        const guild: Guild | undefined = member?.guild;
        if (!guild || !member?.user) return;
        const settings = await this.getSettings(guild.id);
        if (!settings.enabled) return;
        if (!member.user.bot) return;
        if (member.id === this.client?.user?.id) {
            this.refreshSelfRoles(guild);
            return;
        }

        const addedWithAdmin = hasAdministrator(member.permissions?.bitfield);
        if (!addedWithAdmin) return;
        if (!settings.instant.adminBotInvite) return;

        const attribution = await this.attribute(guild, {
            type: AuditLogEvent.BotAdd,
            since: this.now(),
            match: (entry) => entry.targetId === member.id
        });
        if (!attribution) {
            Logger.warn(`[AntiNuke] unattributed bot invite guild=${guild.id} bot=${member.id}`);
            return;
        }
        const adder = await this.resolveActor(guild, attribution);
        const adderExempt = this.exemptionReason(adder, guild, settings) !== null;
        if (!isAdminBotInviteTrigger({ addedBotHasAdministrator: addedWithAdmin, actorExempt: adderExempt })) {
            return;
        }
        const addedActor: NukeActorLike = {
            id: member.id,
            tag: member.user.tag || null,
            isBot: true,
            roleIds: Array.from(member.roles.cache.keys()).map(String),
            member
        };
        // A whitelisted bot joining with Administrator is not an attack.
        if (this.exemptionReason(addedActor, guild, settings)) return;
        await this.trigger({
            guild,
            settings,
            rule: 'adminBotInvite',
            kind: 'instant',
            actor: addedActor,
            attribution,
            addedBy: { id: adder.id, tag: adder.tag }
        });
    }

    private async onMemberRemove(member: any): Promise<void> {
        const guild: Guild | undefined = member?.guild;
        if (!guild || !member?.user) return;
        if (member.id === this.client?.user?.id) return;
        const settings = await this.getSettings(guild.id);
        if (!settings.enabled) return;
        if (!settings.rules.memberKick.enabled) return;
        // Only kicks have an audit entry; ordinary leaves are retried less
        // aggressively because every leave would otherwise cost two fetches.
        await this.attributeAndCount(guild, 'memberKick', settings, {
            type: AuditLogEvent.MemberKick,
            since: this.now(),
            match: (entry) => entry.targetId === member.id,
            attempts: 2,
            delayMs: 400,
            quiet: true
        });
    }

    private async onBanAdd(ban: any): Promise<void> {
        const guild: Guild | undefined = ban?.guild;
        if (!guild) return;
        const settings = await this.getSettings(guild.id);
        if (!settings.enabled) return;
        const userId = ban?.user?.id;
        if (!userId) return;
        await this.attributeAndCount(guild, 'memberBan', settings, {
            type: AuditLogEvent.MemberBanAdd,
            since: this.now(),
            match: (entry) => entry.targetId === userId
        });
    }

    private async onGuildUpdate(oldGuild: any, newGuild: any): Promise<void> {
        if (!newGuild) return;
        const settings = await this.getSettings(newGuild.id);
        if (!settings.enabled || !settings.instant.vanityNameChange) return;
        const changed = oldGuild?.name !== newGuild.name
            || (oldGuild?.vanityURLCode ?? null) !== (newGuild.vanityURLCode ?? null);
        if (!changed) return;

        const attribution = await this.attribute(newGuild, {
            type: AuditLogEvent.GuildUpdate,
            since: this.now(),
            match: (entry) => entry.targetId === newGuild.id
        });
        if (!attribution) return;
        const actor = await this.resolveActor(newGuild, attribution);
        if (!isVanityNameChangeTrigger({ actorIsBot: actor.isBot, changed })
            || this.exemptionReason(actor, newGuild, settings)) {
            return;
        }
        await this.trigger({
            guild: newGuild,
            settings,
            rule: 'vanityNameChange',
            kind: 'instant',
            actor,
            attribution
        });
    }

    private async onWebhooksUpdate(channel: any): Promise<void> {
        const guild: Guild | undefined = channel?.guild;
        if (!guild || typeof channel?.fetchWebhooks !== 'function') return;
        const settings = await this.getSettings(guild.id);
        if (!settings.enabled) return;
        const hooks = await channel.fetchWebhooks().catch(() => null);
        const hookIds = new Set<string>((hooks ? Array.from(hooks.keys()) : []) as string[]);
        await this.attributeAndCount(guild, 'webhookCreate', settings, {
            type: AuditLogEvent.WebhookCreate,
            since: this.now(),
            match: (entry) => hookIds.has(String(entry.targetId)) || entry.extra?.channelId === channel.id
        });
    }

    private async onEmojiDelete(target: any, type: AuditLogEvent): Promise<void> {
        const guild: Guild | undefined = target?.guild;
        if (!guild) return;
        const settings = await this.getSettings(guild.id);
        if (!settings.enabled) return;
        await this.attributeAndCount(guild, 'emojiDelete', settings, {
            type,
            since: this.now(),
            match: (entry) => entry.targetId === target.id
        });
    }

    // ------------------------------------------------------------------
    // Response (brief AN1 §B)
    // ------------------------------------------------------------------

    private async trigger(input: TriggerInput): Promise<void> {
        const { guild, settings, actor, rule } = input;
        const cooldownKey = `${guild.id}:${actor.id}`;
        const cooldownUntil = this.triggerCooldowns.get(cooldownKey) || 0;
        if (this.now() < cooldownUntil) return;
        this.triggerCooldowns.set(cooldownKey, this.now() + TRIGGER_COOLDOWN_MS);

        const detectedAt = this.now();
        const windowStartMs = input.hit?.windowStart ?? detectedAt - 60_000;
        const snapshotId = await this.resolveLatestSnapshotId(guild.id);
        const reason = input.hit
            ? banReason(rule, `${input.hit.count}/${input.hit.threshold} in ${input.hit.windowSeconds}s`)
            : banReason(rule);

        const incident: AntiNukeIncident = {
            id: `nuke-${guild.id}-${detectedAt}-${Math.random().toString(36).slice(2, 8)}`,
            guildId: guild.id,
            guildName: guild.name,
            rule,
            ruleLabel: ruleLabel(rule),
            kind: input.kind,
            actorId: actor.id || null,
            actorTag: actor.tag,
            actorIsBot: actor.isBot,
            addedById: input.addedBy?.id ?? null,
            count: input.hit?.count,
            threshold: input.hit?.threshold,
            windowSeconds: input.hit?.windowSeconds,
            windowStart: new Date(windowStartMs).toISOString(),
            startedAt: new Date(windowStartMs).toISOString(),
            detectedAt: new Date(detectedAt).toISOString(),
            snapshotId,
            affected: emptyAffected(),
            actions: {
                ban: 'skipped',
                rolesStripped: false,
                logPosted: false,
                ownerDm: 'skipped'
            },
            status: 'open',
            attribution: input.attribution ? 'audit' : 'none'
        };

        // 1. Persist the snapshot marker / draft incident before acting.
        await this.persistIncident(incident);

        // 2. Ban immediately (single API call in the common path).
        const selfId = this.client?.user?.id;
        const protectedReason = !actor.id
            ? '実行者を特定できませんでした'
            : actor.id === selfId
                ? 'このBot自身のためBANしません'
                : actor.id === guild.ownerId
                    ? 'サーバー所有者のためBANしません'
                    : null;
        let banResult: { ok: boolean; error?: string } | null = null;
        if (protectedReason) {
            incident.actions.ban = 'skipped';
            incident.actions.banError = protectedReason;
        } else {
            banResult = await this.banActor(guild, actor.id, reason);
            if (banResult.ok) {
                incident.actions.ban = 'success';
            } else {
                incident.actions.ban = 'failed';
                incident.actions.banError = banResult.error;
                // Ban failed (hierarchy): strip the actor's roles.
                const stripResult = await this.stripActorRoles(guild, actor.id, reason);
                incident.actions.rolesStripped = stripResult.ok;
                if (!stripResult.ok) incident.actions.stripError = stripResult.error;
            }
        }

        // 3. Log channel + owner DM, then 4. final incident record.
        incident.affected = await this.collectAffected(guild, actor.id, windowStartMs);
        if (incident.affected.membersBanned.length === 0 && banResult?.ok) {
            incident.affected.membersBanned.push(actor.id);
        }
        await this.persistIncident(incident);

        const embed = this.buildIncidentEmbed(incident);
        incident.actions.logPosted = await this.postToLogChannel(guild, embed);
        const dm = await this.dmOwner(guild, settings, embed, null);
        incident.actions.ownerDm = dm.status;
        if (dm.error) incident.actions.ownerDmError = dm.error;
        await this.persistIncident(incident);

        Logger.warn(
            `[AntiNuke] incident ${incident.id} guild=${guild.id} rule=${rule} actor=${actor.id} `
            + `ban=${incident.actions.ban} strip=${incident.actions.rolesStripped} snapshot=${snapshotId ?? 'none'}`
        );
    }

    private async banActor(guild: Guild, actorId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
        if (this.responseHooks.ban) return this.responseHooks.ban(guild, actorId, reason);
        try {
            await guild.bans.create(actorId, { reason });
            return { ok: true };
        } catch (error) {
            const info = discordErrorInfo(error);
            Logger.warn(`[AntiNuke] ban failed for ${actorId} in ${guild.id}: ${info.message}`);
            return { ok: false, error: info.message };
        }
    }

    private async stripActorRoles(guild: Guild, actorId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
        if (this.responseHooks.strip) return this.responseHooks.strip(guild, actorId, reason);
        const member: GuildMember | null = guild.members.cache.get(actorId)
            || await guild.members.fetch(actorId).catch(() => null);
        if (!member) {
            return { ok: false, error: 'メンバーが退出済みのためロールを剥奪できません' };
        }
        if (!member.manageable) {
            return { ok: false, error: 'ロール階層が低いためロールを剥奪できません' };
        }
        const keep = member.roles.cache.filter((role: any) => role.managed).map((role: any) => role.id);
        const removable = member.roles.cache.filter((role: any) => role.id !== guild.id && !role.managed);
        if (removable.size === 0) {
            return { ok: false, error: '剥奪できるロールがありません（すべて管理ロール）' };
        }
        try {
            await member.roles.set(keep, reason);
            return { ok: true };
        } catch (error) {
            return { ok: false, error: discordErrorInfo(error).message };
        }
    }

    private async collectAffected(guild: Guild, actorId: string, windowStartMs: number): Promise<AntiNukeAffected> {
        const affected = emptyAffected();
        if (!actorId) return affected;
        const entries = await collectActorAuditEntries(guild, actorId, windowStartMs);
        for (const entry of entries) {
            if (!entry.targetId) continue;
            switch (entry.action) {
                case AuditLogEvent.ChannelDelete: pushUnique(affected.channelsDeleted, entry.targetId); break;
                case AuditLogEvent.RoleDelete: pushUnique(affected.rolesDeleted, entry.targetId); break;
                case AuditLogEvent.MemberBanAdd: pushUnique(affected.membersBanned, entry.targetId); break;
                case AuditLogEvent.MemberKick: pushUnique(affected.membersKicked, entry.targetId); break;
                case AuditLogEvent.ChannelCreate: pushUnique(affected.channelsCreated, entry.targetId); break;
                case AuditLogEvent.RoleCreate: pushUnique(affected.rolesCreated, entry.targetId); break;
                case AuditLogEvent.WebhookCreate: pushUnique(affected.webhooksCreated, entry.targetId); break;
                case AuditLogEvent.EmojiDelete:
                case AuditLogEvent.StickerDelete: pushUnique(affected.emojisDeleted, entry.targetId); break;
                default: break;
            }
        }
        return affected;
    }

    private buildIncidentEmbed(incident: AntiNukeIncident): EmbedBuilder {
        const banned = incident.actions.ban === 'success';
        const color: ColorResolvable = banned
            ? Colors.DarkRed
            : incident.actions.rolesStripped ? Colors.Orange : Colors.Red;
        const actionLines: string[] = [];
        if (banned) {
            actionLines.push('✅ BAN 成功');
        } else if (incident.actions.ban === 'failed') {
            actionLines.push(`❌ BAN 失敗: ${incident.actions.banError || '理由不明'}`);
            actionLines.push(incident.actions.rolesStripped
                ? '✅ 代替: ロール剥奪 成功'
                : `❌ 代替のロール剥奪も失敗: ${incident.actions.stripError || '理由不明'}`);
        } else {
            actionLines.push(`⚠️ BAN 未実施: ${incident.actions.banError || '対象外または実行者不明'}`);
        }
        actionLines.push(incident.actions.logPosted ? 'ログ通知: 送信済み' : 'ログ通知: 送信できませんでした');
        actionLines.push(
            incident.actions.ownerDm === 'sent'
                ? 'オーナーDM: 送信済み'
                : incident.actions.ownerDm === 'failed'
                    ? `オーナーDM: 失敗（${incident.actions.ownerDmError || 'DM不可'}）`
                    : 'オーナーDM: 未設定'
        );

        const countText = incident.count !== undefined && incident.threshold !== undefined
            ? `${incident.count}/${incident.threshold}（${incident.windowSeconds ?? 60}秒）`
            : '即時ルール';
        const affectedLines = [
            `削除チャンネル: ${incident.affected.channelsDeleted.length}`,
            `削除ロール: ${incident.affected.rolesDeleted.length}`,
            `BAN: ${incident.affected.membersBanned.length}`,
            `キック: ${incident.affected.membersKicked.length}`,
            `作成チャンネル: ${incident.affected.channelsCreated.length}`,
            `作成ロール: ${incident.affected.rolesCreated.length}`,
            `Webhook: ${incident.affected.webhooksCreated.length}`,
            `絵文字/ステッカー: ${incident.affected.emojisDeleted.length}`
        ];

        const embed = new EmbedBuilder()
            .setTitle('🚨 AntiNuke 発動')
            .setColor(color)
            .setTimestamp(new Date(incident.detectedAt))
            .setDescription('破壊的行為を検知したため、実行者への即時対応を試行しました。')
            .addFields(
                {
                    name: '実行者',
                    value: incident.actorId
                        ? `${incident.actorTag || incident.actorId} (${incident.actorId})${incident.actorIsBot ? ' [BOT]' : ''}`
                        : '特定できませんでした（監査ログ未取得）',
                    inline: false
                },
                { name: 'ルール', value: `${incident.ruleLabel} (${incident.rule})`, inline: true },
                { name: 'カウント', value: countText, inline: true },
                { name: '対応', value: actionLines.join('\n').slice(0, 1024), inline: false },
                { name: '被害（監査ログ範囲）', value: affectedLines.join(' / '), inline: false },
                {
                    name: '復元用スナップショット',
                    value: incident.snapshotId
                        ? `\`${incident.snapshotId}\`（復元機能はAN2で提供）`
                        : 'なし（AN2のスナップショット未取得）',
                    inline: false
                }
            )
            .setFooter({ text: `AntiNuke / incident ${incident.id}` });

        if (incident.addedById) {
            embed.addFields({ name: 'BOTを追加した実行者', value: incident.addedById, inline: false });
        }
        return embed;
    }

    private async postToLogChannel(
        guild: Guild,
        embed: EmbedBuilder
    ): Promise<boolean> {
        try {
            const antiCheatSettings = await antiCheatManager.getSettings(guild.id);
            const channelId = antiCheatSettings.logChannelId;
            if (!channelId) return false;
            const channel = await this.fetchTextChannel(guild, channelId);
            if (!channel) return false;
            await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
            return true;
        } catch (error) {
            Logger.debug(`[AntiNuke] log post failed guild=${guild.id}: ${String(error)}`);
            return false;
        }
    }

    private async fetchTextChannel(guild: Guild, channelId: string): Promise<TextChannel | null> {
        const cached = guild.channels.cache.get(channelId);
        if (cached?.isTextBased()) return cached as TextChannel;
        return guild.channels.fetch(channelId).then((channel) => channel as TextChannel | null).catch(() => null);
    }

    private async dmOwner(
        guild: Guild,
        settings: AntiNukeSettings,
        embed: EmbedBuilder,
        extraLines: string[] | null
    ): Promise<{ status: 'sent' | 'failed' | 'skipped'; error?: string }> {
        if (!settings.selfDefense.ownerDm) return { status: 'skipped' };
        const ownerId = guild.ownerId || await guild.fetchOwner().then((owner) => owner.id).catch(() => null);
        if (!ownerId || !this.client) return { status: 'failed', error: 'サーバー所有者を特定できません' };
        try {
            const user: User = await this.client.users.fetch(ownerId);
            const finalEmbed = extraLines?.length
                ? EmbedBuilder.from(embed).addFields({ name: '復旧', value: extraLines.join('\n').slice(0, 1024), inline: false })
                : embed;
            await user.send({ embeds: [finalEmbed], allowedMentions: { parse: [] } });
            return { status: 'sent' };
        } catch (error) {
            const info = discordErrorInfo(error);
            // 50007 = cannot send messages to this user (DMs closed).
            return { status: 'failed', error: info.code === 50007 ? 'オーナーのDMが閉じています' : info.message };
        }
    }

    // ------------------------------------------------------------------
    // Self-defense (brief AN1 §C)
    // ------------------------------------------------------------------

    private async onGuildDelete(guild: any): Promise<void> {
        if (!guild?.id) return;
        // available === false means a Discord outage, not our removal.
        if (guild.available === false) return;
        const selfId = this.client?.user?.id;
        if (!selfId) return;

        const attribution = await this.attribute(guild, {
            type: AuditLogEvent.MemberKick,
            since: this.now() - 30_000,
            match: (entry) => entry.targetId === selfId,
            attempts: 2,
            delayMs: 400
        }).catch(() => null);

        const settings = await this.getSettings(guild.id).catch(() => null);
        const detectedAt = this.now();
        const incident: AntiNukeIncident = {
            id: `nuke-${guild.id}-${detectedAt}-${Math.random().toString(36).slice(2, 8)}`,
            guildId: guild.id,
            guildName: guild.name || guild.id,
            rule: 'selfKick',
            ruleLabel: ruleLabel('selfKick'),
            kind: 'selfKick',
            actorId: attribution?.executorId ?? null,
            actorTag: attribution?.executorTag ?? null,
            actorIsBot: attribution?.executorIsBot === true,
            windowStart: new Date(detectedAt).toISOString(),
            startedAt: new Date(detectedAt).toISOString(),
            detectedAt: new Date(detectedAt).toISOString(),
            snapshotId: await this.resolveLatestSnapshotId(guild.id).catch(() => null),
            affected: emptyAffected(),
            actions: {
                ban: 'skipped',
                rolesStripped: false,
                logPosted: false,
                ownerDm: 'skipped'
            },
            status: 'open',
            attribution: attribution ? 'audit' : 'none'
        };
        await this.persistIncident(incident);

        const reinvite = this.client?.user?.id
            ? buildReinviteUrl(this.client.user.id)
            : null;
        const lines = [
            'このBotがサーバーから削除されました（キックまたはBAN）。',
            attribution
                ? `実行者（監査ログ）: ${attribution.executorTag || attribution.executorId} (${attribution.executorId})`
                : '実行者は特定できませんでした（削除後は監査ログを読めないため）。',
            ...(reinvite ? [`再招待URL（必要権限を付与済み）: ${reinvite}`] : [])
        ];
        const embed = this.buildIncidentEmbed(incident);
        if (settings) {
            incident.actions.ownerDm = 'skipped';
            const dm = await this.dmOwner(guild, settings, embed, lines);
            incident.actions.ownerDm = dm.status;
            if (dm.error) incident.actions.ownerDmError = dm.error;
        }
        await this.persistIncident(incident);
        Logger.warn(`[AntiNuke] self-kick detected guild=${guild.id} actor=${attribution?.executorId ?? 'unknown'}`);
    }

    private async onGuildCreate(guild: any): Promise<void> {
        if (!guild?.id) return;
        const incidents = await this.readIncidents(guild.id).catch(() => []);
        const snapshotId = await this.resolveLatestSnapshotId(guild.id).catch(() => null);
        if (!incidents.length && !snapshotId) return;
        // Only announce a restitution window for a recent self-kick that has
        // not been announced yet: quiet on ordinary restarts.
        const pending = incidents.find((entry) =>
            entry?.kind === 'selfKick' && entry.status === 'open'
        );
        if (!pending && !snapshotId) return;
        const announceKey = `${guild.id}:${snapshotId || pending?.id || 'unknown'}`;
        if (this.announcedRejoins.has(announceKey)) return;
        this.announcedRejoins.add(announceKey);
        this.refreshSelfRoles(guild);

        const settings = await this.getSettings(guild.id).catch(() => null);
        const lines = [
            snapshotId
                ? `復元可能なスナップショット: \`${snapshotId}\``
                : 'スナップショットはまだありません（AN2の復元エンジン待ち）。',
            `記録済みインシデント: ${incidents.length} 件`
        ];
        const embed = new EmbedBuilder()
            .setTitle('🛡️ AntiNuke: 復元情報があります')
            .setColor(Colors.Blue)
            .setDescription('このサーバーにはAntiNukeのインシデント記録が残っています。')
            .setFooter({ text: 'AntiNuke / rejoin' });
        if (settings) {
            await this.dmOwner(guild, settings, embed, lines).catch(() => null);
        }
    }

    private refreshSelfRoles(guild: Guild): void {
        const me = guild.members.me;
        if (!me) return;
        const dangerous = new Set<string>();
        for (const role of me.roles.cache.values()) {
            if (role.id === guild.id) continue;
            if (roleHoldsDangerous(role)) dangerous.add(role.id);
        }
        this.selfDangerousRoleIds.set(guild.id, dangerous);
    }

    private schedulePositionAudit(guild: Guild): void {
        const existing = this.positionTimers.get(guild.id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
            this.positionTimers.delete(guild.id);
            void this.getSettings(guild.id)
                .then((settings) => this.auditPositions(guild, settings))
                .catch((error) => Logger.debug(`[AntiNuke] position audit failed: ${String(error)}`));
        }, POSITION_AUDIT_DEBOUNCE_MS);
        timer.unref?.();
        this.positionTimers.set(guild.id, timer);
    }

    private async runStartupChecks(): Promise<void> {
        const client = this.client;
        if (!client) return;
        for (const guild of client.guilds.cache.values()) {
            try {
                const settings = await this.getSettings(guild.id);
                this.refreshSelfRoles(guild);
                if (settings.enabled && settings.selfDefense.positionAudit) {
                    await this.auditPositions(guild, settings);
                }
            } catch (error) {
                Logger.debug(`[AntiNuke] startup check failed for ${guild.id}: ${String(error)}`);
            }
        }
    }

    /**
     * Warn the owner when a non-whitelisted bot or role sits above this bot and
     * holds dangerous permissions. Warns once per state change only.
     */
    async auditPositions(guild: Guild, settings: AntiNukeSettings): Promise<string[]> {
        if (!settings.enabled || !settings.selfDefense.positionAudit) return [];
        const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
        if (!me) return [];
        const myTop = me.roles.highest.position;
        const offenders: string[] = [];

        const roles = await guild.roles.fetch().catch(() => null);
        if (roles) {
            for (const role of roles.values()) {
                if (role.id === guild.id) continue;
                if (role.position <= myTop) continue;
                if (settings.whitelistRoles.includes(role.id)) continue;
                if (role.managed) continue;
                if (!roleHoldsDangerous(role)) continue;
                offenders.push(`ロール「${role.name}」(${role.id})`);
            }
        }
        for (const member of guild.members.cache.values()) {
            if (!member.user?.bot || member.id === me.id) continue;
            if (settings.whitelistBots.includes(member.id)) continue;
            const top = member.roles.highest;
            if (!top || top.position <= myTop) continue;
            if (!member.permissions?.has(PermissionFlagsBits.Administrator)
                && !POSITION_AUDIT_PERMISSIONS.some((permission) => member.permissions?.has(permission))) {
                continue;
            }
            offenders.push(`BOT「${member.user.tag}」(${member.id})`);
        }

        const state = offenders.sort().join('|');
        if (this.positionStates.get(guild.id) === state) return offenders;
        this.positionStates.set(guild.id, state);
        if (!offenders.length) return offenders;

        const embed = new EmbedBuilder()
            .setTitle('⚠️ AntiNuke: ロール位置の警告')
            .setColor(Colors.Orange)
            .setDescription(
                '次のアクターはこのBotより上位にあり、危険な権限を持っています。'
                + 'このBotが動く前にロールを外したりキックしたりできます。'
            )
            .addFields({
                name: '該当アクター',
                value: offenders.slice(0, 15).join('\n').slice(0, 1024),
                inline: false
            })
            .addFields({
                name: '対処',
                value: 'このBotのロールを対象アクターより上へ移動するか、不要な権限を外してください。',
                inline: false
            })
            .setFooter({ text: 'AntiNuke / position audit' });
        await Promise.allSettled([
            this.dmOwner(guild, settings, embed, null),
            this.postToLogChannel(guild, embed)
        ]);
        Logger.warn(`[AntiNuke] position audit guild=${guild.id} offenders=${offenders.length}`);
        return offenders;
    }

    // ------------------------------------------------------------------
    // Persistence
    // ------------------------------------------------------------------

    private enqueueIncidentWrite(guildId: string, task: () => Promise<void>): Promise<void> {
        const previous = this.incidentWrites.get(guildId) || Promise.resolve();
        const next = previous.catch(() => undefined).then(task);
        this.incidentWrites.set(guildId, next);
        return next;
    }

    private async persistIncident(incident: AntiNukeIncident): Promise<void> {
        await this.enqueueIncidentWrite(incident.guildId, async () => {
            const key = ANTINUKE_INCIDENTS_KEY(incident.guildId);
            const existing = await database.get<AntiNukeIncident[]>(incident.guildId, key).catch(() => null);
            const list = Array.isArray(existing) ? existing.slice() : [];
            const index = list.findIndex((entry) => entry?.id === incident.id);
            if (index >= 0) list[index] = incident;
            else list.unshift(incident);
            await database.set(incident.guildId, key, list.slice(0, MAX_INCIDENTS_PER_GUILD));
        }).catch((error) => {
            Logger.error('[AntiNuke] failed to persist incident:', error);
        });
    }

    async readIncidents(guildId: string): Promise<AntiNukeIncident[]> {
        const stored = await database.get<AntiNukeIncident[]>(guildId, ANTINUKE_INCIDENTS_KEY(guildId)).catch(() => null);
        return Array.isArray(stored) ? stored : [];
    }

    /**
     * Close the incidents a restore consumed so the next unban window does not
     * keep growing. Only `open` records change; resolved ones stay as they are.
     */
    async markIncidentsRestored(guildId: string, incidentIds: readonly string[]): Promise<number> {
        if (!incidentIds.length) return 0;
        const wanted = new Set(incidentIds);
        let updated = 0;
        await this.enqueueIncidentWrite(guildId, async () => {
            const key = ANTINUKE_INCIDENTS_KEY(guildId);
            const stored = await database.get<AntiNukeIncident[]>(guildId, key).catch(() => null);
            if (!Array.isArray(stored)) return;
            let changed = false;
            for (const incident of stored) {
                if (!incident || !wanted.has(incident.id) || incident.status !== 'open') continue;
                incident.status = 'restored';
                changed = true;
                updated += 1;
            }
            if (changed) await database.set(guildId, key, stored);
        });
        return updated;
    }

    /** Latest snapshot pointer written by AN2, or null when none exists. */
    async resolveLatestSnapshotId(guildId: string): Promise<string | null> {
        const stored = await database.get<any>(guildId, ANTINUKE_SNAPSHOTS_KEY(guildId)).catch(() => null);
        if (!stored) return null;
        if (typeof stored === 'string') return stored;
        if (typeof stored.latestSnapshotId === 'string') return stored.latestSnapshotId;
        if (typeof stored.latest?.id === 'string') return stored.latest.id;
        const list = Array.isArray(stored) ? stored : Array.isArray(stored.snapshots) ? stored.snapshots : [];
        const latest = list[list.length - 1];
        return typeof latest === 'string' ? latest : typeof latest?.id === 'string' ? latest.id : null;
    }
}

function ruleLabel(rule: NukeRuleKey): string {
    return NUKE_RULE_LABELS[rule] || rule;
}

function hasDangerous(permissions: bigint | null | undefined): boolean {
    if (typeof permissions !== 'bigint') return false;
    return POSITION_AUDIT_PERMISSIONS.some((permission) => (permissions & permission) === permission);
}

function roleHoldsDangerous(role: any): boolean {
    if (typeof role?.permissions?.has !== 'function') return false;
    return POSITION_AUDIT_PERMISSIONS.some((permission) => role.permissions.has(permission));
}

function unknownActor(id: string, isBot: boolean): NukeActorLike {
    return { id, tag: null, isBot, roleIds: [], member: null };
}

function pushUnique(list: string[], value: string): void {
    if (!list.includes(value)) list.push(value);
}

const GLOBAL_KEY = '__antiNukeManager_v1';
if (!(global as any)[GLOBAL_KEY]) {
    (global as any)[GLOBAL_KEY] = new AntiNukeManager();
}
export const antiNukeManager: AntiNukeManager = (global as any)[GLOBAL_KEY];
