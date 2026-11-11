import test from 'node:test';
import assert from 'node:assert/strict';
import { isStaffDrawingRequest } from '../src/commands/staff/subcommands/StaffAIDrawingIntent.ts';
import { completeStaffDrawingTool } from '../src/commands/staff/subcommands/ai-tools/drawing.ts';
import { ChatGPTClient } from '../src/core/ai/ChatGPTClient.ts';

const validPosted = 'IMAGE_POSTED: '+JSON.stringify({ filename: 'cat.png', url: 'https://cdn.discordapp.com/attachments/1/2/cat.png', width: 800, height: 600, render: 1 })+'\nVISUAL_REVIEW: 問題なし';

test('force drawing for creation requests, not analysis or quoted completion', () => {
    for (const prompt of ['猫描いて', '猫の絵を作って', 'ロゴ作って', 'ロゴ作成して', '画像を生成して', 'SVGで描いて', 'draw an image of a cat']) {
        assert.equal(isStaffDrawingRequest(prompt), true, prompt);
    }
    for (const prompt of ['お、猫描いたよ！', 'この添付画像について説明して', '猫描ける？', '画像は何？', '画像生成できる？', '', '猫の写真の内容を教えて']) {
        assert.equal(isStaffDrawingRequest(prompt), false, prompt);
    }
});

test('only a verifiable posted image is a drawing success', () => {
    const success = completeStaffDrawingTool([{name:'draw_image',output:validPosted}]);
    assert.match(success ?? '', /cat\.png を画像としてDiscordに投稿しました/);
    assert.equal(completeStaffDrawingTool([{name:'web_search',output:'猫'}]),undefined);
    for (const bad of ['DRAW_ERROR: filename invalid', 'IMAGE_POSTED: {"filename":"cat.png","url":""}', 'IMAGE_POSTED: nonsense']) {
        const result = completeStaffDrawingTool([{name:'draw_image',output:bad}]);
        assert.match(result ?? '', /画像は投稿されていません/);
        assert.doesNotMatch(result ?? '', /画像としてDiscordに投稿しました/);
    }
});

test('Responses API explicitly sends thinking ON and forces draw_image', () => {
    const client = new ChatGPTClient({apiEndpoint:'http://127.0.0.1:1',apiKey:'test',defaultModel:'test'});
    client.registerTool({type:'function',function:{name:'draw_image',description:'Draw',parameters:{type:'object',properties:{svg:{type:'string'}},required:['svg']}}}, async () => validPosted);
    const internal=client as any;
    const opts={reasoningEffort:'high',chatTemplateKwargs:{enable_thinking:true},forceToolSequence:['draw_image']};
    const payload=internal.buildResponseApiPayload([{role:'user',content:'猫描いて'}],opts,'test', [...internal.tools.values()].map((t:any)=>t.definition), undefined, 0);
    assert.deepEqual(payload.chat_template_kwargs,{enable_thinking:true});
    assert.deepEqual(payload.tool_choice,{type:'function',name:'draw_image'});
    assert.equal(payload.reasoning.effort,'high');
    assert.equal(payload.max_output_tokens,1024);
});
