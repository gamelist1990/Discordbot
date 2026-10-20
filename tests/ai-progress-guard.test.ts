import test from 'node:test';
import assert from 'node:assert/strict';
import { AIProgressGuard, AIProgressStalledError, AI_LOOP_STOP_MESSAGE } from '../src/core/ai/AIProgressGuard.ts';
import { ChatGPTClient } from '../src/core/ai/ChatGPTClient.ts';

const options = { model: 'test-model', strictModel: true };
const messages = [{ role: 'user' as const, content: '現在の情報を調べて' }];
const sentence = '検索結果が空だったので、もう一度違う言葉で検索してみる。';
function clientFor(handler: (args: any) => unknown) {
    const client = new ChatGPTClient({ apiEndpoint: 'http://127.0.0.1:1', apiKey: 'test', defaultModel: 'test-model' });
    const internal = client as any;
    internal.resolveModelCandidates = async () => ['test-model'];
    internal.resolveAuthCandidates = () => [{ apiEndpoint: 'http://127.0.0.1:1', apiKey: 'test' }];
    client.registerTool({ type: 'function', function: { name: 'web_search', parameters: { type: 'object', properties: {} } } }, handler as any);
    return { client, internal };
}
function call(n: number) {
    return { type: 'function_call', id: `fc_${n}`, call_id: `call_${n}`, name: 'web_search', arguments: JSON.stringify({ query: `variant ${n}` }) };
}

test('Different empty/failed queries stop, while arbitrarily long productive research is allowed', () => {
    const guard = new AIProgressGuard();
    for (let i=0; i<100; i++) guard.record('web_search', {query:`q${i}`}, `New fact ${i}`);
    assert.equal(guard.stalled, false);
    guard.record('web_search', {query:'ja'}, 'SEARCH_EMPTY: ja');
    guard.record('web_search', {query:'en'}, 'SEARCH_ERROR: offline');
    assert.equal(guard.stalled, false);
    guard.record('web_search', {query:'rephrased'}, 'SEARCH_EMPTY: rephrased');
    assert.equal(guard.stalled, true);
});

test('Changing rank/order and retrieval timestamps does not count as new search evidence', () => {
    const guard = new AIProgressGuard();
    guard.record('web_search', {query:'q1'}, '1. [A](https://a.example)\nFact A\n2. [B](https://b.example)\nFact B\n検索日時: t1');
    guard.record('web_search', {query:'q2'}, '1. [B](https://b.example)\nFact B\n2. [A](https://a.example)\nFact A\n検索日時: t2');
    guard.record('web_search', {query:'q3'}, '1. [A](https://a.example)\nFact A\n2. [B](https://b.example)\nFact B\n検索日時: t3');
    assert.equal(guard.stalled, true);
});

test('New evidence from another call in a parallel batch restores progress', () => {
    const guard = new AIProgressGuard();
    for (let i=0; i<3; i++) guard.record('web_search', {query:`q${i}`}, 'SEARCH_ERROR: offline');
    assert.equal(guard.stalled, true);
    guard.record('fetch_url', {url:'https://primary.example/'}, 'Confirmed fact from source');
    assert.equal(guard.stalled, false);
});

test('Retry narration is detected across chunk boundaries, while quoted examples and poetry are allowed', () => {
    const guard = new AIProgressGuard();
    const repeated = sentence.repeat(20);
    assert.throws(() => { for (let i=0; i<repeated.length; i+=3) guard.observe(repeated.slice(i,i+3), 'thinking'); }, AIProgressStalledError);
    const ordinary = new AIProgressGuard();
    ordinary.observe('海は青い。'.repeat(30), 'text');
    ordinary.observe('```text\n'+sentence.repeat(10)+'\n```\n', 'text');
    ordinary.observe(('> '+sentence+'\n').repeat(10), 'text');
    assert.equal(ordinary.stalled, false);
});

test('Repeated thinking across actual tool turns does not accumulate into a false loop', () => {
    const guard = new AIProgressGuard();
    guard.observe(sentence.repeat(3), 'thinking');
    guard.record('manage_memory', {action: 'list', store: 'server_memos'}, {memos: []});
    guard.observe(sentence.repeat(3), 'thinking');
    guard.record('manage_memory', {action: 'recall', store: 'my_profile'}, '記録されたメモリーはありません');
    guard.observe(sentence.repeat(3), 'thinking');
    assert.equal(guard.stalled, false);
});

test('Structured tool failures count as failures even when the model changes arguments', () => {
    const guard = new AIProgressGuard();
    for (let n = 0; n < 3; n++) guard.record('manage_memory', {store: `invalid-${n}`}, {error: '有効なstoreを指定してください'});
    assert.equal(guard.stalled, true);
});

test('Responses ends three unsuccessful search rounds with a tool-free summary, overriding forced tools', async () => {
    let executions=0, requests=0;
    const {client,internal} = clientFor(() => { executions++; return 'SEARCH_EMPTY: no matching results'; });
    internal.streamResponseApiPayload = async (_auth: unknown, payload: any, emit: any) => {
        requests++;
        if (payload.tool_choice==='none') {
            assert.equal(payload.input.filter((item: any) => item.type==='function_call_output').length,3);
            assert.match(payload.input.at(-1).content,/ツールの呼び出し/);
            emit({type:'text',text:'確認できる情報を取得できませんでした。'});
            return {responseId:'resp_final',functionCalls:[],outputItems:[]};
        }
        assert.ok(requests<=3,'loop was not stopped');
        const item=call(requests);
        return {responseId:`resp_${requests}`,functionCalls:[{id:item.id,callId:item.call_id,name:item.name,arguments:item.arguments}],outputItems:[item]};
    };
    let text='';
    await client.streamResponse(messages,delta=>{if(delta.type==='text')text+=delta.text;},{...options,forceToolSequence:Array(10).fill('web_search')});
    assert.equal(executions,3);assert.equal(requests,4);assert.match(text,/取得できません/);
});

test('A provider ignoring tool_choice none cannot execute further tools or trigger fallback', async () => {
    let executions=0,requests=0;
    const {client,internal}=clientFor(()=>{executions++;return 'SEARCH_ERROR: unavailable';});
    internal.resolveAuthCandidates=()=>[{apiEndpoint:'primary',apiKey:'test'},{apiEndpoint:'fallback',apiKey:'test'}];
    internal.streamResponseApiPayload=async()=>{
        assert.ok(++requests<=4);
        const item=call(requests);
        return {responseId:'resp',functionCalls:[{callId:item.call_id,name:item.name,arguments:item.arguments}],outputItems:[item]};
    };
    let text='';
    await client.streamResponse(messages,delta=>{if(delta.type==='text')text+=delta.text;},options);
    assert.equal(executions,3);assert.equal(requests,4);assert.match(text,/調査を停止/);
});

test('A real repeated memory loop stops without claiming a Web investigation failed', async () => {
    let executions = 0, requests = 0;
    const {client, internal} = clientFor(() => 'unused');
    client.registerTool({type: 'function', function: {name: 'manage_memory', parameters: {type: 'object'}}},
        () => { executions++; return {memos: []}; });
    internal.streamResponseApiPayload = async () => {
        assert.ok(++requests <= 4);
        const item = {...call(requests), name: 'manage_memory', arguments: '{"action":"list","store":"server_memos"}'};
        return {responseId: 'memory', functionCalls: [{callId: item.call_id, name: item.name, arguments: item.arguments}], outputItems: [item]};
    };
    let text = '';
    await client.streamResponse(messages, delta => {if (delta.type === 'text') text += delta.text;}, options);
    assert.equal(executions, 3);
    assert.equal(requests, 4);
    assert.match(text, /同じツール操作/);
    assert.doesNotMatch(text, /検索|事実を確認/);
});

test('Repeating Thinking is interrupted and produces one truthful final message', async () => {
    const {client,internal}=clientFor(()=>{throw new Error('must not run');});
    let attempts=0,closed=false,emitted=0,text='';
    internal.streamResponseApiPayload=async(_auth: unknown,_payload: unknown,emit: any)=>{
        attempts++;
        try { for(let i=0;i<100;i++){emitted++;emit({type:'thinking',text:sentence});} }
        finally {closed=true;}
        throw new Error('loop guard failed');
    };
    await client.streamResponse(messages,delta=>{if(delta.type==='text')text+=delta.text;},options);
    assert.equal(attempts,1);assert.ok(closed);assert.equal(emitted,4);
    assert.equal(text.trim(),AI_LOOP_STOP_MESSAGE);
});

for (const stream of [false,true]) {
    test(`Chat Completions ${stream?'streaming':'non-streaming'} finalizes without another search`,async()=>{
        let requests=0,executions=0;
        const {client,internal}=clientFor(()=>{executions++;return 'SEARCH_EMPTY: empty';});
        internal.createClient=()=>({chat:{completions:{create:async(payload:any)=>{
            requests++;
            assert.ok(requests<=4);
            const final=payload.tool_choice==='none';
            const item=call(requests);
            const message=final?{role:'assistant',content:'確認できません。'}:{role:'assistant',content:null,tool_calls:[{id:item.call_id,type:'function',function:{name:item.name,arguments:item.arguments}}]};
            if(!stream)return {choices:[{message,finish_reason:final?'stop':'tool_calls'}]};
            return (async function*(){yield {choices:[{delta:final?{content:message.content}:{tool_calls:message.tool_calls!.map(tool=>({...tool,index:0}))},finish_reason:final?'stop':'tool_calls'}]};})();
        }}}});
        let text='';
        if(stream)await client.streamMessage(messages,chunk=>{text+=chunk.choices[0]?.delta.content||'';},options);
        else text=String((await client.sendMessage(messages,options)).choices[0].message.content);
        assert.equal(executions,3);assert.equal(requests,4);assert.match(text,/確認できません/);
    });
}

test('Progress state is isolated for concurrent requests on one client',async()=>{
    const {client,internal}=clientFor(args=>args.query.startsWith('empty')?'SEARCH_EMPTY: empty':`fact ${args.query}`);
    internal.streamResponseApiPayload=async(_auth:unknown,payload:any,emit:any)=>{
        const origin=payload.input[0].content;
        const rounds=payload.input.filter((item:any)=>item.type==='function_call_output').length;
        await new Promise(resolve=>setTimeout(resolve,1));
        if(payload.tool_choice==='none'||(origin==='productive'&&rounds===12)){
            emit({type:'text',text:origin});return {responseId:'resp',functionCalls:[],outputItems:[]};
        }
        assert.ok(rounds<13);
        const item=call(rounds);item.arguments=JSON.stringify({query:`${origin} ${rounds}`});
        return {responseId:'resp',functionCalls:[{callId:item.call_id,name:item.name,arguments:item.arguments}],outputItems:[item]};
    };
    const output=['',''];
    await Promise.all(['empty','productive'].map((origin,index)=>client.streamResponse([{role:'user',content:origin}],delta=>{if(delta.type==='text')output[index]+=delta.text;},options)));
    assert.deepEqual(output,['empty','productive']);
});

test('A real SDK SSE stream is closed when repeated reasoning is detected',async()=>{
    const http=await import('node:http');
    let sent=0,closed=false;
    let waitForClose!:()=>void;
    const closing=new Promise<void>(resolve=>{waitForClose=resolve;});
    const server=http.createServer((_request,response)=>{
        response.writeHead(200,{'content-type':'text/event-stream'});
        const timer=setInterval(()=>{
            sent++;
            response.write(`data: ${JSON.stringify({type:'response.reasoning_summary_text.delta',item_id:'rs_test',output_index:0,summary_index:0,delta:sentence,sequence_number:sent})}\n\n`);
            if(sent>20){clearInterval(timer);response.end();}
        },5);
        response.on('close',()=>{clearInterval(timer);closed=true;waitForClose();});
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const client=new ChatGPTClient({apiEndpoint:`http://127.0.0.1:${address.port}`,apiKey:'test',defaultModel:'test-model'});
    const internal=client as any;
    internal.resolveModelCandidates=async()=>['test-model'];
    internal.resolveAuthCandidates=()=>[{apiEndpoint:`http://127.0.0.1:${address.port}`,apiKey:'test'}];
    try{
        let text='';
        await client.streamResponse(messages,delta=>{if(delta.type==='text')text+=delta.text;},options);
        await Promise.race([closing,new Promise((_,reject)=>setTimeout(()=>reject(new Error('SSE did not close')),1000))]);
        assert.ok(closed);assert.ok(sent<20);assert.equal(text.trim(),AI_LOOP_STOP_MESSAGE);
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('A stalled investigation with only usage or thinking still gives a final stop notice',async()=>{
    let requests=0;
    const {client,internal}=clientFor(()=>'SEARCH_EMPTY: no results');
    internal.streamResponseApiPayload=async(_auth:unknown,payload:any,emit:any)=>{
        requests++;
        if(payload.tool_choice==='none'){
            emit({type:'usage',totalTokens:1});
            return {responseId:'resp',functionCalls:[],outputItems:[]};
        }
        const item=call(requests);
        return {responseId:'resp',functionCalls:[{callId:item.call_id,name:item.name,arguments:item.arguments}],outputItems:[item]};
    };
    let text='';
    await client.streamResponse(messages,delta=>{if(delta.type==='text')text+=delta.text;},options);
    assert.equal(requests,4);assert.equal(text.trim(),AI_LOOP_STOP_MESSAGE);
});
