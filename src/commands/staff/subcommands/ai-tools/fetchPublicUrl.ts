import type { OpenAITool } from '../../../../types/openai.js';
import { fetchPublicPage } from '../../../../core/ai/PublicPageReader.js';

export const fetchPublicUrlDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'fetch_url',
        description: 'Web検索結果の正確なURLや指定された公開WebページをNode fetchで取得し、HTML本文をMarkdownで読む。Chrome不要。JSONやソースはmode:raw。JS描画が必要な場合だけ任意のmode:browserを利用（Chrome未導入なら失敗）。内向きIP・localhost・危険なリダイレクトは拒否。Discordメッセージはfetch_discord_messageを使用。',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '読む公開HTTP/HTTPS URL' },
                mode: { type: 'string', enum: ['readable', 'raw', 'browser'], description: 'readable（初期値）はNode fetchのHTML本文、rawはソース、browserは任意のChrome描画。' },
            },
            required: ['url'],
        },
    },
};

export const fetchPublicUrlHandler = fetchPublicPage;
