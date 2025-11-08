#!/usr/bin/env node

/**
 * Vite + webDebug + Playwright 統合テストスクリプト
 * 
 * このスクリプトは以下を実行します:
 * 1. Vite dev serverを起動（フロントエンド）
 * 2. webDebugサーバーを起動（バックエンド + デバッグセッション）
 * 3. Playwrightでスクリーンショットを取得
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const VITE_PORT = 5173;
const WEBDEBUG_PORT = 3000;
const MAX_RETRIES = 30;
const RETRY_DELAY = 2000;

console.log('========================================');
console.log('Vite + webDebug + Playwright 統合テスト');
console.log('========================================\n');

// サーバーが起動しているか確認
function checkServer(port) {
    return new Promise((resolve) => {
        const options = {
            host: 'localhost',
            port: port,
            path: '/',
            method: 'GET',
            timeout: 1000
        };

        const req = http.request(options, (res) => {
            resolve(res.statusCode >= 200 && res.statusCode < 400);
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
        req.end();
    });
}

// サーバーの起動を待つ
async function waitForServer(port, name, maxRetries = MAX_RETRIES) {
    console.log(`⏳ ${name}の起動を待っています (ポート: ${port})...`);
    
    for (let i = 0; i < maxRetries; i++) {
        const isRunning = await checkServer(port);
        if (isRunning) {
            console.log(`✅ ${name}が起動しました (${i + 1}回目のチェック)\n`);
            return true;
        }
        
        if (i < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
    }
    
    console.error(`❌ ${name}の起動に失敗しました\n`);
    return false;
}

// プロセスをクリーンアップ
function cleanup(processes) {
    console.log('\n🧹 プロセスをクリーンアップしています...');
    processes.forEach(proc => {
        if (proc && !proc.killed) {
            proc.kill();
        }
    });
}

async function main() {
    const processes = [];
    
    try {
        // 1. Vite dev server起動
        console.log('1️⃣ Vite dev serverを起動しています...');
        const viteProcess = spawn('npx', ['vite'], {
            cwd: path.join(__dirname, '../src/web/client'),
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true
        });
        
        processes.push(viteProcess);
        
        viteProcess.stdout.on('data', (data) => {
            const output = data.toString();
            if (output.includes('Local:')) {
                console.log(`   ${output.trim()}`);
            }
        });
        
        viteProcess.stderr.on('data', (data) => {
            console.error(`Vite Error: ${data}`);
        });
        
        // Viteの起動を待つ
        const viteStarted = await waitForServer(VITE_PORT, 'Vite dev server');
        if (!viteStarted) {
            throw new Error('Viteサーバーの起動に失敗しました');
        }
        
        // 2. webDebug server起動
        console.log('2️⃣ webDebugサーバーを起動しています...');
        const webDebugProcess = spawn('npx', ['tsx', 'src/web/webDebug.ts'], {
            cwd: path.join(__dirname, '..'),
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
            env: {
                ...process.env,
                WEB_DEBUG_BYPASS_AUTH: '1',
                WEB_DEBUG_NO_PERSIST: '1',
                WEB_DEBUG_PORT: WEBDEBUG_PORT.toString()
            }
        });
        
        processes.push(webDebugProcess);
        
        webDebugProcess.stdout.on('data', (data) => {
            console.log(`   webDebug: ${data.toString().trim()}`);
        });
        
        webDebugProcess.stderr.on('data', (data) => {
            const error = data.toString();
            if (!error.includes('ExperimentalWarning')) {
                console.error(`webDebug Error: ${error}`);
            }
        });
        
        // webDebugの起動を待つ
        const webDebugStarted = await waitForServer(WEBDEBUG_PORT, 'webDebug server');
        if (!webDebugStarted) {
            console.log('⚠️  webDebugサーバーの起動に問題がある可能性があります');
            console.log('   Viteサーバーのみでテストを続行します...\n');
        }
        
        // 3. Playwright テスト実行
        console.log('3️⃣ Playwrightテストを実行しています...');
        console.log('   テストファイル: tests/playwright/profile-screenshots.spec.ts\n');
        
        const playwrightProcess = spawn('npx', ['playwright', 'test', 'tests/playwright/profile-screenshots.spec.ts', '--reporter=list'], {
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit',
            shell: true,
            env: {
                ...process.env,
                VITE_PORT: VITE_PORT.toString(),
                WEBDEBUG_PORT: WEBDEBUG_PORT.toString()
            }
        });
        
        await new Promise((resolve, reject) => {
            playwrightProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('\n✅ Playwrightテストが完了しました');
                    resolve();
                } else {
                    console.log(`\n⚠️  Playwrightテストが終了しました (コード: ${code})`);
                    resolve(); // エラーでも続行
                }
            });
            
            playwrightProcess.on('error', (err) => {
                console.error(`\n❌ Playwrightテストエラー: ${err.message}`);
                reject(err);
            });
        });
        
        console.log('\n========================================');
        console.log('テスト完了');
        console.log('========================================');
        console.log('\nスクリーンショットは以下に保存されています:');
        console.log('  - test-results/profile-*.png');
        console.log('  - playwright-report/ (詳細レポート)\n');
        
        console.log('レポートを表示するには:');
        console.log('  npx playwright show-report\n');
        
    } catch (error) {
        console.error(`\n❌ エラーが発生しました: ${error.message}`);
        process.exit(1);
    } finally {
        cleanup(processes);
        process.exit(0);
    }
}

// エラーハンドリング
process.on('SIGINT', () => {
    console.log('\n\n⚠️  中断されました');
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error(`\n❌ 予期しないエラー: ${error.message}`);
    process.exit(1);
});

main();
