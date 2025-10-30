> [!NOTE]
> **このドキュメントは現在更新中です。**
> **This document is currently being updated.**

# 多機能Discordボット / Multifunctional Discord Bot

このリポジトリは、多機能なDiscordボットのソースコードです。ランキングシステム、Webダッシュボード、AIツールなど、さまざまな機能を搭載しています。
This repository contains the source code for a multifunctional Discord bot. It includes features like a ranking system, a web dashboard, AI tools, and more.

## ✨ 主な機能 / Key Features

- **コマンドシステム / Command System**: ユーザー、スタッフ、管理者向けの多彩なコマンド。/ A variety of commands for users, staff, and administrators.
- **ランキングシステム / Ranking System**: サーバー内での発言に応じて経験値を付与し、ランキングを表示します。/ Grants experience points for messages in the server and displays rankings.
- **Webダッシュボード / Web Dashboard**: ブラウザからボットの設定を簡単に行えます。/ Easily configure the bot from your browser.
  - サーバー設定の管理 / Server settings management
  - ランキングの閲覧 / View rankings
  - ロールパネルの作成 / Create role panels
  - トリガー機能の管理 / Manage trigger functions
- **トリガー機能 / Trigger Function**: 特定のキーワードに自動で反応するカスタムコマンドを作成できます。/ Create custom commands that automatically respond to specific keywords.
- **AIツール連携 / AI Tool Integration**: OpenAI APIを利用した便利なツール群。/ A collection of useful tools using the OpenAI API.
- **TODO管理 / TODO Management**: ユーザーごとにTODOリストを管理できます。/ Manage TODO lists for each user.
- **プライベートチャット / Private Chat**: スタッフ専用のプライベートなチャット機能。/ A private chat feature exclusively for staff.
- その他多数の便利機能。/ And many other useful features.

## 🛠️ 技術スタック / Tech Stack

- **バックエンド / Backend**: Node.js, TypeScript, discord.js
- **フロントエンド / Frontend**: React, TypeScript, Vite
- **パッケージマネージャー / Package Manager**: Bun

## 🚀 セットアップ方法 / Setup

### 前提条件 / Prerequisites

- Node.js (v18 or higher recommended)
- Bun
- Discord Bot Token
- Database (depending on configuration)

### インストール手順 / Installation Steps

1. **リポジトリをクローンします / Clone the repository:**
   ```bash
   git clone https://github.com/gamelist1990/Discordbot.git
   cd Discordbot
   ```

2. **依存関係をインストールします / Install dependencies:**
   ```bash
   bun install
   ```

3. **設定ファイルを作成します / Create a configuration file:**
   `src/config.ts` を参考に、必要な設定（Discordボットのトークン、データベース接続情報など）を行ってください。環境変数を使用する場合は、`.env`ファイルを作成します。
   Refer to `src/config.ts` to configure the necessary settings (Discord bot token, database connection info, etc.). If you are using environment variables, create a `.env` file.

4. **ボットを起動します / Start the bot:**
   `start.sh` スクリプトを実行するか、`package.json` に定義された起動コマンドを実行してください。
   Run the `start.sh` script or the start command defined in `package.json`.
   ```bash
   ./start.sh
   ```
   または / or
   ```bash
   bun start
   ```
   (※ `package.json`のscriptsに依存します / depends on the scripts in `package.json`)

## 使い方 / Usage

ボットをサーバーに招待後、`/help` コマンドで利用可能なコマンドの一覧を確認できます。
Webダッシュボードにアクセスすることで、より詳細な設定が可能です。

After inviting the bot to your server, you can check the list of available commands with the `/help` command.
You can access the web dashboard for more detailed settings.

## 🤝 コントリビュート / Contributing

プルリクエストやIssueの報告を歓迎します。貢献したい方は、まずIssueを立てて提案内容を議論してください。
Pull requests and issue reports are welcome. If you want to contribute, please create an issue first to discuss your proposal.

## 📝 ライセンス / License

このプロジェクトのライセンスについては、`LICENSE`ファイルを参照してください。(※ライセンスファイルが存在しないため、必要に応じて追加してください)
For the license of this project, please refer to the `LICENSE` file. (※Please add a license file if necessary, as it does not currently exist).
