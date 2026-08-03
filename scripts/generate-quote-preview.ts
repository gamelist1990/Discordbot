import { writeFileSync } from 'node:fs';
import { renderQuoteCard } from '../src/core/media/QuoteCardRenderer.js';

const image = await renderQuoteCard({
    quote: 'できるかどうかではなく、やるかどうか。',
    authorName: 'サンプルユーザー',
    authorHandle: 'sample_user',
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    style: 'mono',
    seed: 'preview-quote-card',
});

writeFileSync('./quote-card-preview.png', image);
console.log('Created: quote-card-preview.png');