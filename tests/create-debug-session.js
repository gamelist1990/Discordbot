#!/usr/bin/env node

/**
 * デバッグセッション作成スクリプト
 * 
 * このスクリプトは、Expressバックエンド（ポート3000）にデバッグセッションを作成し、
 * Vite開発サーバー（ポート5173）からそのセッションを使用できるようにします。
 * 
 * 使用方法:
 *   node tests/create-debug-session.js
 * 
 * 環境変数:
 *   BACKEND_PORT - バックエンドのポート（デフォルト: 3000）
 *   FRONTEND_PORT - フロントエンドのポート（デフォルト: 5173）
 *   DEBUG_USER_ID - デバッグユーザーID（デフォルト: debug-user-123）
 *   DEBUG_USERNAME - デバッグユーザー名（デフォルト: TestUser）
 */

const http = require('http');

const BACKEND_PORT = process.env.BACKEND_PORT || '3000';
const FRONTEND_PORT = process.env.FRONTEND_PORT || '5173';
const DEBUG_USER_ID = process.env.DEBUG_USER_ID || 'debug-user-123';
const DEBUG_USERNAME = process.env.DEBUG_USERNAME || 'TestUser';

console.log('========================================');
console.log('デバッグセッション作成スクリプト');
console.log('========================================\n');

/**
 * バックエンドAPIにリクエストを送信
 */
function makeRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: BACKEND_PORT,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 5000
        };

        if (data) {
            const jsonData = JSON.stringify(data);
            options.headers['Content-Length'] = Buffer.byteLength(jsonData);
        }

        const req = http.request(options, (res) => {
            let body = '';
            
            res.on('data', (chunk) => {
                body += chunk.toString();
            });
            
            res.on('end', () => {
                const cookies = res.headers['set-cookie'] || [];
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: body,
                    cookies: cookies
                });
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (data) {
            req.write(JSON.stringify(data));
        }
        
        req.end();
    });
}

/**
 * バックエンドサーバーが起動しているか確認
 */
async function checkBackendServer() {
    try {
        const response = await makeRequest('GET', '/api/health');
        return response.statusCode === 200;
    } catch (error) {
        return false;
    }
}

/**
 * デバッグセッションを作成
 */
async function createDebugSession() {
    console.log('📝 デバッグセッション情報:');
    console.log(`   User ID: ${DEBUG_USER_ID}`);
    console.log(`   Username: ${DEBUG_USERNAME}`);
    console.log(`   Backend: http://localhost:${BACKEND_PORT}`);
    console.log(`   Frontend: http://localhost:${FRONTEND_PORT}\n`);

    // 1. バックエンドサーバーの確認
    console.log('1️⃣ バックエンドサーバーを確認中...');
    const isRunning = await checkBackendServer();
    
    if (!isRunning) {
        console.error('❌ バックエンドサーバーが起動していません');
        console.error(`   ポート ${BACKEND_PORT} でExpressサーバーを起動してください\n`);
        console.log('起動方法:');
        console.log('  ターミナル1: npm run backend  # または bun run src/index.ts\n');
        return false;
    }
    
    console.log('✅ バックエンドサーバーが起動しています\n');

    // 2. デバッグセッションの作成
    console.log('2️⃣ デバッグセッションを作成中...');
    
    try {
        const response = await makeRequest('POST', '/__debug/create-session', {
            userId: DEBUG_USER_ID,
            username: DEBUG_USERNAME,
            discriminator: '0001',
            avatar: null
        });

        if (response.statusCode === 200 || response.statusCode === 201) {
            console.log('✅ デバッグセッションが作成されました\n');
            
            // Cookieを抽出
            const sessionCookie = response.cookies.find(c => c.startsWith('sessionId='));
            
            if (sessionCookie) {
                const sessionId = sessionCookie.split(';')[0].split('=')[1];
                console.log('📋 セッション情報:');
                console.log(`   Cookie: ${sessionCookie.split(';')[0]}`);
                console.log(`   Session ID: ${sessionId}\n`);
                
                // curlコマンド例を表示
                console.log('💡 手動テスト用curlコマンド:');
                console.log(`   curl -b "sessionId=${sessionId}" http://localhost:${BACKEND_PORT}/api/auth/session\n`);
                
                // ブラウザで開く方法
                console.log('🌐 ブラウザでアクセス:');
                console.log(`   1. ブラウザで http://localhost:${FRONTEND_PORT}/profile を開く`);
                console.log(`   2. DevToolsを開き、Application > Cookies を選択`);
                console.log(`   3. 新しいCookieを追加:`);
                console.log(`      Name: sessionId`);
                console.log(`      Value: ${sessionId}`);
                console.log(`      Domain: localhost`);
                console.log(`      Path: /`);
                console.log(`   4. ページをリロード\n`);

                // Playwrightで使用する方法
                console.log('🎭 Playwrightで使用:');
                console.log('   const context = await browser.newContext({');
                console.log('     storageState: {');
                console.log('       cookies: [{');
                console.log(`         name: 'sessionId',`);
                console.log(`         value: '${sessionId}',`);
                console.log(`         domain: 'localhost',`);
                console.log(`         path: '/',`);
                console.log('         httpOnly: true,');
                console.log('         secure: false,');
                console.log('         sameSite: "Lax"');
                console.log('       }]');
                console.log('     }');
                console.log('   });\n');

                return {
                    success: true,
                    sessionId: sessionId,
                    cookie: sessionCookie.split(';')[0]
                };
            } else {
                console.warn('⚠️  セッションCookieが見つかりませんでした');
                console.log('   レスポンス:', response.body);
                return false;
            }
        } else {
            console.error(`❌ セッション作成に失敗しました (ステータス: ${response.statusCode})`);
            console.error('   レスポンス:', response.body);
            return false;
        }
    } catch (error) {
        console.error('❌ エラーが発生しました:', error.message);
        
        if (error.message === 'Request timeout') {
            console.error('   タイムアウトしました。バックエンドサーバーが正常に動作しているか確認してください。');
        } else if (error.code === 'ECONNREFUSED') {
            console.error(`   接続が拒否されました。ポート ${BACKEND_PORT} でサーバーが起動していることを確認してください。`);
        }
        
        return false;
    }
}

/**
 * セッションを検証
 */
async function validateSession(sessionId) {
    console.log('3️⃣ セッションを検証中...');
    
    try {
        const response = await makeRequest('GET', '/api/auth/session');
        
        // Note: このリクエストにはCookieが含まれていないため、
        // 実際の検証は手動またはPlaywrightで行う必要があります
        console.log('ℹ️  セッション検証は手動またはPlaywrightで行ってください\n');
        
        return true;
    } catch (error) {
        console.warn('⚠️  セッション検証をスキップします:', error.message);
        return true;
    }
}

/**
 * メイン処理
 */
async function main() {
    try {
        const result = await createDebugSession();
        
        if (!result) {
            console.log('\n========================================');
            console.log('セットアップが不完全です');
            console.log('========================================\n');
            process.exit(1);
        }

        // セッションIDをファイルに保存（Playwrightから使用するため）
        const fs = require('fs');
        const path = require('path');
        
        const sessionFile = path.join(__dirname, '../test-results/debug-session.json');
        const dir = path.dirname(sessionFile);
        
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(sessionFile, JSON.stringify({
            sessionId: result.sessionId,
            cookie: result.cookie,
            userId: DEBUG_USER_ID,
            username: DEBUG_USERNAME,
            createdAt: new Date().toISOString(),
            backendPort: BACKEND_PORT,
            frontendPort: FRONTEND_PORT
        }, null, 2));
        
        console.log('📄 セッション情報を保存しました:');
        console.log(`   ${sessionFile}\n`);

        console.log('========================================');
        console.log('✅ デバッグセッションの準備が完了しました');
        console.log('========================================\n');
        
        console.log('次のステップ:');
        console.log('  1. Vite dev serverを起動: cd src/web/client && npx vite');
        console.log('  2. ブラウザまたはPlaywrightでテスト\n');
        
        process.exit(0);
    } catch (error) {
        console.error('\n❌ 予期しないエラー:', error);
        process.exit(1);
    }
}

// スクリプトとして実行された場合のみmainを実行
if (require.main === module) {
    main();
}

module.exports = { makeRequest, createDebugSession, checkBackendServer };
