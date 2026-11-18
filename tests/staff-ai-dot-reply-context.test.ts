import test from 'node:test';
import assert from 'node:assert/strict';
import { findUnsupportedDotClaim, selectDotConversationWindow } from '../src/core/ai/DotReplyContext.ts';
import { formatDotReplyFocus } from '../src/core/ai/StaffAIDotAmbient.ts';

test('conversation history is anchored to original target, excludes messages that arrived during generation', () => {
    const m = (id: string, createdTimestamp: number) => ({ id, createdTimestamp });
    const user = m('target', 1_000_000);
    const candidates = [m('later', 1_000_500), m('older', 998_000), m('newer', 999_000), user];
    const picked = selectDotConversationWindow(candidates, user);
    assert.deepEqual(picked.map(item => item.id), ['older', 'newer', 'target']);
    assert.equal(picked.filter(item => item.id === user.id).length, 1);
    assert.deepEqual(selectDotConversationWindow([m('later', 1_000_500)], user)
        .map(item => item.id), ['target']);
});

test('history window retains bounded recent messages but avoids far-away unrelated chatter', () => {
    const target = { id: 'target', createdTimestamp: 2_000_000 };
    const old = { id: 'yesterday', createdTimestamp: 2_000_000 - 3_000_000 };
    const source = [...Array.from({ length: 15 }, (_, i) => ({
        id: 'm' + i, createdTimestamp: 1_990_000 + i * 10,
    })), old];
    const result = selectDotConversationWindow(source, target, 8);
    assert.equal(result.length, 8);
    assert.equal(result.at(-1)?.id, 'target');
    assert.equal(result.some(item => item.id === 'yesterday'), false);
});

test('Discord reply focus keeps quoted parent author separate from current poster', () => {
    const focus = formatDotReplyFocus('70455xy', 'このユーザーは警視庁に監視されています。', false, {
        id: 'parent-message',
        authorId: 'another-user',
        authorName: 'こう君',
        content: 'それ冗談やろ',
    });
    assert.match(focus, /発言者: 70455xy/);
    assert.match(focus, /parent-message/);
    assert.match(focus, /userId=another-user/);
    assert.match(focus, /それ冗談やろ/);
    assert.match(focus, /今の投稿者の発言ではない/);
});

test('screenshot regression: unsupported invented username and fake link fraud cannot be sent', () => {
    const target = 'このユーザーは、日本警視庁サイバー犯罪対策課によって監視されています。このユーザーには連絡しないでください。';
    const wrong = 'それ警視庁の警告じゃなくてリンク詐欺やで。ユーザー名は「エル」。';
    assert.equal(findUnsupportedDotClaim(wrong, target), 'invented-username');
    assert.equal(findUnsupportedDotClaim('それリンク詐欺やで', target), 'unverified-link-scam');
    assert.equal(findUnsupportedDotClaim('その文だけでは警視庁の正式な警告か判断できないね。', target), null);
    assert.equal(findUnsupportedDotClaim('リンク詐欺の可能性があるからURLに注意', 'https://example.com/'), null);
    assert.equal(findUnsupportedDotClaim('ユーザー名は「エル」。', 'ユーザー名は「エル」だよ'), null);
    assert.equal(findUnsupportedDotClaim('ユーザー名は「エル」。', 'これは別の人の話', 'エルは元発言で指定されている'), null);
});
