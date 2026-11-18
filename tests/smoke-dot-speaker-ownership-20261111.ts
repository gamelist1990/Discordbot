import { formatDotSpeakerEvidence, type DotSpeakerLine } from '../src/core/ai/DotSpeakerContext.js';
import { AMBIENT_SYSTEM_RULES } from '../src/core/ai/StaffAIDotAmbient.js';
import { OpenAIChatManager } from '../src/core/ai/OpenAIChatManager.js';
import { config } from '../src/config.js';

const lines: DotSpeakerLine[] = [
    { id:'1',authorId:'owner',authorName:'こう君',content:'相変わらずの',isBot:false },
    { id:'2',authorId:'owner',authorName:'こう君',content:'スタレ',isBot:false },
    { id:'3',authorId:'owner',authorName:'こう君',content:'配布えぐい',isBot:false },
    { id:'4',authorId:'owner',authorName:'こう君',content:'開いただけで',isBot:false },
    { id:'5',authorId:'owner',authorName:'こう君',content:'☆5が',isBot:false },
    { id:'6',authorId:'other',authorName:'冷笑系熱血ゴミムシ',content:'スタレだけに',isBot:false },
    { id:'7',authorId:'owner',authorName:'こう君',content:'餅武器',isBot:false },
    { id:'8',authorId:'other',authorName:'冷笑系熱血ゴミムシ',content:'ヒｨｯ↑w'.repeat(80),isBot:false },
    { id:'9',authorId:'owner',authorName:'こう君',content:'と',isBot:false },
    { id:'10',authorId:'other',authorName:'冷笑系熱血ゴミムシ',content:'おもんな 知らんがな',isBot:false },
    { id:'11',authorId:'owner',authorName:'こう君',content:'ゲットできたわ',isBot:false },
    { id:'12',authorId:'other',authorName:'冷笑系熱血ゴミムシ',content:'いや でも俺はホヨバゲーを極めようかな',isBot:false },
    { id:'13',authorId:'other',authorName:'冷笑系熱血ゴミムシ',content:'マイクラpvpやめてやることなくなったしな',isBot:false },
    { id:'14',authorId:'owner',authorName:'こう君',content:'キモすぎw',isBot:false },
];
const context=lines.map(line=>'['+line.id+'] '+line.authorName+' (userId='+line.authorId+'): '+line.content).join('\n');
const speakerEvidence=formatDotSpeakerEvidence(lines);
const manager=new OpenAIChatManager();
for (const prompt of [
    '誰が餅武器をゲットして、誰がホヨバゲーを極めたいと言った？それぞれ別人として名前で短く説明して。',
    '今の会話の流れに一言で混ざってください。餅武器について触れる場合は持ち主を間違えないこと。',
]) {
    const start=Date.now();
    try {
        const answer=await manager.generateText([
            {role:'system',content:AMBIENT_SYSTEM_RULES},
            {role:'user',content:'直近の会話:\n'+context+'\n\n'+speakerEvidence+'\n\n'+prompt},
        ],{model:config.pexAi.model,strictModel:true,maxTokens:260,chatTemplateKwargs:{enable_thinking:false}});
        const result={prompt,answer,elapsed_s:(Date.now()-start)/1000,
            incorrectly_assigns_weapon_to_other: /(?:冷笑系熱血ゴミムシ|お前|君).{0,17}(?:餅武器|ゲット)/.test(answer)};
        console.log('LIVE_OWNERSHIP_TEST',JSON.stringify(result));
        if (!answer.trim()) process.exitCode=2;
    } catch (e) {
        console.error('LIVE_OWNERSHIP_TEST_ERROR',e instanceof Error?e.message:String(e));
        process.exitCode=1;
    }
}
