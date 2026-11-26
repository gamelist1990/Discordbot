import test from 'node:test';
import assert from 'node:assert/strict';
import {
    browserRequirementMessage,
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
    message: null,
    challenge: {
        id: 'challenge-1',
        instruction: '★（星）を ゴール へ ドラッグ',
        correctItemId: 'item-a',
        items: [
            { id: 'item-a', symbol: '★', label: '星', x: 60, y: 60, size: 44 },
            { id: 'item-b', symbol: '■', label: '四角', x: 180, y: 160, size: 44 }
        ],
        target: { id: 'target', label: 'ゴール', x: 260, y: 60, size: 64 },
        field: { width: 320, height: 220 },
        issuedAt: 0
    },
    challengePassed: false,
    attemptsLeft: 5
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

test('the drag check renders tiles, the goal and a disabled submit button', () => {
    const html = renderWebAuthPage(READY, 'n');
    assert.ok(html.includes('★（星）を ゴール へ ドラッグ'));
    assert.ok(html.includes('id="ch-field"'));
    assert.ok(html.includes('data-item-id=') === false, 'tiles are built by JS (CSP blocks style attributes)');
    assert.ok(html.includes('"item-a"'));
    assert.ok(html.includes('"item-b"'));
    assert.ok(html.includes('ゴール'));
    assert.ok(html.includes('/api/webauth/'));
    assert.ok(html.includes('challenge'));
    // The submit button starts disabled until the drag check passes.
    assert.ok(/id="auth-button"[^>]*disabled/.test(html));
});

test('a passed drag check removes the field and enables the submit button', () => {
    const html = renderWebAuthPage({
        ...READY,
        challenge: null,
        challengePassed: true
    }, 'n');
    assert.ok(html.includes('操作チェックは完了しています'));
    assert.equal(html.includes('data-item-id='), false);
    assert.ok(/id="auth-button"[^>]*disabled/.test(html) === false);
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

test('an unsupported browser page shows the Chrome/Edge/Safari requirement', () => {
    const html = renderWebAuthPage({
        ...READY,
        browser: { allowed: false, browser: null, reason: 'firefox' }
    }, 'n');
    assert.ok(html.includes('Firefox は非対応'));
    assert.ok(html.includes('Safari'));
});

test('Safari is a supported browser on the auth page', () => {
    const html = renderWebAuthPage({
        ...READY,
        browser: { allowed: true, browser: 'safari', reason: 'ok' }
    }, 'n');
    assert.equal(/id="auth-button"[^>]*disabled/.test(html), true, 'the drag gate still disables submit');
    assert.equal(html.includes('class="features"'), false, 'no keyword chips above the button');
    assert.equal(html.includes('Firefox は非対応'), false);
    assert.equal(browserRequirementMessage({ allowed: false, browser: null, reason: 'unsupported-webkit' }).includes('Safari'), true);
});

test('the page embeds the shared browser gate and messages', () => {
    const html = renderWebAuthPage(READY, 'n');
    assert.ok(html.includes('evaluateBrowserUserAgent'));
    assert.ok(html.includes('browserRequirementMessage'));
});

test('the page is styled with the staff theme and a Safari-safe font stack', () => {
    const html = renderWebAuthPage(READY, 'n');
    assert.ok(html.includes('#faf9f6'), 'site background');
    assert.ok(html.includes('#59534b'), 'site accent');
    assert.ok(html.includes('#302e2b'), 'site ink');
    assert.ok(html.includes('IBM Plex Sans JP'));
    assert.ok(html.includes('fonts.googleapis.com'));
    assert.ok(html.includes('prefers-color-scheme:dark'), 'dark scheme mirrors global.css');
    assert.ok(html.includes('touch-action:none'));
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
