import { htmlPageMarkdown } from './HtmlPageMarkdown.js';
import { config } from '../../config.js';
import { assertSafeHttpUrl } from '../ChatAIChannel/tools/urlSafety.js';
import type { ToolHandler } from '../../types/openai.js';

const MAX_BYTES = 512 * 1024;
const MAX_CHARS = 16000;

function browserFailure(reason: string): string {
    const code = /Google News aggregator/i.test(reason) ? 'NEWS_AGGREGATOR'
        : /empty|insufficient.*body/i.test(reason) ? 'BODY_EMPTY'
        : /ENOTFOUND|EAI_AGAIN|DNS/i.test(reason) ? 'DNS_NOT_FOUND'
        : /timeout|timed out/i.test(reason) ? 'TIMEOUT'
        : /HTTP\s+(\d{3})/i.test(reason) ? `HTTP_${reason.match(/HTTP\s+(\d{3})/i)![1]}`
        : /captcha|challenge|access denied/i.test(reason) ? 'ACCESS_CHALLENGE'
        : /blocked.*private|blocked.*local|blocked.*public/i.test(reason) ? 'PRIVATE_NETWORK'
        : /unsupported content type/i.test(reason) ? 'UNSUPPORTED_TYPE' : 'BROWSER_UNAVAILABLE';
    return `FETCH_ERROR: ${code}: ${reason.slice(0, 300)}\n本文は確認できていません。URLを推測して改変せず、検索結果やユーザー指定の正確なリンクを使ってください。`;
}

async function readBrowser(url: string): Promise<string> {
    try {
        const response = await fetch(`${config.pexAi.endpoint.replace(/\/$/, '')}/web/read`, {
            method: 'POST', headers: {'content-type': 'application/json',
                ...(config.pexAi.apiKey ? {authorization: `Bearer ${config.pexAi.apiKey}`} : {})},
            body: JSON.stringify({url}), signal: AbortSignal.timeout(25_000),
        });
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            return `FETCH_ERROR: BROWSER_UNAVAILABLE: Chrome取得API HTTP ${response.status}。EndPointのビルド・再起動と /v1/web/read を確認してください。本文は取得していません。`;
        }
        const page = await response.json() as {status?: string; markdown?: string; error?: string;
            final_url?: string; title?: string; http_status?: number; fetched_at?: string};
        if (page.status !== 'ok') return browserFailure(page.error || 'browser returned no successful page');
        if (typeof page.http_status === 'number' && page.http_status >= 400) return browserFailure(`HTTP ${page.http_status}`);
        const body = typeof page.markdown === 'string' ? page.markdown.trim() : '';
        if (body.replace(/\s/g, '').length < 40 || /^Title:\s*$/i.test(body)) return browserFailure('empty or insufficient page body');
        const finalUrl = page.final_url || url;
        if (new URL(finalUrl).hostname === 'news.google.com' && /^\/(?:rss\/)?(?:articles|read)\//.test(new URL(finalUrl).pathname)) {
            return browserFailure('Google News aggregator did not resolve to publisher');
        }
        const clean = (value: string) => value.replace(/[\r\n]/g, ' ');
        return [`URL: ${clean(url)}`, `Final URL: ${clean(finalUrl)}`, `HTTP: ${page.http_status ?? 200}`,
            'Mode: readable (Headless Chrome)', `Body characters: ${body.length}`,
            ...(page.title ? [`Title: ${clean(page.title)}`] : []),
            ...(page.fetched_at ? [`Fetched at: ${clean(page.fetched_at)}`] : []), '',
            body.slice(0, MAX_CHARS), body.length > MAX_CHARS ? '[truncated]' : ''].join('\n');
    } catch (error) { return browserFailure(error instanceof Error ? error.message : String(error)); }
}

/** Node fetch is the default. Browser rendering is an explicit, optional mode. */
export const fetchPublicPage: ToolHandler = async args => {
    let url = String(args?.url ?? '').trim();
    const initial = await assertSafeHttpUrl(url);
    if (!initial.ok) return initial.reason.includes('DNS解決に失敗')
        ? 'FETCH_ERROR: DNS_NOT_FOUND: ホスト名を解決できません。検索結果のURLを正確に使い、URLを推測して作成しないでください。'
        : 'FETCH_BLOCKED: ' + initial.reason;
    if (args?.mode === 'browser') return readBrowser(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
        for (let n = 0; n <= 4; n++) {
            const safe = await assertSafeHttpUrl(url);
            if (!safe.ok) return 'FETCH_BLOCKED: ' + safe.reason;
            const response = await fetch(url, {redirect: 'manual', signal: controller.signal,
                headers: {'user-agent': 'PEXServerStaffAI/1.0'}});
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get('location');
                await response.body?.cancel().catch(() => {});
                if (!location || n === 4) return 'FETCH_ERROR: REDIRECT: リダイレクトを解決できません。';
                url = new URL(location, url).toString();
                continue;
            }
            if (!response.ok) {
                await response.body?.cancel().catch(() => {});
                return `FETCH_ERROR: HTTP_${response.status}: 本文を取得できませんでした。`;
            }
            const type = response.headers.get('content-type') ?? '';
            if (!/^(text\/|application\/(?:json|xml|javascript|[^;]*\+json))/i.test(type)) {
                await response.body?.cancel().catch(() => {});
                return `FETCH_UNSUPPORTED: HTTP ${response.status} Content-Type: ${type}`;
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
                        buffers.push(buffer.subarray(0, left));
                        total += Math.min(left, buffer.length);
                        if (buffer.length >= left) { truncated = true; break; }
                    }
                } finally {
                    if (truncated) await reader.cancel().catch(() => {});
                    reader.releaseLock();
                }
            }
            const raw = Buffer.concat(buffers, total).toString('utf8');
            if (!raw.trim()) return 'FETCH_ERROR: BODY_EMPTY: レスポンス本文が空です。';
            const current = new URL(url);
            if (args?.mode !== 'raw' && current.hostname === 'news.google.com'
                && /^\/(?:rss\/)?(?:articles|read)\//.test(current.pathname)) {
                return 'FETCH_ERROR: NEWS_AGGREGATOR: Google Newsの集約URLで元記事の本文を取得できません。元記事の正確なURLを使用してください。';
            }
            const parsed = args?.mode !== 'raw' && /html/i.test(type) ? htmlPageMarkdown(raw, url) : undefined;
            const body = parsed?.markdown ?? raw;
            if (!body.trim()) return parsed?.hasScripts
                ? 'FETCH_ERROR: JS_REQUIRED: HTMLに記事本文がありません。JavaScript描画が必要な可能性があります。browserモードは任意で、Chrome未導入なら使えません。'
                : 'FETCH_ERROR: BODY_EMPTY: HTMLから本文を取得できません。タイトルやメタデータは本文として数えません。';
            if (parsed && (/^(just a moment|access denied|verify you are human|robot check)/i.test(parsed.title)
                || body.length < 3000 && /captcha|verify (that )?you are human|unusual traffic|人間であることを確認/i.test(body))) {
                return 'FETCH_ERROR: ACCESS_CHALLENGE: サイトが認証・CAPTCHAを表示しており、記事本文を取得できません。';
            }
            if (parsed && body.replace(/\s/g, '').length < 40) return 'FETCH_ERROR: BODY_EMPTY: HTML本文が短すぎるため、記事本文を確認できていません。';
            return [`URL: ${url}`, `HTTP: ${response.status}`, `Content-Type: ${type}`,
                `Read bytes: ${total}${truncated ? ' (truncated)' : ''}`,
                `Mode: ${args?.mode === 'raw' ? 'raw' : 'readable (Node fetch)'}`,
                ...(parsed?.title ? [`Title: ${parsed.title}`] : []), `Body characters: ${body.length}`, '',
                body.slice(0, MAX_CHARS), body.length > MAX_CHARS ? '[truncated]' : ''].join('\n');
        }
        return 'FETCH_ERROR: REDIRECT: リダイレクト上限です。';
    } catch (error) {
        return controller.signal.aborted ? 'FETCH_ERROR: TIMEOUT: HTTP取得がタイムアウトしました。'
            : 'FETCH_ERROR: NETWORK_ERROR: ' + (error instanceof Error ? error.message : String(error)).slice(0, 240);
    }
    finally { clearTimeout(timer); }
};
