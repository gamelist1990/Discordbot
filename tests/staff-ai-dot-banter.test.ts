import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDotSocialCue, dotHumanBanterHint, shouldSkipDotHeckleReply } from '../src/core/ai/DotBanter.ts';

test('natural role of short replies is preserved, rather than treating everything as an apology', () => {
    assert.equal(classifyDotSocialCue('俺に敬語使わない時点でおかしいんだよ死ね'), 'respect-request');
    assert.equal(classifyDotSocialCue('敬語使え'), 'respect-request');
    assert.equal(classifyDotSocialCue('まーじでくさ'), 'heckle');
    assert.equal(classifyDotSocialCue('草www'), 'heckle');
    assert.equal(classifyDotSocialCue('お前マジでうざい'), 'hostile-banter');
    assert.equal(classifyDotSocialCue('もう反応しないで'), 'leave-alone');
    assert.equal(classifyDotSocialCue('TypeScriptでエラーが出ました。どうしたら直せますか？'), 'ordinary');
});

test('banter directions mention the immediate speaker and avoid repeating the bot apology', () => {
    const hint = dotHumanBanterHint('heckle', 'あ、ごめん。もう敬語使う。');
    assert.match(hint, /前の相手への謝罪/);
    assert.match(hint, /直近の自分の返信/);
    assert.match(hint, /軽いツッコミ/);
    assert.match(dotHumanBanterHint('respect-request'), /おどけた敬語/);
    assert.match(dotHumanBanterHint('ordinary'), /具体的な質問/);
});

test('small bystander laugh may be left alone; explicit mentions and real questions are never auto-skipped', () => {
    const now = 60_000;
    assert.equal(shouldSkipDotHeckleReply('まーじでくさ', true, true, 55_000, now, 'id-01'), false);
    assert.equal(shouldSkipDotHeckleReply('まーじでくさ', false, false, 55_000, now, 'id-01'), false);
    assert.equal(shouldSkipDotHeckleReply('どうやって直す？', true, false, 55_000, now, 'id-01'), false);
    assert.equal(shouldSkipDotHeckleReply('まーじでくさ', true, false, 1_000, now, 'id-01'), false);
    const samples = Array.from({ length: 50 }, (_, i) => shouldSkipDotHeckleReply(
        'まーじでくさ', true, false, 55_000, now, 'id' + i));
    assert.ok(samples.filter(Boolean).length > 25);
    assert.ok(samples.filter(value => !value).length > 0);
    assert.equal(shouldSkipDotHeckleReply('まーじでくさ', true, false, 55_000, now, 'id-01'),
        shouldSkipDotHeckleReply('まーじでくさ', true, false, 55_000, now, 'id-01'));
});
