import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Collection } from 'discord.js';
import { ToolProtocolTextFilter, stripToolProtocolText } from '../src/core/ai/ToolProtocolTextFilter.ts';
import { ChatGPTClient } from '../src/core/ai/ChatGPTClient.ts';
import { staffOutputFileDefinition, staffOutputFileHandler } from '../src/commands/staff/subcommands/ai-tools/fileOutput.ts';

const html='<!DOCTYPE html><html lang="ja"><head><title>くそゲー</title></head><body><h1>くそゲー</h1></body></html>';
const xml=`<tool_call><function=output_file><parameter=filename>くそゲー.html</parameter><parameter=content>${html}</parameter></function></tool_call>`;

test('Raw tool protocol is hidden for every chunk boundary without executing or damaging normal HTML',()=>{
    for(let width=1;width<=32;width++){
        const filter=new ToolProtocolTextFilter();let visible='';
        const text='1. '+xml;
        for(let index=0;index<text.length;index+=width)visible+=filter.push(text.slice(index,index+width));
        visible+=filter.finish();assert.equal(visible.trim(),'');
    }
    assert.equal(stripToolProtocolText(html),html);
    assert.equal(stripToolProtocolText('156'),'156');
    assert.equal(stripToolProtocolText('1. normal numbered item'),'1. normal numbered item');
    assert.equal(stripToolProtocolText(xml+'<h1>must stay hidden after protocol</h1>'),'');
    assert.equal(stripToolProtocolText('normal <today>text</today>'),'normal <today>text</today>');
    assert.equal(stripToolProtocolText('Answer\n'+xml),'Answer\n');
    assert.equal(stripToolProtocolText('\\<tool_call>hidden'),'');
    assert.equal(stripToolProtocolText('&lt;tool_call&gt;hidden'),'');
});

test('Alias-changing SSE calls execute one upload, hide raw XML and do not duplicate final text',async()=>{
    let requests=0,executions=0;const sends:any[]=[];
    const args={filename:'くそゲー.html',content:html};
    const functionCall={id:'fc_alias',call_id:'call_file',type:'function_call',name:'output_file',arguments:JSON.stringify(args),status:'completed'};
    const server=http.createServer(async(request,response)=>{
        const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
        const body=JSON.parse(Buffer.concat(chunks).toString());requests++;
        const events:any[]=[];
        if(requests===1){
            for(let index=0;index<('1. '+xml).length;index+=3)events.push({type:'response.output_text.delta',output_index:0,delta:('1. '+xml).slice(index,index+3)});
            events.push({type:'response.output_text.done',output_index:0,item_id:'msg_raw',text:'1. '+xml},
                {type:'response.output_item.added',output_index:1,item:{type:'function_call',call_id:'call_file',name:'output_file',arguments:''}},
                {type:'response.function_call_arguments.delta',output_index:1,item_id:'fc_first',delta:JSON.stringify(args)},
                {type:'response.function_call_arguments.done',output_index:1,item_id:'fc_first',arguments:JSON.stringify(args)},
                {type:'response.output_item.done',output_index:1,item:{...functionCall,id:'fc_first'}},
                {type:'response.output_item.done',output_index:2,item:functionCall},
                {type:'response.completed',response:{id:'resp_first',output:[{type:'message',id:'msg_raw',role:'assistant',content:[{type:'output_text',text:'1. '+xml}]},functionCall]}});
        }else{
            assert.equal(body.input.filter((item:any)=>item.type==='function_call').length,1);
            assert.equal(body.input.filter((item:any)=>item.type==='function_call_output').length,1);
            assert.ok(body.input.filter((item:any)=>item.type==='message').every((item:any)=>!JSON.stringify(item.content).includes('<tool_call>')));
            events.push({type:'response.output_text.delta',output_index:0,delta:'添付しました。'},
                {type:'response.output_text.done',output_index:0,item_id:'msg_final',text:'添付しました。'},
                {type:'response.completed',response:{id:'resp_final',output:[{type:'message',id:'msg_final',role:'assistant',content:[{type:'output_text',text:'添付しました。'}]}]}});
        }
        response.writeHead(200,{'content-type':'text/event-stream'});
        for(const [index,event]of events.entries())response.write(`data: ${JSON.stringify({...event,sequence_number:index})}\n\n`);
        response.end();
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const endpoint=`http://127.0.0.1:${address.port}`;
    const client=new ChatGPTClient({apiEndpoint:endpoint,apiKey:'test',defaultModel:'test-model'});
    (client as any).resolveModelCandidates=async()=>['test-model'];
    (client as any).resolveAuthCandidates=()=>[{apiEndpoint:endpoint,apiKey:'test'}];
    client.setToolContext({guildId:'g',channelId:'c',followUp:async(payload:any)=>{
        sends.push(payload);return {attachments:new Collection([['f',{name:args.filename,url:'https://cdn.example/file.html'}]])};
    }});
    client.registerTool(staffOutputFileDefinition,(args,context)=>{executions++;return staffOutputFileHandler(args,context);});
    try{
        let text='';await client.streamResponse([{role:'user',content:'HTMLファイルを作って'}],delta=>{if(delta.type==='text')text+=delta.text;},{model:'test-model',strictModel:true,forceToolSequence:['output_file']});
        assert.equal(requests,2);assert.equal(executions,1);assert.equal(sends.length,1);assert.equal(sends[0].files[0].attachment.toString(),html);
        assert.equal(text,'添付しました。');
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
