import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { userHasAdminOrManageFlag } from '../src/web/routes/permissionsUtils.ts';

test('userHasAdminOrManageFlag returns true for guild owner', () => {
    const result = userHasAdminOrManageFlag({ owner: true });
    assert.equal(result, true);
});

test('userHasAdminOrManageFlag reads permissions_new bitfield', () => {
    const manageGuild = Number((PermissionFlagsBits as any).ManageGuild || 0);
    const result = userHasAdminOrManageFlag({ owner: false, permissions_new: String(manageGuild) });
    assert.equal(result, true);
});
