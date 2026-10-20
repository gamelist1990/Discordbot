import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

/** Extract body structure from HTML without inventing content from title/metadata. */
export function htmlPageMarkdown(html: string, baseUrl: string): {title: string; markdown: string; hasScripts: boolean} {
    const $ = cheerio.load(html);
    const title = $('title').first().text().replace(/\s+/g, ' ').trim();
    const hasScripts = $('script[src],script:not([type="application/ld+json"])').length > 0;
    $('script,style,noscript,svg,iframe,form,nav,footer,aside,[hidden],[aria-hidden="true"]').remove();
    $('body > header').remove();
    const selected = $('main,article,[role=main]').first();
    const root = selected.length ? selected : $('body');
    function render(node: AnyNode, depth = 0): string {
        if (depth > 80) return '';
        if (node.type === 'text') return node.data.replace(/\s+/g, ' ');
        if (!('tagName' in node)) return '';
        const element = node as Element;
        const tag = element.tagName.toLowerCase();
        if (tag === 'pre') {
            const code = $(element).text().trim();
            const fence = '`'.repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map(match => match[0].length + 1)));
            return `\n\n${fence}\n${code}\n${fence}\n\n`;
        }
        if (tag === 'table') {
            const rows = $(element).find('tr').slice(0, 30).toArray().map(row => $(row).children('th,td').slice(0, 12)
                .toArray().map(cell => $(cell).text().replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()));
            const width = Math.max(0, ...rows.map(row => row.length));
            if (!width) return '';
            const lines = rows.map(row => '| ' + Array.from({length: width}, (_, i) => row[i] || '').join(' | ') + ' |');
            lines.splice(1, 0, '| ' + Array(width).fill('---').join(' | ') + ' |');
            return '\n\n' + lines.join('\n') + '\n\n';
        }
        const content = $(element).contents().toArray().map(child => render(child, depth + 1)).join('');
        if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${content.trim()}\n\n`;
        if (tag === 'a') {
            try {
                const target = new URL($(element).attr('href') || '', baseUrl);
                if (['http:', 'https:'].includes(target.protocol) && content.trim()) {
                    return `[${content.trim().replace(/[\[\]]/g, '\\$&')}](<${target.href.replace(/</g, '%3C').replace(/>/g, '%3E')}>)`;
                }
            } catch { /* Preserve link text when href is invalid. */ }
            return content;
        }
        if (tag === 'br') return '\n';
        if (tag === 'hr') return '\n\n---\n\n';
        if (tag === 'li') return '\n- ' + content.trim() + '\n';
        if (tag === 'blockquote') return '\n\n' + content.trim().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
        if (tag === 'strong' || tag === 'b') return content.trim() ? `**${content.trim()}**` : '';
        if (tag === 'em' || tag === 'i') return content.trim() ? `*${content.trim()}*` : '';
        if (tag === 'code') return '`' + content.replace(/`/g, '\\`').trim() + '`';
        return /^(p|div|section|article|main|ul|ol|dl|dt|dd)$/.test(tag) ? '\n\n' + content.trim() + '\n\n' : content;
    }
    const markdown = root.contents().toArray().map(node => render(node)).join('')
        .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return {title, markdown, hasScripts};
}
