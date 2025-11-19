# プロフィールカスタマイズ機能 - 実装概要

## 🎉 実装完了した機能

### バックエンド (Phase 1) ✅
1. **ProfileService** (`src/web/services/ProfileService.ts`)
   - プロフィールの保存・取得
   - バリデーション機能
   - バナープリセット提供

2. **ProfileController** (`src/web/controllers/ProfileController.ts`)
   - `GET /api/user/profile/custom?userId=<userId>` - カスタムプロフィール取得
   - `PUT /api/user/profile/custom` - プロフィール更新
   - `GET /api/user/profile/banner-presets` - バナープリセット取得

3. **ユーザールート拡張** (`src/web/routes/user.ts`)
   - `?userId` パラメータのサポート
   - 他ユーザーのプロフィール表示
   - プライバシー設定の尊重

### フロントエンド (Phase 2) ✅
1. **ルーティング** (`src/web/client/src/App.tsx`)
   - `/profile` - 自分のプロフィール
   - `/profile/:userId` - 他ユーザーのプロフィール

2. **プロフィール表示** (`src/web/client/src/pages/Profile/UserProfile.tsx`)
   - カスタムバナー表示 (単色、グラデーション対応)
   - カスタム表示名、代名詞、自己紹介
   - 場所、ウェブサイトのリンク
   - お気に入り絵文字の表示
   - プライバシーエラーハンドリング

3. **スタイリング** (`UserProfile.module.css`)
   - Twitter風のモダンなデザイン
   - レスポンシブ対応
   - カスタム要素用のスタイル追加

## 📊 データ構造

### UserCustomProfile インターフェース
```typescript
{
  userId: string;
  displayName?: string;        // カスタム表示名
  bio?: string;                // 自己紹介 (最大500文字)
  pronouns?: string;           // 代名詞
  location?: string;           // 場所 (最大100文字)
  website?: string;            // ウェブサイトURL
  banner?: {                   // カスタムバナー
    type: 'color' | 'gradient' | 'image' | 'pattern';
    value: string;
    gradient?: {
      colors: string[];
      direction: 'horizontal' | 'vertical' | 'diagonal';
    };
  };
  themeColor?: string;         // テーマカラー
   favoriteImage?: string;      // お気に入り画像のURL（任意）
  favoriteEmojis?: Array<{     // お気に入り絵文字 (最大10個)
    emoji: string;
    label?: string;
  }>;
  privacy?: {
    showStats: boolean;
    showServers: boolean;
    showActivity: boolean;
    allowPublicView: boolean;
  };
  createdAt: string;
  updatedAt: string;
}
```

## 🔒 プライバシー機能

1. **allowPublicView**: 他ユーザーからの閲覧を許可するか
2. **showStats**: 統計情報の表示/非表示
3. **showServers**: サーバーリストの表示/非表示
4. **showActivity**: アクティビティの表示/非表示

デフォルトではすべて `true` (公開状態)

## 🎨 バナープリセット

### カラー
- Twitter Blue (#1DA1F2)
- Purple (#794BC4)
- Pink (#F91880)
- Yellow (#FFD400)
- Green (#00BA7C)
- など12色

### グラデーション
- サンセット (Sunset)
- オーシャン (Ocean)
- パープルドリーム (Purple Dream)
- フォレスト (Forest)
- ファイア (Fire)
- クールブルー (Cool Blue)

### パターン
- ドット
- グリッド

## 🛡️ セキュリティ

1. **認証**: すべてのエンドポイントで認証が必要
2. **プライバシーチェック**: 非公開プロフィールは403エラーを返す
3. **入力検証**:
   - 自己紹介: 500文字まで
   - 場所: 100文字まで
   - 表示名: 32文字まで
   - ウェブサイト: 有効なURL形式
   - テーマカラー: HEXカラーコード (#RRGGBB)
   - お気に入り絵文字: 10個まで
    - お気に入り絵文字: 10個まで
    - お気に入り画像: 有効なURL（省略可）

## 📁 データ保存

- 保存先: `Data/UserProfiles/{userId}.json`
- 既存のDatabaseクラスを使用
- マイグレーション不要

## 🧪 動作確認

### ビルド
```bash
npm run web
```
✅ 正常にビルド完了

### TypeScript型チェック
```bash
npx tsc --noEmit
```
✅ エラーなし

## 📝 使用方法

### 自分のプロフィールを表示
1. `/profile` にアクセス

### 他ユーザーのプロフィールを表示
1. `/profile/{userId}` にアクセス
2. 例: `/profile/123456789012345678`

### プロフィールをカスタマイズ (APIを直接使用)
```javascript
// PUT /api/user/profile/custom
{
  "displayName": "カスタム名前",
  "bio": "こんにちは！これは私の自己紹介です。",
  "pronouns": "she/her",
  "location": "東京",
  "website": "https://example.com",
  "banner": {
    "type": "gradient",
    "gradient": {
      "colors": ["#FF512F", "#DD2476"],
      "direction": "horizontal"
    }
  },
  "favoriteEmojis": [
    { "emoji": "💻", "label": "プログラミング" },
    { "emoji": "🎮", "label": "ゲーム" }
  ]
   ,
   "favoriteImage": "https://example.com/image.png"
}
```

## 🚀 今後の拡張予定 (Phase 3)

1. **プロフィール編集UI**
   - モーダルダイアログ
   - バナー選択UI
   - 絵文字ピッカー
   - リアルタイムプレビュー

2. **高度な機能**
   - バッジシステム
   - カスタム画像アップロード
   - アニメーション効果
   - ソーシャル共有

3. **テスト**
   - E2Eテスト (Playwright)
   - 単体テスト
   - 統合テスト

## 🐛 既知の制限事項

1. プロフィール編集UIはまだ実装されていません（APIは完成）
2. カスタム画像のアップロードは未実装（外部URLは可能）
3. バッジシステムは未実装

## 🔗 関連ファイル

### ドキュメント
- `docs/PROFILE_CUSTOMIZATION_DESIGN.md` - 詳細設計書

### バックエンド
- `src/web/types/profile.ts` - 型定義
- `src/web/services/ProfileService.ts` - サービスクラス
- `src/web/controllers/ProfileController.ts` - コントローラー
- `src/web/routes/user.ts` - ユーザールート (拡張)

### フロントエンド
- `src/web/client/src/App.tsx` - ルーティング設定
- `src/web/client/src/pages/Profile/UserProfile.tsx` - プロフィールコンポーネント
- `src/web/client/src/pages/Profile/UserProfile.module.css` - スタイル

## ✨ ハイライト

- 🎯 **後方互換性**: 既存の機能を一切壊さずに新機能を追加
- 🔒 **プライバシー重視**: ユーザーが自分の情報をコントロール可能
- 🎨 **Twitter風デザイン**: モダンで直感的なUI
- 📱 **レスポンシブ**: モバイルとデスクトップの両方で快適に使用可能
- 🚀 **拡張性**: 将来の機能追加を考慮した設計

---

**実装日**: 2025-11-07  
**ステータス**: Phase 1, 2 完了 / Phase 3 未実装
