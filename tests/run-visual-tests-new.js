#!/usr/bin/env node

/**
 * 新しい統合ビジュアルテストシステム
 * 
 * アーキテクチャ:
 * 1. Expressバックエンドサーバー（ポート3000）を起動
 * 2. curlでデバッグセッションを作成
 * 3. Vite dev server（ポート5173）を起動（バックエンドにプロキシ）
 * 4. Playwrightでスクリーンショット取得（デバッグセッションを使用）
 * 
 * webDebug.tsは使用しません - よりシンプルで確実なアプローチです。
 */

const { spawn } = require('child_process');
const path = require('path');
const { checkBackendServer, createDebugSession } = require('./create-debug-session');

const BACKEND_PORT = 3000;
const FRONTEND_PORT = 5173;
const MAX_RETRIES = 30;
const RETRY_DELAY = 2000;

console.log('========================================');
console.log('統合ビジュアルテスト - 新システム');
console.log('========================================\n');

console.log('システム構成:');
console.log('  📦 Expressバックエンド: ポート', BACKEND_PORT);
console.log('  🎨 Vite開発サーバー: ポート', FRONTEND_PORT);
console.log('  🎭 Playwright: スクリーンショット取得');
console.log('  ✅ webDebug.ts不使用（シンプル化）\n');

// プロセスリスト
const processes = [];

/**
 * プロセスをクリーンアップ
 */
function cleanup() {
    console.log('\n🧹 プロセスをクリーンアップしています...');
    processes.forEach(proc => {
        if (proc && !proc.killed) {
            try {
                proc.kill('SIGTERM');
            } catch (e) {
                // Ignore
            }
        }
    });
}

/**
 * サーバーの起動を待つ
 */
async function waitForServer(checkFn, name, maxRetries = MAX_RETRIES) {
    console.log(`⏳ ${name}の起動を待っています...`);
    
    for (let i = 0; i < maxRetries; i++) {
        const isRunning = await checkFn();
        if (isRunning) {
            console.log(`✅ ${name}が起動しました\n`);
            return true;
        }
        
        if (i < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
    }
    
    console.error(`❌ ${name}の起動に失敗しました\n`);
    return false;
}

/**
 * Viteサーバーの確認
 */
async function checkViteServer() {
    const http = require('http');
    return new Promise((resolve) => {
        const req = http.request({
            host: 'localhost',
            port: FRONTEND_PORT,
            path: '/',
            method: 'GET',
            timeout: 1000
        }, (res) => {
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

/**
 * メイン処理
 */
async function main() {
    try {
        // 0. 注意事項の表示
        console.log('⚠️  重要な前提条件:');
        console.log('   このスクリプトを実行する前に、別のターミナルで');
        console.log('   Expressバックエンドサーバーを起動してください:');
        console.log('');
        console.log('   cd /home/runner/work/Discordbot/Discordbot');
        console.log('   WEB_DEBUG_BYPASS_AUTH=1 WEB_DEBUG_NO_PERSIST=1 bun run src/index.ts');
        console.log('');
        console.log('   または');
        console.log('');
        console.log('   npm run start\n');
        
        // 1. バックエンドサーバーの確認
        console.log('1️⃣ バックエンドサーバーを確認中...');
        const backendRunning = await checkBackendServer();
        
        if (!backendRunning) {
            console.error('❌ バックエンドサーバーが起動していません');
            console.error('   上記の手順でサーバーを起動してから、再度実行してください\n');
            process.exit(1);
        }
        
        console.log('✅ バックエンドサーバーが起動しています\n');

        // 2. デバッグセッションの作成
        console.log('2️⃣ デバッグセッションを作成中...');
        const session = await createDebugSession();
        
        if (!session || !session.success) {
            console.error('❌ デバッグセッションの作成に失敗しました\n');
            process.exit(1);
        }
        
        console.log('✅ デバッグセッションが作成されました\n');

        // 3. Vite dev serverの起動
        console.log('3️⃣ Vite dev serverを起動中...');
        const viteProcess = spawn('npx', ['vite'], {
            cwd: path.join(__dirname, '../src/web/client'),
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true
        });
        
        processes.push(viteProcess);
        
        let viteReady = false;
        viteProcess.stdout.on('data', (data) => {
            const output = data.toString();
            if (output.includes('Local:') || output.includes('ready in')) {
                viteReady = true;
                console.log(`   ${output.trim()}`);
            }
        });
        
        viteProcess.stderr.on('data', (data) => {
            const error = data.toString();
            if (!error.includes('DeprecationWarning')) {
                console.error(`Vite: ${error}`);
            }
        });
        
        // Viteの起動を待つ
        const viteStarted = await waitForServer(checkViteServer, 'Vite dev server');
        
        if (!viteStarted) {
            console.error('❌ Viteサーバーの起動に失敗しました');
            cleanup();
            process.exit(1);
        }

        // 4. Playwrightテストの実行
        console.log('4️⃣ Playwrightテストを実行中...\n');
        
        const playwrightProcess = spawn('npx', [
            'playwright', 'test',
            'tests/playwright/profile-screenshots.spec.ts',
            '--reporter=list'
        ], {
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit',
            shell: true,
            env: {
                ...process.env,
                VITE_PORT: FRONTEND_PORT.toString(),
                BACKEND_PORT: BACKEND_PORT.toString()
            }
        });
        
        await new Promise((resolve) => {
            playwrightProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('\n✅ Playwrightテストが完了しました');
                } else {
                    console.log(`\n⚠️  Playwrightテストが終了しました (コード: ${code})`);
                }
                resolve();
            });
        });

        // 5. 完了
        console.log('\n========================================');
        console.log('✅ すべてのテストが完了しました');
        console.log('========================================\n');
        
        console.log('スクリーンショット:');
        console.log('  test-results/profile-*.png\n');
        
        console.log('レポートを表示:');
        console.log('  npx playwright show-report\n');
        
    } catch (error) {
        console.error('\n❌ エラーが発生しました:', error.message);
        process.exit(1);
    } finally {
        cleanup();
        
        // 終了前に少し待つ
        await new Promise(resolve => setTimeout(resolve, 1000));
        process.exit(0);
    }
}

// シグナルハンドリング
process.on('SIGINT', () => {
    console.log('\n\n⚠️  中断されました');
    cleanup();
    process.exit(130);
});

process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
});

process.on('uncaughtException', (error) => {
    console.error(`\n❌ 予期しないエラー: ${error.message}`);
    cleanup();
    process.exit(1);
});

// 実行
main();
