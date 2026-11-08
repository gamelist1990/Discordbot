import test from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyDotMedia,
    extractDotMedia,
    formatMediaNote,
    formatMediaNotes,
    DotMediaDescriptionStore,
    DOT_MEDIA_LIMITS,
    estimateVideoPromptTokens,
    estimateImagePromptTokens,
    planVideoFrames,
    planAudioChunks,
    mergeMediaDescriptions,
    looksLikeMediaRefusal,
    claimsSpeechContent,
    saysNoSpeech,
    formatClock,
    shouldTryNativeVideoFirst,
    NATIVE_VIDEO_MAX_ESTIMATED_TOKENS,
    type DotMediaItem,
    type DotMediaMessageLike,
} from '../src/core/ai/DotAmbientMedia.ts';
import {
    PARTICIPATION_JUDGE_SYSTEM_PROMPT,
    ADDRESSED_JUDGE_SYSTEM_PROMPT,
    AMBIENT_SYSTEM_RULES,
} from '../src/core/ai/StaffAIDotAmbient.ts';

test('classifyDotMedia prefers contentType and falls back to extension', () => {
    assert.equal(classifyDotMedia('image/png', 'x.bin'), 'image');
    assert.equal(classifyDotMedia('video/mp4; codecs="avc1"', 'x'), 'video');
    assert.equal(classifyDotMedia('audio/ogg', 'voice.bin'), 'audio');
    assert.equal(classifyDotMedia(null, 'photo.JPG'), 'image');
    assert.equal(classifyDotMedia('', 'clip.webm'), 'video');
    assert.equal(classifyDotMedia(undefined, 'voice.opus'), 'audio');
    assert.equal(classifyDotMedia('application/pdf', 'doc.pdf'), null);
    assert.equal(classifyDotMedia(null, 'archive.zip'), null);
});

function fakeMessage(overrides: Partial<DotMediaMessageLike> = {}): DotMediaMessageLike {
    return {
        id: '100000000000000001',
        attachments: [
            { id: 'a1', url: 'https://cdn.example/img.png', contentType: 'image/png', name: 'img.png', size: 1234 },
            { id: 'a2', url: 'https://cdn.example/doc.pdf', contentType: 'application/pdf', name: 'doc.pdf', size: 99 },
        ],
        ...overrides,
    };
}

test('extractDotMedia picks media attachments, snapshots and embeds, capped per message', () => {
    const items = extractDotMedia(fakeMessage());
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, 'image');
    assert.equal(items[0].key, '100000000000000001:a1');
    assert.equal(items[0].state, 'pending');

    const forwarded = extractDotMedia(fakeMessage({
        attachments: [],
        messageSnapshots: [{ attachments: [{ id: 's1', url: 'https://cdn.example/movie.mp4', contentType: 'video/mp4', name: 'movie.mp4' }] }],
        embeds: [{ image: { url: 'https://cdn.example/linked.webp' } }],
    }));
    assert.deepEqual(forwarded.map(item => item.kind), ['video', 'image']);

    const many = extractDotMedia(fakeMessage({
        attachments: Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, url: `https://cdn.example/${i}.png`, contentType: 'image/png', name: `${i}.png` })),
    }));
    assert.equal(many.length, DOT_MEDIA_LIMITS.maxItemsPerMessage);
});

test('formatMediaNotes renders descriptions and 未確認 placeholders', () => {
    const described: DotMediaItem = {
        key: 'm:1', messageId: 'm', kind: 'image', url: '', contentType: 'image/png', name: '',
        size: 0, state: 'described', description: 'フィギュアスケートのペアの写真',
    };
    assert.equal(formatMediaNote(described), '[画像: フィギュアスケートのペアの写真]');
    assert.equal(formatMediaNote({ ...described, state: 'pending', description: '' }), '[画像が添付されています（内容未確認）]');
    assert.equal(formatMediaNote({ ...described, kind: 'video', state: 'failed', description: '' }), '[動画が添付されています（内容未確認）]');
    assert.equal(formatMediaNote({ ...described, kind: 'audio', state: 'failed', description: '' }), '[音声が添付されています（内容未確認）]');
    assert.equal(formatMediaNotes([described, { ...described, kind: 'audio', state: 'pending', description: '' }]),
        '[画像: フィギュアスケートのペアの写真] [音声が添付されています（内容未確認）]');
    assert.equal(formatMediaNotes([]), '');
    assert.equal(formatMediaNotes(undefined), '');
});

test('DotMediaDescriptionStore describes each media once and caches it', async () => {
    let calls = 0;
    const store = new DotMediaDescriptionStore(async (item) => {
        calls += 1;
        return `${item.kind}の説明`;
    });
    const extracted = extractDotMedia(fakeMessage());
    const registered = store.register(extracted);
    // 再抽出しても同じ正規オブジェクトが返り、説明状態が引き継がれる
    assert.equal(store.register(extractDotMedia(fakeMessage()))[0], registered[0]);

    await store.ensure(registered, 2);
    assert.equal(calls, 1);
    assert.equal(registered[0].state, 'described');
    assert.equal(registered[0].description, 'imageの説明');
    assert.equal(store.notesForMessage('100000000000000001'), '[画像: imageの説明]');

    // 2回目の ensure では再説明しない
    await store.ensure(registered, 2);
    assert.equal(calls, 1);
});

test('DotMediaDescriptionStore respects the per-call limit and never retries failures', async () => {
    let calls = 0;
    const store = new DotMediaDescriptionStore(async () => {
        calls += 1;
        return null;
    });
    const items = store.register(extractDotMedia(fakeMessage({
        attachments: [0, 1, 2].map(i => ({ id: `v${i}`, url: `https://cdn.example/${i}.mp4`, contentType: 'video/mp4', name: `${i}.mp4` })),
    })));
    await store.ensure(items, 2);
    assert.equal(calls, 2);
    assert.deepEqual(items.map(item => item.state), ['failed', 'failed', 'pending']);
    // failed は再試行しない。pending の残りだけが進む
    await store.ensure(items, 2);
    assert.equal(calls, 3);
    assert.deepEqual(items.map(item => item.state), ['failed', 'failed', 'failed']);
});

test('DotMediaDescriptionStore shares in-flight descriptions between concurrent ensure calls', async () => {
    let calls = 0;
    let release: (value: string) => void = () => undefined;
    const store = new DotMediaDescriptionStore(() => {
        calls += 1;
        return new Promise<string>(resolve => { release = resolve; });
    });
    const items = store.register(extractDotMedia(fakeMessage()));
    const first = store.ensure(items, 1);
    const second = store.ensure(items, 1);
    release('同時実行でも1回だけ');
    await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(items[0].state, 'described');
});

test('judge and generation prompts carry the media-reading guidance', () => {
    assert.match(PARTICIPATION_JUDGE_SYSTEM_PROMPT, /\[画像: …\]/);
    assert.match(PARTICIPATION_JUDGE_SYSTEM_PROMPT, /AIかと思った/);
    assert.match(ADDRESSED_JUDGE_SYSTEM_PROMPT, /AIかと思った/);
    assert.match(AMBIENT_SYSTEM_RULES, /添付メディアは \[画像: …\]/);
});

test('video routing: incident-size screen recordings go to the frames path, small clips may go native', () => {
    // 2026-11-08 の実インシデント: 27.3秒・1918x1078・7.5MB の画面録画。
    // video_url では 96,237 トークンに展開され枠（32,768）超過で 400 になった実測がある。
    const incident = { durationSec: 27.266, width: 1918, height: 1078 };
    assert.ok(estimateVideoPromptTokens(incident) > 90_000);
    assert.equal(shouldTryNativeVideoFirst(incident, 7_482_973), false);

    // 小さく短いクリップはネイティブを先に試してよい
    const small = { durationSec: 5, width: 1280, height: 720 };
    assert.ok(estimateVideoPromptTokens(small) <= NATIVE_VIDEO_MAX_ESTIMATED_TOKENS);
    assert.equal(shouldTryNativeVideoFirst(small, 2_000_000), true);
    // ファイルが大きい・長い・寸法不明のものはフレーム経路（安全側）
    assert.equal(shouldTryNativeVideoFirst(small, 9_000_000), false);
    assert.equal(shouldTryNativeVideoFirst({ durationSec: 30, width: 640, height: 360 }, 1_000_000), false);
    assert.equal(shouldTryNativeVideoFirst(null, 1_000), false);
    assert.equal(estimateVideoPromptTokens({ durationSec: 0, width: 640, height: 360 }), Number.POSITIVE_INFINITY);
});

test('planVideoFrames scales frame count with duration inside the token budget', () => {
    // 実インシデント動画（27.3秒・1918x1078）: 約3.5秒に1枚で 8 枚、旧6枚固定より多い
    const incident = planVideoFrames({ durationSec: 27.266, width: 1918, height: 1078 });
    assert.equal(incident.count, 8);
    assert.ok(incident.intervalSec > 3 && incident.intervalSec < 3.6);

    // 3分の動画: 間隔どおりなら52枚だが、推定トークン上限で絞られ、枠内に収まる
    const long = planVideoFrames({ durationSec: 180, width: 1920, height: 1080 });
    const perFrame = estimateImagePromptTokens(1024, 576);
    assert.ok(long.count * perFrame <= DOT_MEDIA_LIMITS.videoFrameTokenBudget + perFrame);
    assert.ok(long.count >= DOT_MEDIA_LIMITS.videoFrameMinCount);
    assert.ok(long.count < 52);

    // 短い動画は最低枚数を確保する
    const short = planVideoFrames({ durationSec: 10, width: 640, height: 360 });
    assert.equal(short.count, DOT_MEDIA_LIMITS.videoFrameMinCount);

    // 長さ不明は最低枚数（間隔は決められないので 0）
    assert.deepEqual(planVideoFrames({ durationSec: 0, width: 640, height: 360 }),
        { count: DOT_MEDIA_LIMITS.videoFrameMinCount, intervalSec: 0 });
});

test('planAudioChunks splits long audio at the chunk size and caps the count', () => {
    assert.deepEqual(planAudioChunks(27), [{ startSec: 0, durationSec: 27 }]);
    assert.deepEqual(planAudioChunks(700), [
        { startSec: 0, durationSec: 300 },
        { startSec: 300, durationSec: 300 },
        { startSec: 600, durationSec: 100 },
    ]);
    const capped = planAudioChunks(60 * 60);
    assert.equal(capped.length, DOT_MEDIA_LIMITS.audioMaxChunks);
    // 長さ不明は全体を1チャンク（durationSec 0 = 末尾まで）
    assert.deepEqual(planAudioChunks(0), [{ startSec: 0, durationSec: 0 }]);
});

test('mergeMediaDescriptions combines visual and audio, tolerating either side missing', () => {
    assert.equal(mergeMediaDescriptions('映像の説明', '音声の説明'), '映像の説明 音声: 音声の説明');
    assert.equal(mergeMediaDescriptions('映像の説明', null), '映像の説明');
    assert.equal(mergeMediaDescriptions(null, '音声の説明'), '（映像は確認できなかった）音声: 音声の説明');
    assert.equal(mergeMediaDescriptions(null, null), null);
    assert.equal(mergeMediaDescriptions('  ', ''), null);
});

test('looksLikeMediaRefusal catches false refusals but not legitimate silence notes', () => {
    // 2026-11-08 の実測で観測された誤拒否（音声は実際に渡っていた）
    assert.equal(looksLikeMediaRefusal('申し訳ありません、音声が提供されていないため、内容を説明することができません。'), true);
    assert.equal(looksLikeMediaRefusal('提供された音声ファイルが再生できないため、内容を説明することができません。'), true);
    assert.equal(looksLikeMediaRefusal('音声ファイルをご提供いただければ、その内容を説明いたします。'), true);
    // 正当な説明・無音への言及は拒否ではない
    assert.equal(looksLikeMediaRefusal('音声には、音楽と、何かのノイズが聞こえます。'), false);
    assert.equal(looksLikeMediaRefusal('提供された音声ファイルは無音またはノイズのみのようです。そのため、具体的な内容を説明することができません。'), false);
    assert.equal(looksLikeMediaRefusal('男性がサーバーの設定について話している。'), false);
});

test('speech claim detection and transcription verdict parsing', () => {
    // 2026-11-08 の実測で観測された創作発言（無発言の録画音声に対する説明）
    assert.equal(claimsSpeechContent('男性が「はい、ありがとうございます。では本日の議題についてご説明します」と話しています。'), true);
    assert.equal(claimsSpeechContent('女性の話し声が中心で、穏やかなトーンで話されています。'), true);
    assert.equal(claimsSpeechContent('はい、音声には、女性の声が聞こえます。'), true);
    assert.equal(claimsSpeechContent('音声には、音楽と、何かのノイズが聞こえます。'), false);
    assert.equal(claimsSpeechContent('穏やかなインストゥルメンタル音楽が流れています。'), false);

    assert.equal(saysNoSpeech('発言なし'), true);
    assert.equal(saysNoSpeech('この音声に発言は含まれていないようです。'), true);
    assert.equal(saysNoSpeech('男性が「こんにちは」と挨拶している。'), false);
});

test('formatClock renders m:ss', () => {
    assert.equal(formatClock(0), '0:00');
    assert.equal(formatClock(65), '1:05');
    assert.equal(formatClock(600), '10:00');
});

test('describe budgets are thick enough to actually read the content', () => {
    // 2026-11-08 のユーザー指示（トークン予算を増やして良い）に基づく下限
    assert.ok(DOT_MEDIA_LIMITS.videoDescribeMaxTokens >= 1500);
    assert.ok(DOT_MEDIA_LIMITS.audioDescribeMaxTokens >= 1500);
    assert.ok(DOT_MEDIA_LIMITS.imageDescribeMaxTokens >= 1000);
    assert.ok(DOT_MEDIA_LIMITS.descriptionMaxLength >= 2000);
});

test('media rules forbid parroting the poster and content-free filler over described media', () => {
    // 2026-11-08 の実インシデントの返信が NG 例として両プロンプトに入っていること
    assert.match(AMBIENT_SYSTEM_RULES, /オウム返し/);
    assert.match(AMBIENT_SYSTEM_RULES, /相当な仕組みで組まれたんやな/);
    assert.match(PARTICIPATION_JUDGE_SYSTEM_PROMPT, /メディアの中身の具体/);
    assert.match(PARTICIPATION_JUDGE_SYSTEM_PROMPT, /なぞっただけの下書き/);
});
