import test from 'node:test';
import assert from 'node:assert/strict';
import {dotWebResearchQuery, registerDotWebSearchTool, runDotWebSearch} from '../src/core/ai/DotWebResearch.ts';

test('Dot explicitly searches public web on lookup requests, not ordinary conversation',()=>{
  for(const v of ['dot、WebでOrnithの情報を検索して','Gemma 5の最新情報を教えて','ネットで公式発表を調べて','最新のAIニュースをまとめて','この論文を調査してください']) {
    assert.ok(dotWebResearchQuery(v),v);
  }
  for(const v of ['こんにちは！','猫描いて','最近何してる？','今日も楽しいね','検索できる？','web検索できる？','https://example.com/']) {
    assert.equal(dotWebResearchQuery(v),null,v);
  }
});

test('ambient Dot registers only bounded public web_search, and executes real handler',async()=>{
  const registrations:any[]=[];
  registerDotWebSearchTool({registerTool:(def:any,handler:any)=>{registrations.push({def,handler});}} as any);
  assert.equal(registrations.length,1);
  assert.equal(registrations[0].def.function.name,'web_search');
  const original=globalThis.fetch;
  let body:any;
  globalThis.fetch=(async (_url,options)=>{
    body=JSON.parse(String(options?.body));
    return new Response(JSON.stringify({results:[{rank:1,title:'Official',url:'https://example.org/source',snippet:'Official source',engine:'brave'}],errors:[]}));
  }) as typeof fetch;
  try {
    const result=String(await registrations[0].handler({query:'Ornith release',count:20,safe_search:false}));
    assert.equal(body.count,5);
    assert.equal(body.safe_search,true);
    assert.equal(body.country,'JP');
    assert.equal(body.language,'ja-JP');
    assert.match(result,/https:\/\/example\.org\/source/);
    const injected=await runDotWebSearch('OpenAI official announcements');
    assert.match(String(injected),/Official source/);
    assert.equal(body.count,4);
  } finally {globalThis.fetch=original;}
});
