import type { OpenAITool, ToolHandler } from '../../../types/openai.js';
import type { ChatAIToolRegistrar } from './types.js';
import { config } from '../../../config.js';

export const webSearchDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'web_search',
        description: 'PEX Serverで複数検索元を一括照会し、必要に応じて内部で検索語も整理します。最新情報や事実確認に使います。空結果・障害・既取得の情報しか得られない場合は同じ検索や言い換えを無限に繰り返さず、確認できない点を明示して回答してください。',
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
    warnings?: string[];
    searched_at?: string;
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
        if (!Array.isArray(data.results)) return 'SEARCH_ERROR: 検索APIの応答形式が不正です。結果0件とは区別してください。';
        const results = data.results;
        if (results.length === 0) {
            const unavailable = Array.isArray(data.errors) && data.errors.length > 0;
            const detail = unavailable ? data.errors.map(error => `${error.engine}: ${error.message}`).join(' / ').slice(0, 700) : '';
            return `${unavailable ? 'SEARCH_UNAVAILABLE' : 'SEARCH_EMPTY'}: ${unavailable ? '検索元の障害を伴い、情報を取得できませんでした' : '今回の検索では一致する結果を取得できませんでした'}: ${query}${detail ? `\n${detail}` : ''}\n情報が存在しない証拠ではありません。同じ検索や言い換えを無限に繰り返さず、確認できなければ未確認と伝えて回答を終えてください。`;
        }

        const output = results.map(entry =>
            `${entry.rank}. [${entry.title}](${entry.url})\n   ${entry.snippet}\n   検索元: ${entry.engine}`,
        );
        if (Array.isArray(data.errors) && data.errors.length > 0) {
            output.push('', `一部検索元のエラー: ${data.errors.map(error => `${error.engine}: ${error.message}`).join(' / ')}`);
        }
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
            output.push(`検索時の注意: ${data.warnings.join(' / ').slice(0, 1200)}`);
        }
        if (data.searched_at) output.push(`検索日時: ${data.searched_at}`);
        return output.join('\n');
    } catch (error) {
        return `SEARCH_ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
};

export const registerWebSearchTool: ChatAIToolRegistrar = (manager) => {
    manager.registerTool(webSearchDefinition, webSearchHandler);
};
