import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderQuoteCard } from '../src/core/media/QuoteCardRenderer.js';

const commonOptions = {
    quote: 'できるかどうかではなく、やるかどうか。',
    authorName: 'サンプルユーザー',
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