import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { renderQuoteCard } from '../src/core/media/QuoteCardRenderer.ts';

const SPECIAL_QUOTE = '### 𝒶𝓃𝒶𝓁!!!!! [69], 日本語 👨‍👩‍👧‍👦 e\u0301';
const SPECIAL_AUTHOR = '### 𝓎𝓍𝟝#';

test('Quoteカードは数学英数字・結合文字・絵文字を含むUnicode文字列を描画できる', async () => {
    const image = await renderQuoteCard({
        quote: SPECIAL_QUOTE,
        authorName: SPECIAL_AUTHOR,
        authorHandle: '𝓎𝓍𝟝#',
        style: 'mono',
        seed: 'quote-card-unicode-test',
    });

    const metadata = await sharp(image).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 675);

    const quoteArea = await sharp(image)
        .extract({ left: 625, top: 100, width: 500, height: 440 })
        .greyscale()
        .raw()
        .toBuffer();
    assert.ok(quoteArea.some(pixel => pixel > 180), 'Unicode文字が描画されている');
});

test('Quoteカードは特殊文字列ごとに異なる字形を出力する', async () => {
    const [special, replacement] = await Promise.all([
        renderQuoteCard({
            quote: SPECIAL_QUOTE,
            authorName: SPECIAL_AUTHOR,
            authorHandle: '𝓎𝓍𝟝#',
            style: 'mono',
            seed: 'same-layout',
        }),
        renderQuoteCard({
            quote: '### ����!!!!! [69], 日本語 � e�',
            authorName: '### ���#',
            authorHandle: '���#',
            style: 'mono',
            seed: 'same-layout',
        }),
    ]);

    const [specialPixels, replacementPixels] = await Promise.all([
        sharp(special).raw().toBuffer(),
        sharp(replacement).raw().toBuffer(),
    ]);
    assert.notDeepEqual(specialPixels, replacementPixels);
});