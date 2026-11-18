import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { determineGuildPermissionLevel, determineDelegatedGuildPermissionLevel, canExecuteStaffAction, resolveGuildPermissionLevel } from '../src/core/permissions/GuildAccess.ts';
import { database } from '../src/core/persistence/Database.ts';
import { PermissionLevel } from '../src/web/types/permission.ts';

function member(id = 'actor', flags: bigint[] = [], roles: string[] = []) {
    const bits = new Set(flags);
    const roleIds = new Set(roles);
    return {
        id,
        permissions: { has: (flag: bigint) => bits.has(flag) || bits.has(PermissionFlagsBits.Administrator) },
        roles: { cache: { has: (role: string) => roleIds.has(role) } },
    };
}

test('all guild levels: normal, staff role, admin role, native moderators, administrator and owner', () => {
    const settings = { staffRoleId: 'staff-role', adminRoleId: 'admin-role' };
    const level = (m: ReturnType<typeof member> | null) =>
        determineGuildPermissionLevel('actor', 'owner', m, settings);
    assert.equal(level(member()), PermissionLevel.ANY);
    assert.equal(level(member('actor', [], ['staff-role'])), PermissionLevel.STAFF);
    assert.equal(level(member('actor', [], ['admin-role'])), PermissionLevel.ADMIN);
    assert.equal(level(member('actor', [PermissionFlagsBits.ModerateMembers])), PermissionLevel.STAFF);
    assert.equal(level(member('actor', [PermissionFlagsBits.ManageMessages])), PermissionLevel.STAFF);
    assert.equal(level(member('actor', [PermissionFlagsBits.ManageChannels])), PermissionLevel.STAFF);
    assert.equal(level(member('actor', [PermissionFlagsBits.ManageGuild])), PermissionLevel.ADMIN);
    assert.equal(level(member('actor', [PermissionFlagsBits.Administrator])), PermissionLevel.ADMIN);
    assert.equal(determineGuildPermissionLevel('owner', 'owner', member('owner'), settings), PermissionLevel.OWNER);
    assert.equal(level(member('other', [], ['staff-role'])), PermissionLevel.ANY);
    assert.equal(level(null), PermissionLevel.ANY);
});

test('live guild resolver: configured staff works without ModerateMembers and revoked roles deny', async () => {
    const oldGet = database.get;
    const roleIds = new Set(['staff-role']);
    const currentMember = member('actor', [], ['staff-role']);
    const guild: any = {
        id: 'guild-role-test', ownerId: 'owner',
        members: { fetch: async (id: string) => id === 'actor'
            ? { ...currentMember, roles: { cache: { has: (roleId: string) => roleIds.has(roleId) } } }
            : Promise.reject(new Error('not a member')) },
    };
    (database as any).get = async () => ({ staffRoleId: 'staff-role', adminRoleId: 'admin-role' });
    try {
        assert.equal(await resolveGuildPermissionLevel(guild, 'actor'), PermissionLevel.STAFF);
        roleIds.delete('staff-role');
        assert.equal(await resolveGuildPermissionLevel(guild, 'actor'), PermissionLevel.ANY);
        assert.equal(await resolveGuildPermissionLevel(guild, 'outsider'), PermissionLevel.ANY);
    } finally {
        (database as any).get = oldGet;
    }
});

test('native ManageMessages does not confer ModerateMembers; staff role does', async () => {
    const oldGet = database.get;
    let role = false;
    const actor = member('actor', [PermissionFlagsBits.ManageMessages]);
    const guild: any = {
        id: 'guild-action-test', ownerId: 'owner',
        members: { fetch: async () => ({
            ...actor, roles: { cache: { has: (id: string) => id === 'staff' && role } },
        }) },
    };
    (database as any).get = async () => ({ staffRoleId: 'staff' });
    try {
        assert.equal(determineDelegatedGuildPermissionLevel('actor', 'owner', actor, { staffRoleId: 'staff' }), PermissionLevel.ANY);
        assert.equal(await canExecuteStaffAction(guild, 'actor', PermissionFlagsBits.ManageMessages), true);
        assert.equal(await canExecuteStaffAction(guild, 'actor', PermissionFlagsBits.ModerateMembers), false);
        role = true;
        assert.equal(await canExecuteStaffAction(guild, 'actor', PermissionFlagsBits.ModerateMembers), true);
    } finally {
        (database as any).get = oldGet;
    }
});

test('ManageGuild grants admin UI but does not delegate timeout without configured staff role', async () => {
    const originalGet = database.get;
    const actor = member('actor', [PermissionFlagsBits.ManageGuild]);
    const guild: any = {
        id: 'guild-manage-test', ownerId: 'owner',
        members: { fetch: async () => actor },
    };
    (database as any).get = async () => ({});
    try {
        assert.equal(determineGuildPermissionLevel('actor', 'owner', actor, {}), PermissionLevel.ADMIN);
        assert.equal(determineDelegatedGuildPermissionLevel('actor', 'owner', actor, {}), PermissionLevel.ANY);
        assert.equal(await canExecuteStaffAction(guild, 'actor', PermissionFlagsBits.ModerateMembers), false);
    } finally {
        (database as any).get = originalGet;
    }
});
