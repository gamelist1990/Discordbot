## このリポジトリでの AI エージェント向け要点

以下はこの Discord 管理ボットリポジトリで素早く生産的に動けるようにするための最小限のガイドです。

1) 目的とエントリポイント
- アプリは TypeScript で実装された Discord ボット管理ツールです。
- エントリポイント: `src/index.ts`。ここで設定ファイル(`config.json`)の読み込み、静的/動的コマンドの登録、Discord クライアント作成、イベントルーティング、ログインを行います。

2) 起動とビルド
- 開発: このプロジェクトは Bun を使用するビルドスクリプトを package.json の `scripts` に持ちます（例: `bun build src/index.ts --compile ...`）。ただしローカル実行は `node`/`ts-node` ではなく、ソースは直接 `ts` から動的に import しているため、TypeScript のトランスパイルが前提です。
- 重要: 実行時に `config.json` がルート（プロジェクトのカレントディレクトリ）に存在し、`token` フィールドに有効な Discord Bot トークンが必要です。`src/index.ts` は存在しない/無効なトークン時に CLI プロンプトで入力を求めます。

3) 主要ディレクトリとパターン
- 静的コマンド: `src/modules/import.ts` が `src/modules` 以下の各コマンドモジュールを import して登録します。これらは `registerCommand(...)` を通じて `src/index.ts` の `commands` コレクションに登録されます。
- 動的プラグイン: `src/index.ts` の `PLUGINS_DIR = path.join(__dirname, 'plugins')` に `.js`/`.mjs` ファイルを置くと起動時に動的に読み込まれます（CJS と ESM を判別）。
- コマンド形: `src/types/command.ts` の `Command` インターフェースに従う必要があります。必須プロパティ: `name`, `description`, `execute(client, message, args)`。`handleInteraction` はオプション。

4) 権限と管理者チェック
- グローバル/ギルド管理者は `config.json` の `globalAdmins` / `guildAdmins` に記録されます。管理者向けコマンドには `admin: true` が設定されます。権限チェックは `isAdmin` / `isGlobalAdmin` / `isGuildAdmin` を使って行ってください。

5) レート制限と安全策
- `src/index.ts` 内に簡単なレート制限実装あり（短時間に複数コマンドを送るユーザを一時的にブロック）。コマンド実装では長時間処理する場合は適切に例外処理を行い、ユーザ通知を行ってください。

6) 例外・ログと終了処理
- グローバルの `uncaughtException` / `unhandledRejection` ハンドラと、`SIGINT`/`SIGTERM` の終了処理が `src/index.ts` に実装されています。クリーンアップを行うため `client.destroy()` を呼ぶ必要があります。

7) 重要なファイル参照（実例）
- `src/index.ts` — エントリ、イベントルーティング、動的プラグインの読み込み
- `src/modules/import.ts` — 静的コマンドの import 一覧（追加はここに import 文を追加）
- `src/modules/static-loader.ts` — 動的プラグインディレクトリ(`plugins/`)を読み込む
- `src/types/command.ts` — コマンドの型定義
- `config.json` (ルートの `src/config.json` を利用する場合あり) — Bot トークンや管理者設定

8) 変更時の具体例（PR 作成のための指示）
- 新しい静的コマンドを追加する場合:
  - 新しいディレクトリ `src/modules/<Name>/index.ts` を作成し、`registerCommand(...)` を呼ぶ `Command` をエクスポートしてください。
  - `src/modules/import.ts` に import 文を追加してビルド時に自動登録されるようにします。
- 動的プラグインを追加する場合:
  - `plugins/` に CJS (`.js`) または ESM (`.mjs`) でエクスポートされた `default` または `exports.command` を含むファイルを置きます。

9) CI/自動レビューとの関連
- `.github/workflows/claude-code-review.yml` と `claude.yml` が存在します。これらは `CLAUDE.md` を参照していますが現時点で `CLAUDE.md` はリポジトリにありません。自動レビューで日本語応答が要求されています。

10) 制約と注意点（AI への指示）
- 変更はまず TypeScript の静的型に準拠させること（`src/types/command.ts` を参照）。
- `config.json` の変更やトークン取り扱いは慎重に。実行/テストで認証情報を取り扱う場合はダミー値を使って下さい。
- Node/Bun のランタイム差分に注意。package.json は Bun の `bun build` を使うスクリプトを包含しているが、エディタでの開発は TypeScript の通常のトランスパイル/ランで代替可能。

11) 追加情報を求めるべき点（ユーザへの質問）
- CIで期待するテスト/ビルド手順（GitHub Actions での TypeScript ビルド推奨かどうか）。
- config.json のサンプル（機密を含まない形で）を用意して良いかどうか。

このファイルの内容に問題がなければ、マージして `.github/` に追加します。追加で `CLAUDE.md` を作る必要があれば指示をください。
