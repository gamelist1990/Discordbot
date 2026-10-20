import test from 'node:test';
import assert from 'node:assert/strict';
import { webSearchHandler } from '../src/core/ChatAIChannel/tools/webSearchBing.ts';

async function reply(body: unknown, status=200) {
    const original=globalThis.fetch;
    globalThis.fetch=(async()=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})) as typeof fetch;
    try{return String(await webSearchHandler({query:'現在の情報'}));}
    finally{globalThis.fetch=original;}
}

test('Empty search, unavailable provider and malformed response remain distinguishable',async()=>{
    assert.match(await reply({results:[],errors:[]}),/^SEARCH_EMPTY:/);
    assert.match(await reply({results:[],errors:[{engine:'brave',message:'blocked'}]}),/^SEARCH_UNAVAILABLE:/);
    assert.match(await reply({error:'not results'}),/^SEARCH_ERROR:/);
    assert.match(await reply({message:'upstream unavailable'},502),/^SEARCH_ERROR:/);
});

test('Search warnings and original retrieval time reach the model with actual results',async()=>{
    const result=await reply({results:[{rank:1,title:'Source',url:'https://primary.example/',snippet:'Reported fact',engine:'brave'}],errors:[],warnings:['Check the original source date'],searched_at:'2026-10-20T00:00:00Z'});
    assert.match(result,/https:\/\/primary\.example/);
    assert.match(result,/Check the original source date/);
    assert.match(result,/検索日時: 2026-10-20T00:00:00Z/);
});
