# Jamboard (スタッフコラボレーションツール)

## 概要

Jamboardは、Google Jamboardのようなコラボレーションツールで、Discord Bot に統合されたスタッフ向けの機能です。ホワイトボードとTodoリストを提供し、リアルタイムでの共同作業をサポートします。

## 機能

### 🎨 ホワイトボード
- ペン、ハイライター、消しゴムの描画ツール
- カラーピッカーで自由に色を選択
- ストロークの太さを調整
- リアルタイムで他のユーザーの描画を確認
- キャンバスのクリア機能

### 📝 Todoリスト
- Todoアイテムの追加・削除
- チェックボックスで完了状態を管理
- 誰が作成したかを記録
- リアルタイムで同期

### 🔐 アクセス管理

#### スタッフ用Jamboard
- スタッフ全員がアクセス可能
- サーバーごとに1つのスタッフ共有Jamboard
- 自動的に作成・管理

#### 個人用Jamboard
- ユーザーごとに1つまで作成可能
- 招待リンクで他のユーザーを招待
- オーナーがメンバーを管理

## 使い方

### Discord コマンド

```
/staff jam [type]
```

パラメータ:
- `type` (オプション): 
  - `staff` - スタッフ共有Jamboardを開く（デフォルト）
  - `personal` - 個人用Jamboardを開く

### アクセス方法

1. Discord で `/staff jam` コマンドを実行
2. 表示されたボタンをクリック
3. Discord OAuth2 で認証
4. Jamboard ページが開く

### 操作方法

#### ホワイトボード
1. ツールバーからツールを選択（ペン、ハイライター、消しゴム）
2. カラーピッカーで色を選択
3. スライダーで太さを調整
4. キャンバス上でマウスをドラッグして描画
5. 「クリア」ボタンで全てを消去

#### Todo
1. 入力フィールドにTodoテキストを入力
2. 「追加」ボタンをクリック（またはEnterキー）
3. チェックボックスで完了状態を切り替え
4. ❌ボタンでTodoを削除

## 技術仕様

### バックエンド

#### データベース構造

**Jamboard テーブル**
```typescript
interface Jamboard {
    id: string;
    type: 'staff' | 'personal';
    guildId: string;
    ownerId: string;
    name: string;
    members: string[];
    inviteCode?: string;
    createdAt: number;
    updatedAt: number;
}
```

**コンテンツテーブル**
```typescript
interface JamboardContent {
    jamboardId: string;
    whiteboard: WhiteboardData;
    todos: TodoItem[];
    updatedAt: number;
}
```

#### API エンドポイント

```
GET    /api/jamboards/:token                      - Jamboard一覧を取得
GET    /api/jamboards/:token/staff                - スタッフJamboardを取得/作成
POST   /api/jamboards/:token/personal             - 個人Jamboardを作成
GET    /api/jamboards/:token/:jamboardId          - 特定のJamboardを取得
GET    /api/jamboards/:token/:jamboardId/content  - コンテンツを取得
POST   /api/jamboards/:token/:jamboardId/strokes  - ストロークを追加
DELETE /api/jamboards/:token/:jamboardId/strokes/:strokeId - ストロークを削除
POST   /api/jamboards/:token/:jamboardId/todos    - Todoを追加
PATCH  /api/jamboards/:token/:jamboardId/todos/:todoId - Todoを更新
DELETE /api/jamboards/:token/:jamboardId/todos/:todoId - Todoを削除
POST   /api/jamboards/:token/:jamboardId/members  - メンバーを追加
DELETE /api/jamboards/:token/:jamboardId/members/:userId - メンバーを削除
GET    /api/jamboards/:token/:jamboardId/stream   - リアルタイム更新 (SSE)
```

### フロントエンド

#### 技術スタック
- React 19
- TypeScript
- CSS Modules
- HTML5 Canvas API
- Server-Sent Events (SSE)

#### ファイル構成
```
src/web/client/src/pages/Jamboard/
├── index.tsx                    - メインコンポーネント
└── JamboardPage.module.css      - スタイル
```

### 認証

OAuth2フローを使用したDiscord認証:

1. ユーザーが `/staff jam` コマンドを実行
2. セッショントークンを生成
3. Discord OAuth2 認証URLを生成
4. ユーザーがDiscordでログイン
5. コールバックでセッションを作成
6. セッショントークンでJamboardにアクセス

## セキュリティ

### アクセス制御
- スタッフ用Jamboardはスタッフ権限を持つユーザーのみアクセス可能
- 個人用Jamboardはオーナーと招待されたメンバーのみアクセス可能
- セッショントークンは1時間で期限切れ

### データ保護
- 全てのAPIエンドポイントでセッション検証
- CSRF対策（セッショントークンベース）
- XSS対策（React の自動エスケープ）

## 今後の拡張

- [ ] 招待リンクの実装
- [ ] 画像のアップロード機能
- [ ] テキストボックスの追加
- [ ] 図形描画ツール
- [ ] エクスポート機能（PNG、PDF）
- [ ] 履歴機能（Undo/Redo）
- [ ] ユーザープレゼンス表示
- [ ] WebSocket による完全リアルタイム同期

## トラブルシューティング

### Jamboardが開かない
- セッショントークンの有効期限を確認
- Discord OAuth2の設定を確認
- ブラウザのコンソールでエラーを確認

### 描画が同期されない
- ネットワーク接続を確認
- SSE接続がアクティブか確認
- サーバーログでエラーを確認

### パフォーマンスの問題
- ストローク数が多い場合、クリアして再開
- ブラウザのキャッシュをクリア
- 他のタブを閉じてメモリを解放

## 開発者向け

### ローカル開発

```bash
# 依存関係のインストール
npm install

# フロントエンドのビルド
cd src/web/client
npm run dev

# バックエンドの起動
cd ../../..
bun index.ts
```

### テスト

```bash
# TypeScriptの型チェック
npx tsc --noEmit

# フロントエンドのビルドテスト
cd src/web/client
npm run build
```

### デバッグ

- フロントエンド: ブラウザのDevToolsを使用
- バックエンド: `console.log` または VSCode のデバッガー
- SSE: ネットワークタブで `text/event-stream` を確認

## ライセンス

このプロジェクトは MIT ライセンスの下で公開されています。
