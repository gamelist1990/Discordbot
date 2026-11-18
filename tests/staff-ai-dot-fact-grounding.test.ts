import test from 'node:test';
import assert from 'node:assert/strict';
import { dotPiFactHint, unsupportedDotPiClaim } from '../src/core/ai/DotFactGrounding.ts';

const history = [
    { content: '円周率下四桁で', isBot: false },
    { content: '3141やで', isBot: true },
    { content: 'は', isBot: false },
    { content: 'おまえわりきれたの？？？？', isBot: false },
    { content: 'わりきれてへんわ 円周率くらい言えるつもりや', isBot: true },
    { content: 'くわしくおしえろ', isBot: false },
];

test('initial pi last-four-digits bait must be grounded, not answered with invented digits', () => {
    const hint = dotPiFactHint('円周率下四桁で', history.slice(0, 1));
    assert.match(hint, /最後の4桁.*存在しない/);
    assert.match(hint, /1415/);
    assert.match(hint, /3\.1416/);
    assert.equal(unsupportedDotPiClaim('3141やで', hint), true);
    assert.equal(unsupportedDotPiClaim('円周率の下4桁は3141。1・4・1・1の順やで。', hint), true);
    assert.equal(unsupportedDotPiClaim('下4桁は存在しないやろｗ', hint), false);
});

test('challenge and followup must correct an earlier bot error rather than double down', () => {
    const hint1 = dotPiFactHint('おまえわりきれたの？？？？', history.slice(0, 4));
    const hint2 = dotPiFactHint('くわしくおしえろ', history);
    assert.match(hint1, /過去のBotが3141/);
    assert.match(hint2, /過去のBotが3141/);
    assert.equal(unsupportedDotPiClaim('いや俺の3141は間違いやったわｗ', hint2), false);
    assert.equal(unsupportedDotPiClaim('3141は最初の4桁、最後の4桁はないで', hint2), false);
    assert.equal(unsupportedDotPiClaim('3141という最後の4桁が正解や', hint2), true);
});

test('decimal digit wording is distinguished from nonexistent final digits', () => {
    const hint = dotPiFactHint('円周率の小数点以下4桁', []);
    assert.match(hint, /小数点以下の先頭4桁は1415/);
    assert.equal(unsupportedDotPiClaim('小数点以下4桁は1415やで', hint), false);
});

test('unrelated messages do not inherit old pi trivia', () => {
    assert.equal(dotPiFactHint('明日のマイクラ遊ぼ', history), '');
    const stale = [{ content: '円周率下4桁', isBot: false },
        ...Array.from({ length: 8 }, (_, i) => ({ content: 'マイクラの話' + i, isBot: false }))];
    assert.equal(dotPiFactHint('くわしくおしえろ', stale), '');
    assert.equal(unsupportedDotPiClaim('3141やで', ''), false);
});
