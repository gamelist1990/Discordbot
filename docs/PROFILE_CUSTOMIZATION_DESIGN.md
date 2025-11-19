# プロフィール編集機能 - 詳細設計書

## 📋 概要

Twitter風のカスタマイズ可能なプロフィールシステムを実装し、ユーザーが自分のプロフィールを豊富に装飾できるようにし、他のユーザーのプロフィールも閲覧できるようにします。

## 🎯 目標

1. **Twitter風のUI**: モバイル/デスクトップで一貫した、モダンなプロフィール体験を提供
2. **高度なカスタマイズ**: 壁紙、絵文字、バイオ、テーマカラーなど
3. **他ユーザープロフィール閲覧**: URLパターン `/profile/:userId` で任意のユーザーのプロフィールを表示
4. **既存機能の維持**: 現在のアクティビティ統計やサーバー情報表示機能を保持

## 🏗️ アーキテクチャ

### データベーススキーマ

#### UserCustomProfile テーブル (JSON形式)
保存先: `Data/UserProfiles/{userId}.json`

```typescript
interface UserCustomProfile {
  userId: string;
  
  // 基本情報
  displayName?: string;           // カスタム表示名
  bio?: string;                   // 自己紹介文 (最大500文字)
  pronouns?: string;              // 代名詞 (例: "he/him", "she/her")
  location?: string;              // 場所 (最大100文字)
  website?: string;               // ウェブサイトURL
  
  // ビジュアルカスタマイズ
  banner?: {
    type: 'color' | 'gradient' | 'image' | 'pattern';
    value: string;                // カラーコード、画像URL、またはパターンID
    gradient?: {
      colors: string[];           // グラデーションの場合の色配列
      direction: 'horizontal' | 'vertical' | 'diagonal';
    };
  };
  
  themeColor?: string;            // テーマカラー (HEX)
  
  // 絵文字・アイコン
  favoriteEmojis?: Array<{
    emoji: string;                // 絵文字またはカスタム絵文字ID
    label?: string;               // ラベル (例: "気分", "趣味")
  }>;
  // お気に入り画像（任意）
  favoriteImage?: string; // 画像URL
  
  // バッジ
  badges?: Array<{
    id: string;                   // バッジID
    name: string;                 // バッジ名
    icon: string;                 // アイコン (絵文字またはURL)
    earnedAt: string;             // 取得日時 (ISO 8601)
  }>;
  
  // プライバシー設定
  privacy?: {
    showStats: boolean;           // 統計情報を表示するか
    showServers: boolean;         // 参加サーバーを表示するか
    showActivity: boolean;        // アクティビティを表示するか
    allowPublicView: boolean;     // 他のユーザーからの閲覧を許可するか
  };
  
  // メタデータ
  createdAt: string;              // プロフィール作成日時
  updatedAt: string;              // 最終更新日時
}
```

### API エンドポイント

#### 1. プロフィール取得 API

**既存エンドポイント拡張**: `GET /api/user/profile`

既存の機能を維持しつつ、カスタムプロフィール情報を追加で返す。

```typescript
// クエリパラメータ
?userId=<Discord User ID>  // 省略時は自分のプロフィール

// レスポンス
{
  // 既存のプロフィール情報
  id: string;
  username: string;
  discriminator: string;
  avatar?: string;
  guilds: GuildInfo[];
  totalStats: { ... };
  
  // 追加: カスタムプロフィール情報
  customProfile?: UserCustomProfile;
}
```

#### 2. プロフィール更新 API

**新規エンドポイント**: `PUT /api/user/profile/custom`

認証済みユーザーが自分のプロフィールをカスタマイズできる。

```typescript
// リクエストボディ
{
  displayName?: string;
  bio?: string;
  pronouns?: string;
  location?: string;
  website?: string;
  banner?: { ... };
  themeColor?: string;
  favoriteEmojis?: Array<{ ... }>;
  privacy?: { ... };
}

// バリデーション
- bio: 最大500文字
- location: 最大100文字
- website: 有効なURL形式
- themeColor: 有効なHEXカラーコード
- favoriteEmojis: 最大10個
 - favoriteEmojis: 最大10個
 - favoriteImage: 有効なURL（省略可）
```

#### 3. プリセットバナー取得 API

**新規エンドポイント**: `GET /api/user/profile/banner-presets`

プリセットのバナー画像やパターンを取得。

```typescript
// レスポンス
{
  colors: string[];              // プリセットカラー配列
  gradients: Array<{
    id: string;
    colors: string[];
    direction: string;
    preview: string;             // Base64プレビュー画像
  }>;
  patterns: Array<{
    id: string;
    name: string;
    preview: string;             // Base64プレビュー画像
  }>;
}
```

#### 4. バッジ管理 API

**新規エンドポイント**: `GET /api/user/profile/badges`

ユーザーが獲得したバッジ一覧を取得。

```typescript
// レスポンス
{
  badges: Array<{
    id: string;
    name: string;
    description: string;
    icon: string;
    earnedAt: string;
    rarity: 'common' | 'rare' | 'epic' | 'legendary';
  }>;
}
```

### フロントエンド実装

#### 1. ルーティング

**新規ルート**:
- `/profile` - 自分のプロフィール
- `/profile/:userId` - 指定ユーザーのプロフィール

**実装**:
```typescript
// src/web/client/src/App.tsx に追加
<Route path="/profile" element={<UserProfile />} />
<Route path="/profile/:userId" element={<UserProfile />} />
```

#### 2. プロフィール表示コンポーネント

**拡張**: `src/web/client/src/pages/Profile/UserProfile.tsx`

主な変更点:
1. URLパラメータから `userId` を取得し、自分または他ユーザーのプロフィールを表示
2. カスタムバナーの表示
3. バイオや追加情報の表示
4. お気に入り絵文字の表示
5. テーマカラーの適用

**追加コンポーネント**:
```
src/web/client/src/pages/Profile/
  ├── UserProfile.tsx         (既存 - 拡張)
  ├── ProfileHeader.tsx       (新規 - ヘッダー/バナー部分)
  ├── ProfileBio.tsx          (新規 - バイオ表示)
  ├── ProfileStats.tsx        (新規 - 統計カード)
  ├── ProfileEmojis.tsx       (新規 - お気に入り絵文字)
  ├── ProfileBadges.tsx       (新規 - バッジ表示)
  └── ProfileEditModal.tsx    (新規 - 編集モーダル)
```

#### 3. プロフィール編集コンポーネント

**新規**: `src/web/client/src/pages/Profile/ProfileEditModal.tsx`

Twitter風の編集画面をモーダルとして実装:

**機能**:
1. **バナー編集**
   - カラーピッカー
   - グラデーション選択
   - プリセットパターン選択
   - カスタム画像アップロード (オプション)

2. **基本情報編集**
   - 表示名
   - バイオ (リアルタイム文字数カウント)
   - 代名詞
   - 場所
   - ウェブサイト

3. **絵文字編集**
   - 絵文字ピッカー
   - ラベル付け
   - 並び替え (ドラッグ&ドロップ)

4. **テーマカラー選択**
   - カラーピッカー
   - プリセットカラー

5. **プライバシー設定**
   - 統計情報の表示/非表示
   - サーバー情報の表示/非表示
   - アクティビティの表示/非表示
   - 公開プロフィールの有効/無効

**UI/UX設計**:
```
┌─────────────────────────────────────────┐
│  プロフィールを編集                       │
│  ┌───────────────────────────────────┐  │
│  │                                   │  │
│  │   [バナープレビュー]               │  │
│  │                                   │  │
│  └───────────────────────────────────┘  │
│                                         │
│  バナー                                 │
│  ○ カラー  ○ グラデーション  ○ パターン │
│  [カラーピッカー]                        │
│                                         │
│  表示名                                 │
│  [___________________________]          │
│                                         │
│  自己紹介 (0/500)                       │
│  [___________________________]          │
│  [___________________________]          │
│  [___________________________]          │
│                                         │
│  お気に入り絵文字                        │
│  [😀] [🎮] [💻] [+追加]                │
│                                         │
│  プライバシー                            │
│  ☑ 統計情報を表示                        │
│  ☑ サーバー情報を表示                    │
│  ☑ アクティビティを表示                  │
│  ☑ 他のユーザーに公開                    │
│                                         │
│  [キャンセル]  [保存]                    │
└─────────────────────────────────────────┘
```

#### 4. プロフィールヘッダーのデザイン

**Twitter風レイアウト**:

```
┌─────────────────────────────────────────────────────┐
│  [カスタムバナー/グラデーション背景]                   │
│                                                     │
│  ┌──┐                                              │
│  │  │  ユーザー名 ✨ [バッジ]                       │
│  └──┘  @username#1234                              │
│        📍 Tokyo | 🌐 website.com                   │
│                                                     │
│  自己紹介テキストがここに表示されます...              │
│                                                     │
│  💻 🎮 🎨 🎵 [お気に入り絵文字]                    │
│                                                     │
│  [概要] [サーバー] [アクティビティ] [編集]          │
└─────────────────────────────────────────────────────┘
```

### バックエンド実装

#### 1. プロフィールサービス

**新規ファイル**: `src/web/services/ProfileService.ts`

```typescript
export class ProfileService {
  private database: Database;
  
  constructor(database: Database) {
    this.database = database;
  }
  
  /**
   * カスタムプロフィールを取得
   */
  async getCustomProfile(userId: string): Promise<UserCustomProfile | null> {
    return await this.database.get('', `UserProfiles/${userId}`, null);
  }
  
  /**
   * カスタムプロフィールを保存
   */
  async saveCustomProfile(
    userId: string,
    profile: Partial<UserCustomProfile>
  ): Promise<void> {
    const existing = await this.getCustomProfile(userId);
    const updated: UserCustomProfile = {
      ...existing,
      ...profile,
      userId,
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    
    await this.database.set('', `UserProfiles/${userId}`, updated);
  }
  
  /**
   * バリデーション
   */
  validateProfile(profile: Partial<UserCustomProfile>): string[] {
    const errors: string[] = [];
    
    if (profile.bio && profile.bio.length > 500) {
      errors.push('Bio must be 500 characters or less');
    }
    
    if (profile.location && profile.location.length > 100) {
      errors.push('Location must be 100 characters or less');
    }
    
    if (profile.website) {
      try {
        new URL(profile.website);
      } catch {
        errors.push('Invalid website URL');
      }
    }
    
    if (profile.themeColor && !/^#[0-9A-F]{6}$/i.test(profile.themeColor)) {
      errors.push('Invalid theme color format');
    }
    
    if (profile.favoriteEmojis && profile.favoriteEmojis.length > 10) {
      errors.push('Maximum 10 favorite emojis allowed');
    }
    
    return errors;
  }
}
```

#### 2. プロフィールコントローラー

**新規ファイル**: `src/web/controllers/ProfileController.ts`

```typescript
import { Router, Request, Response } from 'express';
import { verifyAuth, getCurrentUser } from '../middleware/auth.js';
import { ProfileService } from '../services/ProfileService.js';
import { SettingsSession } from '../types/index.js';

export function createProfileController(
  sessions: Map<string, SettingsSession>,
  profileService: ProfileService
): Router {
  const router = Router();
  
  /**
   * カスタムプロフィール取得
   */
  router.get('/custom', verifyAuth(sessions), async (req: Request, res: Response) => {
    try {
      const userId = (req.query.userId as string) || getCurrentUser(req)?.userId;
      
      if (!userId) {
        res.status(400).json({ error: 'User ID required' });
        return;
      }
      
      const profile = await profileService.getCustomProfile(userId);
      
      // プライバシーチェック
      const currentUser = getCurrentUser(req);
      if (userId !== currentUser?.userId) {
        if (!profile?.privacy?.allowPublicView) {
          res.status(403).json({ error: 'Profile is private' });
          return;
        }
      }
      
      res.json(profile || {});
    } catch (error) {
      console.error('Failed to get custom profile:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  /**
   * カスタムプロフィール更新
   */
  router.put('/custom', verifyAuth(sessions), async (req: Request, res: Response) => {
    try {
      const user = getCurrentUser(req);
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      
      const profile = req.body;
      
      // バリデーション
      const errors = profileService.validateProfile(profile);
      if (errors.length > 0) {
        res.status(400).json({ errors });
        return;
      }
      
      await profileService.saveCustomProfile(user.userId, profile);
      
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to update custom profile:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  /**
   * バナープリセット取得
   */
  router.get('/banner-presets', async (req: Request, res: Response) => {
    res.json({
      colors: [
        '#1DA1F2', '#794BC4', '#F91880', '#FFD400',
        '#00BA7C', '#FF6B6B', '#4A90E2', '#9B59B6',
      ],
      gradients: [
        {
          id: 'sunset',
          colors: ['#FF512F', '#DD2476'],
          direction: 'horizontal',
          name: 'サンセット',
        },
        {
          id: 'ocean',
          colors: ['#2E3192', '#1BFFFF'],
          direction: 'diagonal',
          name: 'オーシャン',
        },
        // ... more gradients
      ],
      patterns: [
        {
          id: 'dots',
          name: 'ドット',
          preview: 'data:image/svg+xml;base64,...',
        },
        // ... more patterns
      ],
    });
  });
  
  return router;
}
```

#### 3. ルート統合

**変更**: `src/web/routes/user.ts`

既存の `/api/user/profile` エンドポイントを拡張:

```typescript
router.get('/profile', verifyAuth(sessions), async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || getCurrentUser(req)?.userId;
    
    // ... 既存のプロフィール取得ロジック
    
    // カスタムプロフィール情報を追加
    const customProfile = await profileService.getCustomProfile(userId);
    
    const userProfile = {
      // ... 既存のフィールド
      customProfile,
    };
    
    res.json(userProfile);
  } catch (error) {
    // ... エラーハンドリング
  }
});
```

**新規ルート追加**: `src/web/SettingsServer.ts`

```typescript
import { createProfileController } from './controllers/ProfileController.js';
import { ProfileService } from './services/ProfileService.js';

// ...

const profileService = new ProfileService(this.database);
this.app.use('/api/user/profile', createProfileController(this.sessions, profileService));
```

## 🎨 デザインシステム

### カラーパレット

**テーマカラー**:
- Primary: #1DA1F2 (Twitter Blue)
- Secondary: #14171A (Dark)
- Success: #17BF63 (Green)
- Warning: #FFAD1F (Orange)
- Danger: #E0245E (Red)

**背景色**:
- Light Mode: #FFFFFF, #F7F9F9
- Dark Mode: #15202B, #192734

### タイポグラフィ

- Display Name: 20px, Bold
- Username: 15px, Regular, Gray
- Bio: 15px, Regular
- Stats: 14px, Semi-bold

### スペーシング

- Header Height: 200px (バナー)
- Avatar Size: 134px x 134px
- Content Padding: 16px
- Card Margin: 12px

### レスポンシブブレークポイント

- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

## 🔄 実装フェーズ

### フェーズ 1: 基盤構築 (優先度: 高)
- [x] データベーススキーマ設計
- [ ] ProfileService 実装
- [ ] ProfileController 実装
- [ ] API エンドポイント作成

### フェーズ 2: フロントエンド基本機能 (優先度: 高)
- [ ] ルーティング実装 (`/profile/:userId`)
- [ ] UserProfile コンポーネント拡張
- [ ] カスタムプロフィール情報の表示
- [ ] プライバシー設定の反映

### フェーズ 3: 編集機能 (優先度: 中)
- [ ] ProfileEditModal コンポーネント実装
- [ ] バナー編集機能
- [ ] 基本情報編集フォーム
- [ ] 絵文字選択機能
- [ ] バリデーションとエラーハンドリング

### フェーズ 4: 高度な機能 (優先度: 低)
- [ ] バッジシステム実装
- [ ] カスタム画像アップロード
- [ ] アニメーションとトランジション
- [ ] ソーシャル共有機能

### フェーズ 5: テスト・最適化 (優先度: 中)
- [ ] E2Eテスト (Playwright)
- [ ] パフォーマンス最適化
- [ ] アクセシビリティ対応 (ARIA)
- [ ] モバイル最適化

## 🧪 テスト計画

### 単体テスト
- ProfileService のバリデーション
- データの永続化

### 統合テスト
- API エンドポイント
- 認証とプライバシー設定

### E2E テスト (Playwright)
1. プロフィール閲覧
   - 自分のプロフィールを表示
   - 他ユーザーのプロフィールを表示
   - プライベートプロフィールのアクセス制限

2. プロフィール編集
   - バナー変更
   - バイオ更新
   - 絵文字追加・削除
   - プライバシー設定変更

3. レスポンシブデザイン
   - モバイル表示
   - タブレット表示
   - デスクトップ表示

## 🔒 セキュリティ考慮事項

1. **入力検証**
   - XSS 対策: すべてのユーザー入力をサニタイズ
   - SQLインジェクション対策: (不要 - JSONベース)
   - 文字数制限の厳格な適用

2. **プライバシー**
   - デフォルトでプロフィールを非公開に設定
   - ユーザーが明示的に公開を許可した場合のみ表示
   - 統計情報の表示/非表示をユーザーが制御

3. **認証**
   - 編集操作は認証済みユーザーのみ
   - 他ユーザーのプロフィール編集を防止
   - セッション検証の強化

4. **レート制限**
   - プロフィール更新: 1分あたり5回まで
   - API リクエスト: 1分あたり60回まで

## 📊 パフォーマンス最適化

1. **キャッシング**
   - プロフィールデータをメモリキャッシュ (5分間)
   - バナープリセットを静的ファイルとして配信

2. **画像最適化**
   - バナー画像の遅延読み込み
   - WebP 形式のサポート
   - 画像サイズの制限 (最大2MB)

3. **コード分割**
   - ProfileEditModal を lazy load
   - 絵文字ピッカーを lazy load

## 📝 ドキュメント更新

実装後に以下を更新:
- README.md - 新機能の説明を追加
- API_DOCUMENTATION.md - 新規エンドポイントを記載
- USER_GUIDE.md - プロフィールカスタマイズのガイド

## 🚀 デプロイ手順

1. データベースマイグレーション (不要 - JSON ベース)
2. 環境変数の設定確認
3. フロントエンドのビルド: `npm run web`
4. バックエンドの再起動
5. 動作確認
6. ロールバック計画の準備

## 📈 成功指標

1. **機能的指標**
   - プロフィール編集成功率: > 99%
   - ページロード時間: < 2秒
   - API レスポンス時間: < 500ms

2. **ユーザー指標**
   - プロフィールカスタマイズ率: > 30%
   - 他ユーザープロフィール閲覧数: 測定
   - バナー変更率: > 20%

3. **品質指標**
   - テストカバレッジ: > 80%
   - バグレート: < 1%
   - アクセシビリティスコア: > 90

---

## 🔗 参考資料

- [Discord.js ドキュメント](https://discord.js.org/)
- [React Router](https://reactrouter.com/)
- [Material Icons](https://fonts.google.com/icons)
- [Twitter UI デザインパターン](https://twitter.com/)

---

**作成日**: 2025-11-07  
**バージョン**: 1.0.0  
**ステータス**: 実装待ち
