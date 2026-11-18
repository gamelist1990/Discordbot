import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRole, roleMembersToolHandler } from '../src/commands/staff/subcommands/ai-tools/roleMembers.ts';

const role = {id:'111111111111111111',name:'サムネ職人',members: {size:0}};
const another = {id:'222222222222222222',name:'サムネ職人二軍',members:{size:0}};
const member = (id:string, owns:boolean, bot=false) => ({
    id, user:{username:'user-' + id,bot},
    displayName:'表示 ' + id,
    roles:{cache:new Map(owns?[[role.id,role]]:[])},
    joinedAt:new Date('2026-11-15T00:00:00Z'),
    displayAvatarURL:()=>'https://cdn.discordapp.com/avatars/'+id+'.png',
});
const members = [
    member('101111111111111111',false),
    member('101111111111111112',true),
    member('101111111111111113',false),
    member('101111111111111114',true),
    member('101111111111111115',true,true),
];

function context() {
    return {
        guildId: '999999999999999999',
        guild: {
            name: 'Test server',
            roles: {fetch: async()=>new Map([[role.id,role],[another.id,another]])},
            members: {list: async (options: {after?:string}) =>
                new Map(members.filter(member => !options.after || BigInt(member.id) > BigInt(options.after))
                    .map(member => [member.id,member]))},
        },
    } as any;
}

test('role lookup supports an exact name, mention, ID and ambiguity handling', () => {
    assert.equal(resolveRole([role,another] as any,'サムネ職人').role?.id,role.id);
    assert.equal(resolveRole([role,another] as any,'<@&111111111111111111>').role?.id,role.id);
    assert.equal(resolveRole([role,another] as any,'111111111111111111').role?.id,role.id);
    assert.equal(resolveRole([role,another] as any,'サムネ').choices?.length,2);
    assert.match(resolveRole([role,another] as any,'ないロール').error ?? '',/見つかりません/);
});

test('role member tool scans Discord members rather than requiring IDs or a populated cache', async () => {
    const interaction = context();
    const first:any = await roleMembersToolHandler({role:'サムネ職人',limit:1},interaction);
    assert.equal(first.returned,1);
    assert.equal(first.members[0].id,'101111111111111112');
    assert.equal(first.complete,false);
    assert.equal(first.next_after,'101111111111111112');
    const next:any = await roleMembersToolHandler({role:'<@&111111111111111111>',after:first.next_after,
        limit:30,include_bots:false},interaction);
    assert.deepEqual(next.members.map((m:any)=>m.id),['101111111111111114']);
    assert.equal(next.complete,true);
    assert.ok(next.members[0].avatar_url);
    const err:any = await roleMembersToolHandler({role:'サムネ職人',after:'invalid'},interaction);
    assert.match(err.error,/after/);
});
