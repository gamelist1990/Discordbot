import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { isStaffDrawingRequest, isStaffImageEditRequest, buildStaffDrawingMessages }
    from '../src/commands/staff/subcommands/StaffAIDrawingIntent.ts';
import { applySvgFontPresets, SVG_FONT_PRESETS }
    from '../src/commands/staff/subcommands/ai-tools/svgTypography.ts';
import { composeDrawingSourceSvg, setDrawingSourceImage, isSafeDiscordDrawingSource }
    from '../src/commands/staff/subcommands/ai-tools/drawingSource.ts';
import { sanitizeSvg, renderSvgToPng }
    from '../src/commands/staff/subcommands/ai-tools/drawing.ts';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450">'
    + '<text x="150" y="170" font-size="90" fill="#ffffff">ガクガク</text>'
    + '<text x="150" y="300" data-font-preset="neon" font-size="55">ネオン</text>'
    + '</svg>';

test('editing intent and system prompt support the user photo without re-drawing it', () => {
    for (const prompt of ['この画像をサムネにして', '添付写真に文字入れして',
        'この写真をデコって', '画像を編集して', 'この写真を加工して',
        '元画像を残して明るさと彩度を少し上げて、隅に小さなラベルを付けて',
        '明るさと彩度を少し上げて', 'これをいい感じにして', '彩度を上げて',
        '明るく補正して', 'この写真に文字を入れて']) {
        assert.equal(isStaffImageEditRequest(prompt), true, prompt);
        assert.equal(isStaffDrawingRequest(prompt), true, prompt);
    }
    for (const text of ['画像の中身を教えて','この画像の説明をして','画像編集できる？','これ何？']) {
        assert.equal(isStaffImageEditRequest(text), false, text);
    }
    for (const text of ['明るくして','もう少し彩度を調整して','いい感じにして','ラベルを追加','仕上げて']) {
        assert.equal(isStaffImageEditRequest(text, true), true, text);
    }
    assert.equal(isStaffImageEditRequest('これおいしそうやね', true), false);
    const messages = buildStaffDrawingMessages({userContent:'この写真をサムネにして',imageEdit:true});
    assert.match(String(messages[0].content), /汎用画像制作Skill/);
    assert.match(String(messages[0].content), /透明SVG/);
    assert.match(String(messages[0].content), /目的を読み取る/);
    assert.match(String(messages[0].content), /既存の文字/);
    assert.match(String(messages[0].content), /表現を選ぶ/);
    assert.match(String(messages[0].content), /画像を実際に制作する/);
    assert.match(String(messages[0].content), /photo_brightness/);
    assert.match(String(messages[0].content), /photo_saturation/);
});

test('all native SVG typography presets are available, with per-text override', async () => {
    assert.ok(SVG_FONT_PRESETS.includes('jagged'));
    assert.ok(SVG_FONT_PRESETS.includes('custom'));
    const prepared = applySvgFontPresets(svg, 'jagged');
    assert.match(prepared, /feDisplacementMap/);
    assert.match(prepared, /pex-text-neon/);
    assert.match(prepared, /Noto Sans CJK JP/);
    assert.match(prepared, /data-font-preset="neon"/);
    const img = await renderSvgToPng(prepared);
    assert.equal(img.png.subarray(0, 4).toString('hex'), '89504e47');
    assert.ok(img.width >= 800);
    const custom = applySvgFontPresets(svg, 'custom');
    assert.doesNotMatch(custom.match(/<text\b[^>]*>/)?.[0] ?? '', /pex-text-jagged/);
    assert.ok(custom.includes('pex-text-neon'));
    const unsafe = sanitizeSvg('<svg viewBox="0 0 20 20"><image href="data:image/png;base64,AA"/></svg>');
    assert.ok('error' in unsafe);
});

test('native SVG editing composes a real uploaded photo under text and effects', async () => {
    const originalFetch = globalThis.fetch;
    const source = await sharp({
        create: { width: 320, height: 180, channels: 3, background: '#bc1256' },
    }).png().toBuffer();
    globalThis.fetch = mock.fn(async () => ({
        ok: true,
        headers: {get: () => String(source.length)},
        arrayBuffer: async () => source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
    })) as unknown as typeof fetch;
    try {
        const context = {};
        assert.equal(isSafeDiscordDrawingSource('https://cdn.discordapp.com/attachments/1/2/test.png'), true);
        assert.equal(isSafeDiscordDrawingSource('http://127.0.0.1/admin.png'), false);
        assert.equal(setDrawingSourceImage(context, 'https://cdn.discordapp.com/attachments/1/2/test.png'), true);
        const prepared = applySvgFontPresets(svg, 'jagged');
        const combined = await composeDrawingSourceSvg(context, prepared, 'cover');
        assert.match(combined, /<image x="0" y="0"/);
        assert.match(combined, /data:image\/png;base64,/);
        const generated = await renderSvgToPng(combined);
        const meta = await sharp(generated.png).metadata();
        assert.ok(meta.width && meta.height && meta.width > meta.height);
        const sample = await sharp(generated.png).extract({left:10,top:10,width:1,height:1}).raw().toBuffer();
        assert.ok(sample[0] > sample[1]); // original purple photo should still be visible
        const contain = await composeDrawingSourceSvg(context, prepared, 'contain');
        assert.match(contain, /xMidYMid meet/);
        const adjustedSvg = await composeDrawingSourceSvg(context, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"></svg>', 'cover',
            {brightness: 1.2, saturation: 1.1});
        const adjusted = await renderSvgToPng(adjustedSvg);
        const baselineSvg = await composeDrawingSourceSvg(context, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"></svg>', 'cover');
        const baseline = await renderSvgToPng(baselineSvg);
        const samplePixel = (image: Buffer) => sharp(image).removeAlpha().extract({left:8,top:8,width:1,height:1}).raw().toBuffer();
        const editedPixel = await samplePixel(adjusted.png), oldPixel = await samplePixel(baseline.png);
        assert.ok(editedPixel[0] > oldPixel[0], `brightness wasn't applied: ${editedPixel[0]} <= ${oldPixel[0]}`);
        assert.equal((globalThis.fetch as any).mock.callCount(), 1); // original cached
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('draw_image really edits and posts an attached image, even without an SVG decoration', async () => {
    const { drawImageToolHandler } = await import('../src/commands/staff/subcommands/ai-tools/drawing.ts');
    const oldFetch = globalThis.fetch;
    const source = await sharp({
        create: {width:300,height:200,channels:3,background:'#995533'},
    }).png().toBuffer();
    let photoRequests = 0;
    let reviews = 0;
    globalThis.fetch = mock.fn(async (input: string | URL | Request) => {
        if (String(input).includes('/chat/completions')) {
            reviews++;
            return {ok: true, json: async () => ({
                choices:[{message:{content:'{"score":90,"accepted":true,"issues":[]}'}}],
            })};
        }
        photoRequests++;
        return {
            ok: true, headers: {get: () => String(source.length)},
            arrayBuffer: async () => source.buffer.slice(source.byteOffset,source.byteOffset + source.byteLength),
        };
    }) as unknown as typeof fetch;
    try {
        let posted: any;
        const attachment = {name:'food.png',url:'https://cdn.discordapp.com/attachments/1/2/food.png'};
        const interaction:any = {
            guildId:'g1',channelId:'c1',
            followUp:async (payload:any) => {
                posted = payload;
                return {
                    url:'https://discord.com/channels/123/234/345',
                    attachments:{size:1,find:()=>attachment,first:()=>attachment},
                };
            },
        };
        assert.ok(setDrawingSourceImage(interaction,'https://cdn.discordapp.com/attachments/1/2/source.png'));
        const result = String(await drawImageToolHandler({
            svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"></svg>',
            filename:'food.png',intent:'元の料理写真を少し明るく鮮やかに',
            photo_brightness:1.12,photo_saturation:1.14,
        },interaction));
        assert.match(result,/IMAGE_POSTED/);
        assert.match(result,/REVIEW_VERDICT: PASS/);
        assert.equal(photoRequests,1);
        assert.equal(reviews,1);
        const output = posted.files[0].attachment as Buffer;
        assert.ok(Buffer.isBuffer(output));
        const [r,g,b] = await sharp(output).removeAlpha().extract({
            left:10,top:10,width:1,height:1,
        }).raw().toBuffer();
        assert.ok(r>0x99, 'image pixel brightness must be physically increased');
        assert.ok(r>g && g>b);
    } finally {
        globalThis.fetch = oldFetch;
    }
});
