import type { OpenAITool, ToolHandler } from '../../../types/openai.js';
import type { ChatAIToolRegistrar } from './types.js';
import { assertSafeHttpUrl } from './urlSafety.js';

const MAX_FETCH_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 12_000;

const fetchUrlDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'fetch_url',
        description: '安全なHTTP/HTTPS URLだけを取得し、本文をMarkdown向けに短く返します。ローカルIP、プライベートIP、危険なリンクは拒否します。',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '取得するHTTP/HTTPS URL' },
            },
            required: ['url'],
        },
    },
};

const fetchUrlHandler: ToolHandler = async (args) => {
    const url = String(args?.url ?? '').trim();
    const safe = await assertSafeHttpUrl(url);
    if (!safe.ok) return `BLOCKED: ${safe.reason}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'user-agent': 'PexisChatAI/1.0' },
        });
        const contentType = response.headers.get('content-type') ?? 'unknown';
        const buffer = Buffer.from(await response.arrayBuffer());
        const sliced = buffer.subarray(0, MAX_FETCH_BYTES);
        const text = sliced.toString('utf8').replace(/\s+/g, ' ').trim();
        return [
            `URL: ${url}`,
            `Status: ${response.status}`,
            `Content-Type: ${contentType}`,
            `Bytes: ${buffer.byteLength}${buffer.byteLength > MAX_FETCH_BYTES ? ' (truncated)' : ''}`,
            '',
            text.slice(0, 8000),
        ].join('\n');
    } catch (error) {
        return `FETCH_ERROR: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
        clearTimeout(timeout);
    }
};

export const registerFetchUrlTool: ChatAIToolRegistrar = (manager) => {
    manager.registerTool(fetchUrlDefinition, fetchUrlHandler);
};
