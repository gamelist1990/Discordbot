# Discord Bot - モジュール構造版

TypeScript で実装された Discord Bot のモジュール化されたプロジェクトです。スラッシュコマンドと JSON ベースのデータベースシステムを使用しています。

## 📁 プロジェクト構造

```

## 開発用ショートカット

ローカル開発で web クライアントの Vite 開発サーバと Bot を同時に起動するには:

Windows (PowerShell) の例:

```powershell
npm run dev
```

このスクリプトはプロジェクトルートで `vite` (web クライアント) と `bun index.ts` (Bot) を同時に実行します。
Discordbot/
├── src/
│   ├── index.ts                # エントリポイント
│   ├── core/                   # コアモジュール
│   │   ├── BotClient.ts       # Discord クライアント管理
│   │   ├── EventHandler.ts    # イベント処理
│   │   ├── CommandLoader.ts   # コマンド自動読み込み
│   │   └── Database.ts        # JSON データベース
│   ├── commands/               # スラッシュコマンド
│   │   ├── utility/           # ユーティリティコマンド
│   │   │   ├── ping.ts        # Ping コマンド
│   │   │   └── info.ts        # Bot 情報コマンド
│   │   └── admin/             # 管理者コマンド
│   │       └── database.ts    # データベース操作コマンド
│   ├── utils/                  # ユーティリティ
│   │   ├── Logger.ts          # ロガー
│   │   ├── PermissionChecker.ts # 権限チェック
│   │   └── CooldownManager.ts # クールダウン管理
│   └── types/                  # 型定義
│       └── command.ts         # コマンドの型
├── Data/                       # データベースフォルダ（自動生成）
├── config.json                 # Bot 設定ファイル
├── config.example.json         # 設定ファイルのサンプル
├── package.json
├── tsconfig.json
└── README.md
```

## 🚀 セットアップ

### 1. 依存関係のインストール

```bash
bun install
# または
npm install
```

### 2. 設定ファイルの作成

`config.example.json` をコピーして `config.json` を作成し、Bot トークンを入力してください。

```json
{
  "token": "YOUR_BOT_TOKEN_HERE"
}
```

**必要な設定はトークンのみです！**
- ~~clientId~~ → 不要（自動取得）
- ~~guildId~~ → 不要（全サーバー自動対応）
- ~~deployGlobal~~ → 不要（自動デプロイ）

### 3. Bot の起動

```bash
# 開発環境
bun run src/index.ts

# ビルド（本番環境用バイナリ）
bun run auto           # 全プラットフォーム
bun run windows-64     # Windows x64
```

## 🎯 機能

### ✅ 実装済み機能

- **簡単セットアップ**: トークンのみで起動可能
- **自動デプロイ**: 全サーバーに自動的にコマンドをデプロイ
- **サーバー上限管理**: 最大50サーバーまで対応
  - 上限超過時は自動退出
  - オーナーにDM通知
- **モジュール構造**: Core、Commands、Utils に分離された設計
- **スラッシュコマンド**: Discord.js v14 の ApplicationCommand に対応
- **4段階権限システム**: ANY / STAFF / ADMIN / OP
- **自動コマンド読み込み**: `src/commands/` 配下のコマンドを自動検出
- **JSON データベース**: `Data/` フォルダに JSON ファイルとして保存
- **イベントハンドリング**: Discord イベントの集中管理
- **ロガー**: 色付きコンソールログ
- **権限チェック**: 管理者・モデレーター権限の確認
- **クールダウン管理**: コマンドの連続実行制限

### 📦 標準コマンド

| コマンド | 説明 | 権限 |
|---------|------|------|
| `/ping [detailed]` | Bot の応答速度を確認 | ANY |
| `/info` | Bot の詳細情報を表示 | ANY |
| `/userinfo [user]` | ユーザー情報を表示 | ANY |
| `/servers` | Bot が参加しているサーバー一覧 | OP |
| `/db set <key> <value>` | データベースに保存 | ANY |
| `/db get <key>` | データベースから取得 | ANY |
| `/db delete <key>` | データベースから削除 | ANY |
| `/db list` | すべてのキーを表示 | ANY |

## ⚙️ サーバー上限機能

Bot は**最大50サーバー**までサポートします。

### 動作:
1. **50サーバー以下**: 通常通り動作
2. **51サーバー目を追加**: 
   - サーバーオーナーにDM通知
   - 自動的にそのサーバーから退出
   - ログに記録

### ログ例:
```
📥 新しいサーバーに参加: Example Server (ID: 123456789)
📊 現在のサーバー数: 51/50
⚠️ サーバー上限 (50) を超えました。サーバーから退出します: Example Server
✅ サーバーから退出しました: Example Server
```

## 🛠️ 新しいコマンドの追加方法

### 1. コマンドファイルを作成

`src/commands/` 配下に新しい `.ts` ファイルを作成します。

```typescript
// src/commands/example/hello.ts
import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { SlashCommand } from '../../types/command.js';

export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('hello')
        .setDescription('挨拶します')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('名前')
                .setRequired(true)
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        const name = interaction.options.getString('name', true);
        await interaction.reply(`こんにちは、${name}さん！`);
    }
};

export default command;
```

### 2. Bot を再起動

コマンドローダーが自動的に新しいコマンドを検出して登録します。

## 💾 データベースの使い方

```typescript
import { database } from './core/Database.js';

// データを保存
await database.set('myKey', { foo: 'bar', count: 42 });

// データを取得
const data = await database.get('myKey');

// データの存在確認
const exists = await database.has('myKey');

// データを削除
await database.delete('myKey');

// すべてのキーを取得
const keys = await database.keys();
```

データは `Data/` フォルダに JSON ファイルとして保存されます。

## 🔧 開発ガイド

### Core モジュール

- **BotClient**: Discord クライアントの初期化とコマンド管理
- **EventHandler**: Discord イベントのリスナー登録
- **CommandLoader**: コマンドの自動読み込みと登録
- **Database**: JSON ベースのデータ永続化

### Utils モジュール

- **Logger**: カラフルなコンソールログ出力
- **PermissionChecker**: ユーザー権限の確認
- **CooldownManager**: コマンドのクールダウン制御

### 型定義

- **Command**: レガシーメッセージコマンド（後方互換性）
- **SlashCommand**: スラッシュコマンドの型定義

## 📝 注意事項

- `config.json` には Bot トークンが含まれます。**絶対に公開しないでください**
- `.gitignore` に `config.json` と `Data/` フォルダが追加されています
- 開発時は `guildId` を設定してギルド固有のコマンドとしてデプロイすることを推奨します（即座に反映されます）
- グローバルコマンドは反映に最大1時間かかる場合があります

## 🐛 トラブルシューティング

### コマンドが表示されない

1. `config.json` の `clientId` が正しいか確認
2. Bot に `applications.commands` スコープが付与されているか確認
3. ギルドにコマンドをデプロイする場合は `guildId` を設定

### データベースエラー

1. `Data/` フォルダの書き込み権限を確認
2. JSON ファイルが破損していないか確認

## 📄 ライセンス

MIT

## 👤 作者

Koukunn_

## 🔗 リンク

- [GitHub Repository](https://github.com/gamelist1990/PEXclient)
