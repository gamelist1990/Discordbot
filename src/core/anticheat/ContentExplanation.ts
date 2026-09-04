import { escapeMarkdown } from 'discord.js';

export function normalizeContentExplanation(value: string): string {
    return Array.from(value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 80).join('');
}

export function displayContentExplanation(value: string): string {
    return escapeMarkdown(value).replace(/@/g, '@\u200b');
}
