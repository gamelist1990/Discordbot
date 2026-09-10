import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import {
    formatMentionAIContext,
    MENTION_AI_HISTORY_LIMIT,
    MENTION_AI_SUPPORT_MODEL,
} from '../src/core/ai-support/MentionAISupportManager.ts';

const message = (id: string, timestamp: number, content: string, author: string) => ({
    id,
    content,
    createdTimestamp: timestamp,
    author: { id: author, bot: false, username: author, displayName: author },
    member: { displayName: author },
    attachments: { size: 0, map: () => [] },
});

test('メンションAIは設定されたVLモデルに固定される', () => {
    assert.equal(MENTION_AI_SUPPORT_MODEL, 'gemma4-e4b-it-qat');
    assert.equal(MENTION_AI_HISTORY_LIMIT, 8);
});

test('周辺会話をDiscordの新しい順取得から時系列へ並べ直す', () => {
    const formatted = formatMentionAIContext([
        message('2', 2_000, '@bot どう思う？', '相談者'),
        message('1', 1_000, 'この案で進めたい', '参加者'),
    ] as any, 'bot');

    assert.ok(formatted.indexOf('この案で進めたい') < formatted.indexOf('@bot どう思う？'));
    assert.match(formatted, /1970-01-01T00:00:01\.000Z/);
});

test('Botの過去回答はAIアシスタントとして表記する', () => {
    const botMessage = message('1', 1_000, '前回の回答', 'bot');
    botMessage.author.bot = true;
    const formatted = formatMentionAIContext([botMessage] as any, 'bot');
    assert.match(formatted, /AIアシスタント: 前回の回答/);
});

test('返信先のDiscord画像を取得してVLモデル用data URLへ変換する', async () => {
    const originalFetch = globalThis.fetch;
    const png = await sharp({
        create: { width: 24, height: 24, channels: 3, background: '#3366cc' },
    }).png().toBuffer();
    globalThis.fetch = (async () => new Response(png, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(png.length) },
    })) as typeof fetch;
    try {
        const manager = new (await import('../src/core/ai-support/MentionAISupportManager.ts')).MentionAISupportManager();
        const referenced = {
            ...message('reply', 1_000, '', 'user'),
            attachments: new Map([['image', {
                id: 'image', name: 'sample.png', contentType: 'image/png', size: png.length,
                url: 'https://cdn.discordapp.com/attachments/test/sample.png',
            }]]),
        };
        const current = { ...message('current', 2_000, '@bot 何が見える？', 'user'), attachments: new Map() };
        const images = await (manager as any).prepareImages(current, {
            messages: [current],
            referenced,
        });

        assert.equal(images.length, 1);
        assert.equal(images[0].messageId, 'reply');
        assert.equal(images[0].filename, 'sample.png');
        assert.match(images[0].dataUrl, /^data:image\/jpeg;base64,/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('生成中テキストへ点滅カーソルを付ける', async () => {
    const manager = new (await import('../src/core/ai-support/MentionAISupportManager.ts')).MentionAISupportManager();
    assert.equal((manager as any).streamingContent('回答中', true), '回答中 ▌');
    assert.equal((manager as any).streamingContent('回答中', false), '回答中 \u200b');
    assert.equal((manager as any).streamingContent('', true), '▌');
});

test('ストリームの最初と最後のチャンクをDiscordへリアルタイム反映する', async () => {
    const manager = new (await import('../src/core/ai-support/MentionAISupportManager.ts')).MentionAISupportManager();
    const edits: string[] = [];
    let finalFields: any[] = [];
    (manager as any).chatManager = {
        streamResponseText: async (_prompt: unknown, onDelta: (delta: any) => void) => {
            onDelta({ type: 'thinking', text: '内部推論' });
            onDelta({ type: 'text', text: '回答' });
            onDelta({ type: 'text', text: 'の続き' });
            onDelta({ type: 'usage', inputTokens: 120, outputTokens: 30, totalTokens: 150 });
        },
    };
    const responseMessage = {
        edit: async ({ embeds }: { embeds: any[] }) => {
            edits.push(embeds[0].data.description);
            finalFields = embeds[0].data.fields || [];
        },
    };
    const input = {
        reply: async () => responseMessage,
        channel: { send: async () => undefined },
    };

    await (manager as any).streamReply(input, []);

    assert.equal(edits[0], '回答 ▌');
    assert.ok(edits.every(content => !content.includes('内部推論')));
    assert.ok(edits.some(content => content.includes('回答の続き')));
    assert.equal(edits.at(-1), '回答の続き');
    assert.equal(finalFields.find(field => field.name === 'トークン（入力 / 出力 / 合計）')?.value, '120 / 30 / 150');
    assert.match(finalFields.find(field => field.name === '出力速度')?.value, /tok\/s$/);
});

test('Typingループは直ちに通知し停止できる', async () => {
    const manager = new (await import('../src/core/ai-support/MentionAISupportManager.ts')).MentionAISupportManager();
    let calls = 0;
    const stop = await (manager as any).startTypingLoop({
        sendTyping: async () => { calls += 1; },
    });
    assert.equal(calls, 1);
    stop();
});
