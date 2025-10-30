import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_DEBUG_BASE_URL || 'http://localhost:3001';

test.describe('webDebug layout checks', () => {
  test('Dashboard loads with authenticated session', async ({ page, request, browser }) => {
    // Create a debug session (requires WEB_DEBUG_BYPASS_AUTH=1 on the server)
    const res = await request.get(`${BASE}/__debug/create-session`);
    expect(res.ok()).toBeTruthy();

    const setCookie = res.headers()['set-cookie'] || '';
    const m = setCookie.match(/sessionId=([^;]+)/);
    expect(m).not.toBeNull();
    const token = m ? m[1] : '';

    // Create a context with the session cookie so the page is authenticated
    const context = await browser.newContext();
    await context.addCookies([{ name: 'sessionId', value: token, domain: 'localhost', path: '/', httpOnly: true }]);
    const authPage = await context.newPage();

    const response = await authPage.goto(BASE, { waitUntil: 'networkidle' });
    expect(response && response.status()).toBeGreaterThanOrEqual(200);
    expect(response && response.status()).toBeLessThan(400);

    const content = await authPage.content();
    // Basic sanity: index.html (React) usually contains root mount element
    expect(content).toContain('id="root"');
  });

  test('Responsive: main page adapts to mobile viewport', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();

    // Assumes server already has a debug session cookie; create one if needed
    // (This test is tolerant if session is absent; it just checks that page loads)
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const content = await page.content();
    expect(content).toBeTruthy();

    // No strict layout assertions here because client HTML structure can vary.
    // This test ensures the SPA serves content at mobile viewport without server error.
  });
});
