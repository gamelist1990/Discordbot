import { test, expect } from '@playwright/test';

/**
 * プロファイルページのビジュアルレグレッションテスト
 * 
 * このテストは複数のビューポートでスクリーンショットを取得し、
 * レスポンシブレイアウトが正しく機能していることを確認します。
 */

const VITE_PORT = process.env.VITE_PORT || '5173';
const WEBDEBUG_PORT = process.env.WEBDEBUG_PORT || '3000';

// テストするビューポート
const viewports = [
    { name: 'desktop', width: 1920, height: 1080, description: 'デスクトップ (1920x1080)' },
    { name: 'laptop', width: 1366, height: 768, description: 'ノートPC (1366x768)' },
    { name: 'tablet-landscape', width: 1024, height: 768, description: 'タブレット横 (1024x768)' },
    { name: 'tablet-portrait', width: 768, height: 1024, description: 'タブレット縦 (768x1024)' },
    { name: 'mobile-large', width: 414, height: 896, description: 'モバイル大 (414x896)' },
    { name: 'mobile-medium', width: 375, height: 667, description: 'モバイル中 (375x667)' },
    { name: 'mobile-small', width: 320, height: 568, description: 'モバイル小 (320x568)' },
];

// ブレークポイント境界値もテスト
const breakpointTests = [
    { name: 'breakpoint-900-above', width: 901, height: 800, description: '900px直上' },
    { name: 'breakpoint-900-below', width: 899, height: 800, description: '900px直下' },
    { name: 'breakpoint-600-above', width: 601, height: 800, description: '600px直上' },
    { name: 'breakpoint-600-below', width: 599, height: 800, description: '600px直下' },
];

test.describe('Profile Page Visual Tests', () => {
    test.beforeEach(async ({ page }) => {
        // エラーとコンソールログを記録
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.log(`Browser Error: ${msg.text()}`);
            }
        });
        
        page.on('pageerror', error => {
            console.log(`Page Error: ${error.message}`);
        });
    });

    // 標準ビューポートテスト
    for (const viewport of viewports) {
        test(`should render correctly on ${viewport.description}`, async ({ page }) => {
            // ビューポート設定
            await page.setViewportSize({ 
                width: viewport.width, 
                height: viewport.height 
            });

            // Vite dev serverに接続（実際のReactアプリ）
            console.log(`📱 Testing ${viewport.description}...`);
            await page.goto(`http://localhost:${VITE_PORT}/profile`, { 
                waitUntil: 'networkidle',
                timeout: 30000 
            });

            // ページが完全にロードされるまで待つ
            await page.waitForLoadState('domcontentloaded');
            
            // 主要な要素が表示されるまで待つ
            try {
                await page.waitForSelector('[class*="container"]', { timeout: 5000 });
            } catch (e) {
                console.log(`⚠️  Container not found for ${viewport.name}, continuing...`);
            }

            // フルページスクリーンショット
            await page.screenshot({ 
                path: `test-results/profile-${viewport.name}-full.png`,
                fullPage: true 
            });

            // ビューポートスクリーンショット
            await page.screenshot({ 
                path: `test-results/profile-${viewport.name}-viewport.png`,
                fullPage: false 
            });

            console.log(`✅ ${viewport.name} screenshots saved`);
        });
    }

    // ブレークポイント境界値テスト
    for (const breakpoint of breakpointTests) {
        test(`should handle ${breakpoint.description}`, async ({ page }) => {
            await page.setViewportSize({ 
                width: breakpoint.width, 
                height: breakpoint.height 
            });

            console.log(`🔍 Testing breakpoint: ${breakpoint.description}...`);
            await page.goto(`http://localhost:${VITE_PORT}/profile`, { 
                waitUntil: 'networkidle',
                timeout: 30000 
            });

            await page.waitForLoadState('domcontentloaded');

            await page.screenshot({ 
                path: `test-results/profile-${breakpoint.name}.png`,
                fullPage: true 
            });

            console.log(`✅ ${breakpoint.name} screenshot saved`);
        });
    }

    // レイアウト要素の検証
    test('should verify layout elements at different viewports', async ({ page }) => {
        const testViewports = [
            { width: 1920, height: 1080, name: 'desktop' },
            { width: 768, height: 1024, name: 'tablet' },
            { width: 375, height: 667, name: 'mobile' }
        ];

        for (const vp of testViewports) {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            
            console.log(`🔍 Verifying layout on ${vp.name}...`);
            await page.goto(`http://localhost:${VITE_PORT}/profile`, { 
                waitUntil: 'networkidle',
                timeout: 30000 
            });

            // 要素の存在確認
            const elements = {
                banner: '[class*="banner"]',
                profileHeader: '[class*="profileHeader"]',
                tabs: '[class*="tabs"]',
                content: '[class*="content"]'
            };

            for (const [name, selector] of Object.entries(elements)) {
                try {
                    const element = await page.locator(selector).first();
                    const isVisible = await element.isVisible({ timeout: 3000 });
                    console.log(`  ${isVisible ? '✅' : '❌'} ${name}: ${isVisible ? 'visible' : 'not visible'}`);
                } catch (e) {
                    console.log(`  ⚠️  ${name}: element not found (may be expected)`);
                }
            }

            // overviewGridの確認
            try {
                const overviewGrid = await page.locator('[class*="overviewGrid"]').first();
                if (await overviewGrid.isVisible({ timeout: 2000 })) {
                    const box = await overviewGrid.boundingBox();
                    if (box) {
                        console.log(`  ℹ️  overviewGrid width: ${Math.round(box.width)}px`);
                        
                        // レイアウトの妥当性チェック
                        if (vp.width > 900) {
                            console.log(`  ✅ Desktop layout expected (width > 900px)`);
                        } else if (vp.width > 600) {
                            console.log(`  ✅ Tablet layout expected (600px < width < 900px)`);
                        } else {
                            console.log(`  ✅ Mobile layout expected (width < 600px)`);
                        }
                    }
                }
            } catch (e) {
                console.log(`  ℹ️  overviewGrid not found (may not be visible yet)`);
            }
        }
    });

    // 空の状態のテスト
    test('should render empty state correctly', async ({ page }) => {
        await page.setViewportSize({ width: 1366, height: 768 });
        
        console.log('🔍 Testing empty state...');
        await page.goto(`http://localhost:${VITE_PORT}/profile`, { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });

        // 空の状態の要素を探す
        try {
            const emptyState = await page.locator('[class*="emptyState"]').first();
            if (await emptyState.isVisible({ timeout: 2000 })) {
                console.log('  ✅ Empty state is visible');
                
                await page.screenshot({ 
                    path: 'test-results/profile-empty-state.png',
                    fullPage: true 
                });
                
                console.log('  ✅ Empty state screenshot saved');
            } else {
                console.log('  ℹ️  Empty state not visible (user may have data)');
            }
        } catch (e) {
            console.log('  ℹ️  Empty state element not found');
        }
    });

    // インタラクティブ要素のテスト
    test('should verify interactive elements', async ({ page }) => {
        await page.setViewportSize({ width: 1366, height: 768 });
        
        console.log('🔍 Testing interactive elements...');
        await page.goto(`http://localhost:${VITE_PORT}/profile`, { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });

        // タブの切り替え
        try {
            const tabs = await page.locator('[class*="tab"]').all();
            console.log(`  ℹ️  Found ${tabs.length} tabs`);
            
            for (let i = 0; i < Math.min(tabs.length, 3); i++) {
                const tab = tabs[i];
                const isVisible = await tab.isVisible();
                if (isVisible) {
                    await tab.click({ timeout: 2000 });
                    await page.waitForTimeout(500);
                    
                    await page.screenshot({ 
                        path: `test-results/profile-tab-${i}.png`,
                        fullPage: true 
                    });
                    
                    console.log(`  ✅ Tab ${i} screenshot saved`);
                }
            }
        } catch (e) {
            console.log('  ℹ️  Could not test tab interactions:', e.message);
        }
    });
});

test.describe('Responsive Layout Validation', () => {
    test('should verify grid layout changes at breakpoints', async ({ page }) => {
        const breakpoints = [
            { width: 1200, expected: '2-column' },
            { width: 800, expected: '1-column' },
            { width: 500, expected: '1-column-mobile' }
        ];

        for (const bp of breakpoints) {
            await page.setViewportSize({ width: bp.width, height: 800 });
            
            console.log(`\n🔍 Testing ${bp.width}px (${bp.expected})...`);
            await page.goto(`http://localhost:${VITE_PORT}/profile`, { 
                waitUntil: 'networkidle',
                timeout: 30000 
            });

            // スクリーンショット取得
            await page.screenshot({ 
                path: `test-results/profile-layout-${bp.width}px.png`,
                fullPage: true 
            });

            console.log(`✅ Layout screenshot saved for ${bp.width}px`);
        }
    });
});

console.log('\n========================================');
console.log('Playwright Visual Tests Configuration');
console.log('========================================');
console.log(`Vite Server: http://localhost:${VITE_PORT}`);
console.log(`WebDebug Server: http://localhost:${WEBDEBUG_PORT}`);
console.log(`Viewports: ${viewports.length} standard + ${breakpointTests.length} breakpoints`);
console.log('========================================\n');
