# ビジュアルテストガイド

## 概要

このガイドでは、Vite dev server + webDebug + Playwrightを使用したプロファイルページのビジュアルレグレッションテストの実行方法を説明します。

## 前提条件

以下がインストールされていることを確認してください：

```bash
# 依存関係のインストール
npm install --legacy-peer-deps

# Playwrightブラウザのインストール
npx playwright install chromium
```

## テストの実行

### 方法1: 統合テストスクリプト（推奨）

すべてを自動で実行します：

```bash
npm run test:visual
```

このコマンドは以下を実行します：
1. Vite dev serverを起動（ポート: 5173）
2. webDebugサーバーを起動（ポート: 3000）
3. Playwrightテストを実行してスクリーンショットを取得
4. すべてのプロセスを自動でクリーンアップ

### 方法2: レポート付きテスト

テスト実行後、自動でPlaywrightレポートを開きます：

```bash
npm run test:visual-ui
```

### 方法3: 手動実行（デバッグ用）

各コンポーネントを個別に起動する場合：

#### ターミナル1: Vite dev server
```bash
cd src/web/client
npx vite
```

#### ターミナル2: webDebug server
```bash
WEB_DEBUG_BYPASS_AUTH=1 WEB_DEBUG_NO_PERSIST=1 WEB_DEBUG_PORT=3000 npx tsx src/web/webDebug.ts
```

#### ターミナル3: Playwright tests
```bash
npx playwright test tests/playwright/profile-screenshots.spec.ts
```

## テスト内容

### ビューポートテスト

以下のビューポートでスクリーンショットを取得します：

| ビューポート | サイズ | 説明 |
|------------|--------|------|
| Desktop | 1920x1080 | デスクトップ |
| Laptop | 1366x768 | ノートPC |
| Tablet Landscape | 1024x768 | タブレット横 |
| Tablet Portrait | 768x1024 | タブレット縦 |
| Mobile Large | 414x896 | iPhone XR/11 |
| Mobile Medium | 375x667 | iPhone SE |
| Mobile Small | 320x568 | iPhone 5/SE |

### ブレークポイント境界値テスト

レスポンシブブレークポイントの動作を確認します：

- **900px直上** (901px): 2カラムレイアウト
- **900px直下** (899px): 1カラムレイアウト
- **600px直上** (601px): 2列statsグリッド
- **600px直下** (599px): 1列statsグリッド

### 検証項目

1. **レイアウト要素の存在確認**
   - バナー
   - プロフィールヘッダー
   - タブナビゲーション
   - コンテンツエリア

2. **レスポンシブレイアウト**
   - overviewGridの幅の確認
   - 各ビューポートでの適切なレイアウト

3. **空の状態**
   - emptyStateの表示確認

4. **インタラクティブ要素**
   - タブ切り替えの動作

## 出力ファイル

テスト完了後、以下のファイルが生成されます：

### スクリーンショット
```
test-results/
├── profile-desktop-full.png
├── profile-desktop-viewport.png
├── profile-laptop-full.png
├── profile-laptop-viewport.png
├── profile-tablet-landscape-full.png
├── profile-tablet-portrait-full.png
├── profile-mobile-large-full.png
├── profile-mobile-medium-full.png
├── profile-mobile-small-full.png
├── profile-breakpoint-900-above.png
├── profile-breakpoint-900-below.png
├── profile-breakpoint-600-above.png
├── profile-breakpoint-600-below.png
├── profile-empty-state.png
├── profile-tab-0.png
├── profile-tab-1.png
├── profile-tab-2.png
└── profile-layout-*.png
```

### レポート
```
playwright-report/
└── index.html  # Playwrightの詳細レポート
```

レポートを開く：
```bash
npx playwright show-report
```

## トラブルシューティング

### Viteサーバーが起動しない

```bash
# ポートが使用中の場合、別のポートを使用
cd src/web/client
npx vite --port 5174
```

### webDebugサーバーが起動しない

ESモジュールの問題がある場合：
```bash
# bunが利用可能な場合
bun run src/web/webDebug.ts

# またはNode.jsで
node --loader tsx src/web/webDebug.ts
```

### Playwrightブラウザがない

```bash
npx playwright install chromium
```

### タイムアウトエラー

ネットワークが遅い場合、`profile-screenshots.spec.ts`のタイムアウトを増やします：
```typescript
await page.goto(`http://localhost:${VITE_PORT}/profile`, { 
    waitUntil: 'networkidle',
    timeout: 60000  // 60秒に増やす
});
```

## CI/CD統合

GitHub Actionsでの使用例：

```yaml
name: Visual Tests

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
      
      - name: Run visual tests
        run: npm run test:visual
      
      - name: Upload screenshots
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: screenshots
          path: test-results/
      
      - name: Upload Playwright report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
```

## 高度な使用方法

### 特定のテストのみ実行

```bash
# デスクトップビューポートのみ
npx playwright test -g "desktop"

# ブレークポイントテストのみ
npx playwright test -g "breakpoint"

# 空の状態のみ
npx playwright test -g "empty state"
```

### デバッグモード

```bash
# UIモードで実行
npx playwright test --ui

# ヘッドフルモードで実行（ブラウザを表示）
npx playwright test --headed

# 特定のテストをデバッグ
npx playwright test --debug -g "desktop"
```

### スクリーンショット比較

ベースラインスクリーンショットを作成し、変更を検出：

```bash
# 初回実行でベースライン作成
npm run test:visual

# ベースラインと比較
npx playwright test --update-snapshots  # 更新が必要な場合
```

## 参考資料

- [Playwright Documentation](https://playwright.dev/)
- [Vite Documentation](https://vitejs.dev/)
- プロジェクトのCopilot Instructions: `.github/copilot-instructions.md`
- CSS修正詳細: `/tmp/TEST_REPORT.md`

## サポート

問題が発生した場合は、以下の情報を含めてIssueを作成してください：

1. エラーメッセージ
2. 実行したコマンド
3. 環境情報（Node.jsバージョン、OS等）
4. スクリーンショット（該当する場合）
