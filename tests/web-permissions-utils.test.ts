import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { parsePermissionBitfield, userHasAdminOrManageFlag } from '../src/web/routes/permissionsUtils.ts';

test('userHasAdminOrManageFlag returns true for guild owner', () => {
    const result = userHasAdminOrManageFlag({ owner: true });
    assert.equal(result, true);
});

test('userHasAdminOrManageFlag reads permissions_new bitfield', () => {
    const admin = Number(PermissionFlagsBits.Administrator);
    const result = userHasAdminOrManageFlag({ owner: false, permissions_new: String(admin) });
    assert.equal(result, true);
});

test('userHasAdminOrManageFlag reads manage guild bitfield', () => {
    const manageGuild = Number((PermissionFlagsBits as any).ManageGuild ?? (PermissionFlagsBits as any).ManageGuildPermissions ?? 0);
    assert.notEqual(manageGuild, 0);
    const result = userHasAdminOrManageFlag({ owner: false, permissions_new: String(manageGuild) });
    assert.equal(result, true);
});

test('large Discord bitfields preserve the low permission bits exactly', () => {
    const huge = 2n ** 60n;
    const withAdmin = (huge | PermissionFlagsBits.Administrator).toString();
    assert.equal(parsePermissionBitfield(withAdmin), huge | PermissionFlagsBits.Administrator);
    assert.equal(userHasAdminOrManageFlag({ permissions_new: withAdmin }), true);
    assert.equal(userHasAdminOrManageFlag({ permissions_new: huge.toString() }), false);
    assert.equal(parsePermissionBitfield('not-a-number'), 0n);
    assert.equal(parsePermissionBitfield(Number.MAX_SAFE_INTEGER + 100), 0n);
});
