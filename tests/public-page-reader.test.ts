import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { fetchPublicPage } from '../src/core/ai/PublicPageReader.ts';
import { toolResultError } from '../src/core/ai/ToolResultStatus.ts';
import { toolResultSummary } from '../src/core/ai/ToolResultSummary.ts';

async function fixture(body: unknown, args: Record<string, unknown> = {mode: 'browser'}, status = 200) {
    const originalFetch = globalThis.fetch;
    const originalLookup = dns.lookup;
    dns.lookup = (async () => [{address: '93.184.216.34', family: 4}]) as any;
    globalThis.fetch = (async (_url, init) => {
        if (args.mode === 'browser') {
            assert.equal(init?.method, 'POST');
            assert.equal(JSON.parse(String(init?.body)).url, 'https://example.com/article');
            return new Response(JSON.stringify(body), {status});
        }
        assert.equal(String(_url), args.url || 'https://example.com/article');
        assert.equal(init?.redirect, 'manual');
        return new Response(String(body), {status, headers: {'content-type': 'text/html'}});
    }) as typeof fetch;
    try { return String(await fetchPublicPage({url: 'https://example.com/article', ...args})); }
    finally { globalThis.fetch = originalFetch; dns.lookup = originalLookup; }
}

test('Optional browser mode uses Chrome Markdown with source metadata and actual body counts', async () => {
    const markdown = '# Source\n\n' + '実際のページから取得した本文です。'.repeat(8);
    const result = await fixture({status: 'ok', markdown, final_url: 'https://example.com/source',
        http_status: 200, title: 'Actual source', fetched_at: '2026-10-21T00:00:00Z'});
    assert.equal(toolResultError(result), undefined);
    assert.match(result, /Headless Chrome/);
    assert.match(result, /Final URL: https:\/\/example.com\/source/);
    assert.match(result, /実際のページから取得した本文/);
    assert.match(toolResultSummary('fetch_url', {}, result), /ページ本文/);
});

test('Title-only and tiny bodies, challenges and HTTP errors must not be successful fetches', async () => {
    for (const markdown of ['', 'Title: ', '# title']) {
        const result = await fixture({status: 'ok', markdown});
        assert.match(result, /^FETCH_ERROR: BODY_EMPTY:/);
        assert.ok(toolResultError(result));
        assert.match(toolResultSummary('fetch_url', {}, result), /本文なし/);
    }
    const cases = [
        ['HTTP 403', 'HTTP_403', 'HTTP 403'],
        ['Google News aggregator: original article URL could not be resolved', 'NEWS_AGGREGATOR', '元記事'],
        ['blocked: CAPTCHA or access challenge', 'ACCESS_CHALLENGE', 'CAPTCHA'],
        ['page timeout', 'TIMEOUT', 'タイムアウト'],
        ['getaddrinfo ENOTFOUND unknown.example', 'DNS_NOT_FOUND', 'DNS解決失敗'],
    ];
    for (const [error, code, summary] of cases) {
        const result = await fixture({status: 'unavailable', error});
        assert.ok(result.startsWith(`FETCH_ERROR: ${code}:`), result);
        assert.ok(toolResultError(result));
        assert.ok(toolResultSummary('fetch_url', {}, result).includes(summary));
    }
    const unresolved = await fixture({status: 'ok', markdown: '本文らしいテキスト'.repeat(15),
        final_url: 'https://news.google.com/rss/articles/encoded'});
    assert.match(unresolved, /^FETCH_ERROR: NEWS_AGGREGATOR:/);
});

test('An old or unavailable EndPoint cannot be mistaken for a publisher HTTP error', async () => {
    const result = await fixture({}, {mode: 'browser'}, 404);
    assert.match(result, /^FETCH_ERROR: BROWSER_UNAVAILABLE:/);
    assert.match(toolResultSummary('fetch_url', {}, result), /Chrome取得サービス/);
});

test('Raw mode rejects HTTP failure and preserves source output only on success', async () => {
    const failed = await fixture('<h1>Forbidden</h1>', {mode: 'raw'}, 403);
    assert.match(failed, /^FETCH_ERROR: HTTP_403:/);
    const success = await fixture('<h1>Actual HTML source</h1>', {mode: 'raw'});
    assert.match(success, /Mode: raw/);
    assert.match(success, /<h1>Actual HTML source<\/h1>/);
});

test('Private URLs remain blocked before any browser endpoint request', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('network must not be called'); }) as typeof fetch;
    try { assert.match(String(await fetchPublicPage({url: 'http://127.0.0.1/'})), /^FETCH_BLOCKED:/); }
    finally { globalThis.fetch = original; }
});


test('Default readable mode uses Node fetch without any Chrome endpoint and extracts structured Markdown', async () => {
    const output = await fixture('<title>Original page</title><nav>IGNORE_NAVIGATION</nav><main>'
        + '<h1>実際の本文</h1><p>公開ページからHTTPで直接取得した情報です。'.repeat(4) + '</p>'
        + '<h2>詳しい情報</h2><a href="/source">出典</a><table><tr><th>品名</th><th>価格</th></tr><tr><td>RAM</td><td>123</td></tr></table>'
        + '</main><script>IGNORE_SCRIPT</script>', {});
    assert.equal(toolResultError(output), undefined);
    assert.match(output, /Mode: readable \(Node fetch\)/);
    assert.match(output, /# 実際の本文/);
    assert.match(output, /## 詳しい情報/);
    assert.match(output, /\[出典\]\(<https:\/\/example.com\/source>\)/);
    assert.match(output, /\| 品名 \| 価格 \|/);
    assert.doesNotMatch(output, /IGNORE_NAVIGATION|IGNORE_SCRIPT/);
});

test('Node HTML extraction never counts the title as article content and detects JS-only shells', async () => {
    assert.match(await fixture('<title>Only metadata</title><body></body>', {}), /^FETCH_ERROR: BODY_EMPTY:/);
    assert.match(await fixture('<title>JS app</title><body><div id="app"></div><script src="app.js"></script></body>', {}), /^FETCH_ERROR: JS_REQUIRED:/);
    assert.match(await fixture('<title>Just a moment</title><p>Verify you are human CAPTCHA</p>', {}), /^FETCH_ERROR: ACCESS_CHALLENGE:/);
    assert.match(await fixture('<p>Forbidden HTML body</p>', {}, 403), /^FETCH_ERROR: HTTP_403:/);
});


test('Default Node fetch does not treat Google News wrapper HTML as publisher content', async () => {
    const output = await fixture('<title>Google News</title><main><p>News navigation and unrelated aggregator content.'.repeat(4) + '</p></main>',
        {url: 'https://news.google.com/rss/articles/encoded'});
    assert.match(output, /^FETCH_ERROR: NEWS_AGGREGATOR:/);
});

test('Node fetch checks redirects before accessing private network destinations', async () => {
    const originalFetch = globalThis.fetch;
    const originalLookup = dns.lookup;
    dns.lookup = (async () => [{address: '93.184.216.34', family: 4}]) as any;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response(null, {status: 302, headers: {location: 'http://127.0.0.1/secret'}}); }) as typeof fetch;
    try {
        assert.match(String(await fetchPublicPage({url: 'https://example.com/article'})), /^FETCH_BLOCKED:/);
        assert.equal(calls, 1);
    } finally { globalThis.fetch = originalFetch; dns.lookup = originalLookup; }
});
