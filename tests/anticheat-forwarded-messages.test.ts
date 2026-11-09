import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { TextSpamDetector } from '../src/core/anticheat/detectors/TextSpamDetector.ts';
import { DuplicateMessageDetector } from '../src/core/anticheat/detectors/DuplicateMessageDetector.ts';
import { CrossChannelSpamDetector } from '../src/core/anticheat/detectors/CrossChannelSpamDetector.ts';
import { InviteReferralDetector } from '../src/core/anticheat/detectors/InviteReferralDetector.ts';
import { MentionSpamDetector } from '../src/core/anticheat/detectors/MentionSpamDetector.ts';
import { ContentSafetyDetector, SPAM_LABEL } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';
import { getEffectiveContent, getForwardedSnapshots, hasForwardedContent, getForwardOrigin, formatForwardAnnotation } from '../src/core/anticheat/utils.ts';
import { CacheManager } from '../src/utils/CacheManager.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

// A Discord forward: the forwarder's own content is empty (or a short
// comment) and the forwarded body lives on messageSnapshots.
function forwardedMessage(
    id: string,
    snapshotContent: string,
    options: { ownContent?: string; snapshotAttachments?: any[]; snapshotEmbeds?: any[] } = {},
) {
    const attachments = new Map((options.snapshotAttachments || []).map((a: any) => [a.id, a]));
    return {
        id,
        content: options.ownContent ?? '',
        editedTimestamp: null,
        attachments: new Map(),
        embeds: [],
        messageSnapshots: new Map([['original-' + id, {
            content: snapshotContent,
            attachments,
            embeds: options.snapshotEmbeds || [],
        }]]),
    } as any;
}

function detectorContext(guildId: string, userId: string, channelId: string, detectors: Record<string, any>): any {
    return { guildId, userId, channelId, settings: { detectors } } as any;
}

test('getEffectiveContent exposes forwarded bodies and leaves plain messages untouched', () => {
    assert.equal(getEffectiveContent({ content: '普通の投稿' } as any), '普通の投稿');
    assert.equal(getEffectiveContent({ content: '' } as any), '');
    const pure = forwardedMessage('u1', '転送された本文です');
    assert.equal(getEffectiveContent(pure), '転送された本文です');
    const withComment = forwardedMessage('u2', '転送された本文です', { ownContent: 'これ見て' });
    assert.equal(getEffectiveContent(withComment), 'これ見て\n転送された本文です');
    assert.equal(hasForwardedContent(pure), true);
    assert.equal(hasForwardedContent({ content: 'x' } as any), false);
    assert.equal(getForwardedSnapshots(pure).length, 1);
});

test('repeated forwards of the same raid template are detected as similar duplicates', async (t) => {
    t.after(() => CacheManager.clear());
    const detector = new TextSpamDetector();
    const context = detectorContext('guild-fwd-text', 'user-fwd-text', 'channel-fwd-text', {
        textSpam: {
            enabled: true, score: 2, deleteMessage: false, notifyChannel: false,
            config: { windowSeconds: 5, rapidMessageCount: 6, duplicateThreshold: 3 },
        },
    });
    const tails = ['x8f2kq9zaa', 'p9w8e7r6t5', 'zz12kk34mn'];
    const results = [];
    for (let i = 0; i < tails.length; i++) {
        results.push(await detector.detect(
            forwardedMessage(`fwd-text-${i}`, `Raid by INMU dsc.gg/inmu7f3ka9 ${tails[i]}`),
            context,
        ));
    }
    assert.equal(results[0].scoreDelta, 0, JSON.stringify(results[0]));
    // Invite-bearing lookalikes score from the second post.
    assert.ok(results[1].scoreDelta > 0, JSON.stringify(results[1]));
    assert.ok(results[1].reasons.some((r: string) => r.includes('招待リンクを含む類似')), JSON.stringify(results[1]));
    assert.ok(results[2].scoreDelta > 0, JSON.stringify(results[2]));
});

test('identical forwards are caught by the duplicate detector from the second post', async (t) => {
    t.after(() => CacheManager.clear());
    const detector = new DuplicateMessageDetector();
    const context = detectorContext('guild-fwd-dup', 'user-fwd-dup', 'channel-fwd-dup', {
        duplicateMessage: {
            enabled: true, score: 1, deleteMessage: true, notifyChannel: false,
            config: { windowSeconds: 180, deleteFrom: 2, scoreFrom: 4 },
        },
    });
    const text = '同じテンプレ文を転送で流しますね、みんなで広めよう';
    const first = await detector.detect(forwardedMessage('fwd-dup-1', text), context);
    const second = await detector.detect(forwardedMessage('fwd-dup-2', text), context);
    assert.equal(first.reasons.length, 0);
    assert.ok(second.reasons.length > 0, JSON.stringify(second));
    assert.equal(second.deleteMessage, true);
});

test('the same forward spread across channels is caught by the cross-channel detector', async (t) => {
    t.after(() => CacheManager.clear());
    const detector = new CrossChannelSpamDetector();
    const settings = {
        crossChannelSpam: {
            enabled: true, score: 3, deleteMessage: true, notifyChannel: false, config: {},
        },
    };
    const text = '全チャンネルに拡散する転送テンプレです、よろしくお願いします';
    const first = await detector.detect(
        forwardedMessage('fwd-cross-1', text),
        detectorContext('guild-fwd-cross', 'user-fwd-cross', 'channel-a', settings),
    );
    const second = await detector.detect(
        forwardedMessage('fwd-cross-2', text),
        detectorContext('guild-fwd-cross', 'user-fwd-cross', 'channel-b', settings),
    );
    assert.equal(first.reasons.length, 0);
    assert.ok(second.reasons.some((r: string) => r.includes('拡散')), JSON.stringify(second));
});

test('an invite link inside a forwarded snapshot is detected on a single post', async () => {
    const detector = new InviteReferralDetector();
    const context = detectorContext('guild-fwd-invite', 'user-fwd-invite', 'channel-fwd-invite', {
        inviteReferral: { enabled: true, score: 5, deleteMessage: true, notifyChannel: false, config: {} },
    });
    const result = await detector.detect(
        forwardedMessage('fwd-invite-1', 'みんな来てね https://discord.gg/abcd1234 待ってるよ'),
        context,
    );
    assert.ok(result.scoreDelta > 0, JSON.stringify(result));
    assert.ok(result.reasons.some((r: string) => r.includes('Discord招待リンク')), JSON.stringify(result));
});

test('mentions inside a forwarded snapshot feed the mention spam window', async (t) => {
    t.after(() => CacheManager.clear());
    const detector = new MentionSpamDetector();
    const context = detectorContext('guild-fwd-mention', 'user-fwd-mention', 'channel-fwd-mention', {
        mentionSpam: {
            enabled: true, score: 2, deleteMessage: true, notifyChannel: false,
            config: { windowSeconds: 30, sameUserMentionThreshold: 5, roleMentionThreshold: 5, totalMentionThreshold: 50, uniqueUserMentionThreshold: 8 },
        },
    });
    const mentions = Array.from({ length: 8 }, (_, i) => `<@10000000000000000${i}>`).join(' ');
    const result = await detector.detect(forwardedMessage('fwd-mention-1', `全員集合 ${mentions}`), context);
    assert.ok(result.reasons.some((r: string) => r.includes('多数の異なるユーザー')), JSON.stringify(result));
});

const zeroVerdict = Object.fromEntries(
    ['suggestive', 'explicit', 'harassment', 'hate', 'threat', 'violence'].map((c) => [c, 0]),
);

function aiFetch(verdict: Record<string, unknown>, bodies?: string[]) {
    return async (_url: unknown, init?: { body?: unknown }) => {
        if (bodies) bodies.push(String(init?.body ?? ''));
        return new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify(verdict) } }],
            usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
}

test('forwarded text is sent to the AI content safety scan as the post itself', async () => {
    const bodies: string[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = aiFetch(
        { ...zeroVerdict, spam: 0.95, explanation: '招待リンクとランダム文字列の荒らしです', suggestedPoints: 30, pointsReason: 'レイドスパムのため' },
        bodies,
    ) as typeof fetch;
    try {
        const detector = new ContentSafetyDetector();
        const message = forwardedMessage('fwd-ai-1', 'Raid by INMU dsc.gg/inmu x8f2kq9z randomtail');
        const context = { settings: { detectors: { contentSafety: { enabled: true, config: { awardScore: 1, maxAiScore: 10, fallbackScore: 20, spam: 1, action: 'delete' } } } } } as any;
        const result = await detector.detect(message, context);
        assert.ok(result.reasons.includes(SPAM_LABEL), JSON.stringify(result));
        assert.ok(bodies.some((body) => body.includes('dsc.gg/inmu')), 'classifier request must contain the forwarded text');
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test('images attached to a forwarded snapshot enter the AI image scan', async () => {
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#389' } }).png().toBuffer();
    const resolvedUrls: string[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = aiFetch({ ...zeroVerdict, explanation: '通常の画像です' }) as typeof fetch;
    try {
        const detector = new ContentSafetyDetector(async (url: string) => {
            resolvedUrls.push(url);
            return { data: image, type: 'png' } as any;
        });
        const snapshotUrl = 'https://cdn.discordapp.com/attachments/9/9/photo.png';
        const message = forwardedMessage('fwd-ai-2', '写真を共有します', {
            snapshotAttachments: [{ id: 'att1', name: 'photo.png', contentType: 'image/png', size: image.length, url: snapshotUrl }],
        });
        const context = { settings: { detectors: { contentSafety: { enabled: true, config: { scanText: 1, scanImages: 1, scanUrls: 1 } } } } } as any;
        const result = await detector.detect(message, context);
        assert.ok(resolvedUrls.includes(snapshotUrl), `snapshot image must be resolved, got ${JSON.stringify(resolvedUrls)}`);
        const sources = (result.metadata?.analyses || []).map((a: any) => a.source);
        assert.ok(sources.some((s: string) => s.startsWith('image')), JSON.stringify(sources));
        assert.equal(result.scoreDelta, 0);
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test('a single benign forward is not flagged by any integrated detector', async (t) => {
    t.after(() => CacheManager.clear());
    const benign = '昨日の会議メモを共有します。来週の予定は金曜の午後です。';
    const message = forwardedMessage('fwd-benign-1', benign);

    const textSpam = await new TextSpamDetector().detect(message, detectorContext('guild-fwd-benign', 'user-fwd-benign', 'channel-fwd-benign', {
        textSpam: { enabled: true, score: 2, deleteMessage: true, notifyChannel: false, config: { duplicateThreshold: 3 } },
    }));
    assert.equal(textSpam.scoreDelta, 0, JSON.stringify(textSpam));

    const duplicate = await new DuplicateMessageDetector().detect(message, detectorContext('guild-fwd-benign', 'user-fwd-benign', 'channel-fwd-benign', {
        duplicateMessage: { enabled: true, score: 1, deleteMessage: true, notifyChannel: false, config: { deleteFrom: 2, scoreFrom: 4 } },
    }));
    assert.equal(duplicate.reasons.length, 0);

    const invite = await new InviteReferralDetector().detect(message, detectorContext('guild-fwd-benign', 'user-fwd-benign', 'channel-fwd-benign', {
        inviteReferral: { enabled: true, score: 5, deleteMessage: true, notifyChannel: false, config: {} },
    }));
    assert.equal(invite.scoreDelta, 0);

    const mention = await new MentionSpamDetector().detect(message, detectorContext('guild-fwd-benign', 'user-fwd-benign', 'channel-fwd-benign', {
        mentionSpam: { enabled: true, score: 2, deleteMessage: true, notifyChannel: false, config: {} },
    }));
    assert.equal(mention.scoreDelta, 0);

    const previousFetch = globalThis.fetch;
    globalThis.fetch = aiFetch({ ...zeroVerdict, explanation: '通常の投稿です' }) as typeof fetch;
    try {
        const safety = await new ContentSafetyDetector().detect(message, {
            settings: { detectors: { contentSafety: { enabled: true, config: { spam: 1, action: 'delete' } } } },
        } as any);
        assert.equal(safety.scoreDelta, 0, JSON.stringify(safety));
        assert.deepEqual(safety.reasons, []);
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test('forward origin annotation exposes source guild relation and original date', () => {
    const at = Date.parse('2024-12-09T11:18:58.932Z'); // 2024/12/09 20:18 JST
    const crossGuild = {
        content: '',
        guildId: '890315487962095637',
        messageSnapshots: new Map([['1315638823593705472', {
            content: '',
            createdTimestamp: at,
            guildId: '1304404938138320926',
            author: null,
        }]]),
    } as any;
    assert.deepEqual(getForwardOrigin(crossGuild), { at, authorName: null, fromOtherGuild: true });
    assert.equal(formatForwardAnnotation(crossGuild), '[転送: 別サーバーから, 2024/12/09]');

    const sameGuild = {
        content: 'これ見て',
        guildId: '890315487962095637',
        messageSnapshots: new Map([['m1', {
            content: '昔の投稿',
            createdTimestamp: at,
            guildId: '890315487962095637',
            author: { username: 'someone' },
        }]]),
    } as any;
    assert.equal(formatForwardAnnotation(sameGuild), '[転送, 2024/12/09, someone]');

    // 日付は JST 基準（16:00 UTC は翌日 01:00 JST）。
    const lateUtc = {
        content: '',
        guildId: 'g1',
        messageSnapshots: new Map([['m2', { content: '', createdTimestamp: Date.parse('2024-12-09T16:00:00Z'), guildId: 'g2' }]]),
    } as any;
    assert.equal(formatForwardAnnotation(lateUtc), '[転送: 別サーバーから, 2024/12/10]');

    // メタデータが無いスナップショットでも「転送」であることだけは示す。
    const bare = forwardedMessage('u9', '転送本文');
    assert.equal(formatForwardAnnotation(bare), '[転送]');
    assert.deepEqual(getForwardOrigin(bare), { at: null, authorName: null, fromOtherGuild: null });

    // 転送でなければ注記なし。
    assert.equal(formatForwardAnnotation({ content: '普通の投稿', guildId: 'g1' } as any), '');
    assert.equal(getForwardOrigin({ content: '普通の投稿', guildId: 'g1' } as any), null);
});
