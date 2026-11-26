import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBrowserGate, evaluateBrowserUserAgent, parseBrandHeader } from '../src/core/webauth/browserGate.ts';

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const IOS_SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI_UA = 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const CRIOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1';
const FXIOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15';
const EDGIOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/131.0.0.0 Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME_BRANDS = [
    { brand: 'Google Chrome', version: '131' },
    { brand: 'Chromium', version: '131' },
    { brand: 'Not_A Brand', version: '24' }
];
const EDGE_BRANDS = [
    { brand: 'Microsoft Edge', version: '131' },
    { brand: 'Chromium', version: '131' },
    { brand: 'Not_A Brand', version: '24' }
];

test('desktop Chrome and Edge are accepted', () => {
    assert.deepEqual(
        evaluateBrowserGate({ userAgent: CHROME_UA, brands: CHROME_BRANDS }),
        { allowed: true, browser: 'chrome', reason: 'ok' }
    );
    assert.deepEqual(
        evaluateBrowserGate({ userAgent: EDGE_UA, brands: EDGE_BRANDS }),
        { allowed: true, browser: 'edge', reason: 'ok' }
    );
    assert.equal(evaluateBrowserGate({ userAgent: CHROME_UA }).allowed, true);
    assert.equal(evaluateBrowserGate({ userAgent: EDGE_UA }).browser, 'edge');
});

test('UA-CH header alone is enough to confirm Chrome', () => {
    const hint = '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"';
    assert.deepEqual(parseBrandHeader(hint).map((brand) => brand.brand), [
        'Chromium', 'Google Chrome', 'Not_A Brand'
    ]);
    assert.equal(evaluateBrowserGate({ userAgent: CHROME_UA, clientHint: hint }).allowed, true);
    assert.equal(evaluateBrowserGate({ userAgent: CHROME_UA, clientHint: '"Chromium";v="131"' }).allowed, true);
});

test('the Safari family is accepted without UA-CH', () => {
    for (const ua of [SAFARI_UA, IOS_SAFARI_UA, IPAD_SAFARI_UA, CRIOS_UA, FXIOS_UA, EDGIOS_UA]) {
        assert.deepEqual(
            evaluateBrowserUserAgent(ua, []),
            { allowed: true, browser: 'safari', reason: 'ok' },
            ua
        );
    }
    // Safari sends no Sec-CH-UA; the branch decides from the UA alone and is
    // deliberately not invalidated by a (spoofed) brand list.
    assert.equal(
        evaluateBrowserGate({ userAgent: SAFARI_UA, brands: CHROME_BRANDS }).browser,
        'safari'
    );
    assert.equal(evaluateBrowserGate({ userAgent: IOS_SAFARI_UA, clientHint: '' }).allowed, true);
});

test('desktop Firefox and unknown WebKit shells are rejected', () => {
    assert.equal(evaluateBrowserGate({ userAgent: FIREFOX_UA }).reason, 'firefox');
    // Google app / DuckDuckGo / other iOS WebKit shells are not the Safari
    // family the flow supports.
    const gsa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/335.0.0.0 Mobile/15E148 Safari/604.1';
    assert.equal(evaluateBrowserGate({ userAgent: gsa }).reason, 'unsupported-webkit');
    const duckDuckGo = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 DuckDuckGo/7';
    assert.equal(evaluateBrowserGate({ userAgent: duckDuckGo }).reason, 'unsupported-webkit');
    // Android's stock WebKit browser is not Safari.
    const androidWebKit = 'Mozilla/5.0 (Linux; U; Android 4.4.2; ja-jp; Nexus 5 Build/KOT49H) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30';
    assert.equal(evaluateBrowserGate({ userAgent: androidWebKit }).reason, 'unsupported-webkit');
});

test('in-app webviews and other Chromium browsers are rejected', () => {
    const webview = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36';
    assert.equal(evaluateBrowserGate({ userAgent: webview }).reason, 'in-app-webview');
    const line = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Line/14.0';
    assert.equal(evaluateBrowserGate({ userAgent: line }).reason, 'in-app-webview');
    const instagram = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0';
    assert.equal(evaluateBrowserGate({ userAgent: instagram }).reason, 'in-app-webview');
    const opera = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/115.0.0.0';
    assert.equal(evaluateBrowserGate({ userAgent: opera }).reason, 'unsupported-chromium');
    const samsung = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/131.0.0.0 Mobile Safari/537.36';
    assert.equal(evaluateBrowserGate({ userAgent: samsung }).reason, 'unsupported-chromium');
    // Brave keeps the Chrome UA but advertises its own brand.
    assert.equal(evaluateBrowserGate({
        userAgent: CHROME_UA,
        brands: [
            { brand: 'Brave', version: '131' },
            { brand: 'Chromium', version: '131' },
            { brand: 'Not_A Brand', version: '24' }
        ]
    }).reason, 'unsupported-chromium');
});

test('the gate source can be embedded in the page script unchanged', () => {
    // page.ts embeds Function#toString() of the gate so the client cannot
    // drift from the server decision.
    const embedded = new Function(`return (${evaluateBrowserUserAgent.toString()});`)() as typeof evaluateBrowserUserAgent;
    for (const ua of [CHROME_UA, EDGE_UA, SAFARI_UA, IOS_SAFARI_UA, FIREFOX_UA]) {
        assert.deepEqual(embedded(ua, []), evaluateBrowserUserAgent(ua, []), ua);
    }
    assert.deepEqual(embedded(SAFARI_UA, CHROME_BRANDS), evaluateBrowserUserAgent(SAFARI_UA, CHROME_BRANDS));
});

test('headless and missing UA are rejected', () => {
    const headless = CHROME_UA.replace('Chrome/', 'HeadlessChrome/');
    assert.equal(evaluateBrowserGate({ userAgent: headless }).reason, 'headless');
    assert.equal(evaluateBrowserGate({ userAgent: '' }).reason, 'missing-user-agent');
});

test('brand and UA disagreements are rejected', () => {
    assert.equal(
        evaluateBrowserGate({ userAgent: CHROME_UA, brands: EDGE_BRANDS }).reason,
        'brand-mismatch'
    );
    assert.equal(
        evaluateBrowserGate({ userAgent: EDGE_UA, brands: CHROME_BRANDS }).reason,
        'brand-mismatch'
    );
    assert.equal(
        evaluateBrowserGate({ userAgent: CHROME_UA, clientHint: '"Firefox";v="133"' }).reason,
        'brand-mismatch'
    );
    assert.equal(
        evaluateBrowserGate({ userAgent: FIREFOX_UA, brands: CHROME_BRANDS }).reason,
        'firefox'
    );
});
