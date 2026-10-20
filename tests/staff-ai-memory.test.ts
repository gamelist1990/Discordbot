import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from '../src/core/persistence/Database.ts';
import {
    staffMemoryList, staffMetrics, recordStaffUsage, editStaffMemory, clearStaffMemory, staffMemoryContext,
} from '../src/core/ai/StaffAIMemory.ts';
import { staffMemoryHandler, staffMemoryToolScope } from '../src/commands/staff/subcommands/ai-tools/staff_memory.ts';

test('ギルドごとに統計を分離し不明なKV hit率は取得済み扱いにしない', async () => {
    const get = database.get.bind(database), set = database.set.bind(database);
    const memory = new Map<string, unknown>();
    (database as any).get = async (guild: string, key: string, fallback: unknown) =>
        memory.get(guild + '/' + key) ?? fallback;
    (database as any).set = async (guild: string, key: string, value: unknown) => {
        memory.set(guild + '/' + key, structuredClone(value));
    };
    try {
        await recordStaffUsage('g1', 100, 40, 2);
        await recordStaffUsage('g1', 200, 100, 4);
        const metrics = await staffMetrics('g1');
        assert.equal(metrics.requests, 2);
        assert.equal(metrics.totalTokens, 440);
        assert.equal(metrics.cacheInputTokens, 0);
        assert.equal((await staffMetrics('g2')).totalTokens, 0);
        const sample = [
            {id:'daily:2026-10-16',kind:'daily',guildId:'g1',day:'2026-10-16',title:'前日',content:'マイクラ制作',evidenceCount:2,updatedAt:'2026-10-17T00:00:00Z'},
            {id:'user:u1',kind:'user',guildId:'g1',userId:'u1',title:'u1さん',content:'建築が好き',evidenceCount:3,updatedAt:'2026-10-17T00:00:00Z'},
            {id:'user:u2',kind:'user',guildId:'g1',userId:'u2',title:'u2さん',content:'楽曲が好き',evidenceCount:5,updatedAt:'2026-10-17T00:00:00Z'},
        ];
        await (database as any).set('g1','Guild/g1/staff-ai-memory',sample);
        assert.equal((await staffMemoryList('g1')).length,3);
        const own = await staffMemoryToolScope.run({ guildId:'g1',userId:'u1' },
            () => staffMemoryHandler({type:'my_profile'}));
        assert.match(own, /建築が好き/);
        assert.doesNotMatch(own, /楽曲が好き/);
        const without = await staffMemoryHandler({type:'my_profile'});
        assert.match((without as {error: string}).error,/権限がありません/);
        const context = await staffMemoryContext('g1','u1','昨日何があった？');
        assert.match(context,/マイクラ制作/);
        assert.doesNotMatch(context,/楽曲が好き/);
        await editStaffMemory('g1','user:u1','プラグイン制作が得意');
        assert.equal((await staffMemoryList('g1')).find(m=>m.id==='user:u1')?.editedByStaff,true);
        assert.equal(await clearStaffMemory('g1','user:u2'),1);
        assert.equal((await staffMemoryList('g1')).length,2);
    } finally {
        (database as any).get = get;
        (database as any).set = set;
    }
});

test('他ユーザーには一般的な趣味だけ公開し、私的プロフィール本文は渡さない', async () => {
 const get = database.get.bind(database);
 (database as any).get = async (_g: string,_k:string,_d:unknown) => [{
  id:'user:123456789012345678', kind:'user', guildId:'guild',
  userId:'123456789012345678',title:'テスト',content:'非公開の連絡先情報',
  publicInterests:'Minecraftの建築が好き。Javaが得意。',
  updatedAt:new Date().toISOString(), evidenceCount:3,
 }];
 try {
  const publicValue=await staffMemoryToolScope.run({guildId:'guild',userId:'999999999999999999'},
    ()=>staffMemoryHandler({type:'public_interests',userId:'123456789012345678'}));
  assert.match(publicValue,/Minecraft/);
  assert.doesNotMatch(publicValue,/非公開/);
  const privateValue=await staffMemoryToolScope.run({guildId:'guild',userId:'999999999999999999'},
    ()=>staffMemoryHandler({type:'my_profile'}));
  assert.doesNotMatch(privateValue,/非公開/);
 } finally {(database as any).get=get;}
});
