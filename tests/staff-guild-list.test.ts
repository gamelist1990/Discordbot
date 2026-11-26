import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import {
    listLiveStaffGuilds,
    getLiveGuildPermissionLevel,
    refreshSessionGuildPermissionLevel,
} from '../src/web/middleware/liveGuildAccess.ts';
import { StaffController } from '../src/web/controllers/StaffController.ts';
import { isGuildAccessible } from '../src/web/middleware/auth.ts';
import { database } from '../src/core/persistence/Database.ts';
import { PermissionLevel } from '../src/web/types/permission.ts';

type FakeMember = {
    id: string;
    permissions: { has: (flag: bigint) => boolean };
    roles: { cache: { has: (roleId: string) => boolean } };
};

function member(id: string, flags: bigint[] = [], roles: string[] = []): FakeMember {
    const bits = new Set(flags);
    const roleIds = new Set(roles);
    return {
        id,
        permissions: { has: (flag: bigint) => bits.has(flag) || bits.has(PermissionFlagsBits.Administrator) },
        roles: { cache: { has: (roleId: string) => roleIds.has(roleId) } },
    };
}

type FakeGuildOptions = {
    id: string;
    name?: string;
    icon?: string | null;
    ownerId?: string;
    cachedMembers?: FakeMember[];
    reachableMembers?: FakeMember[];
    fetches: string[];
};

function fakeGuild(options: FakeGuildOptions) {
    const cache = new Map((options.cachedMembers ?? []).map(m => [m.id, m]));
    const reachable = new Map((options.reachableMembers ?? options.cachedMembers ?? []).map(m => [m.id, m]));
    return {
        id: options.id,
        name: options.name ?? `Guild ${options.id}`,
        icon: options.icon ?? null,
        ownerId: options.ownerId ?? 'owner',
        members: {
            cache: { get: (userId: string) => cache.get(userId) },
            fetch: async (userId: string) => {
                options.fetches.push(`${options.id}:${userId}`);
                const found = reachable.get(userId);
                if (!found) throw new Error('Unknown Member');
                return found;
            },
        },
    };
}

function fakeBot(guilds: Array<ReturnType<typeof fakeGuild>>) {
    const cache = new Map(guilds.map(g => [g.id, g]));
    return {
        client: { guilds: { cache, fetch: async (id: string) => cache.get(id) ?? null } },
    } as any;
}

function sessionWith(overrides: Record<string, any> = {}) {
    return {
        userId: 'actor',
        guildIds: [] as string[],
        permissions: [] as Array<{ guildId: string; level: number }>,
        ...overrides,
    } as any;
}

async function withSettings<T>(settings: Record<string, any>, run: () => Promise<T>): Promise<T> {
    const originalGet = database.get;
    (database as any).get = async () => settings;
    try {
        return await run();
    } finally {
        (database as any).get = originalGet;
    }
}

test('live list: guild only the bot knows about is listed with the live level and repairs the session', async () => {
    const fetches: string[] = [];
    const guild = fakeGuild({
        id: '1575566026274381995',
        name: '実験鯖',
        icon: 'icon-hash',
        ownerId: 'actor',
        cachedMembers: [member('actor')],
        fetches,
    });
    const bot = fakeBot([guild]);
    const session = sessionWith();
    await withSettings({}, async () => {
        const guilds = await listLiveStaffGuilds(bot, session);
        assert.deepEqual(guilds, [{
            id: '1575566026274381995',
            name: '実験鯖',
            icon: 'icon-hash',
            permissionLevel: PermissionLevel.OWNER,
        }]);
    });
    assert.equal(fetches.length, 0, 'cache hit must not spend a member fetch');
    assert.deepEqual(session.permissions, [{ guildId: '1575566026274381995', level: PermissionLevel.OWNER }]);
    assert.deepEqual(session.guildIds, ['1575566026274381995']);
    assert.equal(isGuildAccessible(session, '1575566026274381995'), true);
});

test('live list: stale STAFF level is corrected up to ADMIN', async () => {
    const fetches: string[] = [];
    const guild = fakeGuild({
        id: 'guild-up',
        name: 'Up',
        ownerId: 'owner',
        cachedMembers: [member('actor', [], ['admin-role'])],
        fetches,
    });
    const session = sessionWith({
        guildIds: ['guild-up'],
        permissions: [{ guildId: 'guild-up', level: PermissionLevel.STAFF }],
    });
    await withSettings({ staffRoleId: 'staff-role', adminRoleId: 'admin-role' }, async () => {
        const guilds = await listLiveStaffGuilds(fakeBot([guild]), session);
        assert.deepEqual(guilds.map(g => g.permissionLevel), [PermissionLevel.ADMIN]);
    });
    assert.deepEqual(session.permissions, [{ guildId: 'guild-up', level: PermissionLevel.ADMIN }]);
});

test('live list: stale OWNER level is corrected down when the live level dropped to ANY', async () => {
    const fetches: string[] = [];
    const guild = fakeGuild({
        id: 'guild-down',
        name: 'Down',
        ownerId: 'owner',
        cachedMembers: [member('actor')],
        fetches,
    });
    const session = sessionWith({
        guildIds: ['guild-down'],
        permissions: [{ guildId: 'guild-down', level: PermissionLevel.OWNER }],
    });
    await withSettings({}, async () => {
        const guilds = await listLiveStaffGuilds(fakeBot([guild]), session);
        assert.deepEqual(guilds, [], 'ANY level must not be listed');
    });
    assert.deepEqual(session.permissions, [{ guildId: 'guild-down', level: PermissionLevel.ANY }]);
});

test('live list: non-member guild is excluded and gains no session entry', async () => {
    const fetches: string[] = [];
    const guild = fakeGuild({ id: 'guild-not-member', ownerId: 'owner', fetches });
    const session = sessionWith();
    await withSettings({}, async () => {
        assert.deepEqual(await listLiveStaffGuilds(fakeBot([guild]), session), []);
    });
    assert.deepEqual(session.permissions, []);
    assert.deepEqual(session.guildIds, []);
    assert.deepEqual(fetches, ['guild-not-member:actor'], 'cold cache falls back to one member fetch');
});

test('live list: member fetch is skipped for cached members and used only on cache miss', async () => {
    const fetches: string[] = [];
    const cached = fakeGuild({
        id: 'guild-cached',
        ownerId: 'owner',
        cachedMembers: [member('actor', [], ['staff-role'])],
        fetches,
    });
    const uncached = fakeGuild({
        id: 'guild-uncached',
        ownerId: 'owner',
        reachableMembers: [member('actor', [PermissionFlagsBits.ManageGuild])],
        fetches,
    });
    const session = sessionWith();
    await withSettings({ staffRoleId: 'staff-role' }, async () => {
        const guilds = await listLiveStaffGuilds(fakeBot([cached, uncached]), session);
        assert.deepEqual(guilds.map(g => [g.id, g.permissionLevel]), [
            ['guild-cached', PermissionLevel.STAFF],
            ['guild-uncached', PermissionLevel.ADMIN],
        ]);
    });
    assert.deepEqual(fetches, ['guild-uncached:actor']);
});

test('live level check: resolves guilds the login snapshot never contained', async () => {
    const fetches: string[] = [];
    const guild = fakeGuild({
        id: 'guild-late-join',
        ownerId: 'owner',
        cachedMembers: [member('actor', [PermissionFlagsBits.ManageMessages])],
        fetches,
    });
    const bot = fakeBot([guild]);
    const session = sessionWith();
    await withSettings({}, async () => {
        assert.equal(await getLiveGuildPermissionLevel(bot, session, 'guild-late-join'), PermissionLevel.STAFF);
        assert.equal(await refreshSessionGuildPermissionLevel(bot, session, 'guild-late-join'), PermissionLevel.STAFF);
    });
    assert.equal(isGuildAccessible(session, 'guild-late-join'), true);
    assert.deepEqual(session.permissions, [{ guildId: 'guild-late-join', level: PermissionLevel.STAFF }]);
    assert.equal(session.guildId, undefined);
});

test('live level check: snapshot owner loses access once the live level is ANY', async () => {
    const fetches: string[] = [];
    const guild = fakeGuild({
        id: 'guild-demoted',
        ownerId: 'owner',
        cachedMembers: [member('actor')],
        fetches,
    });
    const bot = fakeBot([guild]);
    const session = sessionWith({
        guildId: 'guild-demoted',
        guildIds: ['guild-demoted'],
        permission: PermissionLevel.OWNER,
        permissions: [{ guildId: 'guild-demoted', level: PermissionLevel.OWNER }],
    });
    await withSettings({}, async () => {
        assert.equal(await getLiveGuildPermissionLevel(bot, session, 'guild-demoted'), PermissionLevel.ANY);
    });
    assert.deepEqual(session.permissions, [{ guildId: 'guild-demoted', level: PermissionLevel.ANY }]);
    assert.equal(session.permission, PermissionLevel.ANY);
});

test('staff guild-list endpoint keeps { guilds: [{ id, name, icon }] } and names come from the bot cache', async () => {
    const fetches: string[] = [];
    const guild = fakeGuild({
        id: '1580000000000000001',
        name: '実験鯖',
        icon: null,
        ownerId: 'actor',
        cachedMembers: [member('actor')],
        fetches,
    });
    const controller = new StaffController(fakeBot([guild]) as any);
    const response = {
        statusCode: 200,
        body: undefined as any,
        status(code: number) { this.statusCode = code; return this; },
        json(body: any) { this.body = body; return this; },
    };
    const session = sessionWith();
    await withSettings({}, async () => {
        await controller.getAccessibleGuilds({ session } as any, response as any);
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
        guilds: [{ id: '1580000000000000001', name: '実験鯖', icon: null, permissionLevel: PermissionLevel.OWNER }],
    });
    assert.notEqual(response.body.guilds[0].name, response.body.guilds[0].id, 'guild id must never be used as a placeholder name');
});
