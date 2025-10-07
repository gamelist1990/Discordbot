# Todo Management System

## 概要

Discord Botと連携したTodo管理システムです。ユーザーはDiscordサーバー内から `/todo` コマンドを実行してWebベースのTodo管理ツールにアクセスできます。

## アーキテクチャ

### システム構成

```
Discord Bot (/todo command)
    ↓
Web Application (React + Express)
    ↓
Authentication (Discord OAuth2)
    ↓
Todo Manager (Backend)
    ↓
Database (JSON DB)
```

### 主要コンポーネント

#### バックエンド

- **TodoManager** (`src/core/TodoManager.ts`)
  - Todoセッションとアイテムの管理
  - データベース操作（JSON DB)
  - アクセス権限の管理

- **TodoController** (`src/web/controllers/TodoController.ts`)
  - HTTPリクエストハンドリング
  - 認証・認可の確認
  - エラーハンドリング

- **Todo Routes** (`src/web/routes/todo.ts`)
  - RESTful APIエンドポイント
  - 認証ミドルウェアの適用

#### フロントエンド

- **Login Page** - Discord OAuth2認証
- **Dashboard** - Todoセッション一覧（プロジェクト画面）
- **Session Detail** - 個別Todoセッションの詳細と編集
- **Components** - 再利用可能なUIコンポーネント

## 認証フロー（Discord OAuth2）

既存の認証システム（`src/web/routes/auth.ts`、`src/web/middleware/auth.ts`、`src/web/services/SessionService.ts`）を使用します。

### フロー

1. User clicks `/todo` command button → Redirects to: `http://baseUrl/todo/{guildId}`
2. Frontend checks `/api/auth/session` (with sessionId cookie)
3. Not authenticated → Redirect to `/api/auth/discord`
4. Discord OAuth2 Login → Callback to `/api/auth/callback`
5. Create session with token → Set cookie: sessionId
6. Redirect to `/todo/{guildId}`

### セッション管理

- **SessionService** - セッションの作成・検証・削除、`Data/sessions.json` に永続化
- **Cookie**: `sessionId` (HttpOnly, SameSite='lax')

## データ構造

### TodoSession

```typescript
{
  id: string;              // セッションID（ランダム生成）
  guildId: string;         // DiscordギルドID
  name: string;            // セッション名（最大100文字）
  ownerId: string;         // 作成者のユーザーID
  createdAt: number;       // 作成日時（UNIX timestamp）
  updatedAt: number;       // 更新日時（UNIX timestamp）
  viewers: string[];       // 閲覧者のユーザーID配列
  editors: string[];       // 編集者のユーザーID配列
  favoritedBy: string[];   // お気に入り登録したユーザーID配列
}
```

### TodoItem

```typescript
{
  id: string;              // TodoアイテムID
  sessionId: string;       // 所属するセッションID
  text: string;            // Todoテキスト
  completed: boolean;      // 完了状態
  priority: 'low' | 'medium' | 'high';  // 優先度
  dueDate?: number;        // 期限（UNIX timestamp、オプション）
  createdBy: string;       // 作成者のユーザーID
  createdAt: number;       // 作成日時
  updatedAt: number;       // 更新日時
  completedAt?: number;    // 完了日時（オプション）
  tags: string[];          // タグ配列
  description?: string;    // 説明文（オプション）
}
```

## API エンドポイント

### Todoセッション

- `GET /api/todos/sessions` - セッション一覧取得
- `POST /api/todos/sessions` - セッション作成 (Body: `{ name: string }`, 制限: 最大3個/ユーザー)
- `GET /api/todos/sessions/:sessionId` - セッション詳細取得
- `DELETE /api/todos/sessions/:sessionId` - セッション削除（オーナーのみ）

### Todoアイテム

- `GET /api/todos/sessions/:sessionId/content` - コンテンツ取得
- `POST /api/todos/sessions/:sessionId/items` - Todoアイテム追加 (権限: オーナー or エディター)
- `PATCH /api/todos/sessions/:sessionId/items/:todoId` - Todoアイテム更新
- `DELETE /api/todos/sessions/:sessionId/items/:todoId` - Todoアイテム削除

### 共有とメンバー管理

- `POST /api/todos/sessions/:sessionId/members` - メンバー追加 (Body: `{ userId, role: 'viewer' | 'editor' }`, 権限: オーナーのみ)
- `DELETE /api/todos/sessions/:sessionId/members/:userId` - メンバー削除（オーナーのみ）

### お気に入り

- `POST /api/todos/sessions/:sessionId/favorite` - お気に入りトグル

## 権限モデル

1. **Owner（オーナー）** - セッション作成者、全操作可能、メンバー管理・削除
2. **Editor（編集者）** - Todoの追加・編集・削除、セッション閲覧
3. **Viewer（閲覧者）** - Todo閲覧のみ

## 制限事項

- ユーザーあたり最大3つのTodoセッションを作成可能
- セッション名は最大100文字

## フロントエンド UI仕様

### デザインシステム

- **スタイル**: Google Material Design
- **カラーパレット**: Primary #4285F4, Secondary #34A853, Error #EA4335, Warning #FBBC04

### ページ構成

1. **ログイン画面** - Discord OAuth2ボタン、サービス説明
2. **プロジェクト画面（Dashboard）** - ヘッダー（アプリタイトル、ユーザーメニュー）、新規セッション作成ボタン、セッションカード一覧、フィルター
3. **セッション詳細画面** - ヘッダー、Todoリスト、Todoアイテム（チェックボックス、優先度、タグ、期限、編集・削除）
4. **共有モーダル** - メンバーリスト、メンバー追加

## データベース

- `database/todo_sessions.json` - Todoセッションデータ
- `database/todo_contents.json` - Todoアイテムデータ
- `Data/sessions.json` - 認証セッションデータ

## セキュリティ

- Discord OAuth2認証
- sessionIdはHTTPOnly cookie
- 全APIで認証確認・権限チェック
- 入力値バリデーション

## 開発者向け情報

```bash
# クライアントビルド
cd src/web/client && npm run build

# サーバー起動
bun run dev
```

## まとめ

Discordとシームレスに統合されたTodo管理システム。OAuth2認証と柔軟な共有機能でプロジェクト管理をサポート。
