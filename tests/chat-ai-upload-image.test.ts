import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_DISCORD_FILE_BYTES, uploadImageHandler } from '../src/core/ChatAIChannel/tools/uploadImage.ts';
import type { ChatAIToolContext } from '../src/core/ChatAIChannel/tools/types.ts';

function makeContext(images: Buffer[]): { context: ChatAIToolContext; sent: any[] } {
    const sent: any[] = [];
    const channel = {
        isTextBased: () => true,
        send: async (payload: any) => {
            sent.push(payload);
            return payload;
        },
    };
    const context: ChatAIToolContext = {
        channelId: 'channel-test',
        client: {
            channels: {
                fetch: async () => channel,
            },
        } as any,
        generatedImages: images.map((data, index) => ({
            source: 'youtube',
            data,
            mimeType: 'image/jpeg',
            filename: `scene-${index + 1}.jpg`,
            description: `scene ${index + 1}`,
        })),
        uploadedImageIndices: new Set<number>(),
    };
    return { context, sent };
}

test('upload_imageは選択した画像をDiscord添付として送信する', async () => {
    const { context, sent } = makeContext([Buffer.from('image-a'), Buffer.from('image-b')]);
    const result = await uploadImageHandler({ image_indices: [1, 2], caption: '名シーン' }, context);

    assert.match(String(result), /^UPLOAD_IMAGE_SUCCESS:/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].content, '名シーン');
    assert.deepEqual(sent[0].files.map((file: any) => file.name), ['scene-1.jpg', 'scene-2.jpg']);
    assert.deepEqual([...context.uploadedImageIndices!], [1, 2]);
});

test('upload_imageは同じ画像の重複送信を拒否する', async () => {
    const { context, sent } = makeContext([Buffer.from('image')]);
    const first = await uploadImageHandler({ image_indices: [1] }, context);
    const second = await uploadImageHandler({ image_indices: [1] }, context);

    assert.match(String(first), /^UPLOAD_IMAGE_SUCCESS:/);
    assert.match(String(second), /送信済み/);
    assert.equal(sent.length, 1);
});

test('upload_imageは単体または合計10MiB超過を送信しない', async () => {
    const single = makeContext([Buffer.alloc(MAX_DISCORD_FILE_BYTES + 1)]);
    const singleResult = await uploadImageHandler({ image_indices: [1] }, single.context);
    assert.match(String(singleResult), /上限10MiB/);
    assert.equal(single.sent.length, 0);

    const combined = makeContext([
        Buffer.alloc(Math.floor(MAX_DISCORD_FILE_BYTES / 2) + 1),
        Buffer.alloc(Math.floor(MAX_DISCORD_FILE_BYTES / 2) + 1),
    ]);
    const combinedResult = await uploadImageHandler({ image_indices: [1, 2] }, combined.context);
    assert.match(String(combinedResult), /合計.*上限10MiB/);
    assert.equal(combined.sent.length, 0);
});

test('upload_imageは候補がない場合にyoutube_detailsの先行実行を求める', async () => {
    const { context, sent } = makeContext([]);
    const result = await uploadImageHandler({ image_indices: [1] }, context);

    assert.match(String(result), /先にyoutube_details/);
    assert.equal(sent.length, 0);
});
