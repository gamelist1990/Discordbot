import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    renderWebAuthErrorPage,
    renderWebAuthPage,
    renderWebAuthSuccessPage
} from '../src/web/webauth/page.ts';

const FONT_DIR = fileURLToPath(new URL('../src/web/webauth/fonts/', import.meta.url));
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
    challenge: null,
    challengePassed: true,
    attemptsLeft: 5
};

test('every WebAuth page variant loads fonts from the bot origin only', () => {
    const pages = {
        auth: renderWebAuthPage(READY, 'n'),
        success: renderWebAuthSuccessPage(true, 'n'),
        error: renderWebAuthErrorPage('expired', null, 'n')
    };
    for (const [variant, html] of Object.entries(pages)) {
        assert.ok(html.includes('/webauth/fonts/fonts.css'), `${variant} page links the local stylesheet`);
        assert.equal(/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html), false, `${variant} page has no Google Fonts reference`);
        const externalUrls = html.match(/https?:\/\/[^\s"'<>]+/g) || [];
        assert.deepEqual(externalUrls, [], `${variant} page must not reference a third-party origin`);
    }
});

test('the local stylesheet only points at local woff2 files that exist', () => {
    const css = readFileSync(path.join(FONT_DIR, 'fonts.css'), 'utf8');
    assert.equal(/https?:\/\//.test(css), false, 'no absolute URLs in the stylesheet');
    const references = [...css.matchAll(/url\(\.\/([^)]+)\)/g)].map((match) => match[1]);
    assert.ok(references.length === 516, `expected 516 @font-face sources, got ${references.length}`);
    const missing = [...new Set(references)].filter((file) => !existsSync(path.join(FONT_DIR, file)));
    assert.deepEqual(missing, []);
    const families = new Set([...css.matchAll(/font-family: '([^']+)'/g)].map((match) => match[1]));
    assert.deepEqual([...families].sort(), ['IBM Plex Sans', 'IBM Plex Sans JP']);
    for (const weight of [400, 500, 600, 700]) {
        assert.ok(css.includes(`font-weight: ${weight};`), `weight ${weight} is mirrored`);
    }
    assert.ok((css.match(/@font-face/g) || []).length === 516);
    assert.ok(readdirSync(FONT_DIR).some((file) => file.endsWith('.woff2')), 'font files are committed');
    assert.ok(existsSync(path.join(FONT_DIR, 'OFL.txt')), 'OFL license ships with the fonts');
});
