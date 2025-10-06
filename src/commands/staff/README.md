# Staff Command Module

スタッフ向けの管理機能を提供する拡張可能なモジュール構造のコマンドです。

## 🎯 新機能

### 動的サブコマンドローディング

サブコマンドは `subcommands/` ディレクトリから動的に読み込まれます。新しいサブコマンドを追加するには、ファイルを追加するだけで自動的に登録されます。

### Web UI 統合

プライベートチャットの作成、一覧表示、削除はすべて Web UI から操作できます。

## 構造

```
src/commands/staff/
├── index.ts                  # メインコマンド（動的ローダー）
├── help.ts                   # ヘルプサブコマンド
├── privatechat.ts            # プライベートチャット（Web UI統合）
├── PrivateChatManager.ts     # プライベートチャット管理ロジック
├── README.md                 # このファイル
└── subcommands/              # 動的ロードされるサブコマンド
    └── stats.ts              # 統計情報表示（例）
```

## コマンド一覧

### `/staff help [page]`

スタッフコマンドのヘルプを表示します。

**オプション:**
- `page` (数値): 表示するページ番号

**例:**
```
/staff help
/staff help page:2
```

### `/staff privatechat`

プライベートチャット管理画面を開きます。すべての操作は Web UI で行います。

**Web UI でできること:**
- プライベートチャットの作成
- アクティブなチャットの一覧表示
- チャットの削除
- チャット統計の確認

**例:**
```
/staff privatechat
```

### `/staff stats` (動的ロード)

プライベートチャットの統計情報を表示します。

**例:**
```
/staff stats
```

## 動的サブコマンドの追加方法

### 1. サブコマンドファイルを作成

`src/commands/staff/subcommands/` ディレクトリに新しいファイルを作成します。

```typescript
// src/commands/staff/subcommands/mycommand.ts
import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

export default {
    name: 'mycommand',
    description: '私のカスタムコマンド',
    
    // オプション: サブコマンドビルダー
    builder: (subcommand: any) => {
        return subcommand
            .setName('mycommand')
            .setDescription('私のカスタムコマンド')
            .addStringOption(option =>
                option
                    .setName('text')
                    .setDescription('テキスト入力')
                    .setRequired(true)
            );
    },
    
    // 必須: 実行関数
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const text = interaction.options.getString('text');
        
        await interaction.reply({
            content: `入力されたテキスト: ${text}`,
            ephemeral: true
        });
    }
};
```

### 2. 自動登録

ファイルを保存するだけで、次回 Bot 起動時に自動的にサブコマンドが登録されます。

**注意事項:**
- ファイル名は任意ですが、`.ts` または `.js` 拡張子が必要です
- `name` プロパティは Discord のサブコマンド名として使用されます
- `execute` 関数は必須です
- `builder` 関数はオプションで、より詳細な設定が必要な場合に使用します

## Web UI API エンドポイント

プライベートチャット管理用の Web API が提供されています。

### GET `/api/staff/privatechats/:token`

プライベートチャット一覧を取得します。

**レスポンス:**
```json
{
  "chats": [
    {
      "chatId": "1234567890",
      "channelId": "1234567890",
      "userId": "9876543210",
      "staffId": "5555555555",
      "guildId": "1111111111",
      "createdAt": 1234567890000,
      "userName": "User Name",
      "staffName": "Staff Name",
      "channelExists": true
    }
  ]
}
```

### POST `/api/staff/privatechats/:token`

新しいプライベートチャットを作成します。

**リクエストボディ:**
```json
{
  "userId": "9876543210"
}
```

**レスポンス:**
```json
{
  "success": true,
  "chat": {
    "chatId": "1234567890",
    "channelId": "1234567890",
    "userId": "9876543210",
    "staffId": "5555555555",
    "guildId": "1111111111",
    "createdAt": 1234567890000
  }
}
```

### DELETE `/api/staff/privatechats/:token/:chatId`

プライベートチャットを削除します。

**レスポンス:**
```json
{
  "success": true
}
```

### GET `/api/staff/stats/:token`

プライベートチャット統計を取得します。

**レスポンス:**
```json
{
  "total": 10,
  "today": 2,
  "thisWeek": 5,
  "thisMonth": 8
}
```

## プライベートチャット機能

### 概要

ユーザーとスタッフの間でプライベートな会話をするためのチャンネルを Web UI で管理します。

### 機能

1. **Web UI での管理**
   - すべての操作をブラウザから実行可能
   - 直感的なインターフェース
   - リアルタイムでチャット一覧を確認

2. **セキュリティ**
   - セッショントークンは30分で自動失効
   - ManageGuild 権限が必要
   - ギルド専用（DM では使用不可）

3. **統計情報**
   - 合計チャット数
   - 今日、今週、今月の作成数
   - スタッフ別のチャット数

### データ構造

```typescript
interface PrivateChatInfo {
    chatId: string;        // チャットID
    channelId: string;     // Discord チャンネルID
    userId: string;        // ユーザーID
    staffId: string;       // スタッフID
    guildId: string;       // サーバーID
    createdAt: number;     // 作成日時（タイムスタンプ）
}
```

## 権限

このコマンドは「サーバー管理」権限（`ManageGuild`）を持つユーザーのみが使用できます。

## アーキテクチャ

### 動的ローディングシステム

起動時に `subcommands/` ディレクトリをスキャンし、すべてのサブコマンドを自動的に読み込みます。

**メリット:**
- コードの再利用性が向上
- 新機能の追加が容易
- モジュール間の依存関係が最小限

### Web UI 統合

`PrivateChatManager` クラスがビジネスロジックを管理し、`SettingsServer` が Web API を提供します。

**メリット:**
- Discord コマンドと Web UI で同じロジックを使用
- REST API による柔軟な操作
- フロントエンドとの明確な分離

## 今後の拡張案

### 動的サブコマンドの例

- **notify** - 通知システム
- **archive** - アーカイブ管理
- **template** - メッセージテンプレート
- **report** - レポート生成
- **schedule** - スケジュール管理

### Web UI の拡張

- チャット履歴の表示
- メッセージテンプレート管理
- ユーザー評価システム
- チャット分析ダッシュボード

## トラブルシューティング

### サブコマンドが表示されない

- Bot を再起動してください
- `subcommands/` ディレクトリが存在するか確認してください
- ファイルが正しい形式でエクスポートされているか確認してください

### Web UI が開けない

- SettingsServer が起動しているか確認してください
- ポート3000が使用可能か確認してください
- トークンの有効期限が切れていないか確認してください（30分）

### プライベートチャットが作成できない

- Bot に「チャンネルの管理」権限があるか確認してください
- カテゴリの上限（50チャンネル）に達していないか確認してください
