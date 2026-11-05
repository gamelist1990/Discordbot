import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isHangingQuestion,
    isNameCalled,
    parseDotJudgeResponse,
    evaluateDotOpportunity,
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

test('name call detection matches persona names and the word dot', () => {
    assert.equal(isNameCalled('リン、ちょっと聞きたいんだけど', ['リン']), true);
    assert.equal(isNameCalled('dotいる？', []), true);
    assert.equal(isNameCalled('ねえ dot 、これ見て', []), true);
    assert.equal(isNameCalled('dotcomの株が上がったらしい', []), false);
    assert.equal(isNameCalled('普通の会話だよ', ['リン']), false);
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

const T = 1_000_000;
const base: DotChannelSnapshot = {
    lastHumanMessageAt: T,
    lastHumanMessageIsQuestion: false,
    lastHumanMessageId: 'm1',
    lastJudgedQuestionId: '',
    lastAmbientJoinAt: 0,
    lastOtherBotMessageAt: 0,
    humanMessagesInWindow: 0,
    distinctHumansInWindow: 0,
    humanMessagesTotal: 10,
    humanCountAtLastEvaluation: 0,
    lastEvaluationAt: 0,
};

test('opportunity: lively conversation gets judged while it is still warm', () => {
    const s = { ...base, humanMessagesInWindow: 5, distinctHumansInWindow: 3 };
    // 会話の最中（最終発言から1分）でも判定機会が来る。静かになるまで待たない。
    assert.equal(evaluateDotOpportunity(s, T + 60_000), 'active');
    // 会話が冷めたら機会は消える
    assert.equal(evaluateDotOpportunity(s, T + 4 * 60_000), null);
});

test('opportunity: evaluation pacing requires time and new messages', () => {
    const s = { ...base, humanMessagesInWindow: 5, distinctHumansInWindow: 3 };
    // 直前に評価済みで新規発言が少ない場合は再評価しない
    assert.equal(evaluateDotOpportunity(
        { ...s, lastEvaluationAt: T + 50_000, humanCountAtLastEvaluation: 10 },
        T + 60_000,
    ), null);
    // 90秒以上経ち、新規発言が2件以上あれば再評価する
    assert.equal(evaluateDotOpportunity(
        { ...s, lastEvaluationAt: T, humanCountAtLastEvaluation: 8 },
        T + 120_000,
    ), 'active');
    // 参加者が1人だけなら混ざらない
    assert.equal(evaluateDotOpportunity({ ...s, distinctHumansInWindow: 1 }, T + 60_000), null);
});

test('opportunity: lone hanging question in a quiet channel, judged once', () => {
    const s = { ...base, lastHumanMessageIsQuestion: true, humanMessagesInWindow: 1, distinctHumansInWindow: 1 };
    assert.equal(evaluateDotOpportunity(s, T + 30_000), null);
    assert.equal(evaluateDotOpportunity(s, T + 70_000), 'question');
    assert.equal(evaluateDotOpportunity({ ...s, lastJudgedQuestionId: 'm1' }, T + 80_000), null);
});

test('opportunity: cooldown and other-bot activity suppress judging', () => {
    const active = { ...base, humanMessagesInWindow: 5, distinctHumansInWindow: 3 };
    // 30分以内に混ざったチャンネルでは再参加しない
    assert.equal(evaluateDotOpportunity(
        { ...active, lastAmbientJoinAt: T + 30_000, lastHumanMessageAt: T + 40_000 },
        T + 100_000,
    ), null);
    // Bot本体（他の機能）が最近話したチャンネルには入らない
    assert.equal(evaluateDotOpportunity(
        { ...active, lastOtherBotMessageAt: T + 30_000 },
        T + 60_000,
    ), null);
    // 最後に混ざってから人間の発言がなければ何もしない
    assert.equal(evaluateDotOpportunity(
        { ...active, lastAmbientJoinAt: T + 30_000 },
        T + 60_000,
    ), null);
});
