# Copilot Instructions for Discordbot

_See also `CLAUDE.md` for complementary AI guidance and style preferences._

This document highlights repo-specific conventions and actionable patterns for AI coding agents. Keep small, focused edits and prefer following existing patterns rather than introducing new architecture.

## Quick Runtime & Setup
- **Runtime**: Bun or Node.js (ESM + TypeScript). Imports must end with `.js` at runtime (e.g., `import { BotClient } from './core/BotClient.js';`).
- **Entry Points**: `src/index.ts` (full bot + web), `src/web/webDebug.ts` (web-only debug server).
- **Config**: `config.json` in project root; it is not committed. Avoid leaking secrets — the repo uses `config.json` for local configuration and `config.js` import in some runtime code.

## Architecture Overview (important for changes)
- **Bot Core**: `BotClient` (discord.js) manages the REST client, command registration and guild lifecycle. `EventHandler` wires command handling and lifecycle events; `EventManager` emits custom events.
- **Command System**: `CommandLoader` loads files recursively from `src/commands/`, handles both legacy `SlashCommand` objects and new `DynamicCommandOptions`. Commands may be `.ts` in source, we import them at runtime with `file:///` URL and `.js` extension.
- **Web UI**: `SettingsServer` (Express) + `src/web/client/` (Vite + React). The server serves static files from `dist/web` and provides API endpoints under `/api`. Web debug mode and Vite dev server are supported.
- **Persistence**: `Database` (src/core/Database.ts) persists to `Data/` as JSON files. Writes must use `database.set()`; `database.getAll(guildId)` understands both legacy flat keys (`<guildId>_key.json`) and new `Guild/<guildId>/<key>.json` layouts.
- **Key Managers**: `RankManager`, `TriggerManager`, `AntiCheatManager`, `StatsManager`, `TodoManager`, `PrivateChatManager` and `RolePresetManager` are created/initialized in `src/index.ts` or lazy-imported as needed.

## Implementation notes & common patterns
- Lazy/dynamic imports are used throughout to reduce startup time and avoid circular dependencies (e.g., `import('./core/RankManager.js')` inside handlers). If adding heavy dependencies, prefer lazy imports inside event handlers.
- Rule for Windows path -> URL conversion are used before import: `fileUrl = 'file:///${path.replace(/\\/g, '/')}'`.
- The backend prefers guild-specific REST commands (not global), and `BotClient` includes logic to skip deploy when unchanged.

## Development Workflows & commands
- Install: `bun install` or `npm install`.
- Dev (UI + Bot watch): `bun run dev` or `npm run dev` (concurrently builds web and runs Bun with --watch).
- Build & Run (production-like): `bun start` (builds web + runs bot); for web-only debug: `npm run webDebug` or `npm run webserver`.
- Type check: `npx tsc --noEmit`.
- Visual tests: start web debug server (or `bun start`) then run `npm run test:visual*` (Playwright test harnesses expect UI running).
- Useful env flags: `WEB_DEBUG_BYPASS_AUTH=1` (create debug sessions in web), `WEB_DEBUG_NO_PERSIST=1` (skip DB writes in dev), set `BASE_URL`/`WEB_BASE_URL` in `config.json`.

## Commands & Features (patterns AI should preserve)
- Commands live in `src/commands/` and are auto-discovered. A command file should export a default object—either a `SlashCommand` (legacy) or `DynamicCommandOptions` (new):
  - Legacy `SlashCommand`: has `data` (SlashCommandBuilder) and `execute(interaction)`. If `permissionLevel` exists on a legacy command, `CommandLoader` wraps it into a dynamic command to preserve builder metadata.
  - Dynamic commands (`DynamicCommandOptions`) use `{ name, description, builder?, execute, permissionLevel?, cooldown?, guildOnly? }`. The optional `builder` callback is used to add subcommands and options (example: `src/commands/staff/subcommands/rolepanel.ts`).
- `CommandLoader` excludes `staff/subcommands` from recursive scanning and converts Windows paths to `file:///` import URL.
- Use `database.set(guildId, key, data)` for writes and `database.get(guildId, key)` for reads (prefer `getAll` for migrations/exports).
- Commands are deployed only to guild-specific commands; `BotClient.deployCommandsToAllGuilds()` updates per-guild commands and clears global commands. The bot also auto-deploys commands when joining a new server:
  - Max official guild limit for changes: 50 (see `BotClient.MAX_GUILDS`).

## Testing & Debugging
- Visual/E2E tests are in `tests/` and require the web server to be running (run `webDebug` or `webserver`).
- For local runs, use `npx playwright install` if the CI complains.
- Debug flags: `WEB_DEBUG_NO_PERSIST=1` to skip persistence in tests, `WEB_DEBUG_BYPASS_AUTH=1` to create debug sessions.

## PR Checklist (important & enforceable)
1. Runtime imports end with `.js` (e.g., `import { X } from './foo.js'`).
2. DB writes must go through `database.set()`; use `get()` for read-only and prefer `getAll` for migration tasks.
3. Do not commit secrets (`config.json` should not be committed). Mask tokens in logs.
4. Commands: export default `SlashCommand` or `DynamicCommandOptions`. When adding subcommands, use `builder` callback.
5. Web routes and controllers: add API handlers under `src/web/routes/` and controllers under `src/web/controllers/`.
6. Tests: add Playwright UI tests in `tests/`, ensure `webDebug` runs for tests that exercise UI.
7. Keep `CLAUDE.md` (or other AI guidance files) in sync with this document when updating style or instructions.

## Key files to reference
- `src/index.ts` — bootstrap: initializes managers, deploys commands, starts `SettingsServer`.
- `src/core/CommandLoader.ts` — recursive loading and conversion rules.
- `src/core/Database.ts` — JSON persistence, `Data/` layout and `Guild/<guildId>/` support.
- `src/core/BotClient.ts` — registration, deployment, and guild limit handling.
- `src/core/EventHandler.ts` — event wiring, permission checks and cooldown behavior.
- `src/web/SettingsServer.ts`, `src/web/webDebug.ts` — web UI server, debug routes, cookie helpers.

## Examples & Common snippets
- Legacy SlashCommand (permission + cooldown optional):
```ts
import { SlashCommandBuilder } from 'discord.js';
export default {
  data: new SlashCommandBuilder().setName('ping').setDescription('Pong!'),
  permissionLevel: 0,
  async execute(interaction) { await interaction.reply('Pong!'); }
};
```
- Dynamic command with builder (subcommands example — see `src/commands/staff/subcommands/rolepanel.ts`):
```ts
export default {
  name: 'rolepanel',
  description: 'Post and manage role panels',
  builder: (b) => b.setName('rolepanel').addStringOption(opt => opt.setName('preset').required(true)),
  execute: async (interaction) => { /* ... */ }
};
```
- Database read/write:
```ts
import { database } from './core/Database.js';
await database.set(guildId, 'settings', { enabled: true });
const settings = await database.get(guildId, 'settings');
const all = await database.getAll(guildId); // returns both legacy and Guild/ layout
```

---

If anything here is unclear or you'd like an opinionated default (e.g., preferred command shape or module-level decorators), tell me which area to expand and I’ll update the doc.
