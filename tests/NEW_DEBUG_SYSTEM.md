# 新しいデバッグ・テストシステム

## 概要

webDebug.tsを廃止し、より確実でシンプルなデバッグ・テストシステムを構築しました。

### 旧システム（廃止）
- ❌ webDebug.ts（TypeScript/ESMの問題あり）
- ❌ 複雑な起動手順
- ❌ 不安定な動作

### 新システム（推奨）
- ✅ Expressバックエンド + Vite dev server
- ✅ curlベースのデバッグセッション作成
- ✅ シンプルで確実な動作
- ✅ Playwrightとの統合が容易

## システムアーキテクチャ

```
┌─────────────────────────────────────────┐
│  1. Expressバックエンド (ポート3000)     │
│     - REST API                          │
│     - セッション管理                     │
│     - データ提供                        │
└─────────────────────────────────────────┘
                  ↓ プロキシ
┌─────────────────────────────────────────┐
│  2. Vite Dev Server (ポート5173)        │
│     - Reactアプリ                       │
│     - HMR (Hot Module Replacement)      │
│     - /api → localhost:3000 にプロキシ  │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  3. デバッグセッション (curl)            │
│     - POST /__debug/create-session      │
│     - セッションCookie取得              │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  4. Playwright テスト                   │
│     - セッションCookieを使用            │
│     - スクリーンショット取得            │
│     - レイアウト検証                    │
└─────────────────────────────────────────┘
```

## クイックスタート

### 前提条件

```bash
# 依存関係のインストール
npm install --legacy-peer-deps

# Playwrightのインストール
npx playwright install chromium
```

### 手順1: バックエンドサーバーを起動

ターミナル1で実行：

```bash
cd /home/runner/work/Discordbot/Discordbot

# デバッグモードで起動
WEB_DEBUG_BYPASS_AUTH=1 WEB_DEBUG_NO_PERSIST=1 bun run src/index.ts

# または
WEB_DEBUG_BYPASS_AUTH=1 WEB_DEBUG_NO_PERSIST=1 npm run start
```

### 手順2: デバッグセッションを作成

ターミナル2で実行：

```bash
cd /home/runner/work/Discordbot/Discordbot
node tests/create-debug-session.js
```

出力例：
```
✅ デバッグセッションが作成されました

📋 セッション情報:
   Cookie: sessionId=abc123...
   Session ID: abc123...

🌐 ブラウザでアクセス:
   1. ブラウザで http://localhost:5173/profile を開く
   2. DevToolsを開き、Application > Cookies を選択
   3. 新しいCookieを追加: sessionId=abc123...
```

### 手順3: Vite dev serverを起動

ターミナル3で実行：

```bash
cd /home/runner/work/Discordbot/Discordbot/src/web/client
npx vite
```

### 手順4: ブラウザまたはPlaywrightでテスト

#### ブラウザで手動テスト

1. http://localhost:5173/profile を開く
2. DevTools > Application > Cookies
3. `sessionId` cookieを追加（手順2で取得した値）
4. ページをリロード

#### Playwrightで自動テスト

ターミナル4で実行：

```bash
cd /home/runner/work/Discordbot/Discordbot
npx playwright test tests/playwright/profile-visual-new.spec.ts
```

## 統合テストスクリプト

すべてを自動化する場合：

```bash
# 統合テストを実行（Vite + Playwrightを自動起動）
node tests/run-visual-tests-new.js
```

このスクリプトは以下を実行します：
1. バックエンドが起動しているか確認
2. デバッグセッションを作成
3. Vite dev serverを起動
4. Playwrightテストを実行
5. すべてのプロセスをクリーンアップ

## API エンドポイント

### デバッグセッション作成

```bash
curl -X POST http://localhost:3000/__debug/create-session \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "debug-user-123",
    "username": "TestUser",
    "discriminator": "0001"
  }' \
  -c cookies.txt
```

レスポンス：
```
Set-Cookie: sessionId=abc123...; Path=/; HttpOnly; SameSite=Lax
```

### セッション検証

```bash
curl -b cookies.txt http://localhost:3000/api/auth/session
```

レスポンス：
```json
{
  "authenticated": true,
  "user": {
    "userId": "debug-user-123",
    "username": "TestUser",
    "discriminator": "0001"
  }
}
```

## トラブルシューティング

### バックエンドが起動しない

```bash
# ポートが使用中か確認
lsof -i :3000

# プロセスを停止
kill -9 <PID>

# 再起動
WEB_DEBUG_BYPASS_AUTH=1 bun run src/index.ts
```

### Viteが起動しない

```bash
# キャッシュをクリア
rm -rf src/web/client/node_modules/.vite

# 再起動
cd src/web/client && npx vite
```

### デバッグセッションが作成できない

```bash
# バックエンドが起動しているか確認
curl http://localhost:3000/api/health

# __debug エンドポイントが有効か確認
curl -X POST http://localhost:3000/__debug/create-session \
  -H "Content-Type: application/json" \
  -d '{"userId": "test", "username": "Test"}'
```

### Playwrightテストがタイムアウト

`profile-visual-new.spec.ts`のタイムアウトを増やす：

```typescript
await page.goto(`http://localhost:${FRONTEND_PORT}/profile`, { 
    waitUntil: 'networkidle',
    timeout: 60000  // 60秒
});
```

## 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `WEB_DEBUG_BYPASS_AUTH` | - | デバッグ認証バイパス（1で有効） |
| `WEB_DEBUG_NO_PERSIST` | - | セッション永続化無効（1で有効） |
| `BACKEND_PORT` | 3000 | バックエンドポート |
| `VITE_PORT` / `FRONTEND_PORT` | 5173 | フロントエンドポート |
| `DEBUG_USER_ID` | debug-user-123 | デバッグユーザーID |
| `DEBUG_USERNAME` | TestUser | デバッグユーザー名 |

## ファイル構成

```
tests/
├── create-debug-session.js      # デバッグセッション作成スクリプト
├── run-visual-tests-new.js      # 統合テストスクリプト（新）
├── NEW_DEBUG_SYSTEM.md          # このファイル
└── playwright/
    └── profile-visual-new.spec.ts  # Playwrightテスト（新）

test-results/
├── debug-session.json           # セッション情報（自動生成）
└── new-*.png                    # スクリーンショット（自動生成）
```

## 旧ファイルの削除

以下のファイルは不要になりました：

- ❌ `src/web/webDebug.ts` （廃止）
- ❌ `tests/run-visual-tests.js` （旧版、`run-visual-tests-new.js`に置換）
- ❌ `tests/playwright/profile-screenshots.spec.ts` （旧版、`profile-visual-new.spec.ts`に置換）

## CI/CD統合

GitHub Actionsの例：

```yaml
name: Visual Tests (New System)

on: [push, pull_request]

jobs:
  visual-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm install --legacy-peer-deps
      
      - name: Install Playwright
        run: npx playwright install chromium
      
      - name: Start backend server
        run: |
          WEB_DEBUG_BYPASS_AUTH=1 WEB_DEBUG_NO_PERSIST=1 npm run start &
          sleep 10
      
      - name: Create debug session
        run: node tests/create-debug-session.js
      
      - name: Start Vite server
        run: |
          cd src/web/client && npx vite &
          sleep 5
      
      - name: Run Playwright tests
        run: npx playwright test tests/playwright/profile-visual-new.spec.ts
      
      - name: Upload screenshots
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: screenshots
          path: test-results/
```

## 利点

### 新システムの利点

1. **シンプル**: TypeScript/ESMの問題を回避
2. **確実**: 標準的なExpress + Viteの組み合わせ
3. **デバッグ容易**: curlで直接テスト可能
4. **柔軟**: セッションを手動でも自動でも作成可能
5. **標準的**: 一般的なWebアプリ開発フローに準拠

### 旧システムの問題点

1. ❌ webDebug.ts のESM互換性問題
2. ❌ __dirname が使えない
3. ❌ 起動が不安定
4. ❌ デバッグが困難

## まとめ

新しいシステムは：
- ✅ より確実
- ✅ よりシンプル
- ✅ より標準的
- ✅ よりデバッグしやすい

webDebug.tsは完全に廃止され、Vite + curlベースの方式に置き換えられました。
