import test from 'node:test';
import assert from 'node:assert/strict';

import { TextSpamDetector } from '../src/core/anticheat/detectors/TextSpamDetector.ts';
import { hasMeaningfulDetection } from '../src/core/anticheat/utils.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

test('textSpam does not flag a normal message only because deleteMessage is enabled', async () => {
    const detector = new TextSpamDetector();
    const result = await detector.detect(
        {
            id: 'message-1',
            content: 'こんにちは'
        } as any,
        {
            guildId: 'guild-1',
            userId: 'user-1',
            channelId: 'channel-1',
            userTrustScore: 0,
            settings: {
                detectors: {
                    textSpam: {
                        enabled: true,
                        score: 2,
                        deleteMessage: true,
                        notifyChannel: false,
                        config: {
                            windowSeconds: 5,
                            rapidMessageCount: 6,
                            duplicateThreshold: 3,
                            capsRatio: 0.88
                        }
                    }
                }
            }
        } as any
    );

    assert.equal(result.scoreDelta, 0);
    assert.deepEqual(result.reasons, []);
    assert.equal(result.deleteMessage, undefined);
    assert.equal(hasMeaningfulDetection(result), false);
});

test('manager safety guard ignores delete-only results with no detection signal', () => {
    assert.equal(hasMeaningfulDetection({
        scoreDelta: 0,
        reasons: [],
        deleteMessage: true
    }), false);
});

test('duplicate-message style results still count as meaningful when they provide a reason', () => {
    assert.equal(hasMeaningfulDetection({
        scoreDelta: 0,
        reasons: ['重複メッセージを 2 回送信しました'],
        deleteMessage: true
    }), true);
});
