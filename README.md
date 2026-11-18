# 🤖 多機能Discordボット - [プロジェクト名/GitHubリンク]

多機能性と使いやすさを両立させた、高機能なDiscordボットです。サーバー管理、メンバーエンゲージメント、AI連携など、コミュニティ運営に必要なあらゆる機能を一つのボットで提供します。

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org/)
[![React](https://img.shields.io/badge/React-19.x-cyan.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.x-purple.svg)](https://vitejs.dev/)
[![Package Manager](https://img.shields.io/badge/Bun-Latest-orange.svg)](https://bun.sh/)

## ✨ 主な機能
このボットは、単なるコマンド実行を超え、コミュニティの成長を支援します。

*   **🌐 Webダッシュボード**: 直感的なUIで、サーバー設定、権限管理、各種機能の有効/無効化をブラウザからリアルタイムに操作可能。
*   **🏆 ランキングシステム**: 発言やVC参加に基づきXPを付与。ランクやロール報酬でメンバーの活動を可視化し、コミュニティ活性化を促進します。
*   **🧠 AIツール連携**: OpenAI API (`gpt-4`など)と連携し、高度な対話やコンテンツ生成を提供します。
*   **🔄 トリガー機能**: 特定のキーワードに自動反応するカスタム応答を簡単に設定。
*   **✅ TODO管理**: ユーザーごとのパーソナルなタスク管理機能を提供。
*   **🔒 スタッフ向けプライベートチャット**: モデレーター・管理者専用の安全なチャット空間。
*   **🛡️ アンチチート**: 違反行為を検出・処理し、ポリシーに基づいた罰則（`ExclusionPolicy`など）を実行します。

## 🚀 導入ガイド (クイックスタート)
1.  **前提条件**: Node.js (v18+), Bun, Discordボットのトークンとクライアントシークレット。
2.  **インストール**:
    ```bash
    git clone https://github.com/gamelist1990/Discordbot.git
    cd Discordbot
    bun install
    ```
3.  **設定**: プロジェクトルートに `config.json` を作成し、トークン、APIキー、URLなどを設定してください。（詳細はドキュメント参照）
    ```json
    {
      "token": "YOUR_DISCORD_BOT_TOKEN",
      "DISCORD_CLIENT_SECRET": "YOUR_DISCORD_CLIENT_SECRET",
      "BASE_URL": "http://localhost:3000",
      "WEB_BASE_URL": "https://your-public-domain.com",
      "owner": ["YOUR_DISCORD_USER_ID"],
      "openai": {
        "apiKey": "YOUR_OPENAI_API_KEY",
        "apiEndpoint": "https://api.openai.com/v1",
        "defaultModel": "gpt-4-turbo"
      }
    }
    ```
4.  **起動**:
    *   **開発**: `bun run dev`
    *   **本番**: `bun start` (デプロイスクリプトによりGitの最新化を自動実行します)

## 💬 主要コマンド例
ボットをサーバーに招待後、以下のスラッシュコマンドが利用可能です。

*   `/help`: 利用可能な全コマンドリストを表示。
*   `/rank [user]`: ランク、XP、進捗を表示。
*   `/ping`: ボットの応答時間（レイテンシ）を確認。
*   `/userinfo [user]`: ユーザー情報（参加日、アカウント作成日など）を表示。

## 🤝 貢献とドキュメント
*   **貢献**: プルリクエストやIssueの報告を歓迎します。まずIssueで提案内容を議論してください。
*   **詳細ドキュメント**: `docs/` ディレクトリに、アンチチートポリシー (`ANTICHEAT.md`)、コンテンツ安全ガイドライン、ランキング実装詳細 (`RANKING_IMPLEMENTATION.md`) などの詳細な仕様がまとめられています。

---
**注記:**
*   サーバー上限は **50サーバー** に設定されています。上限到達時は自動でサーバーを退出します。
*   デプロイは `start.sh` スクリプト（または `bun start`）を使用し、Gitリポジトリの最新状態を確実に反映させてください。