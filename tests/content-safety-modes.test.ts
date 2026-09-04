import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { ContentSafetyDetector, classifyContent, parseContentVerdict, CONTENT_SAFETY_PROMPT } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';
import { deleteMatchedContent } from '../src/core/anticheat/ContentDeletion.ts';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();
const verdict = { suggestive: 1, explicit: 0, harassment: 0, hate: 0, threat: 0, violence: 0 };
const makeMessage = () => ({ id: '123', content: '分類用の文章', editedTimestamp: null, attachments: new Map(), embeds: [] } as any);
const context = (action: string) => ({ settings: { detectors: { contentSafety: { enabled: true, config: { action } } } } } as any);
const response = () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_verdict', arguments: JSON.stringify(verdict) } }] } }] }));

test('mixed posts send text with images, invalidate changed captions and respect text opt-out', async () => {
    const original = globalThis.fetch;
    const requests: any[] = [];
    const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'blue' } }).png().toBuffer();
    globalThis.fetch = (async (_url, options) => {
        const request = JSON.parse(String(options?.body));
        requests.push(request);
        const content = request.messages[1].content;
        const scores = Array.isArray(content) && content[0].text.includes('caption A') ? verdict : { ...verdict, suggestive: 0 };
        return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_verdict', arguments: JSON.stringify(scores) } }] } }] }));
    }) as typeof fetch;
    try {
        const detector = new ContentSafetyDetector(async url => ({ data: bytes, type: 'png', url }));
        const message = makeMessage();
        message.content = 'caption A';
        message.attachments.set('img', { id: 'img', name: 'image.png', contentType: 'image/png', url: 'https://cdn.discordapp.com/image.png' });
        const ctx = context('spoiler');
        assert.ok((await detector.detect(message, ctx)).spoilerRepost);
        assert.equal(requests.length, 2);
        assert.equal(requests[1].messages[1].content[0].text, 'caption A');
        assert.equal(requests[1].messages[1].content[1].type, 'image_url');
        message.content = 'caption B';
        assert.equal((await detector.detect(message, ctx)).spoilerRepost, undefined);
        assert.equal(requests.length, 4);
        ctx.settings.detectors.contentSafety.config.scanText = 0;
        message.content = 'caption A';
        assert.equal((await detector.detect(message, ctx)).spoilerRepost, undefined);
        assert.equal(requests.length, 5);
        assert.ok(!JSON.stringify(requests[4]).includes('caption A'));
    } finally { globalThis.fetch = original; }
});

test('AI score is opt-in, scales matched categories and ignores disabled categories', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_verdict', arguments: JSON.stringify({ ...verdict, suggestive: .7, violence: 1 }) } }] } }] }))) as typeof fetch;
    try {
        const detector = new ContentSafetyDetector();
        const ctx = context('spoiler');
        Object.assign(ctx.settings.detectors.contentSafety.config, { violence: 0, maxAiScore: 10 });
        assert.equal((await detector.detect(makeMessage(), ctx)).scoreDelta, 0);
        ctx.settings.detectors.contentSafety.config.awardScore = 1;
        assert.equal((await detector.detect(makeMessage(), ctx)).scoreDelta, 7);
        ctx.settings.detectors.contentSafety.config.textSuggestiveThreshold = .8;
        assert.equal((await detector.detect(makeMessage(), ctx)).scoreDelta, 0);
    } finally { globalThis.fetch = original; }
});

test('incomplete AI scans preserve message without detection notifications or violation logs', async () => {
    const manager = new AntiCheatManager();
    const settings = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
    settings.enabled = true;
    for (const [name, item] of Object.entries(settings.detectors)) item.enabled = name === 'contentSafety';
    manager.getSettings = async () => settings;
    let notifications = 0;
    (manager as any).sendDetectionSummary = async () => { notifications++; };
    manager.registerDetector({ name: 'contentSafety', detect: async () => { throw new Error('test timeout'); } });
    const message = { ...makeMessage(), author: { id: 'user', bot: false }, guild: { id: 'guild' }, channel: { id: 'channel' } };
    await manager.onMessage(message);
    assert.equal(notifications, 0);
    assert.equal(settings.recentLogs.length, 0);
    assert.deepEqual(settings.userTrust, {});
});

test('structured output accepts scores but never fills in missing categories as safe', () => {
    assert.deepEqual(parseContentVerdict(JSON.stringify({ observation: 'visible facts', scores: verdict })), verdict);
    const { hate, ...incomplete } = verdict;
    assert.throws(() => parseContentVerdict(JSON.stringify({ observation: 'visible facts', scores: incomplete })), /Invalid moderation verdict/);
});

test('required tool protocol rejects plain text, wrong functions, multiple calls and truncation', async () => {
    const original = globalThis.fetch;
    const call = { type: 'function', function: { name: 'submit_verdict', arguments: JSON.stringify(verdict) } };
    try {
        for (const choice of [
            { message: { content: JSON.stringify(verdict) } },
            { message: { tool_calls: [{ ...call, function: { ...call.function, name: 'delete_message' } }] } },
            { message: { tool_calls: [call, call] } },
            { message: { tool_calls: [call] }, finish_reason: 'length' }
        ]) {
            globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [choice] }))) as typeof fetch;
            await assert.rejects(classifyContent('test'), /required|Truncated/);
        }
    } finally { globalThis.fetch = original; }
});

test('413 splits frames without altering them or losing caption; aggregates every batch', async () => {
    const original = globalThis.fetch;
    const accepted: string[] = [];
    globalThis.fetch = (async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        const parts = body.messages[1].content;
        assert.equal(parts[0].text, 'context');
        const images = parts.slice(1).map((part: any) => part.image_url.url);
        if (images.length > 1) return new Response('', { status: 413 });
        accepted.push(images[0]);
        const scores = { ...verdict, suggestive: images[0] === 'first' ? .2 : .8 };
        return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_verdict', arguments: JSON.stringify(scores) } }] } }] }));
    }) as typeof fetch;
    try {
        assert.equal((await classifyContent('context', ['first', 'second'])).suggestive, .8);
        assert.deepEqual(accepted, ['first', 'second']);
        globalThis.fetch = (async () => new Response('', { status: 413 })) as typeof fetch;
        await assert.rejects(classifyContent('context', ['single-too-large']), /HTTP 413/);
    } finally { globalThis.fetch = original; }
});

test('near-duplicate positive post reuses verdict only in spoiler mode', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return response(); }) as typeof fetch;
    try {
        const detector = new ContentSafetyDetector();
        const message = makeMessage();
        message.content = 'A long content moderation fixture repeated across posts with a tiny punctuation change!';
        await detector.detect(message, context('spoiler'));
        message.content += '!';
        const reused = await detector.detect(message, context('spoiler'));
        assert.equal(reused.metadata?.analyses[0].cache, 'similar');
        assert.equal(calls, 1);
        await detector.detect(message, context('delete'));
        assert.equal(calls, 2);
    } finally { globalThis.fetch = original; }
});

test('action changes reuse cached scores; delete mode does not request a repost', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return response(); }) as typeof fetch;
    try {
        const detector = new ContentSafetyDetector();
        assert.ok((await detector.detect(makeMessage(), context('spoiler'))).spoilerRepost);
        const deleted = await detector.detect(makeMessage(), context('delete'));
        assert.ok(deleted.contentDeletion);
        assert.equal(deleted.spoilerRepost, undefined);
        assert.equal(deleted.scoreDelta, 0);
        assert.equal(calls, 1);
        assert.ok((await detector.detect(makeMessage(), context('invalid'))).spoilerRepost);
    } finally { globalThis.fetch = original; }
});

test('identical simultaneous inputs share one API request', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    globalThis.fetch = (async () => { calls++; await gate; return response(); }) as typeof fetch;
    try {
        const detector = new ContentSafetyDetector();
        const a = detector.detect(makeMessage(), context('spoiler'));
        const b = detector.detect(makeMessage(), context('delete'));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(calls, 1);
        release();
        const results = await Promise.all([a, b]);
        assert.ok(results[0].spoilerRepost);
        assert.ok(results[1].contentDeletion);
    } finally { release(); globalThis.fetch = original; }
});

test('stable prefix, raw text payload and deduplicated images reduce input', async () => {
    const original = globalThis.fetch;
    const requests: any[] = [];
    globalThis.fetch = (async (_url, options) => { requests.push(JSON.parse(String(options?.body))); return response(); }) as typeof fetch;
    try {
        await classifyContent('hello');
        await classifyContent('', ['data:image/jpeg;base64,AA==', 'data:image/jpeg;base64,AA==']);
        await classifyContent('', ['data:image/jpeg;base64,AA==', 'data:image/jpeg;base64,BB==']);
        assert.equal(requests[0].messages[0].content, CONTENT_SAFETY_PROMPT);
        assert.equal(requests[1].messages[0].content, CONTENT_SAFETY_PROMPT);
        assert.equal(requests[0].messages[1].content, 'hello');
        assert.equal(requests[1].messages[1].content.filter((part: any) => part.type === 'image_url').length, 1);
        assert.equal(requests[2].messages[1].content.filter((part: any) => part.type === 'image_url').length, 2);
        assert.equal(requests[2].messages[1].content[1].image_url.detail, 'high');
        assert.deepEqual(requests[0].tool_choice, { type: 'function', function: { name: 'submit_verdict' } });
        assert.equal(requests[0].response_format, undefined);
        assert.ok(CONTENT_SAFETY_PROMPT.length < 1000);
    } finally { globalThis.fetch = original; }
});

test('confirmed text match does not send additional media for classification', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return response(); }) as typeof fetch;
    try {
        const message = makeMessage();
        message.attachments.set('image', { id: 'image', url: 'https://cdn.discordapp.com/x.png', name: 'x.png', contentType: 'image/png' });
        assert.ok((await new ContentSafetyDetector().detect(message, context('delete'))).contentDeletion);
        assert.equal(calls, 1);
    } finally { globalThis.fetch = original; }
});

test('stale verdict never deletes an edited message', async () => {
    let deletions = 0;
    const message = makeMessage();
    message.fetch = async () => ({ ...message, content: 'safe edit', delete: async () => { deletions++; } });
    await assert.rejects(deleteMatchedContent(message, { content: message.content, editedTimestamp: null, attachmentIds: '' }), /changed/);
    assert.equal(deletions, 0);
});

test('manager deletes only matched message with global auto-delete disabled and no score', async () => {
    const manager = new AntiCheatManager();
    const settings = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
    settings.enabled = true;
    settings.autoDelete.enabled = false;
    for (const [name, item] of Object.entries(settings.detectors)) item.enabled = name === 'contentSafety';
    manager.getSettings = async () => settings;
    manager.setSettings = async () => {};
    const message = { ...makeMessage(), author: { id: 'user', bot: false }, guild: { id: 'guild' }, channel: { id: 'channel' } };
    let deleted = 0;
    message.fetch = async () => message;
    message.delete = async () => { deleted++; };
    manager.registerDetector({ name: 'contentSafety', detect: async () => ({ scoreDelta: 0, reasons: ['test'], contentDeletion: { content: message.content, editedTimestamp: null, attachmentIds: '' } }) });
    assert.equal(await manager.onMessage(message), true);
    assert.equal(deleted, 1);
    assert.deepEqual(settings.userTrust, {});
    assert.equal(settings.recentLogs[0].metadata?.contentDeleted, true);
});
