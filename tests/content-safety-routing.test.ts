import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Collection } from 'discord.js';
import { classifyContent, ContentSafetyDetector } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';
import { buildGemmaModerationRequest, CONTENT_SAFETY_IMAGE_MODEL } from '../src/core/anticheat/GemmaContentClassifier.ts';
import { JEV_CATEGORY_RULES, buildJevDecisionRequest, scoreJevDecision } from '../src/core/anticheat/JevContentClassifier.ts';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

const keys = Object.keys(JEV_CATEGORY_RULES);
const zero = { suggestive: 0, explicit: 0, harassment: 0, hate: 0, threat: 0, violence: 0 };
const evidence = {
  suggestive: 'sexual invitations or sexualized posing/contact',
  explicit: 'explicit sexual acts or sexual nudity',
  harassment: 'direct personal insults or harassment',
  hate: 'protected-group hatred or discrimination',
  threat: 'concrete threats to harm or kill living people or animals',
  violence: 'violent injury or killing of living beings',
};
type Scores = typeof zero;
const decisionResponse = (value = 0) => new Response(JSON.stringify({
  model: 'jeff-base', prompt_tokens: 60,
  choices: ['none','mild','clear','severe'].map((id, i) => ({id, probability: i === 0 ? 1 - value : i === 3 ? value : 0}))
}));
const gemmaResponse = (scores: Scores = zero) => new Response(JSON.stringify({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...scores, explanation: '分析しました。', customRuleViolations: [] }) } }],
  usage: { prompt_tokens: 30, completion_tokens: 70, total_tokens: 100 },
}));
function mockApi(jev: Partial<Scores> = {}, gemma: Scores = zero) {
  const requests: Array<{url:string; body:any}> = [];
  const api = (async (url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    requests.push({url:String(url),body});
    if (String(url).endsWith('/decide')) {
      const key = keys.find(k => body.question.includes(evidence[k as keyof Scores]));
      return decisionResponse(jev[key as keyof Scores] || 0);
    }
    if (String(url).endsWith('/chat/completions')) return gemmaResponse(gemma);
    throw new Error('Unexpected API route');
  }) as typeof fetch;
  return { api, requests };
}
const msg = (content = 'post') => ({ id:'post', content, editedTimestamp:null, attachments:new Collection(), embeds:[] } as any);
const ctx = (options: Record<string, unknown> = {}) => ({
  guildId:'guild', settings:{detectors:{contentSafety:{enabled:true, config:options}}}
} as any);

test('text goes to jeff-base /decide once per category with typed options', async () => {
  const original = globalThis.fetch; const mock = mockApi();
  globalThis.fetch=mock.api;
  try {
    const metrics:any[] = [];
    const value = await classifyContent('おはよう！',[],8000,false,undefined,'jeff-base',metrics);
    assert.deepEqual(keys.map(k=>value[k as keyof Scores]),[0,0,0,0,0,0]);
    assert.equal(mock.requests.length,6);
    assert.ok(mock.requests.every(r=>r.url.endsWith('/decide') && r.body.model==='jeff-base'));
    assert.ok(mock.requests.every(r=>r.body.options.length===4 && r.body.latest.text==='おはよう！'));
    assert.equal(metrics.length,6);
    assert.ok(metrics.every(r=>r.outputTokens===0));
  } finally { globalThis.fetch=original; }
});

test('decide probability values are validated and unrelated category is verified by Gemma', async () => {
  assert.equal(scoreJevDecision({choices:['none','mild','clear','severe'].map((id,i)=>({id,probability:i===3?1:0}))}),1);
  assert.throws(()=>scoreJevDecision({choices:[]}),/Invalid jev decision/);
  const original=globalThis.fetch; const mock=mockApi({suggestive:1},zero);
  globalThis.fetch=mock.api;
  try {
    const verdict=await classifyContent('今日は散歩に行った',[],8000);
    assert.equal(verdict.suggestive,0);
    assert.equal(mock.requests.filter(x=>x.url.endsWith('/chat/completions')).length,1);
  } finally {globalThis.fetch=original;}
});

test('text matches require confirmation, retain category and points and invalidate scoring cache', async () => {
  const original=globalThis.fetch;
  const mock=mockApi({threat:1},{...zero,threat:1});
  globalThis.fetch=mock.api;
  try {
    const detector=new ContentSafetyDetector();
    const message=msg('物理的危害を告げる');
    const result=await detector.detect(message,ctx({awardScore:1,maxAiScore:10}));
    assert.ok(result.spoilerRepost);
    assert.ok(result.reasons.includes('脅迫'));
    assert.equal(result.scoreDelta,10);
    const count=mock.requests.length;
    assert.equal((await detector.detect(message,ctx({awardScore:1,maxAiScore:10}))).scoreDelta,10);
    assert.equal(mock.requests.length,count);
    assert.equal((await detector.detect(message,ctx({awardScore:1,maxAiScore:5}))).scoreDelta,5);
    assert.equal(mock.requests.length,count+7);
  } finally { globalThis.fetch=original; }
});

test('images, GIF and MP4 are routed to Gemma, with native video_url parts', async () => {
  const original=globalThis.fetch; const mock=mockApi({}, {...zero,suggestive:1});
  globalThis.fetch=mock.api;
  try {
    for (const url of ['data:image/png;base64,AA==','data:image/gif;base64,AA==','data:video/mp4;base64,AA==']) {
      const result=await classifyContent('caption',[url],8000);
      assert.equal(result.suggestive,1);
      const req=mock.requests.at(-1)!;
      assert.equal(req.body.model,CONTENT_SAFETY_IMAGE_MODEL);
      assert.ok(req.url.endsWith('/chat/completions'));
      const part=req.body.messages[1].content[1];
      assert.equal(part.type,url.includes('png')?'image_url':'video_url');
      assert.equal((part.image_url||part.video_url).url,url);
    }
    assert.equal(mock.requests.length,3);
    assert.equal(buildGemmaModerationRequest('',[]).model,CONTENT_SAFETY_IMAGE_MODEL);
  } finally {globalThis.fetch=original;}
});

test('413 splits images without changing them, combines strongest evidence and preserves captions', async () => {
  const original=globalThis.fetch; const accepted:string[]=[];
  globalThis.fetch=(async (_url,options) => {
    const body=JSON.parse(String(options?.body));
    const parts=body.messages[1].content;
    assert.equal(parts[0].text,'caption');
    const images=parts.slice(1);
    if(images.length>1)return new Response('',{status:413});
    accepted.push(images[0].image_url.url);
    return gemmaResponse({...zero, suggestive:images[0].image_url.url==='first'?.3:.9});
  }) as typeof fetch;
  try{
    const verdict=await classifyContent('caption',['first','second'],8000);
    assert.equal(verdict.suggestive,.9);
    assert.deepEqual(accepted,['first','second']);
    globalThis.fetch=(async()=>new Response('',{status:413})) as typeof fetch;
    await assert.rejects(classifyContent('caption',['only'],8000),/HTTP 413/);
  }finally{globalThis.fetch=original;}
});

test('all attached media are scanned even after positive text; original bytes are included', async () => {
  const original=globalThis.fetch;
  const mock=mockApi({threat:1},{...zero,threat:1});
  globalThis.fetch=mock.api;
  try{
    const image=await sharp({create:{width:16,height:16,channels:3,background:'blue'}}).png().toBuffer();
    const detector=new ContentSafetyDetector(async url=>({data:image,type:'png',url}));
    const message=msg('実際の脅迫');
    message.attachments.set('a',{id:'a',name:'a.png',url:'https://cdn.discordapp.com/a.png',contentType:'image/png'});
    message.attachments.set('b',{id:'b',name:'b.png',url:'https://cdn.discordapp.com/b.png',contentType:'image/png'});
    const r=await detector.detect(message,ctx());
    assert.ok(r.spoilerRepost);
    assert.equal(r.spoilerRepost.files.length,2);
    assert.equal(r.metadata?.analyses.length,3);
    assert.equal(mock.requests.filter(r=>r.url.endsWith('/chat/completions')).length,2); // second image is byte-identical and uses the exact cache
  }finally{globalThis.fetch=original;}
});

test('failed media analysis never authorizes a destructive action, even after a confirmed text match',async()=>{
  const original=globalThis.fetch;const mock=mockApi({threat:1},{...zero,threat:1});
  globalThis.fetch=mock.api;
  try{
    const detector=new ContentSafetyDetector(async()=>{throw new Error('Media HTTP 503');});
    const message=msg('脅迫'); message.attachments.set('a',{id:'a',name:'a.png',url:'https://cdn.discordapp.com/a.png',contentType:'image/png'});
    await assert.rejects(detector.detect(message,ctx({action:'delete'})),/incomplete.*image-analysis-failed/);
    const max=new ContentSafetyDetector();
    const over=msg('safe');
    for(let i=0;i<2;i++)over.attachments.set(String(i),{id:String(i),name:'image.png',url:'https://cdn.discordapp.com/'+i+'.png',contentType:'image/png'});
    await assert.rejects(max.detect(over,ctx({maxImages:1,scanText:0,action:'delete'})),/incomplete/);
  }finally{globalThis.fetch=original;}
});

test('invalid replies or failed providers cannot create a safe result',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=(async()=>new Response(JSON.stringify({choices:[{id:'yes',probability:1}]}))) as typeof fetch;
  try{await assert.rejects(classifyContent('post',[],5000),/Invalid jev decision/);}
  finally{globalThis.fetch=original;}
});

test('API failure retry refetches the original and re-runs the normal message pipeline',async()=>{
  const manager:any=new AntiCheatManager();
  const id='retry-test'; const message:any={id,guild:{id:'guild'},fetch:async()=>message};
  const oldTimeout=globalThis.setTimeout;
  let callback:(()=>void)|undefined;
  globalThis.setTimeout=((fn:()=>void)=>{callback=fn;return {unref(){}} as any;}) as typeof setTimeout;
  let calls=0;
  manager.onMessage=async(fresh:any,only:boolean)=>{ assert.equal(fresh,message);assert.equal(only,true);calls++;return false;};
  try{
    manager.scheduleContentRetry(message,new Error('Moderation API HTTP 503'));
    assert.equal(manager.contentRetries.get(id).attempts,1);
    assert.ok(callback);
    callback!();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls,1);
    manager.cancelContentRetry(id);
  }finally{globalThis.setTimeout=oldTimeout;manager.cancelContentRetry(id);}
});

test('API failure keeps scheduling retries after the old six-attempt limit',()=>{
  const manager:any=new AntiCheatManager();
  const id='persistent-retry'; const message:any={id,guild:{id:'guild'},fetch:async()=>message};
  const oldTimeout=globalThis.setTimeout;
  const delays:number[]=[];
  globalThis.setTimeout=((_fn:()=>void,delay?:number)=>{delays.push(delay||0);return {unref(){}} as any;}) as typeof setTimeout;
  try{
    for(let attempt=1;attempt<=9;attempt++){
      const pending=manager.contentRetries.get(id);
      if(pending)pending.timer=undefined;
      manager.scheduleContentRetry(message,new Error('Moderation API HTTP 503'));
      assert.equal(manager.contentRetries.get(id).attempts,attempt);
    }
    assert.equal(delays.length,9);
    assert.equal(delays.at(-1),15*60_000);
  }finally{globalThis.setTimeout=oldTimeout;manager.cancelContentRetry(id);}
});
