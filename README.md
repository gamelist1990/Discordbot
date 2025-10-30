# Discordbot — モジュール構造版 (更新済)

モジュール化された TypeScript 製の Discord Bot（Bun / Node 互換）です。
主要機能: スラッシュコマンド、自動コマンド登録、JSON ベースの簡易 DB、Express を使った Web ダッシュボード、Playwright による UI レイアウト検査。

## 主な特徴

- ランタイム: Bun を想定（npm / npx と併用可能）
- TypeScript + ESM（実行時インポートは `.js` 拡張子で書く慣習）
- コマンドは `src/commands/` に配置し、`src/core/CommandLoader.ts` が再帰的に読み込みます
- 永続化は `Data/` 配下の JSON ファイル（`src/core/Database.ts` を通して操作）
- Web 管理画面: `src/web/SettingsServer.ts`
- Web 単体デバッグ: `src/web/webDebug.ts`（Discord 接続不要で UI テストが可能）

## 目次

1. クイックスタート
2. 必要な設定（config.json）
3. スクリプトと開発コマンド
4. webDebug と Playwright テスト
5. コマンド追加方法
6. 永続化と Data フォルダ
7. 開発時の注意点（Bun / .js import 等）
8. 貢献ガイドと PR チェックリスト

---

## 1. クイックスタート

前提: `config.json` をルートに作成し、Discord Bot トークンを設定します（例は次節）。

PowerShell の例（依存関係のインストール → フロントエンドビルド → Bot 起動）:

```powershell
# 依存関係
bun install
# または npm を使う場合
# npm install

# フロントエンドをビルド
cd src/web/client
npx vite build
cd ../../

# Bot を開発モードで起動
bun run src/index.ts
```

補足: `package.json` のスクリプトを使うと便利です（例: `npm run dev`, `npm run webDebug`）。

---

## 2. 必要な設定（`config.json` の例）

ルートに `config.json` を作成してください。必須は `token`（Bot トークン）のみです。例:

```json
{
  "token": "YOUR_DISCORD_BOT_TOKEN",
  "BASE_URL": "http://localhost:3000",
  "owner": ["123456789012345678"]
}
```

注意: 実動環境にトークンをコミットしないでください。`.gitignore` で `config.json` と `Data/` は除外されています。

---

## 3. 主要スクリプト

主要な npm スクリプト（`package.json` を参照）:

- `npm run dev` — フロントエンドのビルドと Bot の監視起動（開発用）
- `npm run start` — フロントエンドをビルドして Bot を起動
- `npm run web` — フロントエンドのビルド（`src/web/client`）
- `npm run webDebug` — webDebug を起動（フロントエンドをビルドしてから `src/web/webDebug.ts` を実行）
- `npm run test:playwright` — Playwright による UI テストを実行

Bun を使ったネイティブバイナリのビルドも `package.json` に用意されています（`npm run auto` / `npm run windows-64` 等）。

---

## 4. webDebug と Playwright テスト

`webDebug` は Discord OAuth を必要としない軽量モードです。CI やローカルでフロントエンドのレイアウト検査を行う際に便利です。

PowerShell での起動例（テスト用セッションの自動生成を許可）:

```powershell
$env:WEB_DEBUG_BYPASS_AUTH = '1'
$env:WEB_DEBUG_NO_PERSIST = '1'   # ディスク永続化を無効化
$env:WEB_DEBUG_PORT = '3001'

npm run webDebug
```

Playwright 流れ:
1. `webDebug` を上記の通り起動
2. テストは `GET /__debug/create-session` で取得したセッション cookie を注入してページにアクセスします
3. `npm run test:playwright` でテストを実行

注意: `WEB_DEBUG_BYPASS_AUTH` は開発用フラグです。本番環境で有効にしないでください。

---

## 5. 新しいコマンドの追加方法

1. `src/commands/` 配下に新しいファイルを作成します（例: `src/commands/example/hello.ts`）。
2. `SlashCommandBuilder` ベースで `data` と `execute` を実装します。
3. Bot を再起動すると `CommandLoader` により自動検出されます。

短いテンプレート:

```ts
import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { SlashCommand } from '../../types/command.js';

export const command: SlashCommand = {
  data: new SlashCommandBuilder().setName('hello').setDescription('挨拶します'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply('こんにちは！');
  }
};

export default command;
```

---

## 6. 永続化（Data フォルダ）

永続化は `Data/` 以下に JSON ファイルとして保存されます。`src/core/Database.ts` を通じて読み書きしてください。テスト実行中は `WEB_DEBUG_NO_PERSIST=1` によってディスク書き込みを抑止できます。

---

## 7. 開発時の注意点 / よくある落とし穴

- 実行時の ESM import は `.js` 拡張子を使う慣習があります（例: `import { BotClient } from './core/BotClient.js';`）。TypeScript → 実行時に解決される点に注意してください。
- Bun を推奨しますが、npm / node での実行も可能です（README では両方の例を提示しています）。どちらを標準にするかはリポジトリ方針で統一してください。
- `config.json` と `Data/` を誤ってコミットしないでください（トークン漏洩の危険）。

---

## 8. 貢献 & PR チェックリスト

必ず確認してください:

- 追加した実行時 import は `.js` で終わっているか
- DB を変更するコードは `database.set()` を呼んで永続化しているか
- デバッグフラグ（`WEB_DEBUG_BYPASS_AUTH` 等）は README と PR に明記され、本番で無効化される設計か

---

## 主要ファイル（参照用）

- `src/index.ts` — Bot のエントリ
- `src/config.ts` — 設定ローダ（必須キーを確認）
- `src/core/BotClient.ts` — Discord クライアントと起動処理
- `src/core/CommandLoader.ts` — コマンド自動読み込み
- `src/core/Database.ts` — JSON 永続化レイヤ
- `src/web/SettingsServer.ts` — Express ベースの Web ダッシュボード
- `src/web/webDebug.ts` — Web 単体デバッグ用エントリ
- `test/playwright/layout.spec.ts` — Playwright テスト例

---

## ライセンス

MIT

---

もし README の文言や「Bun をデフォルトにする／しない」などポリシー面で決めたいことがあれば教えてください。決定に合わせて README をさらに調整します。
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

## 🔎 Web の単体デバッグ (webDebug)

開発や CI で「Discord OAuth にログインできない環境」からでも Web UI のレイアウト検査を行うための軽量モードです。

ポイント:
- `src/web/webDebug.ts` を追加し、軽量な Bot スタブで `SettingsServer` を単体起動します。
- デバッグ用に `GET /__debug/create-session` を用意しており、環境変数 `WEB_DEBUG_BYPASS_AUTH=1` を設定するとテスト用セッションを生成し `sessionId` クッキーを返します。
- テスト実行中にディスクへ書き込みたくない場合は `WEB_DEBUG_NO_PERSIST=1` を設定してください（セッションの永続化を無効化します）。

推奨の起動例（PowerShell）:
```powershell
# 環境変数を設定して webDebug を起動
$env:WEB_DEBUG_BYPASS_AUTH = '1'
$env:WEB_DEBUG_NO_PERSIST = '1'
$env:WEB_DEBUG_PORT = '3001'

# フロントエンドをビルドして server を起動
npm run webDebug
```

手動でセッションを作成するには（Playwright 等のテストランナーから）:

1. `GET http://localhost:3001/__debug/create-session` を叩く
2. レスポンスに Set-Cookie ヘッダが含まれるので、Playwright の context に設定してページを開くと認証済み状態でテストが可能

注意: `/__debug/create-session` は開発専用です。絶対に本番環境で `WEB_DEBUG_BYPASS_AUTH=1` を設定しないでください。

## 🧪 Playwright によるレイアウト検査（簡易手順）

1. 依存関係をインストール（初回のみ）:
```powershell
npm install
npx playwright install --with-deps
```

2. webDebug を別ターミナルで起動（上の PowerShell 例を参照）

3. Playwright テストを実行:
```powershell
npm run test:playwright
```

テストの実行方針:
- テスト先頭で `GET /__debug/create-session` を実行して session cookie を取得し、ブラウザコンテキストに注入します。
- デスクトップ幅とモバイル幅で主要な要素（ヘッダー、サイドバー、主要フォーム）が表示されるかを確認します。
- 必要に応じてスクリーンショット差分を CI に保存し、レイアウトの重大な崩れを検出します。

CI での注意点:
- `npx playwright install --with-deps` を必ず含めてください。
- テストはヘッドレスで実行するのが安定します。失敗時にスクリーンショットをアーティファクトとして保存する設定が便利です。


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
