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

### `/staff ai` の通知・AI動作の予約

「今日の午後3時に起こして」「10分後に休憩を通知して」のように依頼すると、AIが
`manage_schedule` ツールで予約を保存します。日本時間（Asia/Tokyo）を標準とし、
午前・午後が曖昧な時刻は確認します。指定時刻になると、依頼したチャンネルで
本人をメンションして通知します。「通知予約の一覧を見せて」「この予約を取り消して」
にも対応します。予約完了時に案内されるIDで取り消す予約を指定できます。

「今日の15時に最新ニュースを調べて」「明日7時に東京の天気を確認して」のような依頼は、
`mode=task` と自己完結した実行依頼文 `task` を保存します。指定時刻にAIが起動して
Web検索・公開ページ取得・天気確認・文章作成や要約を行い、完了後に結果をメンション通知します。
調査は予約した時点ではなく実行時点の情報を使い、今日・最新なども実行日時が基準です。
この動作でのサーバー管理操作や非公開Discord履歴参照には対応していません。
長い結果はテキストファイルで全文を添付します。結果保存後に送信が失敗した場合は
結果を再利用し、同じ調査を繰り返しません。実行中の予約も取り消せ、取り消すと結果は投稿されません。

予約はデータベースに保存され、Bot再起動後も復元されます。Bot稼働中は5秒間隔で
期限を確認し、停止中に期限を過ぎた予約は起動後に通知します。送信失敗は最大5回まで
再試行します。一人につき未送信の予約は50件までで、一覧・取消は本人の予約だけが対象です。
通知先でBotの閲覧・送信権限が必要です。予約は一回限りで、定期実行には対応していません。

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
            flags: MessageFlags.Ephemeral
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
