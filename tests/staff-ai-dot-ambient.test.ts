import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import {
    isHangingQuestion,
    isNameCalled,
    isAddressedCandidate,
    addressedNominationBasis,
    parseParticipationDecision,
    shouldExecuteParticipation,
    shouldRespondToAddressed,
    hasRawBotMention,
    hasExplicitNameCall,
    shouldFallbackToAddressed,
    parseDecisionWithRetry,
    sanitizeAiText,
    generateWithContextFallback,
    presenceOf,
    evaluateEvaluationTrigger,
    ambientSendDelayMs,
    DOT_AMBIENT,
    recordRecentReaction,
    formatRecentReactions,
    type RecentReaction,
    startTypingKeepAlive,
    AMBIENT_SYSTEM_RULES,
    PARTICIPATION_JUDGE_SYSTEM_PROMPT,
    ADDRESSED_JUDGE_SYSTEM_PROMPT,
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

function hasLoneSurrogate(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF) {
            const next = text.charCodeAt(i + 1);
            if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
            i++;
        } else if (code >= 0xDC00 && code <= 0xDFFF) {
            return true;
        }
    }
    return false;
}

test('sanitize: lone surrogates in history text are replaced so the payload stays parseable', () => {
    // 単独サロゲート（上側・下側）は U+FFFD に置換される
    const loneHigh = 'abc' + String.fromCharCode(0xD83D) + 'def';
    const loneLow = 'abc' + String.fromCharCode(0xDE00) + 'def';
    assert.equal(sanitizeAiText(loneHigh), 'abc\uFFFDdef');
    assert.equal(sanitizeAiText(loneLow), 'abc\uFFFDdef');
    // formatContext の slice(0, 300) で絵文字のペアが切り離されたケース
    const cut = ('あ'.repeat(299) + '😀').slice(0, 300);
    assert.equal(hasLoneSurrogate(cut), true);
    assert.equal(hasLoneSurrogate(sanitizeAiText(cut)), false);
    // 健全性: サニタイズ後は JSON 化しても単独サロゲートの \u エスケープが出ず、往復で一致する
    // （EndPoint の serde_json はペアになっていない \uD83D 等を「unexpected end of hex escape」で弾く）
    for (const raw of [loneHigh, loneLow, cut]) {
        const out = sanitizeAiText(raw);
        assert.equal(hasLoneSurrogate(out), false);
        assert.equal(JSON.parse(JSON.stringify(out)), out);
        assert.equal(JSON.stringify(out).toLowerCase().includes('\\ud83d'), false);
    }
    // 正常なサロゲートペア（絵文字）はそのまま残る
    assert.equal(sanitizeAiText('ok 😀 end'), 'ok 😀 end');
    // リテラルなバックスラッシュ列（コード片の \u 表記など）はテキストとして無害なので変えない
    assert.equal(sanitizeAiText('broken \\u12 escape'), 'broken \\u12 escape');
});

test('sanitize: unsafe control characters are dropped, newline/tab/CR are kept', () => {
    assert.equal(sanitizeAiText('a\u0001b\u0007c\u007Fd'), 'abcd');
    assert.equal(sanitizeAiText('a\nb\tc\rd'), 'a\nb\tc\rd');
    assert.equal(sanitizeAiText('普通のテキスト'), '普通のテキスト');
});

test('generation fallback: reply generation retries once with minimal context on request failure', async () => {
    // (b) 応答生成が1回失敗しても、最小文脈で組み立て直した再試行の結果が使われる
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const retriedErrors: unknown[] = [];
    const value = await generateWithContextFallback(
        async () => { primaryCalls++; throw new Error('400 [proxy-error-body] Failed to parse the request body as JSON'); },
        async () => { fallbackCalls++; return 'ご挨拶の返信'; },
        error => { retriedErrors.push(error); },
    );
    assert.equal(value, 'ご挨拶の返信');
    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 1);
    assert.equal(retriedErrors.length, 1);
    // 1回目が成功すれば再試行は走らない
    let unusedFallback = 0;
    const ok = await generateWithContextFallback(
        async () => '通常の返信',
        async () => { unusedFallback++; return 'unused'; },
    );
    assert.equal(ok, '通常の返信');
    assert.equal(unusedFallback, 0);
    // 再試行も失敗したら、そのエラーが呼び出し側へ伝播する（失敗として記録される）
    await assert.rejects(
        generateWithContextFallback(
            async () => { throw new Error('first failure'); },
            async () => { throw new Error('second failure'); },
        ),
        /second failure/,
    );
});

test('generation fallback: judge request errors retry with minimal context before returning null', async () => {
    // (c) 判定の生成エラー時は最小文脈で再試行し、再試行の応答が解釈できればそれを使う
    let seenContexts: string[] = [];
    const runJudge = async (contextText: string) => {
        seenContexts.push(contextText);
        if (contextText === 'full-context') throw new Error('400 [proxy-error-body]');
        return '{"action":"reply","confidence":0.9}';
    };
    const decision = await generateWithContextFallback(
        () => parseDecisionWithRetry(() => runJudge('full-context')),
        () => parseDecisionWithRetry(() => runJudge('minimal-context')),
    ).catch(() => null);
    assert.deepEqual(seenContexts, ['full-context', 'minimal-context']);
    assert.equal(decision?.action, 'reply');
    // 再試行も生成エラーなら null（従来どおり無言＋フォールバック判定へ）
    const failed = await generateWithContextFallback(
        () => parseDecisionWithRetry(async () => { throw new Error('400'); }),
        () => parseDecisionWithRetry(async () => { throw new Error('400 again'); }),
    ).catch(() => null);
    assert.equal(failed, null);
});

test('typing keep-alive resends on interval until stopped, and stopping is idempotent', () => {
    mock.timers.enable({ apis: ['setInterval'] });
    try {
        let count = 0;
        const stop = startTypingKeepAlive({ sendTyping: async () => { count += 1; } }, 1_000);
        // 開始直後に1回送る
        assert.equal(count, 1);
        mock.timers.tick(1_000);
        assert.equal(count, 2);
        mock.timers.tick(2_500);
        assert.equal(count, 4);
        stop();
        mock.timers.tick(10_000);
        assert.equal(count, 4);
        // 二重 stop でも送られない
        stop();
        mock.timers.tick(3_000);
        assert.equal(count, 4);
    } finally {
        mock.timers.reset();
    }
});

test('typing keep-alive swallows sendTyping failures', async () => {
    let count = 0;
    const stop = startTypingKeepAlive({
        sendTyping: async () => { count += 1; throw new Error('no permission'); },
    }, 60_000);
    // 失敗しても例外にならず、呼び出し自体は行われている
    assert.equal(count, 1);
    stop();
    await new Promise(resolve => setTimeout(resolve, 0));
});

test('ambient system rules include the concrete prohibitions (no attribute nicknames, no soliciting closers, no unprompted star talk)', () => {
    // 属性ラベルのあだ名禁止（具体例つき）
    assert.ok(AMBIENT_SYSTEM_RULES.includes('夜更かしさん'));
    assert.ok(AMBIENT_SYSTEM_RULES.includes('表示名を使うか'));
    assert.ok(AMBIENT_SYSTEM_RULES.includes('ラベル・あだ名では呼ばない'));
    // 締めの誘い文句の禁止（具体例つき）
    assert.ok(AMBIENT_SYSTEM_RULES.includes('勧誘する文句で締めない'));
    assert.ok(AMBIENT_SYSTEM_RULES.includes('何か話したいことある？'));
    assert.ok(AMBIENT_SYSTEM_RULES.includes('返事は、答えが終わったらそこで終わる'));
    // 星・夜空は相手が振ったときだけ
    assert.ok(AMBIENT_SYSTEM_RULES.includes('星や夜空の話題・比喩は、相手が振ったときだけ'));
    // 既存の短さ指定は維持されている
    assert.ok(AMBIENT_SYSTEM_RULES.includes('基本1〜2文'));
});

test('nomination basis: message-internal signals vs recent-bot-only', () => {
    const base = { names: ['リン'], isQuestion: false, botRecentlyActive: false };
    // 発言自体の中に呼びかけ信号があるものは message-signal
    assert.equal(addressedNominationBasis('リン、ちょっと聞きたいんだけど', base), 'message-signal');
    assert.equal(addressedNominationBasis('AIさ、これ翻訳して', base), 'message-signal');
    assert.equal(addressedNominationBasis('そのbotさ、昨日変なこと言ってた', base), 'message-signal');
    // 「Botが直近に話した＋質問形」だけが根拠のものは recent-bot-only
    // （2026-11-07 の実事故: 場への質問「どこかwick入れてる鯖ないかな」を自分宛てと誤認した）
    assert.equal(addressedNominationBasis('どこかwick入れてる鯖ないかな', { names: ['リン'], isQuestion: true, botRecentlyActive: true }), 'recent-bot-only');
    assert.equal(addressedNominationBasis('それどういうこと？', { names: ['リン'], isQuestion: true, botRecentlyActive: true }), 'recent-bot-only');
    assert.equal(addressedNominationBasis('ねえ、聞いて', { names: ['リン'], isQuestion: false, botRecentlyActive: true }), 'recent-bot-only');
    // Botが直近に話していなければ、その経路では候補にならない
    assert.equal(addressedNominationBasis('どこかwick入れてる鯖ないかな', { names: ['リン'], isQuestion: true, botRecentlyActive: false }), null);
    // そもそも候補でないもの（質問形でも呼びかけ口調でもない通常の発言）
    assert.equal(addressedNominationBasis('普通の会話だよ', { names: ['リン'], isQuestion: false, botRecentlyActive: true }), null);
    // isAddressedCandidate は basis の有無と一致する
    assert.equal(isAddressedCandidate('どこかwick入れてる鯖ないかな', { names: ['リン'], isQuestion: true, botRecentlyActive: true }), true);
    assert.equal(isAddressedCandidate('普通の会話だよ', base), false);
});

test('addressed threshold: recent-bot-only nominations require higher confidence', () => {
    const reply = (confidence: number): ParticipationDecision => ({ action: 'reply', targetMessageId: null, emoji: null, confidence, reason: '' });
    // 通常経路（発言内に信号あり）は従来どおり 0.65
    assert.equal(shouldRespondToAddressed(reply(0.65)), true);
    assert.equal(shouldRespondToAddressed(reply(0.8), 'message-signal'), true);
    assert.equal(shouldRespondToAddressed(reply(0.64), 'message-signal'), false);
    // recent-bot-only 経路は 0.85 未満を落とす
    assert.equal(shouldRespondToAddressed(reply(0.7), 'recent-bot-only'), false);
    assert.equal(shouldRespondToAddressed(reply(0.84), 'recent-bot-only'), false);
    assert.equal(shouldRespondToAddressed(reply(0.85), 'recent-bot-only'), true);
    // reply 以外・null はどちらの経路でも応答しない
    assert.equal(shouldRespondToAddressed({ action: 'none', targetMessageId: null, emoji: null, confidence: 0.99, reason: '' }, 'recent-bot-only'), false);
    assert.equal(shouldRespondToAddressed(null, 'recent-bot-only'), false);
});

test('participation judge prompt requires a concrete draft in reason and bans empty deflections', () => {
    // reason に「具体的に何を言うのか」が必須であること
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('具体的に何を言うのか'));
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('言う内容が空の理由しか書けない場合は必ず none'));
    // はぐらかし文の実例が NG として明記されていること
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('なんか技術的な話は、結構複雑な仕組みで動いてるんだよねぇ。'));
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('特定の技術的な実装については、なかなか情報掴みにくいんだよね。'));
    // 知らない話題は参加理由にならないこと
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('知らないことは参加の理由にならない'));
    // 雰囲気そのものへの感想は参加内容として認めないこと（2026-11-07 の「カオスな空間」実例）
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('雰囲気そのものへの感想は参加内容として認めない'));
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('いろんな話が飛び交う、まじでカオスな空間だよね。'));
    // 下書きは対象発言の話題そのものの具体でなければならないこと
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('話題そのもの（人名・物・出来事などの具体）について言える内容でなければならない'));
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('その話題について具体的に言えることがなければ none'));
});

test('addressed judge prompt excludes open questions to the room', () => {
    // 場への質問は、それだけでは呼びかけにならないこと
    assert.ok(ADDRESSED_JUDGE_SYSTEM_PROMPT.includes('場への質問'));
    assert.ok(ADDRESSED_JUDGE_SYSTEM_PROMPT.includes('あなたが直前に発言していたという事情だけを理由に reply にしない'));
    // reply の根拠は発言自体の中の信号に限ること
    assert.ok(ADDRESSED_JUDGE_SYSTEM_PROMPT.includes('発言自体の中にあなた宛ての信号がある場合だけ'));
    // ノミネート経緯（recent-bot-only）の伝え方と対応していること
    assert.ok(ADDRESSED_JUDGE_SYSTEM_PROMPT.includes('直近であなたが発言していたことと質問形であることだけが根拠'));
});

test('reactions have no fixed-time cooldown anymore (interval is model-judged)', () => {
    // 固定時間クールダウンの定数自体が廃止されていること
    assert.equal('reactChannelCooldownMs' in DOT_AMBIENT, false);
});

test('reaction history records back-to-back reactions without time-based blocking', () => {
    const t0 = 2_000_000;
    const first: RecentReaction = { at: t0, authorName: 'koukun_', excerpt: '鯖', emoji: '😂' };
    // わずか1分後の2回目でも、仕組み上はブロックされず履歴に残る（付けるかどうかの判断はモデル側）
    const second: RecentReaction = { at: t0 + 60_000, authorName: 'someone', excerpt: 'それな', emoji: '👍' };
    let history = recordRecentReaction([], first);
    history = recordRecentReaction(history, second);
    assert.equal(history.length, 2);
    // 新しい順に並ぶ（先頭が最新）
    assert.equal(history[0].emoji, '👍');
    assert.equal(history[1].emoji, '😂');
});

test('reaction history is capped at the keep count, dropping the oldest', () => {
    const t0 = 3_000_000;
    let history: RecentReaction[] = [];
    for (let i = 0; i < DOT_AMBIENT.recentReactionKeep + 3; i++) {
        history = recordRecentReaction(history, { at: t0 + i * 1000, authorName: 'u', excerpt: `m${i}`, emoji: '🔥' });
    }
    assert.equal(history.length, DOT_AMBIENT.recentReactionKeep);
    // 最新が先頭、最も古いものは落ちている
    assert.equal(history[0].excerpt, `m${DOT_AMBIENT.recentReactionKeep + 2}`);
    assert.ok(!history.some(entry => entry.excerpt === 'm0'));
});

test('formatRecentReactions renders history for the judge and handles the empty case', () => {
    const now = 10_000_000;
    assert.equal(formatRecentReactions([], now), '（このチャンネルではまだリアクションしていません）');
    const history: RecentReaction[] = [
        { at: now - 2 * 60_000, authorName: 'koukun_', excerpt: 'その鯖やばい', emoji: '😂' },
        { at: now - 3 * 60 * 60_000, authorName: 'someone', excerpt: 'おめでとう！', emoji: '🎉' },
    ];
    const text = formatRecentReactions(history, now);
    assert.ok(text.includes('2分前'));
    assert.ok(text.includes('koukun_'));
    assert.ok(text.includes('その鯖やばい'));
    assert.ok(text.includes('😂'));
    assert.ok(text.includes('3時間前'));
    assert.ok(text.includes('🎉'));
});

test('participation judge prompt delegates reaction pacing to the model with concrete guidance', () => {
    // 履歴が材料として渡されること
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('あなたの直近のリアクション'));
    // 間隔は固定ルールでなくモデルが文脈で判断すること
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('人間らしい間隔を自分で判断'));
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('秒数の決まりは無い'));
    // 直後の連打を避ける指針
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('直前に自分がリアクションしたばかり'));
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('全部の発言に付けるのは不自然'));
    // 話題が変われば短い間隔でもよい、という人間らしい緩和
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('前回から話題が変わった'));
    assert.ok(PARTICIPATION_JUDGE_SYSTEM_PROMPT.includes('間隔は時計ではなく文脈で判断'));
});

test('ambient system rules ban deflection with abstract words and require concrete words from the conversation', () => {
    // はぐらかし文の NG 例が生成プロンプトにも明記されていること
    assert.ok(AMBIENT_SYSTEM_RULES.includes('一般論ではぐらかさない'));
    assert.ok(AMBIENT_SYSTEM_RULES.includes('なんか技術的な話は、結構複雑な仕組みで動いてるんだよねぇ。'));
    assert.ok(AMBIENT_SYSTEM_RULES.includes('特定の技術的な実装については、なかなか情報掴みにくいんだよね。'));
    // 会話に出てきた具体的な単語を使う推奨と、同じ文型の繰り返し回避
    assert.ok(AMBIENT_SYSTEM_RULES.includes('具体的な単語（固有名詞や話題の語）を拾って使う'));
    assert.ok(AMBIENT_SYSTEM_RULES.includes('同じ文型・言い回しを繰り返さない'));
    // 雰囲気の一般論に落とさず、下書きの具体をそのまま言うこと
    assert.ok(AMBIENT_SYSTEM_RULES.includes('サーバーの雰囲気そのものへの感想'));
    assert.ok(AMBIENT_SYSTEM_RULES.includes('この鯖の魅力だよね'));
    assert.ok(AMBIENT_SYSTEM_RULES.includes('判定の下書きにあった具体（人名・物・出来事）をそのまま短く言う'));
});
