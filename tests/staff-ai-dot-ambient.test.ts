import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isHangingQuestion,
    isNameCalled,
    isAddressedCandidate,
    parseParticipationDecision,
    shouldExecuteParticipation,
    shouldRespondToAddressed,
    hasRawBotMention,
    hasExplicitNameCall,
    shouldFallbackToAddressed,
    parseDecisionWithRetry,
    presenceOf,
    evaluateEvaluationTrigger,
    ambientSendDelayMs,
    type DotChannelSnapshot,
    type ParticipationDecision,
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

test('addressed candidate nomination is loose but bounded', () => {
    const base = { names: ['リン'], isQuestion: false, botRecentlyActive: false };
    // 名前呼びは候補になる（最終判断はモデル）
    assert.equal(isAddressedCandidate('リン、ちょっと聞きたいんだけど', base), true);
    // 「AI」への呼びかけは名前パターンに一致しなくても候補になる
    assert.equal(isNameCalled('AIさ、これ翻訳して', ['リン']), false);
    assert.equal(isAddressedCandidate('AIさ、これ翻訳して', base), true);
    // Botを話題にしているだけの発言も候補にはなる（モデルが action=none で落とす）
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

test('participation decision parser validates the structured schema', () => {
    assert.deepEqual(
        parseParticipationDecision('{"action":"react","targetMessageId":"123456789012345678","emoji":"👍","confidence":0.8,"reason":"笑える"}'),
        { action: 'react', targetMessageId: '123456789012345678', emoji: '👍', confidence: 0.8, reason: '笑える' },
    );
    assert.deepEqual(
        parseParticipationDecision('判定: {"action":"none","targetMessageId":null,"emoji":null,"confidence":0.3,"reason":"閉じた会話"} です'),
        { action: 'none', targetMessageId: null, emoji: null, confidence: 0.3, reason: '閉じた会話' },
    );
    // confidence は 0..1 にクランプ
    assert.equal(parseParticipationDecision('{"action":"comment","confidence":1.7}')?.confidence, 1);
    // 不正な action は解釈不能として落とす
    assert.equal(parseParticipationDecision('{"action":"join","confidence":0.9}'), null);
    assert.equal(parseParticipationDecision('参加しません'), null);
    assert.equal(parseParticipationDecision(''), null);
    // カスタム絵文字は emoji として採用しない（リアクションは通常絵文字のみ）
    assert.equal(parseParticipationDecision('{"action":"react","targetMessageId":"123456789012345678","emoji":"<:pepe:123456>","confidence":0.8}')?.emoji, null);
    // 数値でない targetMessageId は null に落とす
    assert.equal(parseParticipationDecision('{"action":"reply","targetMessageId":"abc","confidence":0.8}')?.targetMessageId, null);
});

test('addressed decisions accept only high-confidence replies', () => {
    // (a) 自然な呼びかけをモデルが高確信度で reply と判定したら応答する
    assert.equal(shouldRespondToAddressed(parseParticipationDecision('{"action":"reply","confidence":0.85}')), true);
    assert.equal(shouldRespondToAddressed({ action: 'reply', targetMessageId: null, emoji: null, confidence: 0.65, reason: '' }), true);
    // (b) Botを話題にしているだけ（none）→ 応答しない
    assert.equal(shouldRespondToAddressed(parseParticipationDecision('{"action":"none","confidence":0.9}')), false);
    // (c) 他人宛（none）→ 応答しない
    assert.equal(shouldRespondToAddressed({ action: 'none', targetMessageId: null, emoji: null, confidence: 0.8, reason: '他人宛' }), false);
    // reply 以外の action は呼びかけ応答にしない
    assert.equal(shouldRespondToAddressed({ action: 'comment', targetMessageId: null, emoji: null, confidence: 0.95, reason: '' }), false);
    // (d) 低確信度 → 応答しない
    assert.equal(shouldRespondToAddressed(parseParticipationDecision('{"action":"reply","confidence":0.4}')), false);
    assert.equal(shouldRespondToAddressed(null), false);
});

const T = 1_000_000;
const base: DotChannelSnapshot = {
    lastHumanMessageAt: T,
    lastHumanMessageIsQuestion: false,
    lastHumanMessageId: 'm1',
    lastJudgedQuestionId: '',
    lastAmbientJoinAt: 0,
    lastOtherBotMessageAt: 0,
    lastBotParticipationAt: 0,
    engagedUntil: 0,
    lastReactAt: 0,
    humanMessagesInWindow: 0,
    distinctHumansInWindow: 0,
    humanMessagesTotal: 10,
    humanCountAtLastEvaluation: 0,
    lastEvaluationAt: 0,
};

test('presence: engaged beats cooldown, cooldown beats lurking', () => {
    assert.equal(presenceOf(base, T), 'lurking');
    // 参加直後は cooldown
    assert.equal(presenceOf({ ...base, lastAmbientJoinAt: T }, T + 10 * 60_000), 'cooldown');
    // 30分経てば lurking に戻る
    assert.equal(presenceOf({ ...base, lastAmbientJoinAt: T }, T + 31 * 60_000), 'lurking');
    // engaged の期限内は cooldown より優先される
    assert.equal(presenceOf({ ...base, lastAmbientJoinAt: T, engagedUntil: T + 20 * 60_000 }, T + 10 * 60_000), 'engaged');
    assert.equal(presenceOf({ ...base, lastAmbientJoinAt: T, engagedUntil: T + 5 * 60_000 }, T + 10 * 60_000), 'cooldown');
});

test('trigger: open conversation in lurking is nominated, pacing applies', () => {
    const s = { ...base, humanMessagesInWindow: 5, distinctHumansInWindow: 3 };
    // 盛り上がっている最中（最終発言から1分）でも判定機会が来る
    assert.equal(evaluateEvaluationTrigger(s, T + 60_000), 'open');
    // 会話が冷めたら機会は消える
    assert.equal(evaluateEvaluationTrigger(s, T + 4 * 60_000), null);
    // 直前に評価済みで新規発言が少ない場合は再評価しない
    assert.equal(evaluateEvaluationTrigger(
        { ...s, lastEvaluationAt: T + 50_000, humanCountAtLastEvaluation: 10 },
        T + 60_000,
    ), null);
    // 90秒以上経ち、新規発言が2件以上あれば再評価する
    assert.equal(evaluateEvaluationTrigger(
        { ...s, lastEvaluationAt: T, humanCountAtLastEvaluation: 8 },
        T + 120_000,
    ), 'open');
    // 参加者が1人だけなら候補化しない
    assert.equal(evaluateEvaluationTrigger({ ...s, distinctHumansInWindow: 1 }, T + 60_000), null);
    // 発言が無ければ何もしない
    assert.equal(evaluateEvaluationTrigger({ ...base, lastHumanMessageAt: 0 }, T), null);
});

test('trigger: lone hanging question in a quiet channel, judged once', () => {
    const s = { ...base, lastHumanMessageIsQuestion: true, humanMessagesInWindow: 1, distinctHumansInWindow: 1 };
    assert.equal(evaluateEvaluationTrigger(s, T + 30_000), null);
    assert.equal(evaluateEvaluationTrigger(s, T + 70_000), 'question');
    assert.equal(evaluateEvaluationTrigger({ ...s, lastJudgedQuestionId: 'm1' }, T + 80_000), null);
});

test('trigger: cooldown suppresses cold re-entry, other-bot activity yields', () => {
    const active = { ...base, humanMessagesInWindow: 5, distinctHumansInWindow: 3 };
    // 参加後30分は冷たい再参加の候補化をしない
    assert.equal(evaluateEvaluationTrigger(
        { ...active, lastAmbientJoinAt: T + 30_000, lastHumanMessageAt: T + 40_000 },
        T + 100_000,
    ), null);
    // Bot本体（他の機能）が最近話したチャンネルには入らない
    assert.equal(evaluateEvaluationTrigger(
        { ...active, lastOtherBotMessageAt: T + 30_000 },
        T + 60_000,
    ), null);
});

test('trigger: engaged channels follow up on fresh replies only', () => {
    const engaged = {
        ...base,
        lastAmbientJoinAt: T,
        lastBotParticipationAt: T,
        engagedUntil: T + 5 * 60_000,
        lastEvaluationAt: T,
        lastHumanMessageAt: T + 60_000,
    };
    // Botの参加後に人間の返信が来たら、cooldown期間でも追随判定の機会になる
    assert.equal(evaluateEvaluationTrigger(engaged, T + 90_000), 'engaged');
    // 評価済みの末尾は再判定しない
    assert.equal(evaluateEvaluationTrigger({ ...engaged, lastEvaluationAt: T + 80_000 }, T + 90_000), null);
    // 流れが止まったら追随しない
    assert.equal(evaluateEvaluationTrigger(engaged, T + 60_000 + 4 * 60_000), null);
    // engaged の期限が切れたら cooldown 扱いで新規参加は候補化しない
    assert.equal(evaluateEvaluationTrigger({ ...engaged, lastHumanMessageAt: T + 6 * 60_000 }, T + 6 * 60_000 + 30_000), null);
});

test('participation execution thresholds by action and presence', () => {
    const d = (action: ParticipationDecision['action'], confidence: number): ParticipationDecision =>
        ({ action, targetMessageId: null, emoji: null, confidence, reason: '' });
    // none は既定で実行しない（開かれていない会話・他人同士の会話）
    assert.equal(shouldExecuteParticipation(d('none', 0.99), 'lurking'), false);
    assert.equal(shouldExecuteParticipation(null, 'lurking'), false);
    // comment（冷たい新規参加）は 0.7 未満では実行しない
    assert.equal(shouldExecuteParticipation(d('comment', 0.8), 'lurking'), true);
    assert.equal(shouldExecuteParticipation(d('comment', 0.65), 'lurking'), false);
    // reply（宙に浮いた質問への回答など）も 0.7 が敷居
    assert.equal(shouldExecuteParticipation(d('reply', 0.75), 'lurking'), true);
    assert.equal(shouldExecuteParticipation(d('reply', 0.6), 'lurking'), false);
    // react は軽い参加なので少し低めの敷居
    assert.equal(shouldExecuteParticipation(d('react', 0.62), 'lurking'), true);
    assert.equal(shouldExecuteParticipation(d('react', 0.5), 'lurking'), false);
    // continue は engaged の時だけ、かつ低めの確信度でもよい
    assert.equal(shouldExecuteParticipation(d('continue', 0.58), 'engaged'), true);
    assert.equal(shouldExecuteParticipation(d('continue', 0.58), 'lurking'), false);
    assert.equal(shouldExecuteParticipation(d('continue', 0.5), 'engaged'), false);
});

test('send delays are human-like ranges by kind', () => {
    assert.equal(ambientSendDelayMs('addressed', 0), 400);
    assert.equal(ambientSendDelayMs('addressed', 0.999), 1199);
    assert.equal(ambientSendDelayMs('join', 0), 1500);
    assert.equal(ambientSendDelayMs('join', 0.999), 3997);
    assert.equal(ambientSendDelayMs('react', 0), 300);
    assert.equal(ambientSendDelayMs('react', 0.999), 899);
});

test('raw mention text counts as a direct bot mention even when mentions.users misses it', () => {
    // (a) 生文字列 <@id> / <@!id> が本文にあればメンション扱いにする
    assert.equal(hasRawBotMention('<@123456789012345678> おー', '123456789012345678'), true);
    assert.equal(hasRawBotMention('<@!123456789012345678> おー', '123456789012345678'), true);
    assert.equal(hasRawBotMention('あいだに <@123456789012345678> いる', '123456789012345678'), true);
    // 他人のメンションや、テキスト表記の @名前 は生メンションではない
    assert.equal(hasRawBotMention('<@987654321098765432> おー', '123456789012345678'), false);
    assert.equal(hasRawBotMention('@PEXserver おー', '123456789012345678'), false);
    assert.equal(hasRawBotMention('<@123456789012345678> おー', undefined), false);
});

test('participation parser extracts JSON embedded in noisy surrounding text', () => {
    // (b) 前後にテキストや別の波括弧があっても本命のJSONを拾える
    const noisy = '考え中… 形式は {"action": ...} のような形で、結果は {"action":"reply","confidence":0.9,"reason":"呼びかけ"} です';
    const d = parseParticipationDecision(noisy);
    assert.equal(d?.action, 'reply');
    assert.equal(d?.confidence, 0.9);
    // 末尾に余分な波括弧が付いていても拾える
    const trailing = '{"action":"none","confidence":0.2} （補足 } あり）';
    assert.equal(parseParticipationDecision(trailing)?.action, 'none');
    // 文字列リテラル内の波括弧は対応付けを壊さない
    const bracesInString = '{"action":"comment","confidence":0.8,"reason":"波括弧 } を含む理由"}';
    assert.equal(parseParticipationDecision(bracesInString)?.action, 'comment');
});

test('decision retry: unparseable judge output is retried exactly once', async () => {
    // (c) 1回目が解釈不能でも、再試行で解釈できれば応答判断に使える
    let calls = 0;
    const failures: Array<{ raw: string; attempt: number }> = [];
    const decision = await parseDecisionWithRetry(async () => {
        calls++;
        return calls === 1 ? 'JSONを返せませんでした' : '{"action":"reply","confidence":0.9}';
    }, (raw, attempt) => { failures.push({ raw, attempt }); });
    assert.equal(calls, 2);
    assert.equal(decision?.action, 'reply');
    assert.equal(shouldRespondToAddressed(decision), true);
    assert.deepEqual(failures, [{ raw: 'JSONを返せませんでした', attempt: 1 }]);
    // 2回とも解釈不能なら null（再試行は1回だけ）
    let calls2 = 0;
    const none = await parseDecisionWithRetry(async () => { calls2++; return 'だめ'; });
    assert.equal(calls2, 2);
    assert.equal(none, null);
    // 1回目で解釈できれば再試行しない
    let calls3 = 0;
    const first = await parseDecisionWithRetry(async () => { calls3++; return '{"action":"none","confidence":0.1}'; });
    assert.equal(calls3, 1);
    assert.equal(first?.action, 'none');
});

test('addressed fallback: explicit name call responds even when the judge returns null', () => {
    // (d) 再試行後も null だが、明確な名前呼びならフォールバックで応答する
    assert.equal(shouldFallbackToAddressed(null, 'ロコ、ご挨拶してくれんのか', ['ロコ']), true);
    // 今回の事象の再現: @表示名 のテキスト表記を含む呼びかけ
    assert.equal(shouldFallbackToAddressed(null, 'AIちゃん会話に参加してくれるようになったよ @PEXserver ご挨拶してくれんのか', ['PEXserver']), true);
    assert.equal(hasExplicitNameCall('@PEXserver おー', ['PEXserver']), true);
    assert.equal(hasExplicitNameCall('ねえ PEXserver これ見て', ['PEXserver']), true);
    // 判定が正常に none を返した場合は、名前呼びでもフォールバックしない（モデルの判断を尊重）
    assert.equal(shouldFallbackToAddressed(
        { action: 'none', targetMessageId: null, emoji: null, confidence: 0.9, reason: '話題にしているだけ' },
        'ロコ、ご挨拶してくれんのか', ['ロコ']), false);
    // (e) 名前呼びでない候補は、判定 null でも応答しない
    assert.equal(shouldFallbackToAddressed(null, 'AIの判定理由おもろすぎ', ['PEXserver', 'ロコ']), false);
    assert.equal(shouldFallbackToAddressed(null, 'ねえ、今のってどう思う？', ['PEXserver', 'ロコ']), false);
    assert.equal(shouldFallbackToAddressed(null, 'AIさ、これ翻訳して', ['PEXserver', 'ロコ']), false);
});
