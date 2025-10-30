# 🤖 多機能Discordボット (Multifunctional Discord Bot)

![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)
![discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)
![React](https://img.shields.io/badge/React-19.x-cyan.svg)
![Vite](https://img.shields.io/badge/Vite-5.x-purple.svg)

多機能さと使いやすさを両立させた高機能なDiscordボット。サーバー管理を効率化し、コミュニティを活性化させるための豊富な機能を提供します。

## ✨ 主な機能

このボットは、サーバー管理からメンバーエンゲージメントまで、幅広いニーズに対応する多彩な機能を搭載しています。

- **🌐 Webダッシュボード**
  - 直感的なUIでボットの設定をブラウザからリアルタイムに変更可能。
  - サーバー設定、権限管理、各種機能の有効/無効化などを簡単に行えます。

- **🏆 ランキングシステム**
  - 発言やVC参加に応じてXPを付与し、メンバーの活動を可視化。
  - ランクやロール報酬を自由にカスタマイズし、コミュニティの活性化を促進します。
  - Webダッシュボードからランキングの閲覧や設定変更が可能です。

- **🔄 トリガー機能**
  - 特定のキーワードやフレーズに自動で反応するカスタムコマンドを作成。
  - 定型的なアナウンスや面白い自動応答を簡単に設定できます。

- **🧠 AIツール連携**
  - OpenAI API (`gpt-4`など)と連携し、高度な対話機能やコンテンツ生成を実現。
  - サーバーにインテリジェントな機能を追加します。

- **✅ TODO管理**
  - ユーザーごとにTODOリストを管理できるパーソナルなタスク管理機能。

- **🔒 スタッフ用プライベートチャット**
  - モデレーターや管理者向けの安全なプライベートチャット空間を提供。

- **その他**
  - ユーザー情報表示、サーバー情報の確認など、多数の便利なコマンドを搭載。

## 🛠️ 技術スタック

- **バックエンド**: Node.js, TypeScript, discord.js, Express
- **フロントエンド**: React, TypeScript, Vite
- **パッケージマネージャー**: Bun
- **データベース**: （設定に応じて）

## 🚀 導入ガイド

### 1. 前提条件

- [Node.js](https://nodejs.org/) (v18以上を推奨)
- [Bun](https://bun.sh/)
- Discordボットのトークンとクライアントシークレット

### 2. インストール手順

1.  **リポジトリをクローンします:**
    ```bash
    git clone https://github.com/gamelist1990/Discordbot.git
    cd Discordbot
    ```

2.  **依存関係をインストールします:**
    ```bash
    bun install
    ```

3.  **設定ファイルを作成します:**
    プロジェクトのルートディレクトリ（`src`と同じ階層）に`config.json`という名前でファイルを作成し、以下の内容を参考に設定を記述します。

    ```json
    {
      "token": "YOUR_DISCORD_BOT_TOKEN",
      "DISCORD_CLIENT_SECRET": "YOUR_DISCORD_CLIENT_SECRET",
      "BASE_URL": "http://localhost:3000",
      "WEB_BASE_URL": "https://your-public-domain.com",
      "owner": [
        "YOUR_DISCORD_USER_ID"
      ],
      "openai": {
        "apiKey": "YOUR_OPENAI_API_KEY",
        "apiEndpoint": "https://api.openai.com/v1",
        "defaultModel": "gpt-4-turbo"
      }
    }
    ```
    - `token`: あなたのDiscordボットのトークン。
    - `DISCORD_CLIENT_SECRET`: Discord開発者ポータルのOAuth2ページで取得できるクライアントシークレット。
    - `BASE_URL`: ボットが内部でリッスンするURL。通常は`http://localhost:3000`のままで問題ありません。
    - `WEB_BASE_URL`: ユーザーがWebダッシュボードにアクセスするための公開URL。DiscordのOAuth2リダイレクトURLにもこのURLを設定する必要があります。
    - `owner`: ボットの所有者のDiscordユーザーID（配列形式）。
    - `openai`: OpenAI APIを使用する場合の設定。

### 3. ボットの起動

- **通常起動:**
  以下のコマンドでWebダッシュボードのUIをビルドし、ボットを起動します。
  ```bash
  bun start
  ```

- **開発モード:**
  ファイルの変更を監視し、自動で再起動する開発モードで起動します。
  ```bash
  bun run dev
  ```

- **`start.sh`について:**
  このシェルスクリプトは、Gitリポジトリから最新の変更を取得してボットを起動するためのもので、本番環境でのデプロイを想定しています。ローカルでの開発やテストでは`bun start`の使用を推奨します。

## 💬 コマンド例

ボットをサーバーに招待後、以下のスラッシュコマンドが利用できます。（一部）

- `/help`
  利用可能な全てのコマンドリストを表示します。

- `/rank [user]`
  あなたまたは指定したユーザーのランク、XP、次のランクまでの進捗を表示します。
  `user`を省略した場合は、あなた自身のランクが表示されます。

- `/ping`
  ボットの応答時間（レイテンシ）を確認します。

- `/userinfo [user]`
  あなたまたは指定したユーザーのアカウント作成日やサーバー参加日などの情報を表示します。

その他、スタッフや管理者向けのコマンドも多数用意されています。

## 🤝 コントリビュート

プルリクエストやIssueの報告を歓迎します。貢献したい方は、まずIssueを立てて提案内容を議論してください。
