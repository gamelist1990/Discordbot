import type { OpenAITool, ToolHandler } from '../../../types/openai.js';
import type { ChatAIToolRegistrar } from './types.js';
import { config } from '../../../config.js';

const webSearchDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'web_search',
        description: 'PEX Serverの複数検索元を統合したWeb検索を実行します。最新情報や調査が必要な時に使います。',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '検索語句' },
                count: { type: 'number', description: '返す統合結果数。既定は10、1～20。' },
                country: { type: 'string', description: '2文字の国コード。例: JP' },
                language: { type: 'string', description: 'BCP 47形式の言語。例: ja-JP' },
                engines: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '使用する検索元。省略時は有効な全検索元を使用。',
                },
                offset: { type: 'number', description: '各検索元で読み飛ばす件数。0～100。' },
                safe_search: { type: 'boolean', description: 'セーフサーチ。既定はtrue。' },
            },
            required: ['query'],
        },
    },
};

interface WebSearchResult {
    rank: number;
    title: string;
    url: string;
    snippet: string;
    engine: string;
    display_url?: string | null;
}

interface WebSearchResponse {
    query: string;
    count: number;
    engines: string[];
    results: WebSearchResult[];
    errors: Array<{ engine: string; message: string }>;
}

export const webSearchHandler: ToolHandler = async (args) => {
    const query = String(args?.query ?? '').trim();
    if (!query) return '検索語句が空です。';

    const count = Math.min(Math.max(Math.trunc(Number(args?.count ?? 10)) || 10, 1), 20);
    const offset = Math.min(Math.max(Math.trunc(Number(args?.offset ?? 0)) || 0, 0), 100);
    const endpoint = `${config.pexAi.endpoint.replace(/\/$/, '')}/web/search`;
    const body = {
        query,
        count,
        offset,
        safe_search: args?.safe_search !== false,
        ...(typeof args?.country === 'string' && args.country.trim() ? { country: args.country.trim() } : {}),
        ...(typeof args?.language === 'string' && args.language.trim() ? { language: args.language.trim() } : {}),
        ...(Array.isArray(args?.engines)
            ? { engines: args.engines.filter((engine: unknown): engine is string => typeof engine === 'string' && engine.trim().length > 0) }
            : {}),
    };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(config.pexAi.apiKey ? { authorization: `Bearer ${config.pexAi.apiKey}` } : {}),
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
            const detail = (await response.text()).slice(0, 500);
            return `SEARCH_ERROR: PEX Server HTTP ${response.status}${detail ? `: ${detail}` : ''}`;
        }
        const data = await response.json() as WebSearchResponse;
        const results = Array.isArray(data.results) ? data.results : [];
        if (results.length === 0) return `Web検索結果がありませんでした: ${query}`;

        const output = results.map(entry =>
            `${entry.rank}. [${entry.title}](${entry.url})\n   ${entry.snippet}\n   検索元: ${entry.engine}`,
        );
        if (Array.isArray(data.errors) && data.errors.length > 0) {
            output.push('', `一部検索元のエラー: ${data.errors.map(error => `${error.engine}: ${error.message}`).join(' / ')}`);
        }
        return output.join('\n');
    } catch (error) {
        return `SEARCH_ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
};

export const registerWebSearchTool: ChatAIToolRegistrar = (manager) => {
    manager.registerTool(webSearchDefinition, webSearchHandler);
};
