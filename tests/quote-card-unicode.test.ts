import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import { renderQuoteCard } from '../src/core/media/QuoteCardRenderer.ts';

const SPECIAL_QUOTE = '### 𝒶𝓃𝒶𝓁!!!!! [69], 日本語 👨‍👩‍👧‍👦 e\u0301';
const SPECIAL_AUTHOR = '### 𝓎𝓍𝟝#';

test('Quoteカード用数学UnicodeフォントをOSに依存せず同梱している', () => {
    const fontPath = path.resolve('assets/fonts/STIXTwoMath-Regular.otf');
    const licensePath = path.resolve('assets/fonts/STIXTwoMath-OFL.txt');

    assert.equal(fs.existsSync(fontPath), true);
    assert.equal(fs.existsSync(licensePath), true);
    assert.ok(fs.statSync(fontPath).size > 100_000, '有効なSTIX Two Mathフォントである');
});

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

test('QuoteカードはOG画像をリンクプレビュー背景として描画できる', async () => {
    const ogImage = await sharp({
        create: {
            width: 800,
            height: 420,
            channels: 4,
            background: '#2f6feb',
        },
    }).png().toBuffer();

    const card = await renderQuoteCard({
        quote: 'リンク先の紹介です',
        authorName: 'テストユーザー',
        authorHandle: 'preview_test',
        linkPreview: {
            siteName: 'example.com',
            title: '自然なレイアウトのOGリンクプレビュー',
            description: 'OG画像を背景にし、その上へ読みやすいタイトルと説明を表示します。',
            imageUrl: `data:image/png;base64,${ogImage.toString('base64')}`,
        },
        style: 'mono',
        seed: 'og-preview-background',
    });

    const metadata = await sharp(card).metadata();
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 675);

    const previewPixel = await sharp(card)
        .extract({ left: 760, top: 70, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer();
    assert.ok(previewPixel[2] > previewPixel[0], 'OG画像の青い背景色が反映されている');
});