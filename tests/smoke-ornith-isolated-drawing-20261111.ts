import { OpenAIChatManager } from '../src/core/ai/OpenAIChatManager.js';
import { buildStaffDrawingMessages } from '../src/commands/staff/subcommands/StaffAIDrawingIntent.js';
import { drawImageToolDefinition, completeStaffDrawingTool } from '../src/commands/staff/subcommands/ai-tools/drawing.js';
import { config } from '../src/config.js';

const manager=new OpenAIChatManager();
let executed=0,think=0;
manager.registerTool(drawImageToolDefinition,async(args:any)=>{
  executed++;
  if(typeof args.svg!=='string'||!args.svg.includes('<svg'))throw Error('Expected actual SVG');
  console.info('MOCK_DRAW_EXECUTED',JSON.stringify({filename:args.filename,svgLength:args.svg.length,intent:args.intent},null,2));
  return 'DRAW_ERROR: dry-run。Discordには投稿していません。';
});
const messages=buildStaffDrawingMessages({userContent:'猫描いて'});
const stream:string[]=[];
try {
  await manager.streamResponseText(messages,(delta)=>{
    if(delta.type==='thinking')think+=(delta.text||'').length;
    if(delta.type==='text')stream.push(delta.text);
  },{
    model:config.pexAi.model,
    strictModel:true,
    maxTokens:4096,
    reasoningEffort:'medium',
    chatTemplateKwargs:{enable_thinking:true},
    forceToolSequence:['draw_image'],
    completeAfterTools:completeStaffDrawingTool,
  });
  if(executed!==1)throw Error('Tool was not executed, count='+executed);
  const answer=stream.join('');
  if(!answer.includes('画像は投稿されていません'))throw Error('Invalid completion: '+answer.slice(-150));
  console.log('ISOLATED_REAL_MODEL_PASS',JSON.stringify({model:config.pexAi.model,messageCount:messages.length,toolCount:1,executions:executed,thinkingLength:think,answer:answer.slice(-130)},null,2));
} catch(e) {
  console.error('ISOLATED_REAL_MODEL_FAILED',e instanceof Error?e.message:String(e));
  process.exitCode=1;
}
