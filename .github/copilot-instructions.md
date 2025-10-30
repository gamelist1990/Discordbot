# Copilot / Contributor Guide — Discordbot

この文書は、このリポジトリに対して AI エージェント（Copilot 等）や開発者が安全かつ効率的に変更を加えられるように、重要な設計方針・開発慣習・デバッグ手順を簡潔にまとめたものです。

## 重要ポイント（先に読む）
- ランタイム: Bun（Node 互換）。TypeScript + ESM。すべての実行時 import は `.js` 拡張子で終えること（例: `import { BotClient } from './core/BotClient.js';`）。
- エントリ: `src/index.ts` がフル Bot の起動エントリ。Web UI は `src/web/SettingsServer.ts` が担う。
- Web-only デバッグ: `src/web/webDebug.ts` を追加済み。Bot を起動せず Web サーバー単体で動作／Playwright によるレイアウト検査が可能。
- 永続化: Data フォルダ（`Data/`）に JSON ファイルで保存。テスト／デバッグ時は `WEB_DEBUG_NO_PERSIST=1` を使いディスク書き込みを抑制できる。

## アーキテクチャ概要

### コア技術
- Bun（実行）
- TypeScript（ESM）
- Discord.js v14（Bot）
- Express（Web API）
- Vite + React（フロントエンド）

### 要点
- コマンドは `src/commands/` に置き、`src/core/CommandLoader.ts` が再帰的に読み込みます。
- Web は `src/web/` 配下で構築。`SettingsServer` が Express アプリを組み立て、`dist/web` にビルドされたクライアントを配信します。
- セッションは `src/web/services/SessionService.ts` が管理し、トークン・権限・期限情報を保持します。

## Web デバッグ（webDebug）の使い方

目的: クラウド上の Agent や CI から「Discord OAuth にログインできない環境」でも Web レイアウトや UI を検査できるようにするための軽量モード。

- 新しいエントリ: `src/web/webDebug.ts` — 軽量な Bot スタブを用いて `SettingsServer` を起動します。
- デバッグ用エンドポイント: `/__debug/create-session` を実装。環境変数 `WEB_DEBUG_BYPASS_AUTH=1` を設定した状態で呼ぶと、テスト用セッションを作成して `sessionId` クッキーを返します。
- セッションの永続化を抑制: 環境変数 `WEB_DEBUG_NO_PERSIST=1` を設定すると、`SessionService` はディスクの読み書きを行いません（CI / テスト向け）。

推奨の起動例（PowerShell）:
```powershell
$env:WEB_DEBUG_BYPASS_AUTH = '1'
$env:WEB_DEBUG_NO_PERSIST = '1'
$env:WEB_DEBUG_PORT = '3001'
npm run webDebug
```

webDebug の挙動:
- フロントエンドを `cd src/web/client && vite build` でビルドしてから `src/web/webDebug.ts` を起動します。
- Playwright 等の E2E ツールは `/__debug/create-session` を叩いて取得した `Set-Cookie` をテスト用ブラウザにセットすれば、認証済みの状態で UI を検査できます。

## OAuth とセキュリティの注意点
- `/__debug/create-session` と OAuth バイパスは開発専用です。絶対に本番環境で `WEB_DEBUG_BYPASS_AUTH=1` を設定しないでください。
- デバッグ機能は環境変数で明示的に有効にする必要があります。公開環境で誤って有効化されないよう、デプロイ手順にチェックを入れてください。

## package.json のスクリプト（参照）
- 既存: `start`, `dev`, `web` など。
- 追加: `webDebug` スクリプトを用意しました（フロントエンドビルド → `src/web/webDebug.ts` 起動）。

例（PowerShell）:
```powershell
# Webだけ起動して手動確認
$env:WEB_DEBUG_BYPASS_AUTH = '1'
$env:WEB_DEBUG_NO_PERSIST = '1'
npm run webDebug
```

## テスト / Playwright の導入ガイダンス
- devDependencies に `@playwright/test` を追加しました。
- テスト戦略:
  - 起動: `webDebug` を起動し、`/__debug/create-session` でセッションを作る
  - Cookie を Playwright の context にセットしてページにアクセス
  - レイアウトの主要要素（ヘッダー、ナビ、主要フォーム）の存在とレスポンシブ表示を検証
  - 必要に応じてスクリーンショットを取り、差分チェックで重大な崩壊を検知できます

CI での実行ポイント:
- `npx playwright install --with-deps` を CI のセットアップステップに入れてください。
- 可能ならヘッドレスで実行し、必要に応じて失敗時にスクリーンショットを保存してアーティファクトに添付します。

## 開発時の PR チェックリスト
1. 追加したコマンド/ルートは `src/commands/...` / `src/web/routes/...` の慣習に従っているか。
2. 永続化を行う変更がある場合は `database.set()` を呼んでいるか（DB 変更は明示的に）。
3. すべての実行時 import は `.js` 拡張子で終わっているか（例: `./core/BotClient.js`）。
4. `config.json` にトークンやシークレットがベタ書きされていないか。
5. デバッグ用フラグ（`WEB_DEBUG_BYPASS_AUTH` 等）は README / PR に明記され、プロダクションで無効化される設計になっているか。

## よくある変更パターン（短く）
- Webだけの確認をしたい: `npm run webDebug` を使い、Playwright テストを作る。
- OAuth を回避して UI を取得したい: `WEB_DEBUG_BYPASS_AUTH=1` で `/__debug/create-session` を使う。
- テストでディスクを書きたくない: `WEB_DEBUG_NO_PERSIST=1` を使用。

---
このファイルに追加してほしい具体的サンプル（例: Playwright のテスト雛形、webDebug の自動 session 注入コード）を教えてください。要望があれば私がそのままファイルを作成して差分を出します。

## .github/copilot-instructions.md — Discordbot 簡潔ガイド

目的: AI エージェントがこのリポジトリで素早く安全に変更を加えられるよう、運用ルールとプロジェクト固有の慣習を短くまとめます。

重要ポイント（短く）:

- ランタイム: Bun（Node 互換）。TypeScript + ESM。インポートは必ず `.js` で終える（例: `import { BotClient } from './core/BotClient.js';`）。
- エントリ: `src/index.ts` — `config.json` を読み、`BotClient`/`CommandLoader`/`EventHandler`/`SettingsServer` を初期化する。
- コマンド: `src/core/CommandLoader.ts` が `src/commands/` を再帰検出。各コマンドは default export の `SlashCommand` を実装（`data`, `execute(interaction)`、任意で `permissionLevel` と `cooldown`）。
- 永続化: `src/core/Database.ts` が JSON（`Data/`）を管理。必ず `database.set()` を呼んで永続化。読み取りのみの `get()` は保存されない。
- イベント: `src/core/EventHandler.ts` / `src/core/EventManager.ts` により `interactionCreate`（コマンド）や `guildCreate`（自動デプロイ/参加上限）が処理される。
- Web: `src/web/SettingsServer.ts`（Express） + `src/web/client/`（Vite/React）。セッションは `Data/Auth/` に保存。

頻繁に使うコマンド:

- 依存関係: `npm install` または `bun install`
- 開発: `npm run dev`（Vite + Bot を同時起動するスクリプト）
- Bot 単体: `bun run src/index.ts`
- 型チェック: `npx tsc --noEmit`

必ず確認する PR 前チェックリスト:

1. 追加したコマンドは default export の `SlashCommand` になっているか（`src/commands/...`）。
2. DB を変更するコードは `database.set()` を呼んでいるか。
3. すべての ESM import が `.js` で終わっているか。
4. `config.json` にトークンをコミットしていないか。

代表的ファイル参照（短縮）:

- `src/index.ts` — ブートストラップ
- `src/core/CommandLoader.ts` — 自動検出ロジック
- `src/core/Database.ts` — JSON 永続化 + キャッシュ
- `src/core/EventHandler.ts` — イベントルーティング
- `src/web/SettingsServer.ts` — Web 管理
- `src/utils/Logger.ts`, `src/utils/CooldownManager.ts`, `src/utils/PermissionManager.ts`

実装例（インポート形式）:

import を間違えないでください:
```ts
// 正: ESM + .js 拡張子
import { BotClient } from './core/BotClient.js';
```

フィードバックのお願い:

この短縮版で足りない具体例（例: コマンド登録のフルサンプル、Database の回復例、EventManager の使い方）を教えてください。受け取った内容に基づき追記してマージします。
