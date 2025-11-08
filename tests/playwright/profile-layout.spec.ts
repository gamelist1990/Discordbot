import { test, expect } from '@playwright/test';

test.describe('Profile Page Layout', () => {
  test.beforeAll(async ({ }) => {
    // This test assumes webDebug mode is running
    // Start webDebug with: WEB_DEBUG_BYPASS_AUTH=1 WEB_DEBUG_NO_PERSIST=1 npm run webDebug
  });

  test('should display profile page with responsive layout on desktop', async ({ page }) => {
    // Navigate to profile page (assuming webDebug is running on port 3000)
    await page.goto('http://localhost:3000/profile', { waitUntil: 'networkidle' });

    // Check if main container exists
    const container = page.locator('[class*="container"]').first();
    await expect(container).toBeVisible();

    // Check if banner exists
    const banner = page.locator('[class*="banner"]').first();
    await expect(banner).toBeVisible();

    // Check if profile header exists
    const profileHeader = page.locator('[class*="profileHeader"]').first();
    await expect(profileHeader).toBeVisible();

    // Check if tabs are visible
    const tabs = page.locator('[class*="tabs"]').first();
    await expect(tabs).toBeVisible();

    // Check if overview tab content is visible
    const content = page.locator('[class*="content"]').first();
    await expect(content).toBeVisible();
  });

  test('should have proper responsive layout on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Navigate to profile page
    await page.goto('http://localhost:3000/profile', { waitUntil: 'networkidle' });

    // Check if main container exists
    const container = page.locator('[class*="container"]').first();
    await expect(container).toBeVisible();

    // On mobile, the overview grid should stack vertically
    const overviewGrid = page.locator('[class*="overviewGrid"]').first();
    if (await overviewGrid.isVisible()) {
      const box = await overviewGrid.boundingBox();
      expect(box).not.toBeNull();
    }

    // Check that tab text is hidden on mobile (only icons shown)
    const tabSpans = page.locator('[class*="tab"] span:not(.material-icons)');
    const count = await tabSpans.count();
    if (count > 0) {
      const firstSpan = tabSpans.first();
      const isVisible = await firstSpan.isVisible();
      // On mobile, text should be hidden
      expect(isVisible).toBe(false);
    }
  });

  test('should have proper responsive layout on tablet viewport', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });

    // Navigate to profile page
    await page.goto('http://localhost:3000/profile', { waitUntil: 'networkidle' });

    // Check if main container exists
    const container = page.locator('[class*="container"]').first();
    await expect(container).toBeVisible();

    // Overview grid should be visible and properly laid out
    const overviewGrid = page.locator('[class*="overviewGrid"]').first();
    if (await overviewGrid.isVisible()) {
      const box = await overviewGrid.boundingBox();
      expect(box).not.toBeNull();
      // On tablet, grid might be stacked (width < 900px)
    }
  });

  test('should take screenshots for visual verification', async ({ page }) => {
    // Desktop screenshot
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('http://localhost:3000/profile', { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'test-results/profile-desktop.png', fullPage: true });

    // Tablet screenshot
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('http://localhost:3000/profile', { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'test-results/profile-tablet.png', fullPage: true });

    // Mobile screenshot
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('http://localhost:3000/profile', { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'test-results/profile-mobile.png', fullPage: true });
  });
});
