import test from 'node:test';
import assert from 'node:assert/strict';
import { webSearchHandler } from '../src/core/ChatAIChannel/tools/webSearchBing.ts';
import { toolResultSummary } from '../src/core/ai/ToolResultSummary.ts';

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

test('Search requests Chrome source reading and passes endpoint Markdown to the model', async () => {
    const original = globalThis.fetch;
    const markdown = '# Web検索: Rust\n検索日時: 2026-10-21T00:00:00Z\n\n## 1. [Rust](<https://rust-lang.org/>)\n\n### 検索スニペット\nDiscovery\n\n### Chromeで取得した本文\n# Rendered source\n本文の事実';
    globalThis.fetch = (async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.read_pages, true);
        assert.equal(body.page_count, 3);
        return new Response(JSON.stringify({ results: [{rank: 1, title: 'Rust', url: 'https://rust-lang.org/'}], markdown }));
    }) as typeof fetch;
    try {
        const output = String(await webSearchHandler({query: 'Rust'}));
        assert.equal(output, markdown);
        assert.match(toolResultSummary('web_search', {}, output), /検索結果 1件：Rust/);
    } finally { globalThis.fetch = original; }
});

test('Older search endpoints explicitly label snippets as unread source pages', async () => {
    const output = await reply({results: [{rank: 1, title: 'Source', url: 'https://example.com/',
        snippet: 'Indexed text', engine: 'brave', published_at: '2026-10-20'}], errors: []});
    assert.match(output, /## 1\. \[Source\]/);
    assert.match(output, /### 検索スニペット/);
    assert.match(output, /本文取得: 未実施/);
    assert.match(output, /公開日: 2026-10-20/);
});
