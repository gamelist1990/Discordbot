import test from 'node:test';
import assert from 'node:assert/strict';
import { protectStaffAnswerFromHistoryLeak } from '../src/commands/staff/subcommands/StaffAIAnswerIntegrity.ts';

test('never claim a new image for pasted channel attachment metadata', () => {
    const screenshot = '🎨 cat.png（1回目の描画）\n[添付: 画像: cat.png]\n[この投稿の返信先: PEXserver / ID 1569956975750684762] お、猫描いたよ！';
    const result=protectStaffAnswerFromHistoryLeak(screenshot,false);
    assert.match(result,/新しい画像の生成・添付は確認できていません/);
    assert.doesNotMatch(result,/\[添付:|🎨 cat\.png|お、猫描いたよ/);
});

test('keep real verified drawing output and links intact', () => {
    const verified='🎨 cat.png（1回の描画で完了）\n🔗 画像URL: https://cdn.discordapp.com/attachments/example/cat.png';
    assert.equal(protectStaffAnswerFromHistoryLeak(verified,true),verified);
    assert.equal(protectStaffAnswerFromHistoryLeak(verified,false),verified);
});

test('remove leaked Discord provenance markers but retain other answers', () => {
    const input='この質問について回答します。\n[添付: 画像: example.png]\n[この投稿の返信先: PEXserver / ID 1569956975750684762] 引用された古い投稿\n結論は以上です。';
    const result=protectStaffAnswerFromHistoryLeak(input,false);
    assert.ok(result.startsWith('この質問について回答します。'));
    assert.ok(result.includes('結論は以上です。'));
    assert.doesNotMatch(result,/\[(?:添付:|この投稿の返信先:)/);
});

test('ordinary text and file names mentioned as facts are not discarded', () => {
    const normal='cat.pngという画像の保存形式について説明します。';
    assert.equal(protectStaffAnswerFromHistoryLeak(normal,false),normal);
});
