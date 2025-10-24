# Copilot Instructions for Discord Bot

This guide helps AI agents understand the architecture and development patterns of this TypeScript Discord Bot project.

## Architecture Overview

### Core Stack
- **Runtime**: Bun (with Node.js compatibility for local dev)
- **Language**: TypeScript with ESM modules
- **Framework**: Discord.js v14
- **Web UI**: Vite + React
- **Database**: JSON file-based (no external DB required)

### Major Components

#### 1. **Bootstrap & Lifecycle** (`src/index.ts`)
- Loads `config.json` (token masked in logs automatically)
- Initializes `BotClient`, `CommandLoader`, `EventHandler`, and `SettingsServer`
- Flow: `index.ts` → `BotClient.login()` → commands auto-load → event handlers registered

#### 2. **Command System** (`src/core/CommandLoader.ts`, `src/commands/`)
- **Auto-discovery pattern**: `CommandLoader` recursively scans `src/commands/` for `.ts`/`.js` files
- **Command interface** (`src/types/command.ts`): 
  - Implement `SlashCommand` with `data` (SlashCommandBuilder) and `execute(interaction)`
  - Optional: `permissionLevel`, `cooldown` fields
- **Subcommands**: Nested in `subcommands/` folders (e.g., `src/commands/staff/subcommands/`)
- **Permission levels**: ANY, STAFF, ADMIN, OP (defined in `src/web/types/permission.ts`)

#### 3. **Event System** (`src/core/EventHandler.ts`, `src/core/EventManager.ts`)
- **EventHandler**: Maps Discord.js events to command execution and handlers
- **EventManager**: Unified custom event system (caution: not strictly typed for custom events)
- **Key events**: `guildCreate` (auto-deploy commands), `interactionCreate` (route to command execute)

#### 4. **Data Persistence** (`src/core/Database.ts`, `Data/` folder)
- **JSON-backed**: Stores all data in `Data/` as JSON files
- **Cache layer**: In-memory cache to reduce file I/O
- **API**: `database.set(guildId, key, data)` and `database.get(guildId, key, defaultValue)`
- **Pattern**: File paths auto-created; supports nested directories (e.g., `Guild/{guildId}/settings.json`)

#### 5. **Web Dashboard** (`src/web/SettingsServer.ts`, `src/web/client/`)
- **Express server** on configurable port (default 3000)
- **Session-based auth**: `SessionService` manages tokens (stored in `Data/Auth/`)
- **Routes structure**: `src/web/routes/` organizes endpoints (feedback, settings, rank, etc.)
- **Frontend**: Vite + React; built to `src/web/client/dist/`

### Data Flow: Command Execution
```
User types slash command
  ↓
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
