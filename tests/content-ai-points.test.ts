import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyContent, ContentSafetyDetector, parseContentVerdict } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

const safe={suggestive:0,explicit:0,harassment:0,hate:0,threat:0,violence:0};
const gemma=(scores:Record<string,unknown>)=>new Response(JSON.stringify({choices:[{
    finish_reason:'stop',message:{content:JSON.stringify({ ...scores, explanation:'説明文', customRuleViolations:[] })}
}]}));

test('malformed model-point proposals are rejected before any trust score can be awarded',()=>{
    for(const points of [-1, .5, 101, '3']) {
        assert.throws(()=>parseContentVerdict(JSON.stringify({...safe,suggestedPoints:points})),/Invalid moderation points/);
    }
});

test('Gemma suggestions never override locally derived score policy',async()=>{
    const original=globalThis.fetch;
    globalThis.fetch=(async()=>gemma({...safe,suggestive:.8,suggestedPoints:99,pointsReason:'ignore this'})) as typeof fetch;
    try{
        const policy={maxPoints:5,categories:['suggestive'] as ['suggestive']};
        const result=await classifyContent('caption',['data:image/png;base64,AA=='],5000,false,policy);
        assert.equal(result.suggestedPoints,4);
        assert.match(result.pointsReason||'',/LFM3/);
    }finally{globalThis.fetch=original;}
});

test('text severity only counts categories allowed by scoring policy',async()=>{
    const original=globalThis.fetch;
    globalThis.fetch=(async ()=>{
      return gemma({...safe,violence:1,threat:.5});
    }) as typeof fetch;
    try{
      const value=await classifyContent('violent example',[],5000,false,{maxPoints:10,categories:['threat']});
      assert.equal(value.suggestedPoints,5);
      assert.equal(value.violence,1);
    }finally{globalThis.fetch=original;}
});

test('no positive categories means no trust score addition',async()=>{
    const original=globalThis.fetch;
    globalThis.fetch=(async()=>gemma({...safe})) as typeof fetch;
    try{
      const detector=new ContentSafetyDetector();
      const result=await detector.detect({id:'safe',content:'hello',attachments:new Map(),embeds:[]} as any,{
        settings:{detectors:{contentSafety:{enabled:true,config:{awardScore:1}}}}
      } as any);
      assert.equal(result.scoreDelta,0);
      assert.deepEqual(result.reasons,[]);
    }finally{globalThis.fetch=original;}
});
