import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { ChatGPTClient } from '../src/core/ai/ChatGPTClient.ts';
import { AIProgressGuard, AIProgressStalledError } from '../src/core/ai/AIProgressGuard.ts';
import { staffOutputFileDefinition, staffOutputFileHandler, completeStaffFileTools, isSingleStaffFileRequest } from '../src/commands/staff/subcommands/ai-tools/fileOutput.ts';
import { toolResultError } from '../src/core/ai/ToolResultStatus.ts';

const prompt='適当にファイル作って出力して';
const args={filename:'適当なテキスト.txt',content:'適当なテキストファイルです。\n'};
const options={model:'test-model',strictModel:true};
function fixture(){
    let sends=0;
    const context={guildId:'g',channelId:'c',followUp:async()=>{
        sends++;
        return {attachments:new Collection([['file',{name:'normalized_name.txt',url:'https://cdn.example/file.txt'}]])};
    }};
    const client=new ChatGPTClient({apiEndpoint:'http://127.0.0.1:1',apiKey:'test',defaultModel:'test-model'});
    const internal=client as any;
    internal.resolveModelCandidates=async()=>['test-model'];
    internal.resolveAuthCandidates=()=>[{apiEndpoint:'http://127.0.0.1:1',apiKey:'test'}];
    client.setToolContext(context);
    return {client,internal,context,sends:()=>sends};
}

test('Discord filename normalization is not reported as upload failure',async()=>{
    const {context,sends}=fixture();
    const result=String(await staffOutputFileHandler(args,context));
    assert.match(result,/^FILE_UPLOADED:/);assert.equal(sends(),1);
    assert.match(String(await staffOutputFileHandler({...args,filename:' \n'+args.filename+'\n '},context)),/^FILE_UPLOADED:/);
    assert.equal(sends(),1);
    assert.match(completeStaffFileTools(context,[{name:'output_file',output:result}])!,/https:\/\/cdn\.example\/file\.txt/);
});

test('An arbitrary single-file request can finish, while plural/multi-file requests keep the normal tool flow',()=>{
    assert.equal(isSingleStaffFileRequest(prompt),true);
    assert.equal(isSingleStaffFileRequest('HTMLファイルを作って'),true);
    assert.equal(isSingleStaffFileRequest('HTMLとJavaScriptで1つのファイルを作って'),true);
    for(const text of ['3つのファイルを作って','１０個のファイルを作って','複数のファイルを作って','index.htmlとapp.jsを作って','HTMLとCSSファイルを作って','ファイルを修正して再出力して','ファイルを作って、その後に別の作業もして'])assert.equal(isSingleStaffFileRequest(text),false,text);
});

test('Two real file failures followed by success produce a verified link without another model request',async()=>{
    const {client,internal,context,sends}=fixture();
    let attempts=0,requests=0;
    const phases:string[]=[];
    client.registerTool(staffOutputFileDefinition,async(a,c)=>{
        attempts++;
        return attempts<3?'FILE_ERROR: invalid first attempt':staffOutputFileHandler(a,c);
    });
    internal.streamResponseApiPayload=async()=>{
        assert.ok(++requests<=3,'model continued generating after verified upload');
        const item={type:'function_call',id:`fc_${requests}`,call_id:`call_${requests}`,name:'output_file',arguments:JSON.stringify(args)};
        return {responseId:`resp_${requests}`,functionCalls:[{callId:item.call_id,name:item.name,arguments:item.arguments}],outputItems:[item]};
    };
    let text='';
    await client.streamResponse([{role:'user',content:prompt}],delta=>{if(delta.type==='text')text+=delta.text;},{...options,
        completeAfterTools:results=>completeStaffFileTools(context,results),
        onToolStep:step=>{if(step.phase!=='started')phases.push(step.phase);},
    });
    assert.equal(requests,3);assert.equal(attempts,3);assert.equal(sends(),1);
    assert.deepEqual(phases,['failed','failed','completed']);
    assert.match(text,/https:\/\/cdn\.example\/file\.txt/);
    assert.doesNotMatch(text,/失敗|再試行/);
});

for(const stream of [false,true])test(`Chat Completions ${stream?'streaming':'non-streaming'} stops at verified file completion`,async()=>{
    const {client,internal,context,sends}=fixture();
    client.registerTool(staffOutputFileDefinition,staffOutputFileHandler);
    let requests=0;
    internal.createClient=()=>({chat:{completions:{create:async()=>{
        assert.equal(++requests,1,'extra model request');
        const call={id:'call_file',type:'function',function:{name:'output_file',arguments:JSON.stringify(args)}};
        if(!stream)return {id:'chat',model:'test-model',choices:[{message:{role:'assistant',content:null,tool_calls:[call]}}]};
        return (async function*(){yield{id:'chat',created:0,choices:[{delta:{tool_calls:[{...call,index:0}]},finish_reason:'tool_calls'}]};})();
    }}}});
    const opts={...options,completeAfterTools:(results:Array<{name:string;output:string}>)=>completeStaffFileTools(context,results)};
    let text='';
    if(stream)await client.streamMessage([{role:'user',content:prompt}],chunk=>{text+=chunk.choices[0]?.delta?.content||'';},opts);
    else text=String((await client.sendMessage([{role:'user',content:prompt}],opts)).choices[0].message.content);
    assert.equal(requests,1);assert.equal(sends(),1);assert.match(text,/https:\/\/cdn\.example\/file\.txt/);
});

test('A receipt marker without actual retained Discord success cannot finish the request',()=>{
    assert.equal(completeStaffFileTools({},[{name:'output_file',output:'FILE_UPLOADED: invented'}]),undefined);
});

test('File errors count as failures even when arguments change, and repeated file retry narration is stopped',()=>{
    assert.equal(toolResultError('FILE_ERROR: no destination'),'FILE_ERROR: no destination');
    assert.equal(toolResultError('FILE_UPLOADED: {}'),undefined);
    const guard=new AIProgressGuard();
    for(let n=0;n<3;n++)guard.record('output_file',{filename:`file-${n}.txt`},'FILE_ERROR: no destination');
    assert.equal(guard.stalled,true);
    const narration=new AIProgressGuard();
    assert.throws(()=>narration.observe('ファイル出力が失敗した。適当なファイルで再試行。'.repeat(10),'thinking'),AIProgressStalledError);
});
