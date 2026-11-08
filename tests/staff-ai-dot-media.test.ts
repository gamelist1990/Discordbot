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

test('media rules forbid parroting the poster and content-free filler over described media', () => {
    // 2026-11-08 の実インシデントの返信が NG 例として両プロンプトに入っていること
    assert.match(AMBIENT_SYSTEM_RULES, /オウム返し/);
    assert.match(AMBIENT_SYSTEM_RULES, /相当な仕組みで組まれたんやな/);
    assert.match(PARTICIPATION_JUDGE_SYSTEM_PROMPT, /メディアの中身の具体/);
    assert.match(PARTICIPATION_JUDGE_SYSTEM_PROMPT, /なぞっただけの下書き/);
});
