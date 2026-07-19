import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

import { imageEditorHandler } from '../src/core/ChatAIChannel/tools/imageEditor.ts';
import type { ChatAIToolContext } from '../src/core/ChatAIChannel/tools/types.ts';

async function contextWithImages(count = 1): Promise<{ context: ChatAIToolContext; work: string }> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-ai-editor-'));
    const work = path.join(root, 'work');
    const images = [];
    for (let index = 1; index <= count; index++) {
        const data = await sharp({ create: { width: 120, height: 80, channels: 4, background: index === 1 ? '#ff0000' : '#0000ff' } }).png().toBuffer();
        images.push({ index, author: 'tester', dataUrl: `data:image/png;base64,${data.toString('base64')}` });
    }
    return { context: { images, sandbox: { root, work, downloads: path.join(root, 'downloads'), uploads: path.join(root, 'uploads') }, generatedImages: [] }, work };
}

test('image_editorは添付画像へ文字と図形を追加してworkへ保存する', async () => {
    const { context, work } = await contextWithImages();
    const result = await imageEditorHandler({ source_image: 1, operations: [
        { type: 'shape', shape: 'rounded_rectangle', x: 5, y: 5, width: 80, height: 40, fill: '#ffffff', radius: 8 },
        { type: 'text', x: 10, y: 10, width: 70, height: 30, text: 'TEST', font_size: 18, color: '#000000' },
    ], output_name: 'card', format: 'png' }, context);

    assert.match(String(result), /^IMAGE_EDITOR_SUCCESS:/);
    assert.equal(context.generatedImages?.length, 1);
    const generated = context.generatedImages![0];
    assert.equal(generated.source, 'editor');
    assert.equal(path.dirname(generated.path!), work);
    const metadata = await sharp(generated.data).metadata();
    assert.equal(metadata.width, 120);
    assert.equal(metadata.height, 80);
    await fs.access(generated.path!);
});

test('image_editorは複数の添付素材を合成できる', async () => {
    const { context } = await contextWithImages(2);
    const result = await imageEditorHandler({ source_image: 1, operations: [
        { type: 'overlay', image: 2, x: 20, y: 10, width: 50, height: 50, fit: 'cover', opacity: 0.8 },
        { type: 'rotate', angle: 5, color: 'transparent' },
        { type: 'sharpen', sigma: 1 },
    ], format: 'webp' }, context);

    assert.match(String(result), /^IMAGE_EDITOR_SUCCESS:/);
    assert.equal(context.generatedImages?.[0].mimeType, 'image/webp');
});

test('image_editorは画像端からの切り抜きを有効範囲へ収める', async () => {
    const { context } = await contextWithImages();
    const result = await imageEditorHandler({
        source_image: 1,
        operations: [{ type: 'crop', x: 100, y: 60, width: 100, height: 100 }],
    }, context);

    assert.match(String(result), /^IMAGE_EDITOR_SUCCESS:/);
    const metadata = await sharp(context.generatedImages![0].data).metadata();
    assert.equal(metadata.width, 20);
    assert.equal(metadata.height, 20);
});

test('image_editorは存在しない素材番号を拒否する', async () => {
    const { context } = await contextWithImages();
    const result = await imageEditorHandler({ source_image: 1, operations: [{ type: 'overlay', image: 9 }] }, context);
    assert.match(String(result), /素材画像 9 が見つかりません/);
    assert.equal(context.generatedImages?.length, 0);
});

test('image_editorは傾きと色調エフェクトを適用できる', async () => {
    const { context } = await contextWithImages();
    const result = await imageEditorHandler({ source_image: 1, operations: [
        { type: 'skew', skew_x: 12, skew_y: -4, color: 'transparent' },
        { type: 'modulate', brightness: 1.1, saturation: 1.25, hue: 20 },
        { type: 'gamma', gamma: 1.2 },
    ], format: 'png' }, context);

    assert.match(String(result), /^IMAGE_EDITOR_SUCCESS:/);
    const metadata = await sharp(context.generatedImages![0].data).metadata();
    assert.ok((metadata.width ?? 0) > 120);
});

test('image_editorは作成済み画像を再編集・素材利用できる', async () => {
    const { context } = await contextWithImages();
    const first = await imageEditorHandler({ source_image: 1, operations: [{ type: 'grayscale' }] }, context);
    assert.match(String(first), /^IMAGE_EDITOR_SUCCESS:/);

    const second = await imageEditorHandler({ source_generated: 1, operations: [
        { type: 'overlay', generated_image: 1, x: 10, y: 5, width: 40, height: 30, opacity: 0.5 },
    ], format: 'webp', quality: 75 }, context);
    assert.match(String(second), /^IMAGE_EDITOR_SUCCESS:/);
    assert.equal(context.generatedImages?.length, 2);
    assert.equal(context.generatedImages?.[1].mimeType, 'image/webp');
});

test('image_editorはCSS風スタイルでサイズ・変形・フィルター・透過度を適用できる', async () => {
    const { context } = await contextWithImages();
    const result = await imageEditorHandler({ source_image: 1, operations: [{
        type: 'css',
        css: 'width: 60px; height: 40px; object-fit: contain; background-color: transparent; transform: rotate(5deg) scale(0.5); filter: brightness(110%) saturate(120%) blur(0.5px); opacity: 75%;',
    }], format: 'png' }, context);

    assert.match(String(result), /^IMAGE_EDITOR_SUCCESS:/);
    const metadata = await sharp(context.generatedImages![0].data).metadata();
    assert.ok((metadata.width ?? 0) > 30);
    assert.ok((metadata.height ?? 0) > 20);
    assert.equal(metadata.hasAlpha, true);
    const center = await sharp(context.generatedImages![0].data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const centerOffset = (Math.floor(center.info.height / 2) * center.info.width + Math.floor(center.info.width / 2)) * center.info.channels;
    assert.ok(center.data[centerOffset + 3] >= 185 && center.data[centerOffset + 3] <= 195);
});

test('image_editorは未知のCSS宣言を安全に無視する', async () => {
    const { context } = await contextWithImages();
    const result = await imageEditorHandler({ source_image: 1, operations: [{
        type: 'css',
        css: 'position: fixed; url: javascript:alert(1); unknown-property: value;',
    }] }, context);

    assert.match(String(result), /^IMAGE_EDITOR_SUCCESS:/);
    const metadata = await sharp(context.generatedImages![0].data).metadata();
    assert.equal(metadata.width, 120);
    assert.equal(metadata.height, 80);
});
