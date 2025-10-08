# Discord Bot プロジェクト構造

このドキュメントは、プロジェクト全体の構造とモジュール化の指針を説明します。

## 📁 プロジェクト構造

```
Discordbot/
├── src/
│   ├── commands/          # Discord コマンド (機能別フォルダ構造)
│   │   ├── admin/         # 管理者専用コマンド
│   │   │   ├── settings.ts
│   │   │   └── servers.ts
│   │   ├── any/           # 全ユーザー向けコマンド
│   │   │   ├── help.ts
│   │   │   ├── ping.ts
│   │   │   ├── todo.ts
│   │   │   └── userinfo.ts
│   │   └── staff/         # スタッフ専用コマンド
│   │       ├── index.ts
│   │       ├── help.ts
│   │       ├── privatechat.ts
│   │       └── subcommands/
│   │           └── stats.ts
│   │
│   ├── core/              # コアシステム
│   │   ├── BotClient.ts        # Discord クライアント
│   │   ├── CommandLoader.ts     # コマンド読み込み
│   │   ├── CommandRegistry.ts   # コマンド登録
│   │   ├── Database.ts          # データベース管理
│   │   ├── EventHandler.ts      # イベントハンドラ
│   │   ├── EventManager.ts      # イベント管理
│   │   ├── PrivateChatEvents.ts # プライベートチャット
│   │   ├── PrivateChatManager.ts
│   │   ├── StatsManager.ts      # 統計管理
│   │   └── TodoManager.ts       # TODO 管理
│   │
│   ├── utils/             # ユーティリティ
│   │   ├── CooldownManager.ts  # クールダウン管理
│   │   ├── Logger.ts           # ロギング
│   │   └── StatusManager.ts    # ステータス管理
│   │
│   ├── types/             # 型定義
│   │   ├── command.ts          # コマンド型
│   │   └── enhanced-command.ts # 拡張コマンド型
│   │
│   ├── web/               # Web GUI (フォルダ+モジュール構造)
│   │   ├── client/        # フロントエンド (React + Vite)
│   │   │   ├── src/
│   │   │   │   ├── components/    # 再利用可能なコンポーネント
│   │   │   │   │   ├── Common/    # 共通コンポーネント
│   │   │   │   │   │   ├── AppHeader.tsx      # Google Style ヘッダー
│   │   │   │   │   │   └── AppHeader.module.css
│   │   │   │   │   ├── Layout/    # レイアウト
│   │   │   │   │   ├── Login/     # ログイン
│   │   │   │   │   ├── Tabs/      # タブUI
│   │   │   │   │   └── Toast/     # 通知
│   │   │   │   │
│   │   │   │   ├── pages/         # ページコンポーネント
│   │   │   │   │   ├── Dashboard/    # ダッシュボード
│   │   │   │   │   ├── Home/         # ホーム
│   │   │   │   │   ├── NotFound/     # 404
│   │   │   │   │   ├── PrivateChat/  # プライベートチャット
│   │   │   │   │   ├── Profile/      # プロフィール (Google Style + サイドバー)
│   │   │   │   │   ├── Settings/     # 設定
│   │   │   │   │   ├── SettingsList/ # 設定一覧
│   │   │   │   │   └── Todo/         # TODO
│   │   │   │   │
│   │   │   │   ├── services/      # API サービス
│   │   │   │   │   ├── api.ts
│   │   │   │   │   └── sse.ts
│   │   │   │   │
│   │   │   │   ├── hooks/         # カスタムフック
│   │   │   │   ├── utils/         # ユーティリティ
│   │   │   │   ├── types/         # 型定義
│   │   │   │   ├── styles/        # グローバルスタイル
│   │   │   │   ├── App.tsx        # メインアプリ
│   │   │   │   └── main.tsx       # エントリーポイント
│   │   │   │
│   │   │   ├── index.html
│   │   │   ├── vite.config.ts
│   │   │   └── tsconfig.json
│   │   │
│   │   ├── controllers/   # API コントローラー
│   │   ├── routes/        # ルート定義
│   │   ├── services/      # バックエンドサービス
│   │   │   ├── SessionService.ts
│   │   │   └── index.ts
│   │   ├── modules/       # 機能モジュール
│   │   │   └── Auth/      # 認証モジュール
│   │   ├── middleware/    # ミドルウェア
│   │   ├── types/         # 型定義
│   │   └── SettingsServer.ts  # Web サーバー
│   │
│   ├── index.ts           # Discord Bot エントリーポイント
│   └── config.ts          # 設定
│
├── dist/                  # ビルド出力
├── config.json            # Bot 設定ファイル
├── package.json           # 依存関係
├── tsconfig.json          # TypeScript 設定
└── ARCHITECTURE.md        # このファイル
```

## 🎨 デザインシステム

### Web GUI
- **デザインガイドライン**: Google Material Design
- **主な特徴**:
  - Google Apps のようなアプリ一覧メニュー（ダッシュボード、設定、プロフィール、TODO）
  - レスポンシブデザイン（PC/モバイル対応）
  - サイドバーナビゲーション（プロフィールページ）
  - Material Icons の使用
  - 統一されたカラーパレット

### コンポーネント設計原則
1. **単一責任の原則**: 各コンポーネントは1つの責任を持つ
2. **再利用性**: 共通コンポーネントは `components/Common/` に配置
3. **型安全性**: TypeScript を使用した厳密な型定義
4. **CSS Modules**: スタイルのスコープ化

## 🏗️ モジュール構造

### Discord Bot コマンド
コマンドは権限レベルに基づいて整理:
- `admin/`: 管理者のみ
- `any/`: 全ユーザー
- `staff/`: スタッフのみ

各コマンドは独立したファイルとして実装され、`CommandLoader` によって自動的に読み込まれます。

### Web モジュール
- **modules/**: 機能ごとのモジュール（例: Auth）
- **services/**: ビジネスロジック
- **controllers/**: リクエストハンドリング
- **routes/**: ルーティング定義
- **middleware/**: 共通処理

## 📝 コーディング規約

### ファイル命名
- **TypeScript**: `PascalCase.ts` (クラス), `camelCase.ts` (関数/変数)
- **React コンポーネント**: `PascalCase.tsx`
- **CSS Modules**: `ComponentName.module.css`

### インポート順序
1. 外部ライブラリ
2. 内部モジュール（絶対パス）
3. 相対パス
4. 型定義
5. スタイル

### コメント
- 日本語で記述
- JSDoc 形式を推奨
- 複雑なロジックには説明コメントを追加

## 🔄 開発ワークフロー

### コマンド追加
1. `src/commands/[permission-level]/` に新しいファイルを作成
2. `SlashCommand` インターフェースを実装
3. ビルド & テスト
4. `CommandLoader` が自動的に読み込み

### Web ページ追加
1. `src/web/client/src/pages/[PageName]/` にディレクトリ作成
2. `index.tsx` と `[PageName].module.css` を作成
3. `src/web/client/src/App.tsx` にルートを追加
4. ビルド & テスト

### ビルド
```bash
# Web クライアント
npm run web

# Discord Bot (全プラットフォーム)
npm run auto

# 開発モード
npm run dev
```

## 🎯 今後の拡張

### 計画中の機能
- [ ] アクティビティトラッキング
- [ ] プロフィール設定のカスタマイズ
- [ ] TODO 機能の強化
- [ ] 通知システムの改善

### メンテナンス
- コードの定期的なリファクタリング
- 依存関係の更新
- パフォーマンス最適化
- セキュリティアップデート

## 📚 関連ドキュメント
- [Web Improvement Report](./WEB_IMPROVEMENT_REPORT.md)
- [OAuth2 Setup Guide](./ChangeLogMD/OAUTH2_SETUP.md)
- [Changelog](./ChangeLogMD/)

## 🤝 コントリビューション
このプロジェクトに貢献する際は、上記の構造とコーディング規約に従ってください。
