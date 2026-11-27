import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits } from 'discord.js';
import {
    AntiNukeSettings,
    NukeVelocityTracker,
    banReason,
    buildReinviteUrl,
    discordErrorInfo,
    isAdminBotInviteTrigger,
    isAdminRoleGrantTrigger,
    isVanityNameChangeTrigger,
    nukeExemptionReason,
    readAntiNukeSettings
} from '../src/core/anticheat/AntiNuke.ts';
import { AntiNukeManager } from '../src/core/anticheat/AntiNukeManager.ts';

const NOW = 1_700_000_000_000;

const settings = (): AntiNukeSettings => readAntiNukeSettings(undefined);

const actor = (id: string, isBot = false) => ({
    id,
    tag: `${id}#0001`,
    isBot,
    roleIds: [] as string[],
    member: null
});

const fakeGuild = (overrides: Record<string, any> = {}): any => ({
    id: 'guild',
    name: 'Guild',
    ownerId: 'owner',
    members: {
        cache: new Collection(),
        fetch: async () => null,
        fetchMe: async () => null
    },
    bans: { create: async () => undefined },
    channels: { cache: new Collection(), fetch: async () => null },
    roles: { fetch: async () => new Collection() },
    fetchAuditLogs: async () => ({ entries: new Collection() }),
    fetchOwner: async () => ({ id: 'owner' }),
    ...overrides
});

/** Manager with persistence, log and DM stubbed out; returns captured state. */
function setupManager() {
    const manager = new AntiNukeManager();
    manager.setClock(() => NOW);
    (manager as any).client = {
        user: { id: 'self-bot' },
        users: { fetch: async () => ({ send: async () => undefined }) }
    };
    const incidents: any[] = [];
    const order: string[] = [];
    (manager as any).persistIncident = async (incident: any) => {
        order.push(`persist:${incident.actions.ban}`);
        incidents.push(structuredClone(incident));
    };
    (manager as any).resolveLatestSnapshotId = async () => 'snap-1';
    (manager as any).collectAffected = async () => ({
        channelsDeleted: [],
        rolesDeleted: [],
        membersBanned: [],
        membersKicked: [],
        channelsCreated: [],
        rolesCreated: [],
        webhooksCreated: [],
        emojisDeleted: []
    });
    (manager as any).postToLogChannel = async () => true;
    const dms: any[] = [];
    (manager as any).dmOwner = async (_guild: any, _settings: any, embed: any) => {
        dms.push(embed);
        return { status: 'sent' as const };
    };
    return { manager, incidents, order, dms };
}

// ---------------------------------------------------------------------------
// Velocity windows (pure)
// ---------------------------------------------------------------------------

test('velocity: below threshold does not trigger, threshold does', () => {
    const tracker = new NukeVelocityTracker();
    const hit1 = tracker.record('g', 'channelDelete', 'actor', NOW, 3, 60_000);
    const hit2 = tracker.record('g', 'channelDelete', 'actor', NOW + 1_000, 3, 60_000);
    assert.equal(hit1.exceeded, false);
    assert.equal(hit2.exceeded, false);
    assert.equal(hit2.count, 2);
    const hit3 = tracker.record('g', 'channelDelete', 'actor', NOW + 2_000, 3, 60_000);
    assert.equal(hit3.exceeded, true);
    assert.equal(hit3.count, 3);
    assert.equal(hit3.windowSeconds, 60);
    assert.equal(hit3.windowStart, NOW);
});

test('velocity: events outside the window are dropped', () => {
    const tracker = new NukeVelocityTracker();
    tracker.record('g', 'roleDelete', 'actor', NOW, 3, 60_000);
    tracker.record('g', 'roleDelete', 'actor', NOW + 30_000, 3, 60_000);
    const afterWindow = tracker.record('g', 'roleDelete', 'actor', NOW + 61_000, 3, 60_000);
    assert.equal(afterWindow.count, 2);
    assert.equal(afterWindow.exceeded, false);
    assert.equal(afterWindow.windowStart, NOW + 30_000);
});

test('velocity: buckets are isolated per actor and per action', () => {
    const tracker = new NukeVelocityTracker();
    tracker.record('g', 'memberBan', 'a', NOW, 2, 60_000);
    tracker.record('g', 'memberBan', 'a', NOW + 1, 2, 60_000);
    const otherActor = tracker.record('g', 'memberBan', 'b', NOW + 2, 2, 60_000);
    const otherAction = tracker.record('g', 'memberKick', 'a', NOW + 3, 2, 60_000);
    assert.equal(otherActor.count, 1);
    assert.equal(otherActor.exceeded, false);
    assert.equal(otherAction.count, 1);
    assert.equal(otherAction.exceeded, false);
    const otherGuild = tracker.record('other-guild', 'memberBan', 'a', NOW + 4, 2, 60_000);
    assert.equal(otherGuild.count, 1);
});

test('velocity: defaults match brief AN1 thresholds', () => {
    const defaults = settings();
    assert.equal(defaults.enabled, true);
    assert.deepEqual(
        Object.fromEntries(Object.entries(defaults.rules).map(([key, value]) => [key, value.threshold])),
        {
            channelDelete: 3,
            roleDelete: 3,
            memberBan: 4,
            memberKick: 5,
            channelCreate: 8,
            roleCreate: 8,
            webhookCreate: 3,
            emojiDelete: 3
        }
    );
    for (const rule of Object.values(defaults.rules)) {
        assert.equal(rule.windowSeconds, 60);
        assert.equal(rule.enabled, true);
    }
});

test('settings: malformed values fall back and whitelists are sanitised', () => {
    const parsed = readAntiNukeSettings({
        enabled: 0,
        whitelistUsers: ['123456', '123456', 'not-an-id', '', '999999'],
        whitelistRoles: 'nope',
        rules: { channelDelete: { enabled: 1, threshold: 1, windowSeconds: 0 } },
        selfDefense: { ownerDm: 0 }
    });
    assert.equal(parsed.enabled, false);
    assert.deepEqual(parsed.whitelistUsers, ['123456', '999999']);
    assert.deepEqual(parsed.whitelistRoles, []);
    assert.equal(parsed.rules.channelDelete.threshold, 2);
    assert.equal(parsed.rules.channelDelete.windowSeconds, 5);
    assert.equal(parsed.rules.roleDelete.threshold, 3);
    assert.equal(parsed.selfDefense.ownerDm, false);
});

// ---------------------------------------------------------------------------
// Exemptions
// ---------------------------------------------------------------------------

test('exemptions: owner, self, whitelisted users/bots/roles', () => {
    const base = settings();
    base.whitelistUsers = ['trusted-user'];
    base.whitelistBots = ['trusted-bot'];
    base.whitelistRoles = ['trusted-role'];

    assert.equal(nukeExemptionReason({
        actorId: 'owner', guildOwnerId: 'owner', selfId: 'self-bot', isBot: false, roleIds: [], settings: base
    }), 'サーバー所有者');
    assert.equal(nukeExemptionReason({
        actorId: 'self-bot', guildOwnerId: 'owner', selfId: 'self-bot', isBot: true, roleIds: [], settings: base
    }), 'このBot自身');
    assert.equal(nukeExemptionReason({
        actorId: 'trusted-user', guildOwnerId: 'owner', selfId: 'self-bot', isBot: false, roleIds: [], settings: base
    }), 'ホワイトリスト（ユーザー）');
    assert.equal(nukeExemptionReason({
        actorId: 'trusted-bot', guildOwnerId: 'owner', selfId: 'self-bot', isBot: true, roleIds: [], settings: base
    }), 'ホワイトリスト（BOT）');
    assert.equal(nukeExemptionReason({
        actorId: 'member', guildOwnerId: 'owner', selfId: 'self-bot', isBot: false, roleIds: ['trusted-role'], settings: base
    }), 'ホワイトリスト（ロール trusted-role）');
    assert.equal(nukeExemptionReason({
        actorId: 'intruder', guildOwnerId: 'owner', selfId: 'self-bot', isBot: false, roleIds: [], settings: base
    }), null);
});

test('exemptions: a human is not exempt just because whitelistBots matches their id', () => {
    const base = settings();
    base.whitelistBots = ['some-id'];
    assert.equal(nukeExemptionReason({
        actorId: 'some-id', guildOwnerId: 'owner', selfId: 'self-bot', isBot: false, roleIds: [], settings: base
    }), null);
});

// ---------------------------------------------------------------------------
// Instant rules (pure)
// ---------------------------------------------------------------------------

test('instant: administrator role grant by a bot or to this bot', () => {
    assert.equal(isAdminRoleGrantTrigger({ gainedAdministrator: true, actorIsBot: true, targetIsSelf: false }), true);
    assert.equal(isAdminRoleGrantTrigger({ gainedAdministrator: true, actorIsBot: false, targetIsSelf: false }), false);
    assert.equal(isAdminRoleGrantTrigger({ gainedAdministrator: true, actorIsBot: false, targetIsSelf: true }), true);
    assert.equal(isAdminRoleGrantTrigger({ gainedAdministrator: false, actorIsBot: true, targetIsSelf: true }), false);
});

test('instant: admin-invited bot needs a non-exempt adder', () => {
    assert.equal(isAdminBotInviteTrigger({ addedBotHasAdministrator: true, actorExempt: false }), true);
    assert.equal(isAdminBotInviteTrigger({ addedBotHasAdministrator: true, actorExempt: true }), false);
    assert.equal(isAdminBotInviteTrigger({ addedBotHasAdministrator: false, actorExempt: false }), false);
});

test('instant: vanity/name change only from a bot', () => {
    assert.equal(isVanityNameChangeTrigger({ actorIsBot: true, changed: true }), true);
    assert.equal(isVanityNameChangeTrigger({ actorIsBot: false, changed: true }), false);
    assert.equal(isVanityNameChangeTrigger({ actorIsBot: true, changed: false }), false);
});

test('reason and hierarchy helpers', () => {
    assert.equal(banReason('channelDelete', '3/3 in 60s'), 'AntiNuke: channelDelete (3/3 in 60s)');
    const hierarchy = discordErrorInfo({ code: 50013 });
    assert.equal(hierarchy.hierarchy, true);
    assert.match(hierarchy.message, /権限不足/);
    const plain = discordErrorInfo(new Error('boom'));
    assert.equal(plain.hierarchy, false);
    assert.match(buildReinviteUrl('123'), /client_id=123/);
    assert.match(buildReinviteUrl('123'), /permissions=\d+/);
});

// ---------------------------------------------------------------------------
// Manager: response ordering + ban failure fallback
// ---------------------------------------------------------------------------

test('response: ban is attempted before the role-strip fallback, snapshot first', async () => {
    const { manager, incidents, order } = setupManager();
    const sequence: string[] = [];
    manager.setResponseHooks({
        ban: async () => {
            sequence.push('ban');
            return { ok: false, error: '権限不足またはロール階層が低いため実行できません（50013）' };
        },
        strip: async () => {
            sequence.push('strip');
            return { ok: true };
        }
    });
    const persist = (manager as any).persistIncident;
    (manager as any).persistIncident = async (incident: any) => {
        sequence.push(`persist:${incident.actions.ban}`);
        await persist(incident);
    };

    await (manager as any).trigger({
        guild: fakeGuild(),
        settings: settings(),
        rule: 'channelDelete',
        kind: 'velocity',
        actor: actor('attacker'),
        hit: { count: 3, threshold: 3, windowSeconds: 60, exceeded: true, windowStart: NOW - 30_000 },
        attribution: {
            entryId: 'e1', executorId: 'attacker', executorTag: 'attacker#0001',
            executorIsBot: false, targetId: 'chan', action: 12, createdAt: NOW
        }
    });

    assert.deepEqual(sequence, ['persist:skipped', 'ban', 'strip', 'persist:failed', 'persist:failed']);
    const first = incidents[0];
    assert.equal(first.snapshotId, 'snap-1');
    assert.equal(first.status, 'open');
    assert.equal(new Date(first.windowStart).getTime(), NOW - 30_000);
    const final = incidents[incidents.length - 1];
    assert.equal(final.actions.ban, 'failed');
    assert.equal(final.actions.rolesStripped, true);
    assert.equal(final.actions.ownerDm, 'sent');
    assert.match(final.actions.banError, /階層/);
    assert.deepEqual(order, ['persist:skipped', 'persist:failed', 'persist:failed']);
});

test('response: ban and strip both failing are reported, never as success', async () => {
    const { manager, incidents, dms } = setupManager();
    manager.setResponseHooks({
        ban: async () => ({ ok: false, error: '権限不足またはロール階層が低いため実行できません（50013）' }),
        strip: async () => ({ ok: false, error: 'ロール階層が低いためロールを剥奪できません' })
    });

    await (manager as any).trigger({
        guild: fakeGuild(),
        settings: settings(),
        rule: 'roleDelete',
        kind: 'velocity',
        actor: actor('attacker'),
        hit: { count: 3, threshold: 3, windowSeconds: 60, exceeded: true, windowStart: NOW - 10_000 }
    });

    const final = incidents[incidents.length - 1];
    assert.equal(final.actions.ban, 'failed');
    assert.equal(final.actions.rolesStripped, false);
    assert.match(final.actions.stripError, /剥奪できません/);
    const embed = dms[dms.length - 1].toJSON ? dms[dms.length - 1].toJSON() : dms[dms.length - 1];
    const text = JSON.stringify(embed);
    assert.match(text, /BAN 失敗/);
    assert.match(text, /ロール剥奪も失敗/);
    assert.doesNotMatch(text, /✅ BAN 成功/);
});

test('response: successful ban does not strip roles', async () => {
    const { manager, incidents } = setupManager();
    let stripped = false;
    manager.setResponseHooks({
        ban: async () => ({ ok: true }),
        strip: async () => {
            stripped = true;
            return { ok: true };
        }
    });
    await (manager as any).trigger({
        guild: fakeGuild(),
        settings: settings(),
        rule: 'memberBan',
        kind: 'velocity',
        actor: actor('attacker'),
        hit: { count: 4, threshold: 4, windowSeconds: 60, exceeded: true, windowStart: NOW - 1_000 }
    });
    assert.equal(stripped, false);
    const final = incidents[incidents.length - 1];
    assert.equal(final.actions.ban, 'success');
    assert.deepEqual(final.affected.membersBanned, ['attacker']);
});

test('response: exempt owner is recorded as skipped, not banned or stripped', async () => {
    const { manager, incidents } = setupManager();
    let banned = false;
    let stripped = false;
    manager.setResponseHooks({
        ban: async () => { banned = true; return { ok: true }; },
        strip: async () => { stripped = true; return { ok: true }; }
    });
    await (manager as any).trigger({
        guild: fakeGuild(),
        settings: settings(),
        rule: 'channelDelete',
        kind: 'velocity',
        actor: actor('owner'),
        hit: { count: 3, threshold: 3, windowSeconds: 60, exceeded: true, windowStart: NOW - 1_000 }
    });
    assert.equal(banned, false);
    assert.equal(stripped, false);
    assert.equal(incidents[incidents.length - 1].actions.ban, 'skipped');
});

// ---------------------------------------------------------------------------
// Manager: velocity counting + instant rules + self-tamper attribution
// ---------------------------------------------------------------------------

test('manager: three channel deletes trigger one response with counts', async () => {
    const { manager, incidents } = setupManager();
    (manager as any).getSettings = async () => settings();
    let bans = 0;
    manager.setResponseHooks({
        ban: async () => { bans += 1; return { ok: true }; },
        strip: async () => ({ ok: true })
    });
    const guild = fakeGuild();
    const attribution = {
        entryId: 'e1', executorId: 'attacker', executorTag: 'attacker#0001',
        executorIsBot: false, targetId: 'chan', action: 12, createdAt: NOW
    };
    const attacker = actor('attacker');
    for (let index = 0; index < 3; index++) {
        await (manager as any).countWithAttribution(guild, 'channelDelete', settings(), attacker, attribution);
    }
    assert.equal(bans, 1);
    const final = incidents[incidents.length - 1];
    assert.equal(final.rule, 'channelDelete');
    assert.equal(final.count, 3);
    assert.equal(final.threshold, 3);
});

test('manager: two deletes stay below the threshold', async () => {
    const { manager, incidents } = setupManager();
    (manager as any).getSettings = async () => settings();
    let bans = 0;
    manager.setResponseHooks({
        ban: async () => { bans += 1; return { ok: true }; },
        strip: async () => ({ ok: true })
    });
    const guild = fakeGuild();
    const attribution = {
        entryId: 'e1', executorId: 'attacker', executorTag: null,
        executorIsBot: false, targetId: 'chan', action: 12, createdAt: NOW
    };
    for (let index = 0; index < 2; index++) {
        await (manager as any).countWithAttribution(guild, 'channelDelete', settings(), actor('attacker'), attribution);
    }
    assert.equal(bans, 0);
    assert.equal(incidents.length, 0);
});

test('manager: instant admin role grant by a bot triggers on the bot', async () => {
    const { manager, incidents } = setupManager();
    const config = settings();
    (manager as any).getSettings = async () => config;
    (manager as any).attribute = async () => ({
        entryId: 'e1', executorId: 'evil-bot', executorTag: 'evil-bot#0001',
        executorIsBot: true, targetId: 'role-1', action: 30, createdAt: NOW
    });
    (manager as any).resolveActor = async () => actor('evil-bot', true);
    let banned: string | null = null;
    manager.setResponseHooks({
        ban: async (_guild: any, id: string) => { banned = id; return { ok: true }; },
        strip: async () => ({ ok: true })
    });

    await (manager as any).onRoleCreate({
        id: 'role-1',
        guild: fakeGuild(),
        permissions: { bitfield: PermissionFlagsBits.Administrator }
    });

    assert.equal(banned, 'evil-bot');
    const final = incidents[incidents.length - 1];
    assert.equal(final.rule, 'adminRoleGrant');
    assert.equal(final.kind, 'instant');
});

test('manager: bot invited with Administrator triggers on the added bot and logs the adder', async () => {
    const { manager, incidents } = setupManager();
    const config = settings();
    (manager as any).getSettings = async () => config;
    (manager as any).attribute = async () => ({
        entryId: 'e1', executorId: 'adder', executorTag: 'adder#0001',
        executorIsBot: false, targetId: 'evil-bot', action: 28, createdAt: NOW
    });
    (manager as any).resolveActor = async () => actor('adder');
    let banned: string | null = null;
    manager.setResponseHooks({
        ban: async (_guild: any, id: string) => { banned = id; return { ok: true }; },
        strip: async () => ({ ok: true })
    });
    const addedBot: any = {
        id: 'evil-bot',
        guild: fakeGuild(),
        user: { id: 'evil-bot', bot: true, tag: 'evil-bot#0001' },
        permissions: { bitfield: PermissionFlagsBits.Administrator },
        roles: { cache: new Collection([['role-1', { id: 'role-1' }]]) }
    };

    await (manager as any).onMemberAdd(addedBot);

    assert.equal(banned, 'evil-bot');
    const final = incidents[incidents.length - 1];
    assert.equal(final.rule, 'adminBotInvite');
    assert.equal(final.addedById, 'adder');
});

test('manager: self-tamper on this bot is attributed and triggers a ban', async () => {
    const { manager, incidents } = setupManager();
    const config = settings();
    (manager as any).getSettings = async () => config;
    (manager as any).attribute = async () => ({
        entryId: 'e1', executorId: 'intruder', executorTag: 'intruder#0001',
        executorIsBot: false, targetId: 'self-bot', action: 25, createdAt: NOW
    });
    (manager as any).resolveActor = async () => actor('intruder');
    let banned: string | null = null;
    manager.setResponseHooks({
        ban: async (_guild: any, id: string) => { banned = id; return { ok: true }; },
        strip: async () => ({ ok: true })
    });
    const oldMember: any = {
        id: 'self-bot',
        guild: fakeGuild(),
        user: { id: 'self-bot', bot: true },
        permissions: { bitfield: PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild },
        roles: { cache: new Collection([['admin-role', { id: 'admin-role' }]]) }
    };
    const newMember: any = {
        ...oldMember,
        permissions: { bitfield: 0n },
        roles: { cache: new Collection() }
    };

    await (manager as any).onMemberUpdate(oldMember, newMember);

    assert.equal(banned, 'intruder');
    const final = incidents[incidents.length - 1];
    assert.equal(final.rule, 'selfTamper');
    assert.equal(final.kind, 'selfTamper');
    assert.equal(final.actorId, 'intruder');
});

test('manager: position audit warns once per state change about actors above the bot', async () => {
    const { manager } = setupManager();
    const config = settings();
    (manager as any).getSettings = async () => config;
    const dms: any[] = [];
    (manager as any).dmOwner = async (_guild: any, _settings: any, embed: any) => {
        dms.push(embed);
        return { status: 'sent' as const };
    };
    (manager as any).postToLogChannel = async () => true;

    const dangerousRole = (id: string, position: number) => ({
        id,
        name: id,
        position,
        managed: false,
        permissions: { has: (permission: bigint) => permission === PermissionFlagsBits.ManageRoles }
    });
    const selfMember: any = {
        id: 'self-bot',
        user: { id: 'self-bot', bot: true, tag: 'self#0001' },
        roles: { highest: { position: 5 }, cache: new Collection() },
        permissions: { has: () => false }
    };
    const evilBot: any = {
        id: 'evil-bot',
        user: { id: 'evil-bot', bot: true, tag: 'evil#0001' },
        roles: { highest: { position: 3 }, cache: new Collection() },
        permissions: { has: (permission: bigint) => permission === PermissionFlagsBits.Administrator }
    };
    const guild = fakeGuild({
        members: {
            me: selfMember,
            cache: new Collection([['self-bot', selfMember], ['evil-bot', evilBot]]),
            fetch: async () => null,
            fetchMe: async () => selfMember
        },
        roles: {
            fetch: async () => new Collection([
                ['role-above', dangerousRole('role-above', 20)]
            ])
        }
    });

    const first = await manager.auditPositions(guild, config);
    assert.equal(first.length, 1);
    assert.match(first[0], /role-above/);
    await manager.auditPositions(guild, config);
    assert.equal(dms.length, 1);

    // The offending bot is now above us as well: state changed, warn again.
    evilBot.roles.highest = { position: 30 };
    const second = await manager.auditPositions(guild, config);
    assert.equal(second.length, 2);
    assert.equal(dms.length, 2);
});

test('manager: own removal persists a selfKick incident and DMs a re-invite link', async () => {
    const { manager, incidents } = setupManager();
    const config = settings();
    (manager as any).getSettings = async () => config;
    (manager as any).attribute = async () => ({
        entryId: 'e1', executorId: 'kicker', executorTag: 'kicker#0001',
        executorIsBot: false, targetId: 'self-bot', action: 20, createdAt: NOW
    });
    let captured: { embed: any; extra: string[] | null } | null = null;
    (manager as any).dmOwner = async (_guild: any, _settings: any, embed: any, extra: string[]) => {
        captured = { embed, extra };
        return { status: 'sent' as const };
    };

    await (manager as any).onGuildDelete({ id: 'guild', name: 'Guild', ownerId: 'owner', available: true });

    const incident = incidents[incidents.length - 1];
    assert.equal(incident.kind, 'selfKick');
    assert.equal(incident.actorId, 'kicker');
    assert.equal(incident.status, 'open');
    assert.ok(captured);
    assert.match(captured!.extra!.join('\n'), /oauth2\/authorize\?client_id=self-bot/);
});

test('manager: guildDelete for a Discord outage is ignored', async () => {
    const { manager, incidents } = setupManager();
    (manager as any).attribute = async () => null;
    await (manager as any).onGuildDelete({ id: 'guild', name: 'Guild', available: false });
    assert.equal(incidents.length, 0);
});

test('manager: rejoin announces restore only for an unannounced selfKick incident', async () => {
    const { manager, incidents } = setupManager();
    const config = settings();
    (manager as any).getSettings = async () => config;
    (manager as any).readIncidents = async () => [{
        id: 'inc-1', kind: 'selfKick', status: 'open', detectedAt: new Date(NOW).toISOString()
    }];
    const dms: unknown[] = [];
    (manager as any).dmOwner = async () => {
        dms.push(true);
        return { status: 'sent' as const };
    };
    const guild = fakeGuild({ members: { me: null, cache: new Collection(), fetch: async () => null } });

    await (manager as any).onGuildCreate(guild);
    await (manager as any).onGuildCreate(guild);
    assert.equal(dms.length, 1);
    assert.equal(incidents.length, 0);
});

test('manager: self-tamper without attribution still warns the owner without inventing an actor', async () => {
    const { manager, incidents } = setupManager();
    const config = settings();
    (manager as any).getSettings = async () => config;
    (manager as any).attribute = async () => null;
    let banned = false;
    manager.setResponseHooks({
        ban: async () => { banned = true; return { ok: true }; },
        strip: async () => ({ ok: true })
    });
    const oldMember: any = {
        id: 'self-bot',
        guild: fakeGuild(),
        user: { id: 'self-bot', bot: true },
        permissions: { bitfield: 0n },
        roles: { cache: new Collection([['r1', { id: 'r1' }]]) }
    };
    const newMember: any = {
        ...oldMember,
        roles: { cache: new Collection() }
    };

    await (manager as any).onMemberUpdate(oldMember, newMember);

    assert.equal(banned, false);
    const final = incidents[incidents.length - 1];
    assert.equal(final.rule, 'selfTamper');
    assert.equal(final.attribution, 'none');
    assert.equal(final.actions.ban, 'skipped');
});
