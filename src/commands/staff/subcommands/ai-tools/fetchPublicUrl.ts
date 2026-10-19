import * as cheerio from 'cheerio';
import type { OpenAITool, ToolHandler } from '../../../../types/openai.js';
import { assertSafeHttpUrl } from '../../../../core/ChatAIChannel/tools/urlSafety.js';

const MAX_BYTES = 512 * 1024;
const MAX_CHARS = 16000;

export const fetchPublicUrlDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'fetch_url',
        description: 'Web検索結果のURLや指定された公開Webページへ直接アクセスして本文を読む。HTMLをMarkdown風に抽出、JSONやソースはrawで取得。内向きIP・localhost・危険なリダイレクトは拒否。Discordメッセージはfetch_discord_messageを使用。',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '読む公開HTTP/HTTPS URL' },
                mode: { type: 'string', enum: ['readable', 'raw'], description: 'readable（初期値）はHTML本文抽出、rawはHTML/JSON/テキストの生データ。' },
            },
            required: ['url'],
        },
    },
};

function htmlToReadable(html: string): string {
    const $ = cheerio.load(html);
    const title = $('title').first().text().trim();
    $('script,style,svg,noscript,iframe,form,nav,header,footer,aside').remove();
    const root = $('main,article,[role=main]').first();
    const parent = root.length ? root : $('body');
    const lines: string[] = [];
    parent.find('h1,h2,h3,h4,p,pre,li,blockquote').each((_, element) => {
        const type = element.tagName.toLowerCase();
        const text = $(element).text().replace(/[ \t]+/g, ' ').trim();
        if (text) lines.push((/^h[1-4]$/.test(type) ? '#'.repeat(Number(type[1])) + ' ' : type === 'li' ? '- ' : '') + text.slice(0, 2400));
    });
    return ['Title: ' + title, ...lines].filter(Boolean).join('\n\n') || parent.text().replace(/\s+/g, ' ').trim();
}

export const fetchPublicUrlHandler: ToolHandler = async (args) => {
    let url = String(args?.url ?? '').trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
        for (let n = 0; n <= 4; n++) {
            const safe = await assertSafeHttpUrl(url);
            if (!safe.ok) return 'FETCH_BLOCKED: ' + safe.reason;
            const response = await fetch(url, {
                redirect: 'manual', signal: controller.signal,
                headers: { 'user-agent': 'PEXServerStaffAI/1.0' },
            });
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get('location');
                if (!location || n === 4) return 'FETCH_ERROR: リダイレクトの解決に失敗しました。';
                url = new URL(location, url).toString();
                await response.body?.cancel().catch(() => undefined);
                continue;
            }
            const type = response.headers.get('content-type') ?? '';
            if (!/^(text\/|application\/(?:json|xml|javascript|[^;]*\+json))/i.test(type)) {
                await response.body?.cancel().catch(() => undefined);
                return 'FETCH_UNSUPPORTED: HTTP ' + response.status + ' Content-Type: ' + type + ' (テキスト以外は読み込めません)';
            }
            const reader = response.body?.getReader();
            const buffers: Buffer[] = [];
            let total = 0, truncated = false;
            if (reader) {
                try {
                    for (;;) {
                        const next = await reader.read();
                        if (next.done) break;
                        const buffer = Buffer.from(next.value);
                        const left = MAX_BYTES - total;
                        if (buffer.length >= left) {
                            buffers.push(buffer.subarray(0, Math.max(0, left)));
                            total += Math.min(left, buffer.length);
                            truncated = true;
                            break;
                        }
                        buffers.push(buffer);
                        total += buffer.length;
                    }
                } finally {
                    if (truncated) await reader.cancel().catch(() => undefined);
                    reader.releaseLock();
                }
            }
            const raw = Buffer.concat(buffers, total).toString('utf8');
            const readable = args?.mode === 'raw' || !/html/i.test(type) ? raw : htmlToReadable(raw);
            return [
                'URL: ' + url, 'HTTP: ' + response.status, 'Content-Type: ' + type,
                'Read bytes: ' + total + (truncated ? ' (truncated)' : ''),
                'Mode: ' + (args?.mode === 'raw' ? 'raw' : 'readable'), '',
                readable.slice(0, MAX_CHARS),
                readable.length > MAX_CHARS ? '[truncated]' : '',
            ].join('\n');
        }
        return 'FETCH_ERROR: 上限を超えるリダイレクトです。';
    } catch (error) {
        return 'FETCH_ERROR: ' + (error instanceof Error ? error.message : String(error)).slice(0, 200);
    } finally {
        clearTimeout(timer);
    }
};
