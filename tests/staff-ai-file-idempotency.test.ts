import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { staffOutputFileHandler, staffFileOutputResponse } from '../src/commands/staff/subcommands/ai-tools/fileOutput.ts';
import { StaffAIStreamState } from '../src/commands/staff/subcommands/StaffAIStreamState.ts';

const html='<!DOCTYPE html>\n<html lang="ja"><head><meta charset="UTF-8"><title>くそゲー</title></head><body><h1>くそゲー</h1></body></html>\n';
function interaction() {
    const sends: any[]=[];
    const edits: any[]=[];
    const context={guildId:'guild',channelId:'channel',followUp:async(payload:any)=>{
        sends.push(payload);await new Promise(resolve=>setTimeout(resolve,2));
        const message:any={attachments:new Collection([['file',{name:payload.files[0].name,url:`https://cdn.example/${sends.length}/${encodeURIComponent(payload.files[0].name)}`} ]])};
        message.edit=async(update:any)=>{edits.push(update);message.attachments=new Collection([['file',{name:update.files[0].name,url:`https://cdn.example/edited-${edits.length}/${encodeURIComponent(update.files[0].name)}`}]]);return message;};
        return message;
    }};
    return {context,sends,edits};
}

test('Concurrent and subsequent identical output_file calls attach the entire HTML exactly once',async()=>{
    const {context,sends}=interaction();
    const args={filename:'くそゲー.html',content:html};
    const results=await Promise.all(Array.from({length:3},()=>staffOutputFileHandler(args,context)));
    results.push(await staffOutputFileHandler(args,context));
    assert.equal(sends.length,1);
    assert.ok(results.every(value=>value===results[0]));
    assert.equal(sends[0].files[0].attachment.toString('utf8'),html);
    assert.equal(sends[0].files[0].name,args.filename);
    assert.match(String(results[0]),/^FILE_UPLOADED:/);
});

test('Revisions edit the original attachment while a new interaction can send its own file',async()=>{
    const first=interaction(),second=interaction();
    await staffOutputFileHandler({filename:'index.html',content:html},first.context);
    await staffOutputFileHandler({filename:'index.html',content:html+'<!-- updated -->'},first.context);
    await staffOutputFileHandler({filename:'index.html',content:html},second.context);
    assert.equal(first.sends.length,1);assert.equal(first.edits.length,1);assert.equal(first.edits[0].files[0].attachment.toString(),html+'<!-- updated -->');assert.equal(second.sends.length,1);
});

test('An ambiguous Discord failure is not automatically resent and never claims upload success',async()=>{
    let sends=0;
    const context={guildId:'g',channelId:'c',followUp:async()=>{sends++;throw new Error('connection dropped after send');}};
    const args={filename:'index.html',content:html};
    const first=await staffOutputFileHandler(args,context);
    const second=await staffOutputFileHandler(args,context);
    assert.equal(sends,1);assert.equal(first,second);assert.match(String(first),/^FILE_ERROR:/);
    assert.equal(staffFileOutputResponse(context),null);
});

test('Uploaded files produce links and remove echoed code/XML instead of generating extra attachments',async()=>{
    const {context,sends}=interaction();
    await staffOutputFileHandler({filename:'index.html',content:html},context);
    const result=staffFileOutputResponse(context,'出力しました。\n```html\n'+html+'\n```\n<tool_call><function=output_file>again</function></tool_call>');
    assert.match(result!,/https:\/\/cdn\.example/);
    assert.doesNotMatch(result!,/DOCTYPE|<tool_call|```|again/);
    assert.equal(sends.length,1);
});

test('Repeated completion events have one status and never display file content or raw tool syntax',()=>{
    const state=new StaffAIStreamState(false);
    state.recordToolStep({phase:'started',name:'output_file',round:1,callId:'call_file',arguments:JSON.stringify({filename:'くそゲー.html'})});
    state.recordToolStep({phase:'completed',name:'output_file',round:1,callId:'call_file'});
    state.recordToolStep({phase:'completed',name:'output_file',round:1,callId:'call_file'});
    const rendered=state.render(true,'できました。<tool_call><parameter=content>SECRET</parameter></tool_call>');
    assert.equal((rendered.match(/ファイル出力/g)||[]).length,1);
    assert.match(rendered,/くそゲー/);assert.doesNotMatch(rendered,/SECRET|tool_call|ツール処理を処理/);
});

test('Concurrent revisions of one filename are serialized into edits of a single message',async()=>{
    const {context,sends,edits}=interaction();
    await Promise.all(['one','two','three'].map(version=>staffOutputFileHandler({filename:'index.html',content:html+version},context)));
    assert.equal(sends.length,1);assert.equal(edits.length,2);
    assert.equal(edits[1].files[0].attachment.toString(),html+'three');
    const response=staffFileOutputResponse(context)!;
    assert.match(response,/edited-2/);
    assert.equal((response.match(/https:\/\/cdn\.example/g)||[]).length,1);
});
