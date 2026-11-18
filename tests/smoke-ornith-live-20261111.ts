import { ChatGPTClient } from '/home/pexserver/WorkSpace/DevBox/Discordbot/src/core/ai/ChatGPTClient.ts';
import { config } from '/home/pexserver/WorkSpace/DevBox/Discordbot/src/config.ts';
import { drawImageToolDefinition, completeStaffDrawingTool } from '/home/pexserver/WorkSpace/DevBox/Discordbot/src/commands/staff/subcommands/ai-tools/drawing.ts';

const c=new ChatGPTClient({apiEndpoint:config.pexAi.endpoint,apiKey:config.pexAi.apiKey,defaultModel:config.pexAi.model});
let executed=0,thinking=0,textLength=0;
c.registerTool(drawImageToolDefinition, async (args:any)=>{
  executed++;
  if(typeof args.svg!=='string'||!args.svg.includes('<svg'))throw Error('SVG expected');
  return 'DRAW_ERROR: テスト用なのでDiscordへ投稿しません（実データの作成検証のみ）。';
});
for(let i=0;i<21;i++) c.registerTool({
  type:'function',
  function:{name:'other_tool_'+i,description:'Other utility not for drawing',parameters:{type:'object',properties:{q:{type:'string'}},required:['q']}}
} as any,async()=>({ok:true}));
const text:string[]=[];
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),100000);
try {
 await c.streamResponse([
   {role:'system',content:'ユーザーの画像作成依頼は、必ず実際のdraw_imageツールを呼び出す。ツール実行前に「描いた」等の完了報告をしない。日本語で簡潔に回答する。'},
   {role:'user',content:'かわいい猫をSVGで描いて、draw_imageで投稿して。'}
 ],delta=>{
   if(delta.type==='thinking')thinking+=delta.text?.length??0;
   else if(delta.type==='text') {textLength+=delta.text?.length??0;text.push(delta.text);}
 },{
   model:config.pexAi.model,
   strictModel:true,
   maxTokens:4096,
   reasoningEffort:'high',
   chatTemplateKwargs:{enable_thinking:true},
   forceToolSequence:['draw_image'],
   completeAfterTools:completeStaffDrawingTool,
   signal:controller.signal
 });
 const final=text.join('');
 if(executed!==1)throw Error('draw_image tool did not execute');
 if(!final.includes('画像は投稿されていません'))throw Error('false completed image claim:'+final.slice(0,120));
 if(final.includes('</think>')||final.includes('<think>'))throw Error('raw thought marker leaked');
 console.log('LIVE_BOT_SMOKE_PASS',JSON.stringify({model:config.pexAi.model,toolExecutions:executed,thinkingChars:thinking,visibleTextChars:textLength,finalPreview:final.slice(-150)},null,2));
} finally {clearTimeout(timer)}
