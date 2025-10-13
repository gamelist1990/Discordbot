## AI agent guide for this repository (concise)

Work target: help contributors and automated agents make safe, type-correct changes to this TypeScript Discord bot.

Key facts (read these files first):
- Entry point: `src/index.ts` — loads `config.json`, bootstraps `BotClient`, `CommandLoader`, registers events, and starts `SettingsServer`.
- Command shape: `src/types/command.ts` — follow `Command` / `SlashCommand` interfaces (exported objects must match these types).
- Static commands: files under `src/commands` (and `src/modules/*`). Add static commands by creating `src/modules/<Name>/index.ts` and adding an import to `src/modules/import.ts`.
- Dynamic plugins: `plugins/` (loaded by `src/modules/static-loader.ts` / `src/index.ts`) — support CJS (`.js`) and ESM (`.mjs`) modules exporting `default` or `exports.command`.

Build / run notes:
- Project uses Bun in CI and package scripts (e.g. `bun build`, `bun --watch run src/index.ts`). Local dev may use `bun`, `npm`, or `ts-node-dev`, but confirm runtime differences (Bun vs Node) when running builds.
- `package.json` scripts of interest: `dev`, `start`, `web`, `auto`, and platform build scripts. Use `bun install` or `npm install` to restore deps.
- Runtime requires a `config.json` in the repository root with a valid `token` (Discord bot token) and `openai` settings for the OpenAI integrations. Never commit real secrets — use dummy values for tests.

OpenAI & RAG specifics (project-unique):
- `src/core/OpenAIChatManager.ts` — wrapper around OpenAI Chat completions, supports streaming and tool-calls. Tools are registered with `registerTool(def, handler)` and executed via `handleToolCalls`.
- `src/core/PdfRAGManager.ts` — simple PDF indexer + in-repo vector store at `Data/pdf_vectors.json`. Indexing calls OpenAI embeddings endpoint defined in `config`.
- Many commands (e.g. `src/commands/staff/subcommands/ai.ts`) use streaming, tool registration, and safe reply fallbacks (`safeRespond`). When editing, preserve streaming/update semantics and interaction fallback behavior.

Conventions and gotchas for automated changes:
- Type-first: prefer TypeScript-correct edits; update `src/types/command.ts` usages when changing command signatures.
- Config handling: `src/index.ts` strips BOM and supports JSON with comments — but logs mask `token` when printing. Avoid exposing tokens in logs or commit.
- Long-running / async: commands that call external APIs (OpenAI, PDF parsing) use try/catch and call `safeRespond` or followUp. Preserve these patterns when adding similar features.
- Data persistence: runtime JSON stores live under `Data/`. Tests or offline runs should use temporary/dummy paths.

What to check in PRs (automated reviewer checklist):
- Exports match `SlashCommand` / `Command` types and are registered (e.g. `src/modules/import.ts`).
- No secrets committed; `config.json` changes must be dummy or omitted.
- Long-running handlers preserve interaction defer/reply/fallback logic (see `ai.ts` for examples).
- When adding OpenAI usage, ensure `config.openai` keys are read from `src/config.ts` or `config.json` and that streaming/tool patterns follow `OpenAIChatManager`.

If you need more context, read these files next: `src/index.ts`, `src/core/OpenAIChatManager.ts`, `src/core/PdfRAGManager.ts`, `src/types/command.ts`, and a representative command like `src/commands/staff/subcommands/ai.ts`.

If anything here is unclear or you want additional examples (e.g. how to add a plugin, create a command, or run the web client), tell me which area to expand.
