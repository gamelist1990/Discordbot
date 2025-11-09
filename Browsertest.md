# Browsertest.md - AIブラウザテストガイド

このドキュメントは、AIエージェントがDiscordbotのWeb UIをブラウザでテストするための手順を説明します。主にViteサーバーの起動、curlによるデバッグセッションの認証、ChromeやPlaywright関連のブラウザ経由でのアクセスをカバーします。

## 前提条件

- Bun（Node互換ランタイム）がインストールされていること。
- グローバルにChromeブラウザがインストールされていること（またはPlaywrightが利用可能）。
- プロジェクトの依存関係がインストール済み（`bun install`）。

## 手順

### 1. Viteサーバーの起動

Web UIのフロントエンドをVite dev serverで起動します。これにより、開発モードでホットリロード可能なサーバーが立ち上がります。

```powershell
# フロントエンドをViteで起動
cd src/web/client
vite
```

### 2. バックエンドAPIサーバーの起動

Node.jsでバックエンドAPI（SettingsServer）を起動します。これにより、Web UIとAPIの連携が可能になります。

```powershell
# バックエンドAPIをNodeで起動
node tests/webDebug.js
```

- 環境変数でポートを指定可能：`$env:WEB_DEBUG_PORT = '3001'`
- デフォルトポートは3001。

両方のサーバーが起動したら、http://localhost:3001 でアクセス可能になります。

### 3. curlによるデバッグセッションの認証

OAuth認証を回避するために、デバッグ用エンドポイント `/__debug/create-session` をcurlで叩き、テスト用セッションを作成します。

```bash
curl -X POST http://localhost:3001/__debug/create-session \
  -H "Content-Type: application/json" \
  -d '{}' \
  --cookie-jar cookies.txt
```

このコマンドで：
- テスト用セッションが作成されます。
- レスポンスの `Set-Cookie` ヘッダーから `sessionId` が取得され、`cookies.txt` に保存されます。

### 4. ブラウザでのテスト

AIエージェントは、グローバルでインストールされているChromeブラウザまたはPlaywright関連のツールを使用して、認証済みの状態でWeb UIにアクセスします。

#### Chromeブラウザの場合
```bash
# cookies.txt を読み込んでChromeで開く
# 例: ChromeのコマンドラインでCookieをセット
chrome.exe --new-window http://localhost:3001 --cookie-file=cookies.txt
```

#### Playwrightの場合
Playwrightテストスクリプト内でセッションをセット：

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  
  // curlで取得したCookieをセット
  await context.addCookies([
    {
      name: 'sessionId',
      value: '取得したsessionId値', // cookies.txtから抽出
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false
    }
  ]);
  
  const page = await context.newPage();
  await page.goto('http://localhost:3001');
  
  // テストを実行
  // ...
  
  await browser.close();
})();
```

### 注意点

- この手順は開発・テスト専用です。本番環境では`WEB_DEBUG_BYPASS_AUTH`を有効化しないでください。
- セッションは一時的であり、再起動で無効化されます。
- Playwrightを使用する場合、`npx playwright install`でブラウザをインストールしてください。
- テスト後はサーバーを停止し、環境変数をクリアしてください。

## トラブルシューティング

- サーバーが起動しない場合：ポート3001が使用中か確認し、必要に応じて変更。
- 認証が失敗する場合：環境変数が正しく設定されているか確認。
- ブラウザでアクセスできない場合：ファイアウォールやプロキシ設定を確認。

このガイドに従うことで、AIエージェントは効率的にWeb UIのブラウザテストを実行できます。