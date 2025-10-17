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
Discord → Bot (interactionCreate event)
  ↓
EventHandler routes to CommandRegistry
  ↓
CommandRegistry looks up command from BotClient.commands Collection
  ↓
Command.execute(interaction) runs
  ↓
Often reads/writes to Database → JSON in Data/
```

---

## Project-Specific Patterns & Conventions

### 1. Command Registration
All commands must export default a `SlashCommand` object:
```typescript
const myCommand: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('mycommand')
        .setDescription('Does something'),
    permissionLevel: PermissionLevel.STAFF,  // Optional
    cooldown: 5,  // Optional (seconds)
    async execute(interaction: ChatInputCommandInteraction) {
        // Command logic
    }
};
export default myCommand;
```
- Avoid static imports; `CommandLoader` discovers files automatically.
- Place command files under `src/commands/{category}/` (e.g., `any`, `staff`, `admin`, `owner`).

### 2. Permission System
- Stored in web settings, retrieved via `SessionService` or database.
- Levels: 0 = ANY, 1+ = STAFF, 2+ = ADMIN, 3+ = OP.
- Check in command: compare `permissionLevel` field (web layer enforces during route handling).

### 3. Cooldown Handling
- Use `cooldownManager` singleton from `src/utils/CooldownManager.ts`.
- Pattern: Set `cooldown` field on command, EventHandler checks automatically.
- Fallback: Manually call `cooldownManager.check(commandName, userId, seconds)`.

### 4. Database Patterns
- **Always validate JSON** before reading/writing to `Data/` (handle corrupted files).
- **Guild-scoped data**: Store as `{guildId}_{key}.json` or nested under `Guild/{guildId}/`.
- **Global data**: Use `Global/` prefix or absolute paths (e.g., `Global/feedback.json`).
- **Use cache**: `Database.get()` caches results; call `.set()` to persist changes.

### 5. Event Manager Usage
- Custom events defined in `src/types/events.ts` (e.g., `Event.READY`, `Event.COMMAND_EXECUTED`).
- Register: `eventManager.register(Event.SOME_EVENT, handler, { once: true })`.
- Emit: `eventManager.emit(Event.SOME_EVENT, payload)`.

### 6. Web Routes & Controllers
- Routes live in `src/web/routes/`; controllers in `src/web/controllers/`.
- Controllers handle business logic; call DB, managers, etc.
- Example: `FeedbackController.ts` interacts with feedback data in `Data/Global/Feedback.json`.

### 7. Logger Usage
- Use `Logger` from `src/utils/Logger.ts` (console + color output).
- Methods: `Logger.info()`, `Logger.warn()`, `Logger.error()`, `Logger.success()`.
- Tokens are already masked in startup logs.

### 8. File I/O and Module Imports
- Use ESM imports (`import ... from ...`); no CommonJS.
- Always use `.js` extension in import paths (even for `.ts` sources) for Bun compatibility.
- Example: `import { BotClient } from './core/BotClient.js';`

---

## Development Workflow

### Local Development
```bash
# Install dependencies
npm install

# Run bot + web dev server together (watch mode)
npm run dev

# Run bot alone
bun run src/index.ts

# Type-check only
npx tsc --noEmit
```

### Build & Deployment
```bash
# Cross-platform binary builds (uses Bun)
npm run auto              # All targets
npm run windows-64        # Windows
npm run linux             # Linux x64
# etc.

# Web client only
npm run web
```

### Configuration
- **Required**: `config.json` with `token` field (repo root, ignored by git).
- Example: `config.example.json` provided.
- Tip: No clientId, guildId, or deployGlobal fields needed—auto-detected.

---

## Critical Review Checkpoints

When reviewing code changes:

1. **Type safety** (`src/types/command.ts`): Ensure exported commands match `SlashCommand` interface.
2. **No secrets leaked**: Confirm `config.json` is not committed; tokens are masked in logs.
3. **Long-running handlers**: Guard with try/catch; don't block event loop.
4. **File I/O**: Validate JSON before parsing; handle `ENOENT` errors.
5. **Database updates**: Always call `.set()` after mutations; verify cache invalidation.
6. **Permission checks**: Enforce via `SessionService` or command `permissionLevel` field.

---

## Key Files Reference

| File/Dir | Purpose |
|----------|---------|
| `src/index.ts` | Bootstrap; loads config, initializes services |
| `src/core/BotClient.ts` | Discord client wrapper; manages guild limits (MAX_GUILDS=50) |
| `src/core/CommandLoader.ts` | Auto-discovers and registers commands |
| `src/core/EventHandler.ts` | Routes Discord events to handlers |
| `src/core/Database.ts` | JSON persistence layer with cache |
| `src/types/command.ts` | Command interface definitions |
| `src/web/SettingsServer.ts` | Express server for web dashboard |
| `src/web/client/` | Vite + React frontend |
| `Data/` | Runtime JSON data (Git-ignored) |
| `CLAUDE.md` | Additional AI guidance (referenced by CI) |

---

## Common Pitfalls

- **ESM imports**: Always include `.js` extension; forget and Bun bundler fails.
- **Database not persisted**: Must call `.set()` to write to disk; `.get()` only reads.
- **Command not discovered**: File must be under `src/commands/` and default-export a `SlashCommand`.
- **Token leaked**: Config values in logs → check logs are masked in `src/index.ts:39-55`.
- **Guild limit exceeded**: Bot auto-exits if guild count > 50; owner receives DM.

---

## Notes for AI Agents

- **CI enforces Japanese**: PR review comments from workflows use Japanese (see `.github/workflows/claude-code-review.yml`).
- **Bun vs Node**: Confirm runtime choice before invoking build scripts; Bun is primary for cross-target binaries.
- **Refer to CLAUDE.md**: Comprehensive guidance is also in `CLAUDE.md`; keep both files in sync.
