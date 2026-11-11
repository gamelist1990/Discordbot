import test from 'node:test';
import assert from 'node:assert/strict';
import { AIProgressGuard, AI_LOOP_STOP_MESSAGE } from '../src/core/ai/AIProgressGuard.ts';
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

test('Distinct failed queries never trigger loop detection', () => {
    const guard = new AIProgressGuard();
    for (let i = 0; i < 100; i++) guard.record('web_search', {query:'q'+i}, 'New fact '+i);
    guard.record('web_search', {query:'ja'}, 'SEARCH_EMPTY: ja');
    guard.record('web_search', {query:'en'}, 'SEARCH_ERROR: offline');
    guard.record('web_search', {query:'rephrased'}, 'SEARCH_EMPTY: rephrased');
    assert.equal(guard.stalled, false);
});

test('Distinct searches may return identical pages; only exact retries stall', () => {
    const guard = new AIProgressGuard();
    const a = '1. [A](https://a.example)\nFact A\n2. [B](https://b.example)\nFact B\n検索日時: t1';
    const b = '1. [B](https://b.example)\nFact B\n2. [A](https://a.example)\nFact A\n検索日時: t2';
    guard.record('web_search', {query:'q1'}, a);
    guard.record('web_search', {query:'q2'}, b);
    guard.record('web_search', {query:'q3'}, a);
    assert.equal(guard.stalled, false);
    guard.record('web_search', {query:'q3'}, b);
    guard.record('web_search', {query:'q3'}, a);
    assert.equal(guard.stalled, true);
});

test('New evidence can restore a stalled repeated request', () => {
    const guard = new AIProgressGuard();
    for (let i = 0; i < 3; i++) guard.record('web_search', {query:'same'}, 'SEARCH_ERROR: offline');
    assert.equal(guard.stalled, true);
    guard.record('fetch_url', {url:'https://primary.example/'}, 'Confirmed fact from source');
    assert.equal(guard.stalled, false);
});

test('Repeated narration never interrupts normal ongoing response', () => {
    const guard = new AIProgressGuard();
    const repeated = sentence.repeat(20);
    for (let i=0; i<repeated.length; i+=3) guard.observe(repeated.slice(i,i+3), 'thinking');
    guard.observe('回答を完成させます。', 'text');
    guard.observe('海は青い。'.repeat(30), 'text');
    guard.observe('記載のファイルが見つからなかった。'.repeat(10), 'text');
    assert.equal(guard.stalled, false);
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

test('Different failed file operations are not a loop; identical attempts still are', () => {
    const guard = new AIProgressGuard();
    for (let i=0; i<3; i++) guard.record('output_file', {filename:'file-'+i}, {error:'no destination'});
    assert.equal(guard.stalled, false);
    for (let i=0; i<3; i++) guard.record('output_file', {filename:'same.txt'}, {error:'no destination'});
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
        item.arguments = '{"query":"same repeated failed search"}';
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
        item.arguments = '{"query":"same repeated failed search"}';
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

test('Long repeated Thinking continues until a real final response', async () => {
    const {client,internal}=clientFor(()=>{throw new Error('must not run');});
    let requests=0,emitted=0,text='';
    internal.streamResponseApiPayload=async(_auth:unknown,_payload:unknown,emit:any)=>{
        requests++;
        for(let i=0;i<100;i++){emitted++;emit({type:'thinking',text:sentence});}
        emit({type:'text',text:'調査は正常に完走しました。'});
        return {responseId:'resp_done',functionCalls:[],outputItems:[]};
    };
    await client.streamResponse(messages,delta=>{if(delta.type==='text')text+=delta.text;},options);
    assert.equal(requests,1);assert.equal(emitted,100);
    assert.equal(text,'調査は正常に完走しました。');
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
            item.arguments = '{"query":"same repeated failed search"}';
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
        const item=call(rounds);item.arguments=JSON.stringify({query:origin==='empty' ? 'same failed query' : origin+' '+rounds});
        return {responseId:'resp',functionCalls:[{callId:item.call_id,name:item.name,arguments:item.arguments}],outputItems:[item]};
    };
    const output=['',''];
    await Promise.all(['empty','productive'].map((origin,index)=>client.streamResponse([{role:'user',content:origin}],delta=>{if(delta.type==='text')output[index]+=delta.text;},options)));
    assert.deepEqual(output,['empty','productive']);
});

test('A real SDK SSE stream delivers final text after 21 repeated Thinking chunks', async () => {
    const http=await import('node:http');
    let sent=0,closed=false;
    const server=http.createServer((_request,response)=>{
        response.writeHead(200,{'content-type':'text/event-stream'});
        const timer=setInterval(()=>{
            sent++;
            response.write('data: '+JSON.stringify({type:'response.reasoning_summary_text.delta',item_id:'rs_test',output_index:0,summary_index:0,delta:sentence,sequence_number:sent})+'\n\n');
            if(sent>20){
                clearInterval(timer);
                response.write('data: '+JSON.stringify({type:'response.output_text.delta',item_id:'msg_1',output_index:1,delta:'最後まで回答した。'})+'\n\n');
                response.write('data: '+JSON.stringify({type:'response.completed',response:{id:'resp_done',output:[]}})+'\n\n');
                response.end();
            }
        },5);
        response.on('close',()=>{clearInterval(timer);closed=true;});
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const client=new ChatGPTClient({apiEndpoint:'http://127.0.0.1:'+address.port,apiKey:'test',defaultModel:'test-model'});
    const internal=client as any;
    internal.resolveModelCandidates=async()=>['test-model'];
    internal.resolveAuthCandidates=()=>[{apiEndpoint:'http://127.0.0.1:'+address.port,apiKey:'test'}];
    try{
        let text='';
        await client.streamResponse(messages,delta=>{if(delta.type==='text')text+=delta.text;},options);
        assert.ok(sent>=21);assert.equal(text,'最後まで回答した。');
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    assert.ok(closed);
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
        item.arguments = '{"query":"same repeated failed search"}';
        return {responseId:'resp',functionCalls:[{callId:item.call_id,name:item.name,arguments:item.arguments}],outputItems:[item]};
    };
    let text='';
    await client.streamResponse(messages,delta=>{if(delta.type==='text')text+=delta.text;},options);
    assert.equal(requests,4);assert.equal(text.trim(),AI_LOOP_STOP_MESSAGE);
});
