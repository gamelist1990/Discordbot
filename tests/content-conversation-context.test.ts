import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContentConversationContext } from '../src/core/anticheat/ContentConversationContext.ts';
import { buildLfmModerationRequest } from '../src/core/anticheat/LfmContentClassifier.ts';
import { isHarmlessMentionComplaint, ContentSafetyDetector } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';
import { lfmResponse } from './fixtures/lfm.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();
const t = Date.now();
const author = (id: string) => ({id,bot:false});
const post = (id: string, content: string, ts: number, bot = false) => ({id, content, createdTimestamp:ts, author:{id:id+'user',bot}, channelId:'channel'});
function buildMessage(content: string, neighbors: any[], fetchThrows = false) {
    let calls = 0;
    const message: any = {
        id:'target', createdTimestamp:t, channelId:'channel', content,
        editedTimestamp:null, attachments:new Map(), embeds:[], author:author('current'),
        channel:{messages:{fetch:async (options: any)=>{
            calls++;
            assert.deepEqual(options, {around:'target', limit:50});
            if(fetchThrows) throw new Error('missing permission');
            return new Map(neighbors.map(item=>[item.id,item]));
        }}},
    };
    return {message, getCalls:()=>calls};
}
function context():any {
    return {guildId:'test-context', settings:{detectors:{contentSafety:{enabled:true,config:{scanText:1,scanImages:0}}}}};
}

test('fetch same-channel before and after, excluding bot/system, stale and target messages', async () => {
    const nearby = [
        post('old','old sexual topic',t - 40*60_000),
        post('before','前の話題',t-20_000),
        post('target','現投稿',t),
        post('after','補足だよ',t+2_000),
        post('bot','automated moderation repost',t+3_000,true),
        {...post('other','private channel content',t-1000),channelId:'other'},
        post('muchlater','after 45 minutes',t+45*60_000),
    ];
    const {message,getCalls}=buildMessage('くっそメンションされてるんだが',nearby);
    const data=JSON.parse(await loadContentConversationContext(message,'返信先だよ',0));
    assert.equal(getCalls(),1);
    assert.deepEqual(data.before.map((e:any)=>e.text),['前の話題']);
    assert.deepEqual(data.after.map((e:any)=>e.text),['補足だよ']);
    assert.equal(data.repliedTo,'返信先だよ');
    assert.ok(!JSON.stringify(data).includes('old sexual topic'));
});

test('unavailable history falls back to referenced message and does not block classification', async () => {
    const {message}=buildMessage('some text',[],true);
    assert.equal(await loadContentConversationContext(message,'',0),'');
    assert.deepEqual(JSON.parse(await loadContentConversationContext(message,'引用元',0)),{repliedTo:'引用元'});
});

test('request sends current post separately from non-scoring before/after context and enables low reasoning', () => {
    const nearby=JSON.stringify({before:[{author:'alice',text:'肉体関係を前提に付き合ってください'}],after:[{author:'bob',text:'それはちょっと'}]});
    const request=buildLfmModerationRequest('くっそメンションされてるんだが',[], '',nearby);
    assert.equal(request.reasoning_effort,'low');
    assert.ok(request.max_tokens>=700);
    const text=String(request.messages[1].content);
    assert.match(text,/CURRENT_POST_TO_SCORE/);
    assert.match(text,/NEIGHBORING_POSTS_FOR_CONTEXT_ONLY_DO_NOT_SCORE/);
    assert.ok(text.includes(nearby));
    assert.match(String(request.messages[0].content),/NEVER scoring targets/);
});

test('complaint about being pinged is not sexual or harassment despite hallucinated AI categories', async () => {
    assert.equal(isHarmlessMentionComplaint('くっそメンションされてるんだが'),true);
    assert.equal(isHarmlessMentionComplaint('お前メンションするな、死ね'),false);
    const prior=post('before','肉体関係を前提に付き合ってください',t-500);
    const next=post('after','え？？？',t+500);
    const {message}=buildMessage('くっそメンションされてるんだが',[prior,next]);
    const original=globalThis.fetch;
    let body:any;
    globalThis.fetch=(async (_url,init)=> {
        body=JSON.parse(String(init?.body));
        return lfmResponse({suggestive:1,harassment:1,explanation:'inappropriate sexual expression'});
    }) as typeof fetch;
    try {
        const result=await new ContentSafetyDetector().detect(message,context());
        assert.deepEqual(result.reasons,[]);
        assert.equal(result.spoilerRepost,undefined);
        assert.equal(result.contentDeletion,undefined);
        assert.match(String(body.messages[1].content),/CURRENT_POST_TO_SCORE/);
        assert.match(String(body.messages[1].content),/肉体関係を前提に/);
    } finally {globalThis.fetch=original;}
});

test('actual threat remains actionable despite benign surrounding conversation', async () => {
    const {message}=buildMessage('お前を明日殴る',[
        post('before','今日はいい天気',t-1000),
        post('after','どうしたの',t+200),
    ]);
    const old=globalThis.fetch;
    globalThis.fetch=(async ()=>lfmResponse({threat:1})) as typeof fetch;
    try {
        const result=await new ContentSafetyDetector().detect(message,context());
        assert.ok(result.reasons.some(x=>x.includes('脅迫')));
    } finally {globalThis.fetch=old;}
});

test('a newer reply during inference triggers one context refresh before censoring', async () => {
    const previous = post('before', '何かあった？', t - 500);
    const later = post('after', 'さっきのはネタです', t + 1200);
    let fetched = 0;
    const {message} = buildMessage('変なこと言われた', [previous]);
    message.channel.messages.fetch = async (_options:any) => {
        fetched++;
        return new Map((fetched === 1 ? [previous] : [previous, later]).map(item=>[item.id,item]));
    };
    const orig=globalThis.fetch;
    let analyzed=0;
    globalThis.fetch=(async (_url:any,init:any)=>{
        analyzed++;
        const body=JSON.parse(String(init.body));
        const userContent=String(body.messages[1].content);
        return lfmResponse(userContent.includes('さっきのはネタです') ? {} : {suggestive:1});
    }) as typeof fetch;
    try {
        const result=await new ContentSafetyDetector().detect(message,context());
        assert.equal(fetched,2);
        assert.equal(analyzed,2);
        assert.deepEqual(result.reasons,[]);
        assert.equal(result.spoilerRepost,undefined);
    } finally {globalThis.fetch=orig;}
});

test('includes up to ten neighboring posts per side, keeping the nearest ones', async () => {
    const neighbors: any[] = [];
    for (let i = 12; i >= 1; i--) neighbors.push(post('before' + i, '前' + i, t - i * 60_000));
    neighbors.push(post('target', '現投稿', t));
    for (let i = 1; i <= 12; i++) neighbors.push(post('after' + i, '後' + i, t + i * 60_000));
    const {message} = buildMessage('対象の投稿', neighbors);
    const data = JSON.parse(await loadContentConversationContext(message, '', 0));
    assert.equal(data.before.length, 10);
    assert.equal(data.after.length, 10);
    // The two farthest posts on each side are the ones left out.
    assert.equal(data.before[0].text, '前10');
    assert.equal(data.before.at(-1).text, '前1');
    assert.equal(data.after[0].text, '後1');
    assert.equal(data.after.at(-1).text, '後10');
});

test('total context budget drops the temporally farthest posts first', async () => {
    const longText = 'x'.repeat(400); // truncated to the 300-char preview per post
    const neighbors: any[] = [];
    for (let i = 10; i >= 1; i--) neighbors.push(post('b' + String(i).padStart(17, '0'), longText, t - i * 60_000));
    neighbors.push(post('target', '現投稿', t));
    for (let i = 1; i <= 10; i++) neighbors.push(post('a' + String(i).padStart(17, '0'), longText, t + i * 60_000));
    const {message} = buildMessage('対象の投稿', neighbors);
    const raw = await loadContentConversationContext(message, 'y'.repeat(500), 0);
    assert.ok(raw.length <= 8000, `context length ${raw.length} exceeds the budget`);
    const data = JSON.parse(raw);
    // Nearest posts survive; at least one farthest post was dropped.
    assert.equal(data.before.at(-1).timestamp, t - 60_000);
    assert.equal(data.after[0].timestamp, t + 60_000);
    assert.ok(data.before.length + data.after.length < 20);
    assert.equal(data.repliedTo, 'y'.repeat(500));
});
