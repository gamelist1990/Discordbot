import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJevDecisionRequest, scoreJevDecision, classifyWithJev,
  verdictFromJev, JEV_CATEGORY_RULES
} from '../src/core/anticheat/JevContentClassifier.ts';
import { jevResponse } from './fixtures/jev.ts';
import { similarityInput, inputSimilarity } from '../src/core/anticheat/ContentVerdictCache.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

test('jev-base text-only decisions have exactly four named options per category', () => {
  for (const category of Object.keys(JEV_CATEGORY_RULES) as Array<keyof typeof JEV_CATEGORY_RULES>) {
    const r=buildJevDecisionRequest('現在の投稿',category);
    assert.equal(r.latest.text,'現在の投稿');
    assert.deepEqual(r.options.map(x=>x.id), ['none','mild','clear','severe']);
    assert.match(r.question,/current post/);
    assert.match(r.question,/reply target/);
  }
  const custom=buildJevDecisionRequest('post','custom_rules','no spam');
  assert.match(custom.question,/no spam/);
});

test('jev response probabilities must cover all categories and total one', () => {
  const choices=['none','mild','clear','severe'].map((id,i)=>({id,probability:i===3?1:0}));
  assert.equal(scoreJevDecision({choices}),1);
  for(const invalid of [
    {choices:choices.slice(1)},
    {choices:choices.map((c,i)=>({...c, probability:i===3?2:0}))},
    {choices:choices.map(c=>({...c, probability:.1}))},
  ]) assert.throws(()=>scoreJevDecision(invalid), /Invalid jev decision/);
});

test('legacy structured verdict still requires a category evidence gate', async () => {
  const response=await jevResponse({threat:.9}).json() as any;
  const result=JSON.parse(response.choices[0].message.content);
  result.answers.explicit_strength.score=3;
  assert.equal(verdictFromJev(result).explicit,0);
  assert.ok(verdictFromJev(result).threat>=.89);
  assert.throws(()=>verdictFromJev({answers:{}}),/Invalid jev/);
});

test('custom rule decision exists only when server rules are configured', async () => {
  const original=globalThis.fetch; const submitted:any[]=[];
  globalThis.fetch=(async (_url,options)=>{
    const body=JSON.parse(String(options?.body)); submitted.push(body);
    const positive=body.question.includes('Server rules:');
    return new Response(JSON.stringify({choices:['none','mild','clear','severe'].map((id,i)=>({id,probability:i===(positive?3:0)?1:0}))}));
  }) as typeof fetch;
  try {
    const metrics:any[]=[];
    const verdict=await classifyWithJev('message',[],5000,false,undefined,'jeff-base',metrics,'do not flood chat');
    assert.deepEqual(verdict.customRuleViolations,['サーバー独自ルール']);
    assert.equal(submitted.length,7);
    assert.equal(metrics.length,7);
    await assert.rejects(classifyWithJev('message',['frame'],5000,false,undefined,'jeff-base',[],''),/text only/);
  }finally{globalThis.fetch=original;}
});

test('video cache requires identical bytes and caption', async () => {
  const url='data:video/mp4;base64,AAAA';
  const first=await similarityInput('caption',[url]);
  assert.equal(inputSimilarity(first,await similarityInput('caption',[url])),1);
  assert.equal(inputSimilarity(first,await similarityInput('changed',[url])),0);
  assert.equal(inputSimilarity(first,await similarityInput('caption',[url+'BB'])),0);
});
