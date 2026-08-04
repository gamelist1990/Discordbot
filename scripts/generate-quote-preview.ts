import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderQuoteCard } from '../src/core/media/QuoteCardRenderer.js';

const commonOptions = {
    quote: 'https://www.jpcert.or.jp/tips/2009/wr093901.html',
    authorName: '𝓎𝓍𝟝#𝟚',
    authorHandle: 'sample_user',
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    style: 'mono',
    seed: 'preview-quote-card',
} as const;

const avatarImage = await renderQuoteCard(commonOptions);
writeFileSync('./quote-card-preview.png', avatarImage);
console.log('Created: quote-card-preview.png');

const attachedImage = await renderQuoteCard({
    ...commonOptions,
    contentImageUrl: path.resolve('assets/logo/hiru.png'),
    seed: 'preview-quote-card-with-image',
});

writeFileSync('./quote-card-preview-with-image.png', attachedImage);
console.log('Created: quote-card-preview-with-image.png');

const ogPreviewImage = await renderQuoteCard({
    ...commonOptions,
    quote: 'JPCERT/CCのセキュリティ情報を共有します。',
    linkPreview: {
        siteName: 'JPCERT Coordination Center',
        title: 'インターネット定点観測システムに関する情報',
        description: 'OG画像を背景として使用するリンクプレビューの表示確認です。',
        imageUrl: path.resolve('assets/logo/hiru.png'),
    },
    seed: 'preview-quote-card-with-og-image',
});

writeFileSync('./quote-card-preview-with-og-image.png', ogPreviewImage);
console.log('Created: quote-card-preview-with-og-image.png');