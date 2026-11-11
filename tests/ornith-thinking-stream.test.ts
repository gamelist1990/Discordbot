import test from 'node:test';
import assert from 'node:assert/strict';
import { ThinkingStreamDemux } from '../src/core/ai/ThinkingStreamDemux.ts';
import { ChatGPTClient } from '../src/core/ai/ChatGPTClient.ts';

const raw='思考の途中。7匹から3匹が移動。残りは4匹。\n</think>\n答えは4匹です。';

test('Ornith thinking output becomes reasoning, not answer text, across every chunk boundary', () => {
    for (let chunk=1;chunk<20;chunk++) {
        const demux=new ThinkingStreamDemux();const output:any[]=[];
        const chars=Array.from(raw);
        for(let i=0;i<chars.length;i+=chunk) output.push(...demux.push({type:'text',text:chars.slice(i,i+chunk).join('')}));
        output.push(...demux.finish());
        assert.equal(output.filter(x=>x.type==='thinking').map(x=>x.text).join(''),'思考の途中。7匹から3匹が移動。残りは4匹。\n',`chunk=${chunk}`);
        assert.equal(output.filter(x=>x.type==='text').map(x=>x.text).join(''),'答えは4匹です。',`chunk=${chunk}`);
        assert.ok(output.every(x=>!x.text?.includes('</think>')),`chunk=${chunk}`);
    }
});

test('unfinished thought stays reasoning only; native reasoning remains unchanged', () => {
    const demux=new ThinkingStreamDemux();
    const chunks=[...demux.push({type:'text',text:'まだ考えています'}),...demux.finish()];
    assert.equal(chunks.filter(x=>x.type==='text').length,0);
    assert.equal(chunks.map(x=>x.text).join(''),'まだ考えています');
    const native=new ThinkingStreamDemux();
    assert.deepEqual(native.push({type:'thinking',text:'ネイティブ'}),[{type:'thinking',text:'ネイティブ'}]);
    assert.deepEqual(native.push({type:'text',text:'答え'}),[{type:'text',text:'答え'}]);
});

test('ChatGPTClient restores actual thinking SSE events for local Ornith Responses API', async () => {
    const c=new ChatGPTClient({apiEndpoint:'http://127.0.0.1:1',apiKey:'test',defaultModel:'ornith-1.5-35b-a3b-strata'});
    const internal=c as any;
    internal.resolveAuthCandidates=()=>[{apiEndpoint:'local',apiKey:'test'}];
    internal.resolveModelCandidates=async()=>['ornith-1.5-35b-a3b-strata'];
    internal.streamResponseApiPayload=async (_auth:any,payload:any,emit:any)=>{
        assert.deepEqual(payload.chat_template_kwargs,{enable_thinking:true});
        assert.equal(payload.reasoning.effort,'high');
        emit({type:'text',text:'途中の思考。</thi'});
        emit({type:'text',text:'nk>\n最終回答。'});
        emit({type:'usage',inputTokens:20,outputTokens:24});
        return {responseId:'r',functionCalls:[],outputItems:[]};
    };
    const seen:any[]=[];
    await c.streamResponse([{role:'user',content:'日本語で答えて'}],e=>seen.push(e),{
        model:'ornith-1.5-35b-a3b-strata',strictModel:true,
        reasoningEffort:'high',chatTemplateKwargs:{enable_thinking:true},
    });
    assert.equal(seen.filter(x=>x.type==='thinking').map(x=>x.text).join(''),'途中の思考。');
    assert.equal(seen.filter(x=>x.type==='text').map(x=>x.text).join(''),'最終回答。');
    assert.equal(seen.filter(x=>x.type==='usage').length,1);
});
