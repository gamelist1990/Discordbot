import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isHangingQuestion,
    isNameCalled,
    isAddressedCandidate,
    parseAddressedJudgeResponse,
    shouldRespondToAddressed,
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

test('addressed candidate nomination is loose but bounded', () => {
    const base = { names: ['リン'], isQuestion: false, botRecentlyActive: false };
    // 名前呼びは候補になる（最終判断はモデル）
    assert.equal(isAddressedCandidate('リン、ちょっと聞きたいんだけど', base), true);
    // 「AI」への呼びかけは名前パターンに一致しなくても候補になる
    assert.equal(isNameCalled('AIさ、これ翻訳して', ['リン']), false);
    assert.equal(isAddressedCandidate('AIさ、これ翻訳して', base), true);
    // Botを話題にしているだけの発言も候補にはなる（モデルが addressed=false で落とす）
    assert.equal(isAddressedCandidate('AIの判定理由おもろすぎ', base), true);
    // 通常の会話・コマンドは候補にならない
    assert.equal(isAddressedCandidate('普通の会話だよ', base), false);
    assert.equal(isAddressedCandidate('草', base), false);
    assert.equal(isAddressedCandidate('/staff ai 質問', base), false);
});

test('addressed candidate: natural follow-ups need the bot to have spoken recently', () => {
    // パターンに一致しない自然な呼びかけでも、Botが直前に話した流れなら候補になる
    assert.equal(isNameCalled('ねえ、今のってどう思う？', ['リン']), false);
    assert.equal(isAddressedCandidate('ねえ、今のってどう思う？', { names: ['リン'], isQuestion: true, botRecentlyActive: true }), true);
    assert.equal(isAddressedCandidate('それどういうこと？', { names: ['リン'], isQuestion: true, botRecentlyActive: true }), true);
    // Botが最近話していない場では、宛先不明の発言は候補にしない（他人同士の会話を拾わない）
    assert.equal(isAddressedCandidate('ねえ、今のってどう思う？', { names: ['リン'], isQuestion: true, botRecentlyActive: false }), false);
    assert.equal(isAddressedCandidate('それどういうこと？', { names: ['リン'], isQuestion: true, botRecentlyActive: false }), false);
    // 他人へのメンション挨拶は、Botが最近話していても候補にならない
    assert.equal(isAddressedCandidate('<@123456789> おはよう', { names: ['リン'], isQuestion: false, botRecentlyActive: true }), false);
});

test('addressed judge response parsing and threshold', () => {
    assert.deepEqual(parseAddressedJudgeResponse('{"addressed":true,"confidence":0.85}'), { addressed: true, confidence: 0.85 });
    assert.deepEqual(parseAddressedJudgeResponse('判定: {"addressed":false,"confidence":0.9}'), { addressed: false, confidence: 0.9 });
    assert.equal(parseAddressedJudgeResponse('{"addressed":"yes"}'), null);
    assert.equal(parseAddressedJudgeResponse('わかりません'), null);
    assert.equal(parseAddressedJudgeResponse(''), null);

    // (a) 自然な呼びかけをモデルが高確信度で肯定したら応答する
    assert.equal(shouldRespondToAddressed(parseAddressedJudgeResponse('{"addressed":true,"confidence":0.85}')), true);
    assert.equal(shouldRespondToAddressed({ addressed: true, confidence: 0.65 }), true);
    // (b) Botを話題にしているだけ → 応答しない
    assert.equal(shouldRespondToAddressed(parseAddressedJudgeResponse('{"addressed":false,"confidence":0.9}')), false);
    // (c) 他人宛 → 応答しない
    assert.equal(shouldRespondToAddressed({ addressed: false, confidence: 0.8 }), false);
    // (d) 低確信度 → 応答しない
    assert.equal(shouldRespondToAddressed(parseAddressedJudgeResponse('{"addressed":true,"confidence":0.4}')), false);
    assert.equal(shouldRespondToAddressed(null), false);
});
