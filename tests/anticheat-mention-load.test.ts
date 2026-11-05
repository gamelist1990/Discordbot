import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';
import { CacheManager } from '../src/utils/CacheManager.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

test('10000 real mention events retain every occurrence and delete every post from the threshold onward', async () => {
    CacheManager.clear();
    const manager = new AntiCheatManager();
    const settings = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
    settings.enabled = true;
    for (const [name, detector] of Object.entries(settings.detectors)) detector.enabled = name === 'mentionSpam';
    manager.getSettings = async () => settings;
    manager.setSettings = async () => {};
    (manager as any).deleteRecentMessages = async () => 0;
    (manager as any).sendDetectionSummary = async () => {};
    const latencies: number[] = [];
    const users = 1000, perUser = 10;
    let deleted = 0;
    const start = performance.now();
    await Promise.all(Array.from({ length: users }, (_, user) => Promise.all(
        Array.from({ length: perUser }, (_, index) => {
            const received = performance.now();
            return manager.onMessage({
                id: `mention-${user}-${index}`, content: '<@&134039019352>',
                author: { id: String(user), bot: false }, guild: { id: 'mention-load' },
                channel: { id: index % 2 ? 'a' : 'b' },
                delete: async () => { deleted++; latencies.push(performance.now() - received); }
            } as any);
        })
    )));
    const durationMs = performance.now() - start;
    latencies.sort((a, b) => a - b);
    assert.equal(deleted, users * 6); // Counts 5, 6, 7, 8, 9 and 10.
    assert.equal(Object.keys(settings.userTrust).length, users);
    assert.equal((manager as any).messageProcessingQueues.size, 0);
    assert.ok(durationMs < 15000, `Mention load took ${durationMs}ms`);
    console.log(JSON.stringify({
        messages: users * perUser, users, deleted,
        durationMs: Math.round(durationMs),
        deleteDispatchP95Ms: Math.round(latencies[Math.floor(latencies.length * .95)]),
        eventsPerSecond: Math.round(users * perUser * 1000 / durationMs)
    }));
});
