# Staff Command Implementation Summary

## Overview

実装されたスタッフコマンドは、Discord サーバーのスタッフ向けに様々な管理機能を提供するモジュール構造のコマンドシステムです。

## 実装されたファイル

### 1. コマンドファイル

```
src/commands/staff/
├── index.ts          # メインコマンド
├── help.ts           # ヘルプサブコマンド
├── privatechat.ts    # プライベートチャットサブコマンド
└── README.md         # ドキュメント
```

### 2. スクリプト

```
src/scripts/
└── validate-staff-command.ts  # コマンド検証スクリプト
```

## 機能詳細

### `/staff help [page]` - ページ付きヘルプ表示

**特徴:**
- 1ページあたり3コマンドを表示
- 各コマンドの詳細な説明と使用例
- ページナビゲーション機能
- 権限要件の表示

**実装内容:**
- `STAFF_COMMANDS` 配列にコマンド情報を定義
- ページネーション機能（ITEMS_PER_PAGE で制御）
- Embed を使った視覚的な表示
- エフェメラルメッセージで応答（他のユーザーに見えない）

### `/staff privatechat <action>` - プライベートチャット管理

#### アクション: create（作成）

**機能:**
- ユーザーとスタッフ間のプライベートチャンネルを作成
- 「プライベートチャット」カテゴリを自動生成
- 適切な権限設定（対象ユーザーとスタッフのみアクセス可能）
- ウェルカムメッセージの送信
- データベースへの保存

**権限設定:**
```typescript
- サーバー全体: ViewChannel を拒否（非公開）
- 対象ユーザー: ViewChannel, SendMessages, ReadMessageHistory を許可
- スタッフ: 上記 + ManageMessages を許可
```

#### アクション: list（一覧表示）

**機能:**
- アクティブなプライベートチャットの一覧を表示
- チャンネル情報、ユーザー、スタッフ、作成日時を表示
- 最大10件を表示（それ以上はフッターに件数表示）
- Discord のタイムスタンプ形式を使用（相対時刻表示）

#### アクション: delete（削除）

**機能:**
- チャットIDを指定してプライベートチャットを削除
- Discord チャンネルの削除
- データベースエントリの削除
- 削除完了の確認メッセージ

#### アクション: manage（Web UI 管理）

**機能:**
- ブラウザベースの管理画面へのアクセス
- セキュアなセッショントークン生成（30分間有効）
- `SettingsServer` との統合
- トークン付きURLの提供

**セキュリティ:**
- トークンは30分で失効
- セッションはユーザーIDとギルドIDに紐付け
- エフェメラルメッセージで応答（他のユーザーに見えない）

## データ構造

### PrivateChatInfo

```typescript
interface PrivateChatInfo {
    chatId: string;        // チャットID（チャンネルIDと同じ）
    channelId: string;     // Discord チャンネルID
    userId: string;        // 対象ユーザーのID
    staffId: string;       // スタッフのID
    guildId: string;       // サーバーID
    createdAt: number;     // 作成日時（Unix タイムスタンプ）
}
```

### データベースストレージ

- **キー:** `staff_private_chats`
- **形式:** JSON 配列
- **場所:** `Data/staff_private_chats.json`
- **アクセス:** `Database` クラスを使用

## アーキテクチャの特徴

### 1. モジュール構造

各サブコマンドは独立したファイルとして実装されており、以下の利点があります：

- **保守性:** 各機能が分離されているため、変更が容易
- **拡張性:** 新しいサブコマンドの追加が簡単
- **テスタビリティ:** 個別にテスト可能

### 2. TypeScript の活用

- **型安全性:** すべてのデータ構造に型定義
- **エディタサポート:** IntelliSense による補完
- **コンパイル時チェック:** 実行前にエラーを検出

### 3. エラーハンドリング

```typescript
try {
    // 処理
} catch (error) {
    console.error('エラー:', error);
    // ユーザーにわかりやすいエラーメッセージを返す
}
```

### 4. 権限管理

- `ManageGuild` 権限を持つユーザーのみが使用可能
- ギルド専用（DM では使用不可）
- Discord の権限システムと統合

## 拡張方法

### 新しいサブコマンドの追加

1. **ハンドラーファイルを作成**

```typescript
// src/commands/staff/newfeature.ts
export async function handleNewFeatureSubcommand(
    interaction: ChatInputCommandInteraction
): Promise<void> {
    // 実装
}
```

2. **index.ts に追加**

```typescript
// インポート
import { handleNewFeatureSubcommand } from './newfeature.js';

// SlashCommandBuilder に追加
.addSubcommand(subcommand =>
    subcommand
        .setName('newfeature')
        .setDescription('新機能の説明')
)

// execute 内の switch に追加
case 'newfeature':
    await handleNewFeatureSubcommand(interaction);
    break;
```

3. **help.ts に追加**

```typescript
const STAFF_COMMANDS: StaffCommandInfo[] = [
    // ... 既存のコマンド
    {
        name: 'newfeature',
        description: '新機能の説明',
        usage: '/staff newfeature [オプション]',
        examples: ['/staff newfeature']
    }
];
```

### Web UI の拡張

1. **SettingsServer.ts にエンドポイントを追加**

```typescript
this.app.get('/api/staff/newfeature/:token', this.handleNewFeature.bind(this));
```

2. **フロントエンドに画面を実装**

```typescript
// src/web/client/src/pages/StaffNewFeature.tsx
```

## テストと検証

### TypeScript コンパイル

```bash
npx tsc --noEmit
```

### コマンド構造の検証

```bash
node src/scripts/validate-staff-command.js
```

### 動作確認手順

1. Bot を起動
2. Discord サーバーで `/staff help` を実行
3. `/staff privatechat action:create user:@ユーザー` でチャットを作成
4. `/staff privatechat action:list` で一覧を確認
5. `/staff privatechat action:manage` で Web UI を確認

## 今後の拡張案

### 短期的な拡張

1. **チャット通知機能**
   - 新しいメッセージをスタッフに通知
   - スタッフロールへのメンション

2. **チャット転送機能**
   - 他のスタッフにチャットを引き継ぎ
   - 複数スタッフの同時参加

3. **チャット統計**
   - 応答時間の計測
   - チャット数の統計

### 中期的な拡張

1. **自動アーカイブ**
   - 一定期間無活動でチャットを閉じる
   - アーカイブカテゴリへの移動

2. **チャットテンプレート**
   - よくある質問のテンプレート
   - 自動応答機能

3. **評価システム**
   - ユーザーがスタッフ対応を評価
   - フィードバックの収集

### 長期的な拡張

1. **AI アシスタント統合**
   - 自動応答の提案
   - FAQの自動検索

2. **マルチチャンネルサポート**
   - ボイスチャット対応
   - スレッド機能の活用

3. **外部連携**
   - チケットシステムとの統合
   - CRM との連携

## トラブルシューティング

### よくある問題

1. **コマンドが表示されない**
   - Bot を再起動
   - コマンドの再デプロイ: `/settings` で設定画面を開き、コマンドを更新

2. **チャンネルが作成できない**
   - Bot の権限を確認（チャンネルの管理）
   - カテゴリの上限（50チャンネル）を確認

3. **Web UI が開けない**
   - SettingsServer が起動しているか確認
   - ポート3000が使用可能か確認

4. **データベースエラー**
   - `Data/` ディレクトリの書き込み権限を確認
   - JSON ファイルの整合性を確認

## パフォーマンス考慮事項

### データベース

- キャッシュ機能を活用（Database クラスに実装済み）
- 大量のチャット（100件以上）がある場合はページネーションを実装

### Discord API

- レート制限に注意
- バッチ処理を検討（複数チャンネルの一括作成など）

### メモリ使用

- チャット一覧はメモリに展開されるため、大量のチャットがある場合は注意
- 定期的なクリーンアップを実装

## セキュリティ考慮事項

1. **権限チェック**
   - すべての操作で権限を確認
   - `ManageGuild` 権限を持つユーザーのみがアクセス

2. **データ保護**
   - セッショントークンは30分で失効
   - ユーザーIDとギルドIDで検証

3. **ログ記録**
   - すべてのエラーをコンソールに記録
   - 機密情報（トークンなど）はログに含めない

## ライセンスと貢献

このコマンドはプロジェクトの MIT ライセンスに従います。
貢献を歓迎します。プルリクエストを送る前に以下を確認してください：

- TypeScript のコンパイルが通ること
- コードスタイルが既存のコードと一致していること
- 適切なエラーハンドリングが実装されていること
- ドキュメントが更新されていること
