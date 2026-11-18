import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import {
    sanitizeSvg,
    extractSvgTexts,
    buildReviewPrompt,
    renderSvgToPng,
    isBlankRender,
    drawImageToolHandler,
    parseDrawingReview,
    drawingNeedsRevision,
} from '../src/commands/staff/subcommands/ai-tools/drawing.ts';

const VALID_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">'
    + '<rect width="400" height="300" fill="#203040"/>'
    + '<circle cx="200" cy="130" r="60" fill="#ffcc33"/>'
    + '<text x="200" y="240" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#ffffff">テストロゴ</text>'
    + '</svg>';

test('sanitizeSvg accepts a plain drawing and rejects dangerous constructs', () => {
    assert.ok('svg' in sanitizeSvg(VALID_SVG));
    assert.ok('svg' in sanitizeSvg('<?xml version="1.0"?>\n' + VALID_SVG));
    const bad: Array<[string, RegExp]> = [
        ['<svg viewBox="0 0 100 100"><script>alert(1)</script></svg>', /script/],
        ['<svg viewBox="0 0 100 100"><foreignObject></foreignObject></svg>', /foreignObject/],
        ['<svg viewBox="0 0 100 100"><image href="https://example.com/x.png"/></svg>', /image/],
        ['<!DOCTYPE svg><svg viewBox="0 0 100 100"></svg>', /DOCTYPE/],
        ['<svg viewBox="0 0 100 100"><rect width="9" height="9" onclick="x()"/></svg>', /イベントハンドラ/],
        ['<svg viewBox="0 0 100 100"><use href="https://example.com/a.svg#x"/></svg>', /外部参照/],
        ['<svg><rect width="9" height="9"/></svg>', /viewBox/],
        ['<svg viewBox="0 0 5000 100"></svg>', /大きすぎ/],
        ['not an svg', /全体/],
    ];
    for (const [input, pattern] of bad) {
        const result = sanitizeSvg(input);
        assert.ok('error' in result && pattern.test(result.error), `${pattern} <- ${input.slice(0, 40)}: ${JSON.stringify(result)}`);
    }
    assert.ok('error' in sanitizeSvg(42));
});

test('extractSvgTexts pulls text contents including tspans and entities', () => {
    const svg = '<svg viewBox="0 0 100 100">'
        + '<text x="1" y="2">Hello &amp; <tspan>World</tspan></text>'
        + '<text x="1" y="3">  ロゴ  </text><text x="1" y="4"></text></svg>';
    assert.deepEqual(extractSvgTexts(svg), ['Hello & World', 'ロゴ']);
    assert.deepEqual(extractSvgTexts('<svg viewBox="0 0 1 1"></svg>'), []);
    assert.deepEqual(extractSvgTexts('<svg viewBox="0 0 100 100"><g aria-label="オリジナル文字"><path d="M0 0L1 1"/></g></svg>'), ['オリジナル文字']);
});

test('buildReviewPrompt carries intent, texts and the defect-only checklist', () => {
    const prompt = buildReviewPrompt('猫カフェのタイトルロゴ', ['ねこカフェ']);
    assert.match(prompt, /猫カフェのタイトルロゴ/);
    assert.match(prompt, /「ねこカフェ」/);
    assert.match(prompt, /85点以上/);
    assert.match(prompt, /最大5件/);
    assert.match(prompt, /用途への適合/);
    assert.match(prompt, /派手さ・不規則さ/);
    const originalBrief = buildReviewPrompt('料理', ['新作'], true, '元写真は残して右下に小さく「新作」、彩度を少し上げて');
    assert.match(originalBrief, /ユーザーの依頼: 元写真は残して右下/);
    const photoReview = buildReviewPrompt('Minecraft建築紹介', ['PEXSERVER'], true);
    assert.match(photoReview, /元の被写体/);
    assert.match(photoReview, /既存HUD/);
    assert.match(photoReview, /架空の文字/);
    assert.ok(!prompt.includes('既存HUD'));
});

test('renderSvgToPng rasterizes and blank detection works', async () => {
    const { png, width, height } = await renderSvgToPng(VALID_SVG);
    assert.equal(png.subarray(0, 4).toString('hex'), '89504e47');
    assert.ok(width >= 400 && height >= 300);
    assert.equal(await isBlankRender(png), false);
    const blank = await renderSvgToPng('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>');
    assert.equal(await isBlankRender(blank.png), true);
});

class FakeAttachments {
    constructor(private items: Array<{ name: string; url: string }>) {}
    get size() { return this.items.length; }
    find(fn: (a: { name: string; url: string }) => boolean) { return this.items.find(fn); }
    first() { return this.items[0]; }
}

function fakeMessage(filename: string) {
    const message: any = {
        attachments: new FakeAttachments([{ name: filename, url: 'https://cdn.example/' + filename }]),
        edits: [] as unknown[],
        async edit(payload: unknown) { message.edits.push(payload); return message; },
    };
    return message;
}

test('draw_image handler posts, reviews, edits in place and rejects unchanged SVG', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '問題なし' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    })) as unknown as typeof fetch;
    try {
        const posted = fakeMessage('logo.png');
        const followUps: unknown[] = [];
        const interaction: any = {
            guildId: 'g1',
            channelId: 'c1',
            followUp: async (payload: unknown) => { followUps.push(payload); return posted; },
        };
        const first = await drawImageToolHandler({ svg: VALID_SVG, filename: 'logo.png', intent: 'テストロゴ' }, interaction);
        assert.match(String(first), /IMAGE_POSTED/);
        assert.match(String(first), /VISUAL_REVIEW: 問題なし/);
        assert.equal(followUps.length, 1);

        const firstMeta = JSON.parse(String(first).split('\n')[0].slice('IMAGE_POSTED: '.length));
        assert.equal(firstMeta.url, 'https://cdn.example/logo.png');
        assert.equal(firstMeta.render, 1);

        const late = fakeMessage('late.png');
        const liveAttachments = late.attachments;
        late.attachments = new FakeAttachments([]);
        late.fetch = async () => ({...late, attachments: liveAttachments});
        const lateInteraction: any = {
            guildId: 'g1', channelId: 'c1',
            followUp: async () => late,
        };
        const lateResult = await drawImageToolHandler({svg: VALID_SVG, filename: 'late.png', intent:'test'}, lateInteraction);
        assert.match(String(lateResult), /IMAGE_POSTED/);
        assert.ok(String(lateResult).includes('https://cdn.example/late.png'));

        const same = await drawImageToolHandler({ svg: VALID_SVG, filename: 'logo.png', intent: 'テストロゴ' }, interaction);
        assert.match(String(same), /DRAW_ERROR: 前回と同一の SVG/);
        assert.equal(followUps.length, 1);

        const revised = await drawImageToolHandler({ svg: VALID_SVG.replace('#ffcc33', '#33ccff'), filename: 'logo.png', intent: 'テストロゴ' }, interaction);
        assert.match(String(revised), /IMAGE_POSTED/);
        assert.equal(posted.edits.length, 1);

        const badName = await drawImageToolHandler({ svg: VALID_SVG, filename: '../evil.png', intent: 'x' }, interaction);
        assert.match(String(badName), /DRAW_ERROR: filename/);
        const noContext = await drawImageToolHandler({ svg: VALID_SVG, filename: 'a.png', intent: 'x' }, undefined);
        assert.match(String(noContext), /DRAW_ERROR: Discord/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('visual review needs a new image until quality is approved, at most three renders', async () => {
    assert.deepEqual(parseDrawingReview('{"score":92,"accepted":true,"issues":[]}'),
        {verdict:'PASS', score:92, feedback:'品質確認OK（92/100）'});
    assert.equal(parseDrawingReview('{"score":64,"accepted":false,"issues":["文字が重なる"]}').verdict, 'REVISE');
    assert.equal(parseDrawingReview('{"score":80,"accepted":true,"issues":[]}').verdict, 'REVISE');
    assert.equal(parseDrawingReview('問題なし').verdict, 'PASS');
    assert.equal(parseDrawingReview('').verdict, 'UNAVAILABLE');
    assert.equal(drawingNeedsRevision([{name:'draw_image',output:
        'IMAGE_POSTED: {"filename":"logo.png","url":"https://cdn.example/a.png","render":1}\nREVIEW_VERDICT: REVISE'}]), true);
    assert.equal(drawingNeedsRevision([{name:'draw_image',output:
        'IMAGE_POSTED: {"filename":"logo.png","url":"https://cdn.example/a.png","render":3}\nREVIEW_VERDICT: REVISE'}]), false);
    assert.equal(drawingNeedsRevision([{name:'draw_image',output:
        'IMAGE_POSTED: {"filename":"logo.png","url":"https://cdn.example/a.png","render":2}\nREVIEW_VERDICT: PASS'}]), false);
    assert.equal(drawingNeedsRevision([{name:'draw_image',output:
        'DRAW_ERROR: failure\nREVIEW_VERDICT: REVISE'}]), false);

    const originalFetch = globalThis.fetch;
    let reviews = 0;
    globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({choices:[{message:{content: ++reviews === 1
            ? '{"score":65,"accepted":false,"issues":["タイトルが小さすぎる"]}'
            : '{"score":91,"accepted":true,"issues":[]}'}}]}),
    })) as unknown as typeof fetch;
    try {
        const posted = fakeMessage('reviewed.png');
        let posts = 0;
        const interaction: any = { guildId: 'g1', channelId: 'c1',
            followUp: async () => { posts++; return posted; } };
        const first = String(await drawImageToolHandler({svg:VALID_SVG, filename:'reviewed.png',intent:'ロゴ'}, interaction));
        assert.match(first, /REVIEW_VERDICT: REVISE/);
        assert.equal(drawingNeedsRevision([{name:'draw_image', output:first}]), true);
        const second = String(await drawImageToolHandler({svg:VALID_SVG.replace('#ffcc33','#33ccff'),
            filename:'reviewed.png',intent:'ロゴ'}, interaction));
        assert.match(second, /REVIEW_VERDICT: PASS/);
        assert.equal(drawingNeedsRevision([{name:'draw_image', output:second}]), false);
        assert.equal(posts, 1);
        assert.equal(posted.edits.length, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
