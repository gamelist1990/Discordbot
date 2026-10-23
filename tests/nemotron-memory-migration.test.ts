import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Database, database } from '../src/core/persistence/Database.ts';
import { resetStaffAIHistory, staffMetrics, staffMemoryList } from '../src/core/ai/StaffAIMemory.ts';
import { serverMemoAction, loadMemos } from '../src/commands/staff/subcommands/ai-tools/memo.ts';
import { staffMemoryDefinition, staffMemoryHandler } from '../src/commands/staff/subcommands/ai-tools/staff_memory.ts';

test('startup deletes automatic user profiles and keeps daily records and custom memos', async () => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(),'retired-memory-'));
 try {
  await fs.mkdir(path.join(dir,'guilds','123'),{recursive:true});
  await fs.mkdir(path.join(dir,'integrations','123','chat-ai-channel'),{recursive:true});
  await fs.writeFile(path.join(dir,'guilds','123','staff-ai-memory.json'), JSON.stringify([{id:'d',kind:'daily'},{id:'u',kind:'user'},{id:'a',kind:'ai'}]));
  await fs.writeFile(path.join(dir,'guilds','123','memos.json'),JSON.stringify([{id:'custom',content:'keep me'}]));
  await fs.writeFile(path.join(dir,'integrations','123','chat-ai-channel','user-memory.json'),'{"users":{"u":{"profile":"remove me"}}}');
  const db = new Database(dir);
  await db.initialize();
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'guilds','123','staff-ai-memory.json'),'utf8')),[{id:'d',kind:'daily'}]);
  assert.equal(await fs.stat(path.join(dir,'integrations','123','chat-ai-channel','user-memory.json')).catch(()=>null),null);
  assert.match(await fs.readFile(path.join(dir,'guilds','123','memos.json'),'utf8'),/keep me/);
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('custom memos survive history reset, concurrent creates persist, and profiles are unavailable', async () => {
 const get=database.get, set=database.set;
 const values = new Map<string,unknown>();
 database.get=async(g,k,d)=>structuredClone(values.get(g+'/'+k)??d) as any;
 database.set=async(g,k,v)=>{values.set(g+'/'+k,structuredClone(v));};
 try {
  const context={guild:{id:'custom-test'},user:{id:'u',username:'Staff'}};
  const results=await Promise.all(['first','second'].map(content=>serverMemoAction('create',{content},context)));
  assert.ok(results.every(r=>(r as any).success));
  assert.equal((await loadMemos('custom-test')).length,2);
  for(const key of ['dataset','conversation-memory-history','staff-ai-memory']) await database.set('custom-test','Guild/custom-test/'+key,[{id:'old'}]);
  await database.set('other','Guild/other/dataset',[{id:'other'}]);
  await resetStaffAIHistory('custom-test');
  assert.equal((await staffMetrics('custom-test')).requests,0);
  assert.deepEqual(await staffMemoryList('custom-test'),[]);
  assert.deepEqual(await database.get('custom-test','Guild/custom-test/dataset'),[]);
  assert.equal((await loadMemos('custom-test')).length,2);
  assert.deepEqual(await database.get('other','Guild/other/dataset'),[{id:'other'}]);
  assert.deepEqual(staffMemoryDefinition.function.parameters.properties.store.enum,['daily','server_memos']);
  assert.match(JSON.stringify(await staffMemoryHandler({store:'my_profile',action:'recall'})),/廃止/);
 } finally {database.get=get;database.set=set;}
});
