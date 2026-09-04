import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentSafetyDetector, classifyContent, CONTENT_SAFETY_PROMPT } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';
import { deleteMatchedContent } from '../src/core/anticheat/ContentDeletion.ts';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();
const verdict = { suggestive: 1, explicit: 0, harassment: 0, hate: 0, threat: 0, violence: 0 };
const makeMessage = () => ({ id: '123', content: '分類用の文章', editedTimestamp: null, attachments: new Map(), embeds: [] } as any);
const context = (action: string) => ({ settings: { detectors: { contentSafety: { enabled: true, config: { action } } } } } as any);
const response = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(verdict) } }] }));

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
        assert.equal(requests[0].messages[0].content, CONTENT_SAFETY_PROMPT);
        assert.equal(requests[1].messages[0].content, CONTENT_SAFETY_PROMPT);
        assert.equal(requests[0].messages[1].content, 'hello');
        assert.equal(requests[1].messages[1].content.length, 1);
        assert.ok(CONTENT_SAFETY_PROMPT.length < 800);
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
