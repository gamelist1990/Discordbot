# Web Module Architecture

Web サーバーのモジュール構造ドキュメント

## 📁 ディレクトリ構造

```
src/web/
├── SettingsServer.ts        # メインサーバークラス（簡略化）
├── types/                   # 型定義
│   └── index.ts             # 共通型エクスポート
├── middleware/              # ミドルウェア
│   ├── auth.ts              # 認証ミドルウェア
│   └── index.ts             # ミドルウェアエクスポート
├── controllers/             # コントローラー（ビジネスロジック）
│   ├── StatusController.ts  # ステータス管理
│   ├── SessionController.ts # セッション管理
│   ├── SettingsController.ts# 設定管理
│   ├── StaffController.ts   # スタッフ機能管理
│   └── index.ts             # コントローラーエクスポート
├── routes/                  # ルート定義
│   ├── status.ts            # ステータスルート
│   ├── session.ts           # セッションルート
│   ├── settings.ts          # 設定ルート
│   ├── staff.ts             # スタッフルート
│   └── index.ts             # ルートエクスポート
├── services/                # サービス層
│   ├── SessionService.ts    # セッション管理サービス
│   └── index.ts             # サービスエクスポート
└── client/                  # フロントエンド（React）
    └── src/
        ├── pages/
        │   └── PrivateChatPage.tsx  # プライベートチャット管理画面
        └── App.tsx          # ルーティング設定
```

## 🏗️ アーキテクチャ概要

### レイヤー構造

```
Request
    ↓
SettingsServer (メインサーバー)
    ↓
Routes (ルート定義)
    ↓
Middleware (認証・検証)
    ↓
Controllers (ビジネスロジック)
    ↓
Services (共通機能)
    ↓
Response
```

### 各層の責務

#### 1. SettingsServer
- Express アプリケーションの初期化
- ミドルウェアの設定
- ルートの登録
- サーバーのライフサイクル管理

**Before (442行):**
```typescript
class SettingsServer {
    // すべてのハンドラーメソッドを含む
    private handleGetStatus() { ... }
    private handleValidateToken() { ... }
    private handleGetGuild() { ... }
    // ... 多数のメソッド
}
```

**After (104行):**
```typescript
class SettingsServer {
    // ルートをモジュールから読み込み
    setupRoutes() {
        this.app.use('/api', createStatusRoutes());
        this.app.use('/api', createSessionRoutes());
        // ...
    }
}
```

#### 2. Routes (routes/)
- URLパスとコントローラーのマッピング
- ミドルウェアの適用

```typescript
export function createStaffRoutes(sessions, botClient) {
    const router = Router();
    const controller = new StaffController(botClient);
    const auth = new AuthMiddleware(sessions);

    router.get('/privatechats/:token', 
        auth.validateToken, 
        controller.getPrivateChats.bind(controller)
    );
    
    return router;
}
```

#### 3. Middleware (middleware/)
- 認証・認可
- リクエストの検証
- エラーハンドリング

```typescript
export class AuthMiddleware {
    validateToken = (req, res, next) => {
        const session = this.sessions.get(token);
        if (!session || expired) {
            return res.status(401).json({ error: 'Invalid session' });
        }
        req.session = session;
        next();
    };
}
```

#### 4. Controllers (controllers/)
- ビジネスロジックの実装
- データの取得・加工
- レスポンスの生成

```typescript
export class StaffController {
    async getPrivateChats(req, res) {
        const session = req.session;
        const chats = await PrivateChatManager.getChatsByGuild(session.guildId);
        res.json({ chats });
    }
}
```

#### 5. Services (services/)
- 共通機能の提供
- ステート管理

```typescript
export class SessionService {
    createSession(guildId, userId) {
        const token = randomUUID();
        this.sessions.set(token, { ... });
        return token;
    }
}
```

## 🔄 リクエストフロー例

### プライベートチャット一覧取得

```
1. Client: GET /api/staff/privatechats/abc123

2. SettingsServer
   ↓ ルーティング

3. StaffRouter
   ↓ /privatechats/:token にマッチ

4. AuthMiddleware
   ↓ トークン検証
   ↓ req.session にセッション情報を追加

5. StaffController.getPrivateChats()
   ↓ PrivateChatManager からデータ取得
   ↓ ユーザー情報の付加

6. Response: { chats: [...] }
```

## 🎯 モジュール化の利点

### 1. 保守性の向上
- **Before**: 1ファイル 442行 → **After**: 平均 50-150行/ファイル
- 関心の分離により変更箇所が明確
- テストが容易

### 2. 再利用性
```typescript
// 同じコントローラーを複数のルートで使用可能
const controller = new StaffController(botClient);
router.get('/chats', controller.getPrivateChats);
router.get('/api/v2/chats', controller.getPrivateChats);
```

### 3. 拡張性
```typescript
// 新しい機能を追加する場合
// 1. コントローラーを作成
export class NotificationController { ... }

// 2. ルートを作成
export function createNotificationRoutes() { ... }

// 3. SettingsServer に追加
this.app.use('/api/notifications', createNotificationRoutes());
```

### 4. テスタビリティ
```typescript
// コントローラーを単独でテスト可能
const controller = new StaffController(mockBotClient);
const mockReq = { session: { guildId: '123' } };
const mockRes = { json: jest.fn() };

await controller.getPrivateChats(mockReq, mockRes);
expect(mockRes.json).toHaveBeenCalledWith({ chats: [...] });
```

## 🆕 新機能の追加方法

### ステップ1: コントローラーを作成

```typescript
// src/web/controllers/NotificationController.ts
export class NotificationController {
    async getNotifications(req, res) {
        // ロジックを実装
    }
}
```

### ステップ2: ルートを作成

```typescript
// src/web/routes/notification.ts
export function createNotificationRoutes(sessions) {
    const router = Router();
    const controller = new NotificationController();
    const auth = new AuthMiddleware(sessions);

    router.get('/notifications/:token', 
        auth.validateToken,
        controller.getNotifications.bind(controller)
    );

    return router;
}
```

### ステップ3: エクスポートに追加

```typescript
// src/web/routes/index.ts
export * from './notification.js';

// src/web/controllers/index.ts
export * from './NotificationController.js';
```

### ステップ4: メインサーバーに登録

```typescript
// src/web/SettingsServer.ts
import { createNotificationRoutes } from './routes/index.js';

setupRoutes() {
    this.app.use('/api', createNotificationRoutes(sessions));
}
```

## 📊 コード量の比較

| ファイル | Before | After | 削減率 |
|---------|--------|-------|-------|
| SettingsServer.ts | 442行 | 104行 | -76% |
| 新規モジュール | 0行 | 700+行 | - |
| **合計** | **442行** | **804行** | +82% |

※ 行数は増えていますが、各ファイルが小さく管理しやすくなっています

## 🔐 セキュリティ

### 認証フロー

```
1. Client が /staff/privatechat にアクセス
   ↓
2. PrivateChatCommand が token を生成
   ↓
3. token 付き URL を提供
   ↓
4. Client が token を使ってAPIにアクセス
   ↓
5. AuthMiddleware が token を検証
   ↓
6. 有効期限（30分）をチェック
   ↓
7. セッション情報を req に追加
   ↓
8. Controller がリクエストを処理
```

## 🌐 フロントエンド統合

### PrivateChatPage コンポーネント

**機能:**
- プライベートチャット一覧表示
- 統計情報表示
- チャット作成フォーム
- チャット削除機能

**API 連携:**
```typescript
// チャット一覧取得
const response = await fetch(`/api/staff/privatechats/${token}`);
const { chats } = await response.json();

// チャット作成
await fetch(`/api/staff/privatechats/${token}`, {
    method: 'POST',
    body: JSON.stringify({ userId })
});

// チャット削除
await fetch(`/api/staff/privatechats/${token}/${chatId}`, {
    method: 'DELETE'
});
```

## 📝 まとめ

### 達成したこと

✅ SettingsServer.ts を104行に簡略化（-76%）
✅ 多段階のモジュール構造を実装
✅ 関心の分離による保守性向上
✅ テスタビリティの向上
✅ 拡張性の向上
✅ プライベートチャット管理画面の実装

### 今後の拡張可能性

- 通知システム
- ユーザー管理
- ロギング・モニタリング
- キャッシング
- レート制限
- WebSocket統合
