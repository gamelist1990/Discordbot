import test from 'node:test';
import assert from 'node:assert/strict';
import {
    escapeHtml,
    jsonForScript,
    renderWebAuthErrorPage,
    renderWebAuthPage,
    renderWebAuthSuccessPage
} from '../src/web/webauth/page.ts';

const READY = {
    status: 'ready' as const,
    token: 'A'.repeat(43),
    guildId: '123',
    guildName: 'テスト <サーバー>',
    userId: '456',
    userName: 'user"name',
    browser: { allowed: true, browser: 'chrome' as const, reason: 'ok' as const },
    intel: { verdict: 'clean' as const, flags: [], source: 'ip-api.com', checkedAt: 0, cached: false },
    vpnBlocked: false,
    message: null
};

test('Discord-provided names are HTML-escaped', () => {
    assert.equal(escapeHtml('<script>"x"&\'</script>'), '&lt;script&gt;&quot;x&quot;&amp;&#39;&lt;/script&gt;');
});

test('inline JSON cannot break out of the script element', () => {
    const encoded = jsonForScript({ value: '</script><img src=x onerror=alert(1)>' });
    assert.equal(encoded.includes('</script>'), false);
    assert.equal(encoded.includes('<'), false);
    assert.equal(JSON.parse(encoded).value, '</script><img src=x onerror=alert(1)>');
});

test('the ready page includes the target, token and a nonce-bound script', () => {
    const html = renderWebAuthPage(READY, 'nonce-123');
    assert.ok(html.includes('テスト &lt;サーバー&gt;'));
    assert.ok(html.includes('user&quot;name'));
    assert.ok(html.includes('nonce="nonce-123"'));
    assert.ok(html.includes(READY.token));
    assert.ok(html.includes('認証する'));
    assert.equal(html.includes('テスト <サーバー>'), false);
    assert.equal(html.includes('/api/webauth/'), true);
});

test('a VPN-blocked page disables the button and explains why', () => {
    const html = renderWebAuthPage({
        ...READY,
        intel: { verdict: 'blocked', flags: ['proxy'], source: 'ip-api.com', checkedAt: 0, cached: false },
        vpnBlocked: true
    }, 'n');
    assert.ok(html.includes('VPN・プロキシ経由では認証できません'));
    assert.ok(html.includes('disabled'));
});

test('an unsupported browser page shows the Chrome/Edge requirement', () => {
    const html = renderWebAuthPage({
        ...READY,
        browser: { allowed: false, browser: null, reason: 'firefox' }
    }, 'n');
    assert.ok(html.includes('Firefox は非対応'));
});

test('error pages do not render the auth script', () => {
    for (const [status, needle] of [
        ['expired', '期限が切れました'],
        ['invalid', '認証リンクが無効'],
        ['in-use', '処理中']
    ] as const) {
        const html = renderWebAuthErrorPage(status, null, 'n');
        assert.ok(html.includes(needle), status);
        assert.equal(html.includes('<script'), false);
    }
});

test('success page reflects role grant failure without raw identifiers', () => {
    assert.ok(renderWebAuthSuccessPage(true, 'n').includes('認証ロールを付与しました'));
    assert.ok(renderWebAuthSuccessPage(false, 'n').includes('ロールの付与に失敗'));
});
