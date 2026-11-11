import type { OpenAIChatManager } from './OpenAIChatManager.js';
import { webSearchDefinition, webSearchHandler } from '../ChatAIChannel/tools/webSearchBing.js';

/**
 * Trigger an actual public web lookup for direct search requests. Do not treat
 * ordinary conversation, server-message search or tool capability questions as
 * instructions to browse. The model can still choose web_search on its own.
 */
export function dotWebResearchQuery(message: string): string | null {
    const text = message.replace(/<@!?\d+>/g, '').trim();
    if (!text || text.length < 4) return null;
    if (/^(?:web|ウェブ|ネット)?検索(?:ツール)?(?:は|って|を)?(?:使える|できる|可能|対応)[？?]?$/i.test(text)) return null;
    if (/^(?:https?:\/\/\S+)$/.test(text)) return null;
    const explicit = /(?:web|ウェブ|ネット|インターネット|google|グーグル).{0,12}(?:検索|調べ|調査|探し|探して|確認)/iu.test(text)
        || /(?:検索|調べ|調査|探し|確認).{0,8}(?:して|しよう|してみて|してほしい|してください|お願い|くれ|たい|ちょうだい)/u.test(text)
        || /(?:ググって|検索して|調べて|調査して|ソースを探して|公式(?:発表|サイト|情報).*確認して)/u.test(text);
    const fresh = /(?:今日|最新|最近|直近|今週|新着|速報).{0,35}(?:ニュース|発表|情報|更新|価格|仕様|アップデート|動向|何か|どうなった)/u.test(text)
        || /(?:ニュース|正式発表).{0,24}(?:教えて|まとめて|知りたい|調べて)/u.test(text);
    return explicit || fresh ? text.slice(0, 350) : null;
}

/** Give ambient Dot only public search, not privileged Staff tools. */
export function registerDotWebSearchTool(manager: Pick<OpenAIChatManager, 'registerTool'>): void {
    manager.registerTool(webSearchDefinition, async (args) => {
        const count = Number(args?.count);
        const result = await webSearchHandler({
            ...args,
            count: Number.isFinite(count) ? Math.max(1, Math.min(5, Math.floor(count))) : 4,
            country: typeof args?.country === 'string' ? args.country : 'JP',
            language: typeof args?.language === 'string' ? args.language : 'ja-JP',
            safe_search: true,
        });
        return String(result).slice(0, 8500);
    });
}

export async function runDotWebSearch(query: string): Promise<string> {
    return String(await webSearchHandler({
        query, count: 4, country: 'JP', language: 'ja-JP', safe_search: true,
    })).slice(0, 8500);
}
