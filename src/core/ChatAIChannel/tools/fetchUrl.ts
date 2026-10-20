import type { OpenAITool } from '../../../types/openai.js';
import type { ChatAIToolRegistrar } from './types.js';
import { fetchPublicPage } from '../../ai/PublicPageReader.js';

const fetchUrlDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'fetch_url',
        description: '公開HTTP/HTTPS URLをNode fetchで取得し、HTML本文をMarkdownで返します。Chrome不要。JS描画が必要な場合だけ任意のbrowserモードを使用。検索結果のURLを正確に使用してください。ローカルIP、プライベートIP、危険なリンクは拒否します。',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '取得するHTTP/HTTPS URL' },
                mode: { type: 'string', enum: ['readable', 'raw', 'browser'], description: 'readableはNode fetchのHTML本文、rawはソース、browserは任意のChrome描画。' },
            },
            required: ['url'],
        },
    },
};

export const registerFetchUrlTool: ChatAIToolRegistrar = manager => {
    manager.registerTool(fetchUrlDefinition, fetchPublicPage);
};
