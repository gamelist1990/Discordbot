import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isHangingQuestion,
    parseDotJudgeResponse,
    evaluateDotTrigger,
    type DotChannelSnapshot,
} from '../src/core/ai/StaffAIDotAmbient.ts';

test('hanging question detection catches open questions', () => {
    assert.equal(isHangingQuestion('これってどうやって直すの？'), true);
    assert.equal(isHangingQuestion('明日の集合時間っていつだっけ'), true);
    assert.equal(isHangingQuestion('このエラー見たことある人いますか'), true);
    assert.equal(isHangingQuestion('なるほど、そういうことか'), false);
    assert.equal(isHangingQuestion('草'), false);
    assert.equal(isHangingQuestion('/staff ai settings'), false);
    assert.equal(isHangingQuestion('https://example.com/foo?'), false);
});

test('judge response parser accepts JSON and rejects noise', () => {
    assert.deepEqual(
        parseDotJudgeResponse('{"join":true,"confidence":0.9,"kind":"answer"}'),
        { join: true, confidence: 0.9, kind: 'answer' },
    );
    assert.deepEqual(
        parseDotJudgeResponse('判定: {"join":false,"confidence":0.2,"kind":"comment"} です'),
        { join: false, confidence: 0.2, kind: 'comment' },
    );
    assert.equal(parseDotJudgeResponse('{"join":"yes"}'), null);
    assert.equal(parseDotJudgeResponse('参加しません'), null);
    assert.equal(parseDotJudgeResponse(''), null);
});

const base: DotChannelSnapshot = {
    lastHumanMessageAt: 1_000_000,
    lastHumanMessageIsQuestion: false,
    lastDotMessageAt: 0,
    lastSelfBotMessageAt: 0,
    humanMessages15m: 0,
    distinctHumans15m: 0,
    burstStartedAt: 0,
    lastJoinedBurstStartedAt: 0,
};

test('trigger: hanging question joins after a pause, not immediately', () => {
    const s = { ...base, lastHumanMessageIsQuestion: true };
    assert.equal(evaluateDotTrigger(s, 1_000_000 + 30_000), null);
    assert.deepEqual(evaluateDotTrigger(s, 1_000_000 + 90_000), { kind: 'question' });
    assert.equal(evaluateDotTrigger(s, 1_000_000 + 20 * 60_000), null);
});

test('trigger: lull joins an active conversation once per burst', () => {
    const s = {
        ...base,
        humanMessages15m: 6,
        distinctHumans15m: 3,
        burstStartedAt: 700_000,
    };
    assert.deepEqual(evaluateDotTrigger(s, 1_000_000 + 180_000), { kind: 'lull', burstStartedAt: 700_000 });
    assert.equal(evaluateDotTrigger({ ...s, lastJoinedBurstStartedAt: 700_000 }, 1_000_000 + 180_000), null);
    assert.equal(evaluateDotTrigger({ ...s, distinctHumans15m: 1 }, 1_000_000 + 180_000), null);
});

test('trigger: cooldowns and bot-recent activity suppress joining', () => {
    const q = { ...base, lastHumanMessageIsQuestion: true };
    // dotが最近話したチャンネルでは人間の新発言があってもクールダウン優先
    assert.equal(evaluateDotTrigger(
        { ...q, lastDotMessageAt: 900_000, lastHumanMessageAt: 1_100_000, lastHumanMessageIsQuestion: true },
        1_100_000 + 90_000,
    ), null);
    // Bot本体（ChatAI）が最近話したチャンネルには入らない
    assert.equal(evaluateDotTrigger(
        { ...q, lastSelfBotMessageAt: 1_050_000 },
        1_000_000 + 90_000,
    ), null);
    // dotの発言後に人間の発言がない場合は何もしない
    assert.equal(evaluateDotTrigger(
        { ...q, lastDotMessageAt: 1_050_000 },
        1_000_000 + 90_000,
    ), null);
});
