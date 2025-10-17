# CLAUDE.md

This file provides concise, machine-actionable guidance to Claude Code (claude.ai/code) and automated reviewers working on this repository.

Purpose
- Provide actionable guidance for automated reviewers and Claude Code instances used by this project (CI and local development).

Important files and entry points
- Entry point / bootstrap: [`src/index.ts`](src/index.ts:1) — reads `config.json` (repo root) or `src/config.ts`, initializes BotClient and services, loads commands, and registers event handlers. See startup flow at [`src/index.ts:65-115`](src/index.ts#L65-L115).
- Command loader: [`src/core/CommandLoader.ts`](src/core/CommandLoader.ts:1) — discovers and registers command modules; invoked during startup from [`src/index.ts:91-99`](src/index.ts#L91-L99).
- Core runtime pieces: [`src/core/`](src/core/:1) (BotClient, EventHandler, Database) — implement client lifecycle, event mapping, and JSON persistence.
- Commands: [`src/commands/`](src/commands:1) — command implementations follow types in [`src/types/command.ts`](src/types/command.ts:1).
- Utilities: [`src/utils/`](src/utils:1) — logger, permission checks, cooldowns, status manager.
- Web dashboard: [`src/web/`](src/web:1) and [`src/web/client`](src/web/client:1) — Vite-based client and SettingsServer integration (`src/web/SettingsServer.ts`).
- Data store: [`Data/`](Data/:1) — runtime JSON files persisted by the Database module.
- CI / AI hints: [.github/copilot-instructions.md](.github/copilot-instructions.md:1) and [.github/workflows/claude-code-review.yml](.github/workflows/claude-code-review.yml:1).

Development commands (run from repository root)
- Install dependencies:
  - bun install
  - or npm install
- Development (web client + bot together):
  - npm run dev
- Run bot directly (development):
  - bun run src/index.ts
- Build distributables (Bun cross-target builds):
  - npm run auto            # build all targets
  - npm run windows-64
  - npm run linux
  - npm run macOS-64
  - npm run macOS-arm
- Web client build:
  - npm run web
- Quick type-check (recommended before commits):
  - npx tsc --noEmit

Tests
- There are test files under [`test/`](test/:1), but this repository currently has no standardized "test" npm script configured in `package.json`. When adding tests, prefer adding an npm script named "test".
- Example single-test commands you can use once tests are added:
  - npx vitest path/to/test --run
  - node --loader ts-node/esm path/to/test.ts
- Add a short npm script to run a specific test file for developer convenience.

High-level architecture (big picture)
- Runtime: TypeScript sources executed via Bun in CI/production builds, but Node-based workflows work for local development. Confirm Bun vs Node before running build scripts.
- Responsibilities and boundaries:
  - Bootstrap & config: [`src/index.ts`](src/index.ts:1) handles loading `config.json` (token masked in logs), status manager initialization, and service startup.
  - BotClient: manages Discord client login, guild count, command deployment, database initialization, and cleanup. See [`src/core/`](src/core/:1).
  - Command system: commands implement the `Command`/`SlashCommand` interfaces in [`src/types/command.ts`](src/types/command.ts:1). `CommandLoader` auto-discovers and registers them at startup.
  - Event handling: [`src/core/EventHandler.ts`](src/core/EventHandler.ts:1) maps Discord events to command execution and other handlers.
  - Persistence: lightweight JSON-backed Database persists to [`Data/`](Data/:1). Code should validate JSON before reading/writing.
  - Web settings server: `SettingsServer` (in [`src/web/`](src/web:1)) exposes a small dashboard and is injected into the client object for command access.
- Extension points: add commands under [`src/commands/`](src/commands:1) and utilities under [`src/utils/`](src/utils:1). The project uses an auto-discovering `CommandLoader`, so static import files are not required for normal development; if you need explicit static imports for bundling, add a helper at `src/modules/import.ts`.

Repository notes and suggested improvements
- This file consolidates guidance; keep it in sync with `.github/copilot-instructions.md`.
- Static imports helper: older guidance referenced `src/modules/import.ts`. The current codebase uses an auto-discovering `CommandLoader` (`src/core/CommandLoader.ts`), so confirm whether you need a static import file for your build target.
- Add lightweight "test" and "typecheck" npm scripts (e.g., `"test": "vitest", "typecheck": "tsc --noEmit"`) to improve CI and local workflows.
- Consider adding linter/formatter scripts to package.json if introducing ESLint/Prettier.

Repository conventions for automated agents
- When producing PR review comments invoked by the repository CI, respond in Japanese — the workflow enforces this.
- Do NOT commit or echo secrets. `config.json` is excluded from git; use `config.example.json` for examples and dummy values for CI.
- Follow types in [`src/types/command.ts`](src/types/command.ts:1). Prefer TypeScript-correct changes and run a local typecheck when changing exported signatures.
- When adding static commands for inclusion at build-time, ensure the static import file (if used) is updated so Bun's bundling includes the modules.

What to check during automated reviews
- Type correctness for exported command objects ([`src/types/command.ts`](src/types/command.ts:1)).
- Avoid leaking tokens or config values — `config.json` must not be committed and logs mask tokens already in [`src/index.ts:39-55`](src/index.ts#L39-L55).
- Long-running handlers should guard with try/catch and avoid blocking the event loop.
- File I/O: validate JSON before reading/writing in `Data/` and handle corrupted files gracefully.
- When reviewing OpenAI-related changes, inspect:
  - [`src/core/OpenAIChatManager.ts`](src/core/OpenAIChatManager.ts:1) for streaming and tool-call patterns.
  - [`src/core/PdfRAGManager.ts`](src/core/PdfRAGManager.ts:1) for PDF indexing and vector store behavior.
  - A representative command: [`src/commands/staff/subcommands/ai.ts`](src/commands/staff/subcommands/ai.ts:1) for safeRespond, streaming, and RAG usage.

Notes for future Claude Code instances
- Confirm runtime choice (Bun vs Node) before invoking build scripts; Bun is used for cross-target binary builds in package.json.
- CLAUDE.md is referenced by .github/workflows/claude-code-review.yml — keep it concise and up to date.
- Use [.github/copilot-instructions.md](.github/copilot-instructions.md:1) for additional AI guidance.

References
- [README.md](README.md)
- [package.json](package.json)
- [`src/index.ts`](src/index.ts)
- [`src/types/command.ts`](src/types/command.ts)

---
 
Suggestions applied
- Consolidated commands and clarified a recommended single-test invocation.
- Noted missing static import file and recommended adding a test/typecheck script.

If you want, I can:
- Add a minimal "test" and "typecheck" npm script to package.json.
- Create a stub for src/modules/import.ts if you want static imports added.
