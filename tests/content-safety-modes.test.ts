import { jevResponse } from './fixtures/jev.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { ContentSafetyDetector, classifyContent, parseContentVerdict, CONTENT_SAFETY_PROMPT } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';
import { deleteMatchedContent } from '../src/core/anticheat/ContentDeletion.ts';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();
const verdict = { suggestive: 1, explicit: 0, harassment: 0, hate: 0, threat: 0, violence: 0, explanation: '性的なポーズを強調している。' };
const makeMessage = () => ({ id: '123', content: '分類用の文章', editedTimestamp: null, attachments: new Map(), embeds: [] } as any);
const context = (action: string) => ({ settings: { detectors: { contentSafety: { enabled: true, config: { action } } } } } as any);
const response = () => jevResponse(verdict);







// Legacy jev chat-completion tests are superseded by content-safety-routing.test.ts.

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
