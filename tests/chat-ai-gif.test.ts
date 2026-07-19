import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { createGifContactSheet } from '../src/core/ChatAIChannel/ChatAIChannelManager.ts';

test('アニメーションGIFを代表フレームのPNGコンタクトシートへ変換する', async () => {
    const width = 32;
    const height = 24;
    const frameSize = width * height * 4;
    const frames = [
        { r: 255, g: 0, b: 0 },
        { r: 0, g: 255, b: 0 },
        { r: 0, g: 0, b: 255 },
    ];
    const raw = Buffer.alloc(frameSize * frames.length);
    frames.forEach((color, page) => {
        for (let offset = page * frameSize; offset < (page + 1) * frameSize; offset += 4) {
            raw[offset] = color.r;
            raw[offset + 1] = color.g;
            raw[offset + 2] = color.b;
            raw[offset + 3] = 255;
        }
    });
    const gif = await sharp(raw, {
        raw: { width, height: height * frames.length, channels: 4 },
        pageHeight: height,
    }).gif({ delay: [100, 100, 100], loop: 0 }).toBuffer();

    const sheet = await createGifContactSheet(gif);
    assert.ok(sheet);
    const metadata = await sharp(sheet!).metadata();
    assert.equal(metadata.format, 'png');
    assert.ok((metadata.width || 0) > (metadata.height || 0));
});

test('静止GIFも認識可能なPNGへ変換する', async () => {
    const gif = await sharp({
        create: { width: 40, height: 30, channels: 4, background: '#ff00ff' },
    }).gif().toBuffer();
    const sheet = await createGifContactSheet(gif);
    assert.ok(sheet);
    assert.equal((await sharp(sheet!).metadata()).format, 'png');
});