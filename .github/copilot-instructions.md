# Copilot Instructions for Discordbot

## Runtime & Setup
- **Runtime**: Bun or Node.js with TypeScript + ESM. All runtime imports must end with `.js` (e.g., `import { BotClient } from './core/BotClient.js';`).
- **Entry Points**: `src/index.ts` (full bot + web), `src/web/webDebug.ts` (web-only debug mode).
- **Config**: `config.json` in project root (not committed).

## Architecture Overview
- **Bot Core**: `BotClient` (Discord.js v14), `CommandLoader` (auto-loads from `src/commands/`), `EventHandler` (Discord events).
- **Web UI**: `SettingsServer` (Express) + `src/web/client/` (Vite + React). Sessions in `Data/Auth/`.
- **Persistence**: `Database` class saves JSON to `Data/` folder. Always call `database.set()` for writes; `get()` is read-only.
- **Key Managers**: `RankManager`, `TriggerManager`, `TodoManager`, etc., initialized in `src/index.ts`.

## Development Workflows
- **Install**: `bun install` or `npm install`.
- **Full Dev**: `npm run dev` (builds web + runs bot with watch).
- **Bot Only**: `bun run src/index.ts`.
- **Web Debug**: `npm run webDebug` (lightweight web server, no bot). Use `WEB_DEBUG_BYPASS_AUTH=1` for auth bypass in dev.
- **Type Check**: `npx tsc --noEmit`.

## Commands & Features
- Commands in `src/commands/` (recursive load). Export default `SlashCommand` with `data` (builder) and `execute(interaction)`. Optional: `permissionLevel`, `cooldown`.
- Web routes in `src/web/routes/`. Controllers in `src/web/controllers/`.
- Data flow: Guild-specific data via `database.set(guildId, key, data)`.

## Testing & Debugging
- **E2E**: Playwright in `tests/`. Run `webDebug` first, then `npm run test:visual`.
- **Debug Flags**: `WEB_DEBUG_NO_PERSIST=1` to skip disk writes. `WEB_DEBUG_BYPASS_AUTH=1` for OAuth bypass.
- **CI**: Install Playwright deps, run headless tests.

## PR Checklist
1. Imports end with `.js`.
2. DB changes use `database.set()`.
3. No secrets in `config.json`.
4. Commands follow `src/commands/` structure.
5. Web routes/controllers in `src/web/`.

## Key Files
- `src/index.ts`: Bootstrap.
- `src/core/CommandLoader.ts`: Command discovery.
- `src/core/Database.ts`: JSON persistence.
- `src/web/SettingsServer.ts`: Web server.
- `src/web/webDebug.ts`: Debug mode.

## Examples
Command:
```ts
import { SlashCommandBuilder } from 'discord.js';
export default {
  data: new SlashCommandBuilder().setName('ping').setDescription('Pong!'),
  execute: async (interaction) => { await interaction.reply('Pong!'); }
};
```

DB Usage:
```ts
import { database } from './core/Database.js';
await database.set(guildId, 'settings', { enabled: true });
const settings = await database.get(guildId, 'settings');
```
