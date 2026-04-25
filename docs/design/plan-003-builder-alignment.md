# Plan 003 — Builder alignment

**Date:** 2026-04-24
**Status:** Completed

## Summary

Align the existing `zip-agent` agent subcommand with the cli-agent-builder
guidelines. The agent was already working; this was a focused alignment pass,
not a greenfield build.

## Changes

### Change 1 — `local-openai` provider (7th provider)

New file: `src/agent/providers/local-openai.ts`
- `ChatOpenAI` with `configuration.baseURL` from `ZIP_AGENT_LOCAL_OPENAI_BASE_URL`.
- No API key requirement; defaults to `"local"` if unset (ADR-007 exception).
- URL validated before construction; malformed URL → `ConfigurationError`.
- Canonical aliases for BASE_URL: `LOCAL_OPENAI_BASE_URL`, `OLLAMA_HOST`.
- Last-resort alias for API_KEY: `OPENAI_API_KEY`.

Files changed:
- `src/agent/providers/local-openai.ts` — new
- `src/agent/providers/registry.ts` — added `'local-openai': createLocalOpenaiModel`
- `src/config/agent-config.ts` — extended `ProviderName`, `PROVIDER_NAMES`, `PROVIDER_ENV_PREFIXES`, `PROVIDER_ENV_ALIASES`

### Change 2 — New configuration precedence chain

Previous chain: `CLI flag > process.env > .env > default`
New chain (files beat process.env):

```
--env-file  > CLI flag > ./.env > ~/.tool-agents/zip-agent/config > process.env > default
```

`--env-file` replaces both file sources when provided.

New file: `src/util/env-loader.ts`
- `buildEffectiveEnv({ envFile?, cwd? })` — builds merged env map using
  explicit spread order (`process.env` first, files last = last wins).
- `readDotenvFile(path)` — safe dotenv parse; returns `{}` if file absent.
- `GLOBAL_CONFIG_PATH` — `~/.tool-agents/zip-agent/config`.

Updated: `src/commands/agent.ts`
- Removed `import dotenv from 'dotenv'`.
- Added `buildEffectiveEnv({ envFile, cwd })` call; passes result to `loadAgentConfig`.

ADR-008 recorded in `project-design.md`.

### Change 3 — Default-provider hint in error messages

`loadAgentConfig` now includes `azure-openai` as an example in the
`ConfigurationError` detail when `ZIP_AGENT_PROVIDER` is missing.

### Change 4 — Documentation sync

- `CLAUDE.md` — updated `<zip-agent-agent>` block: 7 providers, new precedence chain, `local-openai` config, global config file path.
- `docs/design/configuration-guide.md` — full rewrite of §1 (precedence chain), new §4 `local-openai` section, new §7 global config file reference.
- `docs/design/project-design.md` — updated invariant #5, provider table row, module layout, ADR-007, ADR-008.
- `README.md` — updated quick-start examples to use `azure-openai` as primary, added `local-openai` OLLaMA example, replaced precedence chain description.
- `.env.example` — updated header with new chain, updated provider example (`azure-openai`), added `local-openai` section.

### Change 5 — Tests

New test file: `test_scripts/agent-env-loader.spec.ts` (12 tests)
- `readDotenvFile`: absent file, KEY=VALUE parsing, comments, empty file.
- `buildEffectiveEnv`: process.env base, local .env wins, global config wins over process.env but loses to local .env, `--env-file` replaces file sources, `--env-file` wins over process.env, global config not read when `--env-file` set, merge semantics for unrelated keys, `GLOBAL_CONFIG_PATH` constant.

Updated: `test_scripts/agent-provider-registry.spec.ts`
- Fixed: "exposes exactly 6 providers" → "exposes exactly 7 providers".
- Added: `local-openai` factory tests (5 tests): valid construction, missing BASE_URL, invalid URL, explicit API key, default API key.

Updated: `test_scripts/agent-config.spec.ts`
- Added 6 tests: `local-openai` accepted as provider, env snapshot isolation, `LOCAL_OPENAI_BASE_URL` alias, `OLLAMA_HOST` alias, `OPENAI_API_KEY` last-resort alias, missing-provider error hint includes `azure-openai`.

Updated: `test_scripts/commands-agent.spec.ts`
- Replaced `vi.mock('dotenv', ...)` with `vi.mock('../src/util/env-loader', ...)`.
- Added `ZIP_AGENT_LOCAL_OPENAI_BASE_URL`, `ZIP_AGENT_LOCAL_OPENAI_API_KEY`, `LOCAL_OPENAI_BASE_URL`, `OLLAMA_HOST` to the ENV_KEYS cleanup list.

## Acceptance gates

- [x] `tsc --noEmit` clean
- [x] `vitest run` — 135 tests pass (0 failures)
- [x] `local-openai` in PROVIDER_NAMES validated
- [x] ConfigurationError for missing provider includes `azure-openai` hint
- [x] All documentation updated

## ADRs recorded

- ADR-007: `ZIP_AGENT_LOCAL_OPENAI_API_KEY` defaults to `"local"` (sole exception to no-fallback rule).
- ADR-008: Env file sources outrank `process.env` in the precedence chain.
