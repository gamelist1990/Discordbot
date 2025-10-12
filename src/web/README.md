# Discord Bot 設定システム

## 概要

このシステムは Discord Bot の設定を Web UI から行えるようにするための機能です。管理者が `/settings` コマンドを実行すると、一時的な設定 URL が生成され、ブラウザから権限ロールの設定などができます。

また、Bot の起動時に Web サーバーが自動的にバックグラウンドで起動し、`http://localhost:3000` でダッシュボードにアクセスできます。

## 主な機能

### 🏠 ダッシュボード (`/`)
- Bot の起動時間を表示
- サーバー数の統計
- Bot のバージョン情報
- リアルタイムステータス（10秒ごとに自動更新）

### ⚙️ 設定画面 (`/settings/:token`)
- 権限ロールの設定（スタッフ・管理者）
- 一時的な URL（30分有効）
- 管理者権限が必要

### 💬 プライベートチャット管理 (`/staff/privatechat/:token`)
- ユーザーとのプライベートチャット管理
- リアルタイム更新（Server-Sent Events または ポーリング）
- チャット統計の表示
- チャットの作成・削除機能
- モダンでレスポンシブなUI

### 📢 グローバルフィードバック管理 (`/feedback`)
- 機能リクエスト・バグ報告・改善要望の投稿と閲覧
- Discord 認証必須（全ユーザーがアクセス可能）
- リアルタイム更新（Server-Sent Events）
- Google Material Design スタイルの直感的な UI
- フィードバックへの Upvote（賛成票）機能
- コメント機能（ディスカッション）
- タグによる分類
- ステータス管理（未対応・対応中・完了・却下）
- カード形式の表示（ダッシュボード風）

## アーキテクチャ

### バックエンド

- **Express サーバー** (`src/web/SettingsServer.ts`)
  - ポート 3000 で起動
  - REST API エンドポイントを提供
  - セッション管理（30分の有効期限）
  - 静的ファイルの配信

- **StatusManager** (`src/utils/StatusManager.ts`)
  - Bot の起動時間を JSON ファイルで記録（`Data/bot_status.json`）
  - 10秒ごとに自動更新
  - サーバー数やバージョン情報を管理

- **API エンドポイント**
  - `GET /api/status` - Bot ステータス取得（認証不要）
  - `GET /api/validate/:token` - トークン検証
  - `GET /api/guild/:token` - ギルド情報取得
  - `GET /api/settings/:token` - 設定取得
  - `POST /api/settings/:token` - 設定保存
  - `GET /api/staff/privatechats/:token` - プライベートチャット一覧取得
  - `POST /api/staff/privatechats/:token` - プライベートチャット作成
  - `DELETE /api/staff/privatechats/:token/:chatId` - プライベートチャット削除
  - `GET /api/staff/stats/:token` - プライベートチャット統計取得
  - `GET /api/staff/privatechats/:token/stream` - リアルタイム更新（SSE）
  - `GET /api/feedback` - フィードバック一覧取得（認証必須）
  - `POST /api/feedback` - フィードバック作成（認証必須）
  - `GET /api/feedback/:id` - 特定のフィードバック取得（認証必須）
  - `PUT /api/feedback/:id` - フィードバック更新（認証必須）
  - `DELETE /api/feedback/:id` - フィードバック削除（認証必須）
  - `POST /api/feedback/:id/upvote` - Upvote トグル（認証必須）
  - `POST /api/feedback/:id/comments` - コメント追加（認証必須）
  - `DELETE /api/feedback/:id/comments/:commentId` - コメント削除（認証必須）
  - `GET /api/feedback/stats` - フィードバック統計取得（認証必須）
  - `GET /api/feedback/stream` - リアルタイム更新（SSE、認証必須）

### フロントエンド

- **Vite + React + TypeScript** (`src/web/client/`)
  - モダンなビルドツールとフレームワーク
  - CSS Modules によるスコープ付きスタイル
  - React Router によるルーティング

- **ページ**
  - `DashboardPage`: デフォルトページ（起動時間・ステータス表示）
  - `SettingsPage`: 設定画面（権限ロール設定）
  - `PrivateChatPage`: プライベートチャット管理（リアルタイム更新対応）
  - `FeedbackPage`: グローバルフィードバック管理（機能リクエスト・バグ報告・改善要望）
  - `NotFoundPage`: 404 エラーページ

- **UI コンポーネント**
  - `Layout`: ヘッダー + サイドバー + コンテンツエリア
  - `Header`: ギルド情報の表示
  - `Sidebar`: タブナビゲーション
  - `PermissionsTab`: 権限ロール設定

## 使用方法

### 1. セットアップ

依存関係をインストール:

```bash
bun install
```

### 2. フロントエンドのビルド

```bash
bun run build:web
```

これにより `dist/web/` にフロントエンドがビルドされます。

### 3. Bot の起動

```bash
bun run src/index.ts
```

Bot が起動すると、以下が自動的に実行されます:
1. StatusManager の初期化（起動時間の記録）
2. 設定サーバーの起動（`http://localhost:3000`）
3. ダッシュボードへのアクセスが可能に

### 4. ダッシュボードの確認

ブラウザで `http://localhost:3000` にアクセスすると、以下の情報が表示されます:
- Bot の稼働時間
- サーバー数の統計
- バージョン情報
- リアルタイムステータス

### 5. 設定 URL の生成

Discord サーバーで管理者権限を持つユーザーが以下のコマンドを実行:

```
/settings
```

これにより、30分間有効な一時設定 URL が Ephemeral メッセージで返信されます。

### 6. 設定画面での操作

1. 生成された URL にブラウザでアクセス
2. サイドバーから「権限設定」タブを選択
3. スタッフロールと管理者ロールを選択
4. 「設定を保存」ボタンをクリック

## 開発

### フロントエンドの開発サーバー

```bash
bun run dev:web
```

これにより Vite 開発サーバーが `http://localhost:5173` で起動します。API リクエストは自動的に `http://localhost:3000` にプロキシされます。

### ディレクトリ構造

```
src/
├── utils/
│   └── StatusManager.ts       # 起動時間・ステータス管理
├── core/
│   └── FeedbackManager.ts     # グローバルフィードバック管理
├── web/
│   ├── SettingsServer.ts      # Express サーバー
│   ├── vite.config.ts         # Vite 設定
│   ├── README.md              # このファイル
│   ├── services/
│   │   └── SSEManager.ts      # 拡張可能なSSEマネージャー（再利用可能）
│   ├── controllers/
│   │   └── FeedbackController.ts  # フィードバックAPI
│   ├── routes/
│   │   └── feedback.ts        # フィードバックルート
│   └── client/                # フロントエンドソース
│       ├── index.html
│       └── src/
│           ├── main.tsx       # エントリポイント
│           ├── App.tsx        # ルーティング
│           ├── types/         # TypeScript 型定義
│           ├── services/      # API サービス
│           ├── pages/         # ページコンポーネント
│           │   ├── DashboardPage.tsx   # ダッシュボード
│           │   ├── SettingsPage.tsx    # 設定画面
│           │   ├── Feedback/           # フィードバックページ
│           │   │   ├── index.tsx
│           │   │   └── FeedbackPage.module.css
│           │   └── NotFoundPage.tsx    # 404 ページ
│           ├── components/    # 再利用可能なコンポーネント
│           │   ├── Layout/
│           │   └── Tabs/
│           └── styles/        # グローバルスタイル
├── commands/
│   └── admin/
│       └── settings.ts        # /settings コマンド
└── index.ts                   # 起動時に自動でサーバーを起動
```

### SSEManager（Server-Sent Events マネージャー）

拡張可能な SSE マネージャークラスが実装されています（`src/web/services/SSEManager.ts`）。
これにより、複数の機能でリアルタイム通信を簡単に実装できます。

**主な機能:**
- チャンネルベースの接続管理
- ブロードキャスト機能（全体 / チャンネル別 / フィルタ）
- 自動再接続サポート
- Keep-alive メッセージ
- メタデータによるフィルタリング

**使用例:**
```typescript
import { sseManager } from '../services/SSEManager.js';

// 接続を追加
sseManager.addConnection(connectionId, res, 'feedback', { userId: 'user123' });

// チャンネルにブロードキャスト
sseManager.broadcast('feedback', {
    type: 'update',
    payload: data
});

// フィルタ付きブロードキャスト
sseManager.broadcast('feedback', data, (conn) => conn.metadata?.userId === 'user123');
```

## 拡張性

### 新しいページの追加

1. `src/web/client/src/pages/` に新しいページコンポーネントを作成
2. `src/web/client/src/App.tsx` にルートを追加

例:
```tsx
<Route path="/logs" element={<LogsPage />} />
```

### 新しいタブの追加

1. `src/web/client/src/components/Tabs/` に新しいタブコンポーネントを作成
2. `src/web/client/src/components/Layout/Sidebar.tsx` の `tabs` 配列に追加
3. `src/web/client/src/pages/SettingsPage.tsx` にタブの表示ロジックを追加

### 新しい設定項目の追加

1. `src/web/SettingsServer.ts` の `GuildSettings` インターフェースに追加
2. API エンドポイントを更新（必要に応じて）
3. フロントエンドの型定義を更新（`src/web/client/src/types/index.ts`）
4. UI コンポーネントを更新

### 新しい API エンドポイントの追加

1. `src/web/SettingsServer.ts` にハンドラーメソッドを追加
2. `setupRoutes()` メソッドにルートを追加
3. フロントエンドの API サービス（`src/web/client/src/services/api.ts`）に関数を追加

## 自動起動の仕組み

Bot の起動時（`src/index.ts`）に以下の順序で実行されます:

1. **StatusManager 初期化**
   - `Data/bot_status.json` に起動時間を記録
   - 10秒ごとに自動更新を開始

2. **Bot クライアント起動**
   - Discord にログイン
   - コマンドを読み込み・デプロイ

3. **SettingsServer 起動**
   - Express サーバーを起動（ポート 3000）
   - API エンドポイントを有効化
   - 静的ファイル（ビルド済みフロントエンド）を配信

4. **準備完了**
   - Bot の状態を「準備完了」に更新
   - ダッシュボードが `http://localhost:3000` で利用可能に

## セキュリティ

- セッショントークンは UUID v4 で生成
- トークンは 30 分で自動的に期限切れ
- `/settings` コマンドは管理者権限が必要
- Ephemeral メッセージで URL を送信（他のユーザーには見えない）
- `/api/status` 以外の API は認証が必要

## リアルタイム更新

プライベートチャット管理画面では、Server-Sent Events (SSE) を使用したリアルタイム更新をサポートしています。

### 動作方式

1. **SSE（優先）**: ブラウザが Server-Sent Events をサポートしている場合、SSE 接続を確立してリアルタイム更新を受信します。
2. **ポーリング（フォールバック）**: SSE が利用できない場合、10秒ごとのポーリングにフォールバックします。

### 技術的詳細

- **SSE エンドポイント**: `/api/staff/privatechats/:token/stream`
- **更新間隔**: 10秒
- **キープアライブ**: 30秒ごとに送信
- **自動再接続**: SSE 接続が切断された場合、ポーリングに自動的に切り替わります

### 利点

- サーバーからの即時更新通知
- 低レイテンシ
- 効率的な帯域幅使用
- 複数の管理者が同時に作業できる

## トラブルシューティング

### ポート 3000 が既に使用されている

`src/web/SettingsServer.ts` のコンストラクタで別のポートを指定してください:

```typescript
settingsServer = new SettingsServer(botClient, 3001);
```

### フロントエンドが表示されない

1. `bun run build:web` を実行してフロントエンドをビルドしてください
2. `dist/web/` ディレクトリが存在することを確認してください

### セッションが期限切れになる

セッションは 30 分で自動的に期限切れになります。再度 `/settings` コマンドを実行して新しい URL を生成してください。

### 起動時間が正しく表示されない

`Data/bot_status.json` ファイルを削除してから Bot を再起動してください。新しい起動時間が記録されます。
