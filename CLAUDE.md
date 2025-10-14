# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Purpose
- Provide concise, machine-actionable guidance for automated reviewers and Claude Code instances used by this project (CI and local development).

Important files and entry points
- Entry point / bootstrap: [src/index.ts](src/index.ts) — reads config.json, initializes BotClient and services, loads commands and registers event handlers. See startup flow at [src/index.ts:65-115](src/index.ts#L65-L115).
- Command loader: [src/core/CommandLoader.js](src/core/CommandLoader.js) — responsible for discovering and registering command modules. Used from [src/index.ts:91-99](src/index.ts#L91-L99).
- Core runtime pieces: [src/core/](src/core/) (BotClient, EventHandler, Database) — these implement client lifecycle, event mapping, and JSON persistence.
- Commands: [src/commands/](src/commands/) — command implementations follow types in [src/types/command.ts](src/types/command.ts).
- Utilities: [src/utils/](src/utils/) — logger, permission checks, cooldowns, status manager.
- Web dashboard: [src/web/](src/web/) and [src/web/client](src/web/client) — Vite-based client and SettingsServer integration.
- Data store: [Data/](Data/) — runtime JSON files persisted by Database module.
- CI / AI hints: [.github/copilot-instructions.md](.github/copilot-instructions.md) and [.github/workflows/claude-code-review.yml](.github/workflows/claude-code-review.yml).

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
- This repository currently has no test runner configured in package.json. When adding tests, prefer adding an npm script named "test".
- Example single-test commands you can use once tests are added:
  - npx vitest path/to/test --run
  - node --loader ts-node/esm path/to/test.ts
- Add a short npm script to run a specific test file for developer convenience.

High-level architecture (big picture)
- Runtime: TypeScript sources executed via Bun in production builds, but Node-based workflows work for local development. Confirm Bun vs Node before running build scripts.
- Responsibilities and boundaries:
  - Bootstrap & config: [src/index.ts](src/index.ts) handles loading config.json (token masked in logs), status manager initialization, and service startup.
  - BotClient: manages Discord client login, guild count, command deployment, database initialization, and cleanup. See [src/core/](src/core/).
  - Command system: commands implement the Command/SlashCommand interfaces in [src/types/command.ts](src/types/command.ts). CommandLoader discovers and registers them at startup.
  - Event handling: [src/core/EventHandler.js](src/core/EventHandler.js) maps Discord events to command execution and other handlers.
  - Persistence: lightweight JSON-backed Database persists to [Data/](Data/). Code should validate JSON before reading/writing.
  - Web settings server: SettingsServer (in [src/web/]) exposes a small dashboard and is injected into the client object for command access.
- Extension points: add commands under [src/commands/] and utilities under [src/utils/]. When adding static commands intended for build-time inclusion, update the static imports file if present (see note below).

Repository notes and suggested improvements
- Existing CLAUDE.md present; this file consolidates and clarifies commands and key files.
- Static imports helper: the old guidance references [src/modules/import.ts]. That file was not present when this CLAUDE.md was generated — confirm where statically-imported commands should be added (the project currently uses a CommandLoader that auto-discovers commands; if a static import file is required for builds, add it at [src/modules/import.ts] or update build scripts).
- Add a lightweight "test" npm script and a "typecheck" script (e.g., "typecheck": "tsc --noEmit") to improve automation and CI.
- If you introduce linters/formatters, add their scripts to package.json and list them here.

Repository conventions for automated agents
- When producing PR review comments invoked by the repository CI, respond in Japanese — the workflow enforces this.
- Do NOT commit or echo secrets. config.json is excluded from git; use `config.example.json` for examples and dummy values for CI.
- Follow types in [src/types/command.ts](src/types/command.ts). Prefer TypeScript-correct changes and run a local build when changing exported signatures.
- When adding static commands for inclusion at build-time, ensure the static import file (if used) is updated so Bun's bundling includes the modules.

What to check during automated reviews
- Type correctness for exported command objects ([src/types/command.ts](src/types/command.ts)).
- Avoid leaking tokens or config values — config.json must not be committed and logs mask tokens already in [src/index.ts:39-55](src/index.ts#L39-L55).
- Long-running handlers should guard with try/catch and avoid blocking the event loop.
- File I/O: validate JSON before reading/writing in Data/ and handle corrupted files gracefully.

Notes for future Claude Code instances
- Confirm runtime choice (Bun vs Node) before invoking build scripts; Bun is used for cross-target binary builds in package.json.
- CLAUDE.md is referenced by .github/workflows/claude-code-review.yml — keep it concise and up to date.
- Use [.github/copilot-instructions.md](.github/copilot-instructions.md) for additional AI guidance.

References
- [README.md](README.md)
- [package.json](package.json)
- [src/index.ts](src/index.ts) (startup flow)
- [src/types/command.ts](src/types/command.ts)

---

Suggestions applied
- Consolidated commands and clarified a recommended single-test invocation.
- Noted missing static import file and recommended adding a test/typecheck script.

If you want, I can:
- Add a minimal "test" and "typecheck" npm script to package.json.
- Create a stub for src/modules/import.ts if you want static imports added.
