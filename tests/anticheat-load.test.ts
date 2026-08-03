import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

function createSettings(detectorName: string) {
    const settings = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
    settings.enabled = true;
    settings.autoDelete.enabled = false;
    settings.autoTimeout.enabled = false;
    settings.punishments = [];
    settings.logChannelId = null;
    settings.avatarLogChannelId = null;
    settings.chatLogChannelId = null;
    settings.excludedChannels = [];
    settings.excludedRoles = [];
    settings.userTrust = {};
    settings.recentLogs = [];

    for (const detector of Object.values(settings.detectors)) {
        detector.enabled = false;
    }

    settings.detectors[detectorName] = {
        enabled: true,
        score: 0,
        deleteMessage: false,
        notifyChannel: false,
        config: {}
    };

    return settings;
}

function createMessage(userId: string, messageIndex: number) {
    return {
        id: `message-${userId}-${messageIndex}`,
        content: `normal traffic ${messageIndex}`,
        author: {
            id: userId,
            bot: false,
            tag: `${userId}#0001`,
            username: userId,
            toString: () => `<@${userId}>`
        },
        guild: {
            id: 'guild-local-load-test',
            members: { me: null },
            channels: { cache: new Map() }
        },
        channel: { id: 'channel-local-load-test' },
        member: {
            roles: {
                cache: { has: () => false }
            }
        },
        mentions: {
            users: new Map(),
            roles: { size: 0, some: () => false }
        },
        delete: async () => undefined
    } as any;
}

test('bounded local multi-user load keeps every detection call stable', async () => {
    const manager = new AntiCheatManager();
    const detectorName = 'loadProbe';
    const settings = createSettings(detectorName);
    const userCount = 1_000;
    const messagesPerUser = 10;
    const expectedCalls = userCount * messagesPerUser;
    let detectorCalls = 0;
    let activeDetectorCalls = 0;
    let peakDetectorCalls = 0;

    manager.registerDetector({
        name: detectorName,
        detect: async () => {
            detectorCalls += 1;
            activeDetectorCalls += 1;
            peakDetectorCalls = Math.max(peakDetectorCalls, activeDetectorCalls);
            await Promise.resolve();
            activeDetectorCalls -= 1;
            return { scoreDelta: 0, reasons: [] };
        }
    });

    (manager as any).getSettings = async () => settings;
    (manager as any).setSettings = async () => undefined;

    const startedAt = performance.now();
    await Promise.all(Array.from({ length: userCount }, (_, userIndex) => (
        Promise.all(Array.from({ length: messagesPerUser }, (_, messageIndex) => (
            manager.onMessage(createMessage(`user-${userIndex}`, messageIndex))
        )))
    )));
    const durationMs = performance.now() - startedAt;
    const heapUsedMb = process.memoryUsage().heapUsed / 1024 / 1024;

    assert.equal(detectorCalls, expectedCalls);
    assert.equal(activeDetectorCalls, 0);
    assert.equal((manager as any).messageProcessingQueues.size, 0);
    assert.ok(peakDetectorCalls <= userCount);
    assert.ok(durationMs < 15_000, `load test exceeded 15 seconds: ${durationMs.toFixed(2)}ms`);
    assert.ok(heapUsedMb < 512, `heap usage exceeded 512 MB: ${heapUsedMb.toFixed(2)} MB`);

    console.log(JSON.stringify({
        users: userCount,
        messages: expectedCalls,
        detectorCalls,
        successRate: detectorCalls / expectedCalls,
        durationMs: Number(durationMs.toFixed(2)),
        throughputPerSecond: Number((expectedCalls / (durationMs / 1000)).toFixed(2)),
        peakConcurrentUsers: peakDetectorCalls,
        heapUsedMb: Number(heapUsedMb.toFixed(2))
    }));
});
