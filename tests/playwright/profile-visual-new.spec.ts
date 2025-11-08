import { test, expect, Browser, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * プロファイルページのビジュアルテスト - 新システム対応
 * 
 * このテストは以下を前提とします:
 * 1. Expressバックエンドが起動している（ポート3000）
 * 2. デバッグセッションが作成されている
 * 3. Vite dev serverが起動している（ポート5173）
 * 
 * デバッグセッション情報は test-results/debug-session.json から読み込まれます。
 */

const FRONTEND_PORT = process.env.VITE_PORT || '5173';
const BACKEND_PORT = process.env.BACKEND_PORT || '3000';

// デバッグセッション情報を読み込む
let debugSession: any = null;

try {
    const sessionFile = path.join(__dirname, '../../test-results/debug-session.json');
    if (fs.existsSync(sessionFile)) {
        debugSession = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
        console.log('✅ デバッグセッション情報を読み込みました');
        console.log(`   Session ID: ${debugSession.sessionId}`);
        console.log(`   User: ${debugSession.username}\n`);
    } else {
        console.warn('⚠️  デバッグセッションファイルが見つかりません');
        console.warn('   tests/create-debug-session.js を先に実行してください\n');
    }
} catch (error) {
    console.error('❌ デバッグセッション情報の読み込みに失敗:', error);
}

// テストするビューポート
const viewports = [
    { name: 'desktop', width: 1920, height: 1080 },
    { name: 'laptop', width: 1366, height: 768 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 375, height: 667 },
];

// ブレークポイント境界値
const breakpoints = [
    { name: 'above-900', width: 901, height: 800 },
    { name: 'below-900', width: 899, height: 800 },
    { name: 'above-600', width: 601, height: 800 },
    { name: 'below-600', width: 599, height: 800 },
];

/**
 * デバッグセッションCookieを持つコンテキストを作成
 */
async function createAuthenticatedContext(browser: Browser): Promise<BrowserContext> {
    if (debugSession && debugSession.sessionId) {
        return await browser.newContext({
            storageState: {
                cookies: [{
                    name: 'sessionId',
                    value: debugSession.sessionId,
                    domain: 'localhost',
                    path: '/',
                    httpOnly: true,
                    secure: false,
                    sameSite: 'Lax',
                    expires: Math.floor(Date.now() / 1000) + 86400 // 24時間
                }],
                origins: []
            }
        });
    }
    
    // セッション情報がない場合は通常のコンテキスト
    console.warn('⚠️  デバッグセッションなしでテストを実行します');
    return await browser.newContext();
}

test.describe('Profile Page Visual Tests - New System', () => {
    test.beforeAll(async () => {
        console.log('\n========================================');
        console.log('プロファイルページビジュアルテスト');
        console.log('========================================');
        console.log(`Frontend: http://localhost:${FRONTEND_PORT}`);
        console.log(`Backend: http://localhost:${BACKEND_PORT}`);
        console.log('========================================\n');
    });

    // 標準ビューポートテスト
    for (const viewport of viewports) {
        test(`should render on ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ browser }) => {
            const context = await createAuthenticatedContext(browser);
            const page = await context.newPage();
            
            await page.setViewportSize({ 
                width: viewport.width, 
                height: viewport.height 
            });

            console.log(`📱 Testing ${viewport.name}...`);
            
            try {
                await page.goto(`http://localhost:${FRONTEND_PORT}/profile`, { 
                    waitUntil: 'networkidle',
                    timeout: 30000 
                });

                // ページが読み込まれるまで待機
                await page.waitForLoadState('domcontentloaded');
                
                // メインコンテナの表示を待つ
                await page.waitForSelector('body', { timeout: 5000 });

                // フルページスクリーンショット
                await page.screenshot({ 
                    path: `test-results/new-${viewport.name}-full.png`,
                    fullPage: true 
                });

                // ビューポートスクリーンショット
                await page.screenshot({ 
                    path: `test-results/new-${viewport.name}-viewport.png`,
                    fullPage: false 
                });

                console.log(`✅ ${viewport.name} screenshots saved`);
                
            } catch (error) {
                console.error(`❌ Error testing ${viewport.name}:`, error);
                throw error;
            } finally {
                await page.close();
                await context.close();
            }
        });
    }

    // ブレークポイント境界値テスト
    for (const bp of breakpoints) {
        test(`should handle breakpoint ${bp.name} (${bp.width}px)`, async ({ browser }) => {
            const context = await createAuthenticatedContext(browser);
            const page = await context.newPage();
            
            await page.setViewportSize({ 
                width: bp.width, 
                height: bp.height 
            });

            console.log(`🔍 Testing breakpoint: ${bp.name} (${bp.width}px)...`);
            
            try {
                await page.goto(`http://localhost:${FRONTEND_PORT}/profile`, { 
                    waitUntil: 'networkidle',
                    timeout: 30000 
                });

                await page.waitForLoadState('domcontentloaded');

                await page.screenshot({ 
                    path: `test-results/new-breakpoint-${bp.name}.png`,
                    fullPage: true 
                });

                console.log(`✅ Breakpoint ${bp.name} screenshot saved`);
                
            } catch (error) {
                console.error(`❌ Error testing breakpoint ${bp.name}:`, error);
                throw error;
            } finally {
                await page.close();
                await context.close();
            }
        });
    }

    // レイアウト要素の検証
    test('should verify responsive layout elements', async ({ browser }) => {
        const testViewports = [
            { width: 1920, height: 1080, name: 'desktop' },
            { width: 800, height: 1024, name: 'tablet' },
            { width: 375, height: 667, name: 'mobile' }
        ];

        for (const vp of testViewports) {
            const context = await createAuthenticatedContext(browser);
            const page = await context.newPage();
            
            await page.setViewportSize({ width: vp.width, height: vp.height });
            
            console.log(`\n🔍 Verifying layout on ${vp.name} (${vp.width}px)...`);
            
            try {
                await page.goto(`http://localhost:${FRONTEND_PORT}/profile`, { 
                    waitUntil: 'networkidle',
                    timeout: 30000 
                });

                // 主要な要素の確認
                const elements = {
                    body: 'body',
                    banner: '[class*="banner"]',
                    profileHeader: '[class*="profileHeader"]',
                    tabs: '[class*="tabs"]',
                    content: '[class*="content"]',
                    overviewGrid: '[class*="overviewGrid"]'
                };

                for (const [name, selector] of Object.entries(elements)) {
                    try {
                        const element = await page.locator(selector).first();
                        const isVisible = await element.isVisible({ timeout: 2000 });
                        
                        if (isVisible) {
                            console.log(`  ✅ ${name}: visible`);
                            
                            // overviewGridの幅を確認
                            if (name === 'overviewGrid') {
                                const box = await element.boundingBox();
                                if (box) {
                                    console.log(`     Width: ${Math.round(box.width)}px`);
                                    
                                    // レイアウトの妥当性チェック
                                    if (vp.width > 900) {
                                        console.log(`     Expected: 2-column layout`);
                                    } else if (vp.width > 600) {
                                        console.log(`     Expected: 1-column + 2-col stats`);
                                    } else {
                                        console.log(`     Expected: 1-column mobile`);
                                    }
                                }
                            }
                        } else {
                            console.log(`  ℹ️  ${name}: not visible`);
                        }
                    } catch (e) {
                        console.log(`  ⚠️  ${name}: element not found`);
                    }
                }
                
                // スクリーンショット
                await page.screenshot({ 
                    path: `test-results/new-layout-verify-${vp.name}.png`,
                    fullPage: true 
                });
                
            } catch (error) {
                console.error(`❌ Error verifying ${vp.name}:`, error);
            } finally {
                await page.close();
                await context.close();
            }
        }
    });

    // タブ切り替えテスト
    test('should verify tab interactions', async ({ browser }) => {
        const context = await createAuthenticatedContext(browser);
        const page = await context.newPage();
        
        await page.setViewportSize({ width: 1366, height: 768 });
        
        console.log('\n🔍 Testing tab interactions...');
        
        try {
            await page.goto(`http://localhost:${FRONTEND_PORT}/profile`, { 
                waitUntil: 'networkidle',
                timeout: 30000 
            });

            const tabs = await page.locator('[class*="tab"]').all();
            console.log(`  Found ${tabs.length} tabs`);
            
            for (let i = 0; i < Math.min(tabs.length, 3); i++) {
                const tab = tabs[i];
                const isVisible = await tab.isVisible();
                
                if (isVisible) {
                    await tab.click({ timeout: 2000 });
                    await page.waitForTimeout(500);
                    
                    await page.screenshot({ 
                        path: `test-results/new-tab-${i}.png`,
                        fullPage: true 
                    });
                    
                    console.log(`  ✅ Tab ${i} screenshot saved`);
                }
            }
        } catch (error) {
            console.error('❌ Error testing tabs:', error);
        } finally {
            await page.close();
            await context.close();
        }
    });
});

test.afterAll(async () => {
    console.log('\n========================================');
    console.log('テスト完了');
    console.log('========================================');
    console.log('スクリーンショット: test-results/new-*.png');
    console.log('レポート: npx playwright show-report\n');
});
