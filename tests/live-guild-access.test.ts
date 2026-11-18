import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshSessionGuildPermissionLevel, getLiveGuildPermissionLevel, getLiveGuildManagementLevel } from '../src/web/middleware/liveGuildAccess.ts';
import { database } from '../src/core/persistence/Database.ts';

test('OAuth staff level is refreshed on role grant and revoked on removal', async () => {
    const originalGet = database.get;
    let hasStaff = false;
    const actor = {
        id: 'actor',
        permissions: { has: () => false },
        roles: { cache: { has: (roleId: string) => roleId === 'staff-role' && hasStaff } },
    };
    const guild = { id: 'guild1', ownerId: 'owner', members: { fetch: async () => actor } };
    const bot = { client: { guilds: { cache: new Map([['guild1', guild]]), fetch: async () => null } } } as any;
    const session = {
        userId: 'actor', guildIds: ['guild1'], permissions: [{ guildId: 'guild1', level: 3 }],
    } as any;
    (database as any).get = async () => ({ staffRoleId: 'staff-role' });
    try {
        assert.equal(await refreshSessionGuildPermissionLevel(bot, session, 'guild1'), 0);
        assert.equal(session.permissions[0].level, 0);
        hasStaff = true;
        assert.equal(await refreshSessionGuildPermissionLevel(bot, session, 'guild1'), 1);
        assert.equal(session.permissions[0].level, 1);
        hasStaff = false;
        assert.equal(await refreshSessionGuildPermissionLevel(bot, session, 'guild1'), 0);
        assert.equal(session.permissions[0].level, 0);
        assert.equal(await getLiveGuildPermissionLevel(bot, session, 'anotherGuild'), 0);
    } finally {
        (database as any).get = originalGet;
    }
});

test('missing member or bot guild never inherits stale session permission', async () => {
    const bot = { client: { guilds: {
        cache: new Map([['guild1', { id: 'guild1', ownerId: 'owner',
            members: { fetch: async () => Promise.reject(new Error('not found')) } }]]),
        fetch: async () => null,
    } } } as any;
    const session = { userId: 'not-member', guildIds: ['guild1'], permissions: [{ guildId: 'guild1', level: 3 }] } as any;
    assert.equal(await refreshSessionGuildPermissionLevel(bot, session, 'guild1'), 0);
    assert.equal(session.permissions[0].level, 0);
});

test('native ManageMessages alone cannot administer Web staff management endpoints', async () => {
    const originalGet = database.get;
    const { PermissionFlagsBits } = await import('discord.js');
    let delegated = false;
    const actor = {
        id: 'actor',
        permissions: { has: (flag: bigint) => flag === PermissionFlagsBits.ManageMessages },
        roles: { cache: { has: (roleId: string) => roleId === 'staff-role' && delegated } },
    };
    const guild = { id: 'guild1', ownerId: 'owner', members: { fetch: async () => actor } };
    const bot = { client: { guilds: { cache: new Map([['guild1', guild]]), fetch: async () => null } } } as any;
    const session = { userId: 'actor', guildIds: ['guild1'] } as any;
    (database as any).get = async () => ({ staffRoleId: 'staff-role' });
    try {
        assert.equal(await getLiveGuildPermissionLevel(bot, session, 'guild1'), 1);
        assert.equal(await getLiveGuildManagementLevel(bot, session, 'guild1'), 0);
        delegated = true;
        assert.equal(await getLiveGuildManagementLevel(bot, session, 'guild1'), 1);
    } finally {
        (database as any).get = originalGet;
    }
});
