# Plan 002 — LangGraph ReAct Agent

## Goal

Layer a LangGraph ReAct agent on top of the Plan-001 CLI substrate. Wraps each `commands/<name>` module as a tool, supports 6 LLM providers, gates mutation tools.

## Deliverables (six units, parallel where noted)

### Unit A — Dependencies (serial; before everything else)
- Add to `package.json`: `langchain@^1.3.0`, `@langchain/langgraph@^1.0.0`, `@langchain/core@^1.1.41`, `@langchain/openai@^1.4.0`, `@langchain/anthropic@^1.3.0`, `@langchain/google-genai@^2.1.0`.
- Smoke-test CJS interop.
- `.env.example` with every `ZIP_AGENT_*` agent var.

### Unit B — Agent config loader (parallel after A)
- `src/config/agent-config.ts` per spec §6 interface.
- Provider model fallback for azure-* (§7.4).
- DeepSeek denylist hook (validation moves to provider but config-load can short-circuit).
- `providerEnv` snapshot.
- `test_scripts/agent-config.spec.ts`.

### Unit C — Provider registry (parallel after A)
- `src/agent/providers/{types,util,openai,anthropic,google,azure-openai,azure-anthropic,azure-deepseek,registry}.ts`.
- `normalizeFoundryEndpoint` shared helper.
- DeepSeek denylist enforced here.
- `test_scripts/agent-provider-{registry,util}.spec.ts`.

### Unit D — Tool adapters (parallel after A)
- `src/agent/tools/{types,truncate,registry}.ts`.
- `*-tool.ts` per command (7 adapters).
- `handleToolError` routing.
- `test_scripts/agent-{tools,tools-registry,truncate}.spec.ts`.

### Unit E — Agent core (parallel after A)
- `src/agent/system-prompt.ts` (DEFAULT_SYSTEM_PROMPT + loader).
- `src/agent/logging.ts` (redaction + file sink + quiet).
- `src/agent/graph.ts` (`createAgent` wrapper).
- `src/agent/run.ts` (`runOneShot` + `runInteractive`).
- `test_scripts/agent-{logging,graph,run}.spec.ts`.

### Unit F — Wiring (serial; after B/C/D/E)
- `src/commands/agent.ts` orchestrating B+C+D+E.
- Register `agent` subcommand in `src/cli.ts`.
- `test_scripts/commands-agent.spec.ts` with `vi.mock('dotenv', …)`.
- Update `CLAUDE.md` with `<agent>` tool block.
- Update `README.md` with `## Agent mode` section.

## Acceptance gates

- `npx tsc --noEmit` clean.
- `npx vitest run` ≥ 80 new agent-* tests, all green.
- `node dist/cli.js agent --help` renders.
- `node dist/cli.js agent` (no flags, no env) exits 3 with `ConfigurationError`.
- `node dist/cli.js agent -p bogus -m x "hi"` exits 2 with `UsageError`.
- Every Plan-001 subcommand still works unchanged.
