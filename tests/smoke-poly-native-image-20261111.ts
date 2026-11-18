import sharp from 'sharp';
import { OpenAIChatManager } from '../src/core/ai/OpenAIChatManager.js';
import { config } from '../src/config.js';

const svg='<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg"><rect width="256" height="256" fill="#107ad8"/><circle cx="128" cy="128" r="70" fill="#ed2222"/></svg>';
const png=await sharp(Buffer.from(svg)).png().toBuffer();
const url='data:image/png;base64,'+png.toString('base64');
const manager=new OpenAIChatManager();
let output='',thinking='';
const started=Date.now();
try{
await manager.streamResponseText(
 [{role:'system',content:'画像の内容を日本語で回答してください。'},{role:'user',content:[{type:'text',text:'画像の中央には何色の形があり、背景は何色ですか？'},{type:'image_url',image_url:{url,detail:'high'}}]}],
 delta=>{if(delta.type==='thinking')thinking+=delta.text||''; if(delta.type==='text')output+=delta.text||'';},
 {model:config.pexAi.model,strictModel:true,maxTokens:250,reasoningEffort:'none',chatTemplateKwargs:{enable_thinking:false}});
const summary={elapsed_s:(Date.now()-started)/1000,model:config.pexAi.model,text:output.trim().slice(-700),thinking_chars:thinking.length,png_bytes:png.length,has_red:/赤/.test(output),has_blue:/青/.test(output)};
console.log('HOMEPC_POLY_NATIVE_IMAGE_RESULT',JSON.stringify(summary,null,2));
if(!summary.has_red||!summary.has_blue)process.exitCode=2;
}catch(e){console.error('HOMEPC_POLY_NATIVE_IMAGE_FAIL',e instanceof Error?e.message:String(e));process.exitCode=1;}
