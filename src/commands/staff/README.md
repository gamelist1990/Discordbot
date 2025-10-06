# Staff Command Module

スタッフ向けの管理機能を提供する拡張可能なモジュール構造のコマンドです。

## 構造

```
src/commands/staff/
├── index.ts          # メインコマンド（/staff）
├── help.ts           # ヘルプサブコマンド
├── privatechat.ts    # プライベートチャットサブコマンド
└── README.md         # このファイル
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

プライベートチャット機能を管理します。

**オプション:**
- `action` (必須): 実行するアクション
  - `create`: 新しいプライベートチャットを作成
  - `list`: 現在のプライベートチャット一覧を表示
  - `delete`: プライベートチャットを削除
  - `manage`: Web UI で管理画面を開く
- `user`: 対象ユーザー（作成時に必要）
- `chat_id`: チャットID（削除時に必要）

**例:**
```
/staff privatechat action:create user:@ユーザー
/staff privatechat action:list
/staff privatechat action:delete chat_id:1234567890
/staff privatechat action:manage
```

## プライベートチャット機能

### 概要

ユーザーとスタッフの間でプライベートな会話をするためのチャンネルを作成・管理します。

### 機能

1. **作成 (create)**
   - 指定したユーザーとのプライベートチャンネルを作成
   - 「プライベートチャット」カテゴリに自動的に配置
   - ユーザーとスタッフのみがアクセス可能

2. **一覧表示 (list)**
   - アクティブなプライベートチャットの一覧を表示
   - チャンネル情報、ユーザー、スタッフ、作成日時を確認可能

3. **削除 (delete)**
   - チャットIDを指定してプライベートチャットを削除
   - チャンネルとデータベースエントリの両方を削除

4. **Web UI管理 (manage)**
   - ブラウザからプライベートチャットを管理
   - 一時的なトークン付きURLを生成（30分間有効）
   - より視覚的で使いやすいインターフェース

### データ構造

プライベートチャット情報は以下の形式でデータベースに保存されます：

```typescript
interface PrivateChatInfo {
    chatId: string;        // チャットID
    channelId: string;     // チャンネルID
    userId: string;        // ユーザーID
    staffId: string;       // スタッフID
    guildId: string;       // サーバーID
    createdAt: number;     // 作成日時（タイムスタンプ）
}
```

## 権限

このコマンドは「サーバー管理」権限（`ManageGuild`）を持つユーザーのみが使用できます。

## 拡張性

### 新しいサブコマンドの追加方法

1. `src/commands/staff/` ディレクトリに新しいファイルを作成
2. サブコマンドハンドラー関数を実装
3. `index.ts` にサブコマンドを追加：

```typescript
// index.ts
import { handleNewSubcommand } from './newsubcommand.js';

const staffCommand: SlashCommand = {
    data: new SlashCommandBuilder()
        // ... 既存の設定 ...
        .addSubcommand(subcommand =>
            subcommand
                .setName('newsubcommand')
                .setDescription('新しいサブコマンドの説明')
        ),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        switch (subcommand) {
            // ... 既存のケース ...
            case 'newsubcommand':
                await handleNewSubcommand(interaction);
                break;
        }
    }
};
```

4. `help.ts` の `STAFF_COMMANDS` 配列にヘルプ情報を追加

### Web UI との統合

Web UI で管理する機能を追加する場合：

1. `src/web/SettingsServer.ts` に新しいAPIエンドポイントを追加
2. フロントエンド (`src/web/client/`) に管理画面を実装
3. サブコマンドから `settingsServer.createSession()` でセッションを作成
4. 生成されたトークン付きURLをユーザーに提供

## 技術的な詳細

- **データベース**: `Database` クラスを使用してJSON形式でデータを永続化
- **権限管理**: Discord.js の PermissionFlagsBits を使用
- **エラーハンドリング**: try-catch でエラーをキャッチし、適切なメッセージを返す
- **非同期処理**: すべての処理は async/await を使用

## トラブルシューティング

### プライベートチャットが作成できない

- Bot に「チャンネルの管理」権限があるか確認
- カテゴリの上限（50チャンネル）に達していないか確認

### Web UI が開けない

- 設定サーバーが起動しているか確認
- `src/index.ts` で `SettingsServer` が初期化されているか確認

### データベースエラー

- `Data/` ディレクトリに書き込み権限があるか確認
- JSON ファイルが破損していないか確認

## 今後の拡張案

- チャット履歴のエクスポート機能
- 自動クローズタイマー（一定期間無活動でチャットを閉じる）
- チャットのアーカイブ機能
- 複数スタッフの参加対応
- チャット統計情報の表示
