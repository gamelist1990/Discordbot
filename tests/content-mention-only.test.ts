import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentSafetyDetector, isOnlyDiscordUserMentions, customRulesBanUserMentions, classifyContent } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';
import { lfmResponse } from './fixtures/lfm.ts';
import sharp from 'sharp';

(globalThis as any)._cacheCleanupInterval?.unref?.();

function makePost(content: string, rules = '') {
    const message: any = {
        id: '1565682624624599053', content, editedTimestamp: null,
        attachments: new Map(), embeds: [],
    };
    if (rules) {
        message.guild = { channels: { fetch: async () => ({
            isTextBased: () => true,
            messages: { fetch: async () => ({ content: rules }) },
        }) } };
    }
    return message;
}

function makeContext(rules = ''): any {
    return { guildId: 'mention-regression', settings: { detectors: {
        contentSafety: { enabled: true, config: {
            scanText: 1, scanImages: 1,
            ...(rules ? {customRulesChannelId: '1381971374947438703', customRulesMessageId: '1381971374947438703'} : {}),
        } },
    } } };
}

test('user mention-only detection distinguishes pings from abusive text', () => {
    assert.equal(isOnlyDiscordUserMentions('<@735854461636837389>'), true);
    assert.equal(isOnlyDiscordUserMentions(' <@!735854461636837389>  <@735854461636837389> '), true);
    assert.equal(isOnlyDiscordUserMentions('<@\u200B735854461636837389>'), true);
    for (const text of ['<@735854461636837389> 死ね', '@everyone', '<@&735854461636837389>', '<@735854461636837389> https://example.org/', 'こんにちは']) {
        assert.equal(isOnlyDiscordUserMentions(text), false, text);
    }
    assert.equal(customRulesBanUserMentions('他人への侮辱は禁止'), false);
    assert.equal(customRulesBanUserMentions('他人へのメンションは禁止'), true);
    assert.equal(customRulesBanUserMentions('メンションによる嫌がらせは禁止'), false);
});

test('ping-only posts never reach AI or become spoiler reposts even if unrelated server rules exist', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return lfmResponse({customRuleViolations: ['サーバー独自ルール']}); }) as typeof fetch;
    try {
        for (const [content, rules] of [
            ['<@735854461636837389>', ''],
            ['<@735854461636837389>', '暴言を禁止します'],
            ['<@!735854461636837389>  <@735854461636837389>', '宣伝は禁止です'],
        ]) {
            const verdict = await new ContentSafetyDetector().detect(makePost(content, rules), makeContext(rules));
            assert.equal(verdict.scoreDelta, 0);
            assert.deepEqual(verdict.reasons, []);
            assert.equal(verdict.spoilerRepost, undefined);
            assert.equal(verdict.contentDeletion, undefined);
        }
        assert.equal(calls, 0);
    } finally { globalThis.fetch = originalFetch; }
});

test('a real insult after a mention remains subject to normal moderation', async () => {
    const oldFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return lfmResponse({harassment: 1}); }) as typeof fetch;
    try {
        const result = await new ContentSafetyDetector().detect(makePost('<@735854461636837389> お前は無能だ'), makeContext());
        assert.equal(calls, 1);
        assert.ok(result.reasons.length > 0);
    } finally { globalThis.fetch = oldFetch; }
});

test('explicitly banning mentions keeps mention-only posts eligible for rule checks', async () => {
    const oldFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return lfmResponse({customRuleViolations: ['サーバー独自ルール']}); }) as typeof fetch;
    try {
        const result = await new ContentSafetyDetector().detect(makePost('<@735854461636837389>', 'メンションは禁止'), makeContext('メンションは禁止'));
        assert.equal(calls, 1);
        assert.ok(result.reasons.some(reason => reason.includes('独自ルール')));
    } finally { globalThis.fetch = oldFetch; }
});

test('hallucinated custom-rule hit is discarded when rules were not supplied', async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async () => lfmResponse({
        customRuleViolations: ['サーバー独自ルール'], explanation: '特定の人物に対して不適切な言及',
    })) as typeof fetch;
    try {
        const result = await classifyContent('今日は良い天気ですね', [], 6000, false, undefined, 'lfm3', [], '');
        assert.deepEqual(result.customRuleViolations, []);
    } finally { globalThis.fetch = oldFetch; }
});

test('mention-only text with an image still runs the image inspection', async () => {
    const oldFetch = globalThis.fetch;
    let calls = 0;
    const image = await sharp({create: {width: 16, height: 16, channels: 3, background: '#389'}}).png().toBuffer();
    const post = makePost('<@735854461636837389>');
    post.attachments.set('a', {
        id: 'a', name: 'photo.png', contentType: 'image/png', size: image.length,
        url: 'https://cdn.discordapp.com/attachments/1/2/photo.png',
    });
    globalThis.fetch = (async () => { calls++; return lfmResponse(); }) as typeof fetch;
    try {
        const detector = new ContentSafetyDetector(async () => ({ data: image, type: 'png' } as any));
        const result = await detector.detect(post, makeContext());
        assert.equal(calls, 1);
        assert.deepEqual(result.reasons, []);
    } finally { globalThis.fetch = oldFetch; }
});
