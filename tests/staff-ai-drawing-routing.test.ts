import test from 'node:test';
import assert from 'node:assert/strict';
import { isStaffDrawingRequest, buildStaffDrawingMessages } from '../src/commands/staff/subcommands/StaffAIDrawingIntent.ts';
import { completeStaffDrawingTool } from '../src/commands/staff/subcommands/ai-tools/drawing.ts';
import { ChatGPTClient } from '../src/core/ai/ChatGPTClient.ts';

const validPosted = 'IMAGE_POSTED: '+JSON.stringify({ filename: 'cat.png', url: 'https://cdn.discordapp.com/attachments/1/2/cat.png?ex=123&is=456', messageUrl: 'https://discord.com/channels/111/222/333', render: 1, width: 800, height: 600, render: 1 })+'\nVISUAL_REVIEW: 問題なし';

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
    assert.match(success ?? '', /🎨 cat\.png（1回の描画で完了）/);
    assert.ok(success?.includes('🔗 画像URL: https://cdn.discordapp.com/attachments/1/2/cat.png?ex=123&is=456'));
    assert.ok(success?.includes('📌 投稿リンク: https://discord.com/channels/111/222/333'));
    assert.doesNotMatch(success ?? '', /IMAGE_POSTED|VISUAL_REVIEW/);
    assert.equal(completeStaffDrawingTool([{name:'web_search',output:'猫'}]),undefined);
    const oldFormat = completeStaffDrawingTool([{name:'draw_image',output: 'IMAGE_POSTED: '+JSON.stringify({filename:'old.png',url:'https://cdn.discordapp.com/old.png'})}]);
    assert.ok(oldFormat?.includes('🔗 画像URL: https://cdn.discordapp.com/old.png'));
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

test('drawing-only request ignores unrelated conversation history, keeps user intent and cited images', () => {
    const result = buildStaffDrawingMessages({
        userContent: '猫描いて',
        systemPrompt: '背景は青にして',
        reply: { text: 'ユーザーの参考画像', imageParts: [{type:'image_url',image_url:{url:'https://cdn.discordapp.com/a.png',detail:'auto'}}] },
    });
    assert.equal(result.length, 3);
    assert.equal(result[0].role, 'system');
    assert.match(String(result[0].content), /draw_image/);
    assert.match(String(result[0].content), /背景は青/);
    assert.equal(result[1].role, 'user');
    assert.equal((result[1].content as any[])[1].image_url.url, 'https://cdn.discordapp.com/a.png');
    assert.deepEqual(result[2],{role:'user',content:'猫描いて'});
    const retry = buildStaffDrawingMessages({userContent:'猫描いて',retry:true});
    assert.equal(retry.length, 2);
    assert.match(String(retry[0].content), /直前の生成では必要なdraw_image/);
});
