import type { OpenAITool, ToolHandler } from '../../../types/openai.js';
import type { ChatAIToolRegistrar } from './types.js';
import { assertSafeHttpUrl } from './urlSafety.js';

const webSearchDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'web_search_bing',
        description: 'Bing検索結果をMarkdownで返します。最新情報や調査が必要な時に使います。',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '検索語句' },
                limit: { type: 'number', description: '最大結果数。既定は5、最大8。' },
            },
            required: ['query'],
        },
    },
};

const webSearchHandler: ToolHandler = async (args) => {
    const query = String(args?.query ?? '').trim();
    const limit = Math.min(Math.max(Number(args?.limit ?? 5), 1), 8);
    if (!query) return '検索語句が空です。';

    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=ja-JP`;
    const safe = await assertSafeHttpUrl(url);
    if (!safe.ok) return `BLOCKED: ${safe.reason}`;

    try {
        const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 PexisChatAI/1.0' } });
        const html = await response.text();
        const results = parseBingResults(html).slice(0, limit);
        if (results.length === 0) {
            return `Bing検索結果を抽出できませんでした: ${query}`;
        }
        return results.map((entry, index) => `${index + 1}. [${entry.title}](${entry.url})\n   ${entry.snippet}`).join('\n');
    } catch (error) {
        return `SEARCH_ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
};

export const registerWebSearchBingTool: ChatAIToolRegistrar = (manager) => {
    manager.registerTool(webSearchDefinition, webSearchHandler);
};

function parseBingResults(html: string): Array<{ title: string; url: string; snippet: string }> {
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const itemRegex = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi;
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(html)) && results.length < 10) {
        const url = decodeHtml(match[1]);
        const title = stripHtml(match[2]);
        const snippet = stripHtml(match[3] || '');
        if (url.startsWith('http') && title) {
            results.push({ title, url, snippet });
        }
    }
    return results;
}

function stripHtml(value: string): string {
    return decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeHtml(value: string): string {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}
