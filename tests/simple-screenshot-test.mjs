import { chromium } from '@playwright/test';
import * as path from 'path';

/**
 * シンプルなスクリーンショットテスト
 * バックエンドなしで、Vite dev serverのみを使用してフロントエンドの表示を確認
 */

const FRONTEND_PORT = '5173';

const viewports = [
    { name: 'desktop', width: 1920, height: 1080 },
    { name: 'laptop', width: 1366, height: 768 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 375, height: 667 },
];

const breakpoints = [
    { name: 'above-900', width: 901, height: 800 },
    { name: 'below-900', width: 899, height: 800 },
    { name: 'above-600', width: 601, height: 800 },
    { name: 'below-600', width: 599, height: 800 },
];

async function main() {
    console.log('========================================');
    console.log('フロントエンド表示確認テスト');
    console.log('========================================\n');
    
    const browser = await chromium.launch({
        headless: true
    });
    
    const context = await browser.newContext();
    
    try {
        // 標準ビューポートテスト
        console.log('📱 標準ビューポートのテスト...\n');
        
        for (const viewport of viewports) {
            const page = await context.newPage();
            
            await page.setViewportSize({ 
                width: viewport.width, 
                height: viewport.height 
            });
            
            console.log(`Testing ${viewport.name} (${viewport.width}x${viewport.height})...`);
            
            try {
                await page.goto(`http://localhost:${FRONTEND_PORT}/profile`, { 
                    waitUntil: 'networkidle',
                    timeout: 15000 
                });
                
                // ページのタイトルを取得
                const title = await page.title();
                console.log(`  Page title: ${title}`);
                
                // bodyが存在するか確認
                const bodyExists = await page.locator('body').count() > 0;
                console.log(`  Body exists: ${bodyExists ? 'Yes' : 'No'}`);
                
                // スクリーンショット取得
                await page.screenshot({ 
                    path: `test-results/simple-${viewport.name}-full.png`,
                    fullPage: true 
                });
                
                await page.screenshot({ 
                    path: `test-results/simple-${viewport.name}-viewport.png`,
                    fullPage: false 
                });
                
                console.log(`  ✅ Screenshots saved`);
                
                // 主要な要素の確認
                const elements = [
                    { name: 'container', selector: '[class*="container"]' },
                    { name: 'banner', selector: '[class*="banner"]' },
                    { name: 'tabs', selector: '[class*="tabs"]' },
                    { name: 'content', selector: '[class*="content"]' }
                ];
                
                for (const elem of elements) {
                    try {
                        const count = await page.locator(elem.selector).count();
                        console.log(`  ${count > 0 ? '✅' : '❌'} ${elem.name}: ${count} found`);
                    } catch (e) {
                        console.log(`  ⚠️  ${elem.name}: error`);
                    }
                }
                
            } catch (error) {
                console.error(`  ❌ Error: ${error.message}`);
            }
            
            await page.close();
            console.log();
        }
        
        // ブレークポイント境界値テスト
        console.log('🔍 ブレークポイント境界値のテスト...\n');
        
        for (const bp of breakpoints) {
            const page = await context.newPage();
            
            await page.setViewportSize({ 
                width: bp.width, 
                height: bp.height 
            });
            
            console.log(`Testing ${bp.name} (${bp.width}px)...`);
            
            try {
                await page.goto(`http://localhost:${FRONTEND_PORT}/profile`, { 
                    waitUntil: 'networkidle',
                    timeout: 15000 
                });
                
                await page.screenshot({ 
                    path: `test-results/simple-bp-${bp.name}.png`,
                    fullPage: true 
                });
                
                console.log(`  ✅ Screenshot saved`);
                
                // overviewGridの確認
                try {
                    const overviewGrid = await page.locator('[class*="overviewGrid"]').first();
                    const count = await page.locator('[class*="overviewGrid"]').count();
                    
                    if (count > 0) {
                        const box = await overviewGrid.boundingBox();
                        if (box) {
                            console.log(`  ℹ️  overviewGrid width: ${Math.round(box.width)}px`);
                            
                            // レイアウトの期待値を表示
                            if (bp.width > 900) {
                                console.log(`  Expected: 2-column layout`);
                            } else if (bp.width > 600) {
                                console.log(`  Expected: 1-column + 2-col stats`);
                            } else {
                                console.log(`  Expected: 1-column mobile`);
                            }
                        }
                    }
                } catch (e) {
                    console.log(`  ℹ️  overviewGrid not found`);
                }
                
            } catch (error) {
                console.error(`  ❌ Error: ${error.message}`);
            }
            
            await page.close();
            console.log();
        }
        
        console.log('========================================');
        console.log('✅ テスト完了');
        console.log('========================================\n');
        
        console.log('スクリーンショット:');
        console.log('  test-results/simple-*.png\n');
        
    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    } finally {
        await context.close();
        await browser.close();
    }
}

main();
