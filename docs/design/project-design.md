# Project Design — `zip-agent`

A TypeScript CLI that wraps the operating system's `zip` and `unzip` binaries with one subcommand per capability, plus a LangGraph ReAct `agent` subcommand that exposes those capabilities as LLM-callable tools.

---

## 1. Goal

Provide a conversational interface over the OS-native zip toolchain so a user can run natural-language requests such as:

- *"List the contents of `release.zip` and tell me how many files are larger than 1 MB."*
- *"Zip every `.log` in `./logs` into `archive.zip` but skip anything older than 30 days."*
- *"Extract `release.zip` into `./out`, but only the files under `docs/`."*

Without losing access to a deterministic, scriptable CLI for the same operations.

## 2. Two-layer architecture

```
┌──────────────────────────────────────────────────────────┐
│  CLI substrate (commander)                               │
│  ────────────────────────────                            │
│   zip-agent list   <archive>                             │
│   zip-agent info   <archive>                             │
│   zip-agent test   <archive>                             │
│   zip-agent create <archive> <inputs...>  [MUTATING]     │
│   zip-agent extract<archive> [-d <out>]   [MUTATING]     │
│   zip-agent add    <archive> <files...>   [MUTATING]     │
│   zip-agent remove <archive> <patterns..> [MUTATING]     │
│                                                          │
│  Each command lives in src/commands/<name>.ts and        │
│  exports run(deps, args, opts). Errors throw typed       │
│  classes mapping to stable exit codes.                   │
├──────────────────────────────────────────────────────────┤
│  Agent layer                                             │
│  ───────────                                             │
│   zip-agent agent [prompt] [-i] [-p provider] [-m model] │
│                   [--max-steps n] [--temperature t]      │
│                   [--system text|--system-file path]     │
│                   [--tools csv] [--per-tool-budget B]    │
│                   [--allow-mutations] [--env-file path]  │
│                   [--verbose]                            │
│                                                          │
│  Wraps each command in src/commands/ as a LangGraph      │
│  tool. Mutating tools (create/extract/add/remove) are    │
│  excluded from the catalog unless --allow-mutations.     │
└──────────────────────────────────────────────────────────┘
```

## 3. Module layout

```
src/
  cli.ts                          # commander root + subcommand registration
  cli/
    make-action.ts                # action wrapper: builds deps, maps errors → exit codes
    emit-result.ts                # JSON / table renderer
  config/
    config.ts                     # CLI-level config (paths to zip/unzip binaries, etc.)
    agent-config.ts               # agent-only config; no-fallback; providerEnv snapshot
  util/
    errors.ts                     # UsageError, ConfigurationError, AuthError, UpstreamError, IoError, CollisionError
    exit-codes.ts                 # error class → exit code map
    redact.ts                     # redactString() for log sinks
    zip-runner.ts                 # spawn() wrapper around /usr/bin/zip & /usr/bin/unzip
    env-loader.ts                 # buildEffectiveEnv() — layered env precedence builder
  types.ts                        # shared CommandDeps shape
  commands/
    list.ts                       # unzip -l
    info.ts                       # zipinfo
    test.ts                       # unzip -t
    create.ts                     # zip -r
    extract.ts                    # unzip
    add.ts                        # zip -u
    remove.ts                     # zip -d
    agent.ts                      # agent subcommand entry point
  agent/
    system-prompt.ts              # DEFAULT_SYSTEM_PROMPT + loadSystemPrompt
    logging.ts                    # createAgentLogger (redaction + file sink + quiet)
    graph.ts                      # createAgentGraph wrapper around langchain v1 createAgent
    run.ts                        # runOneShot, runInteractive, AgentResult types
    providers/
      types.ts                    # ProviderFactory
      util.ts                     # normalizeFoundryEndpoint
      openai.ts
      anthropic.ts
      google.ts
      azure-openai.ts
      azure-anthropic.ts
      azure-deepseek.ts
      local-openai.ts
      registry.ts                 # PROVIDERS map + getProvider
    tools/
      types.ts                    # ToolAdapterFactory + handleToolError
      truncate.ts                 # truncateToolResult(obj, maxBytes)
      list-tool.ts
      info-tool.ts
      test-tool.ts
      create-tool.ts
      extract-tool.ts
      add-tool.ts
      remove-tool.ts
      registry.ts                 # buildToolCatalog(deps, cfg)

test_scripts/                     # vitest specs (one per source unit)
docs/
  design/
    project-design.md             # this file
    project-functions.md          # functional requirements (FR-CLI-* + FR-AGT-*)
    configuration-guide.md
    plan-001-zip-cli-substrate.md
    plan-002-langgraph-agent.md
  reference/
    spec-agent-on-tool.md         # the source spec, for traceability
prompts/                          # any prompt files we author live here
.env.example
```

## 4. Error taxonomy → exit codes

| Class | Code | Meaning |
|---|---|---|
| _none_ (success) | 0 | OK |
| (catch-all) | 1 | Unexpected error |
| `UsageError` | 2 | Bad flag, missing argument, unknown subcommand |
| `ConfigurationError` | 3 | Missing required env var (no-fallback rule) |
| `AuthError` | 4 | Provider auth rejected |
| `UpstreamError` | 5 | Provider SDK error / non-zero exit from zip/unzip |
| `IoError` | 6 | Filesystem read/write failure |
| `CollisionError` | 7 | Output path already exists when not idempotent |
| (SIGINT) | 130 | Interactive REPL interrupted |

Mapping lives in `src/util/exit-codes.ts` and is consulted by `src/cli/make-action.ts`.

## 5. CommandDeps shape

```ts
export interface CommandDeps {
  config: CliConfig;          // resolved CLI config (zip/unzip binary paths, cwd, etc.)
  zipRunner: ZipRunner;       // spawn() wrapper; injected for testability
  now: () => Date;            // injectable clock
  logger: Logger;             // simple stderr logger, redacted
}
```

`agent.ts` extends with an `AgentDeps` alias of the same shape — no new surface.

## 6. Agent layer — invariants

These are non-negotiable (copy-paste-derived from the source spec, §3):

1. The agent is a **subcommand**, not a separate binary. Inherits commander, exit codes, error classes, deps.
2. **Existing command modules become tools.** Adapter calls `commands/<name>.run(deps, …)`; never re-implements zip logic.
3. **Provider registry is an object map.** Add a provider by adding a row to `PROVIDERS` in `src/agent/providers/registry.ts`.
4. **No-fallback for required config.** Missing required env var → `ConfigurationError` (exit 3).
5. **Layered env precedence (unusual — files beat shell).** `buildEffectiveEnv` in `src/util/env-loader.ts` merges sources in this order (last-write-wins): `process.env` → `~/.tool-agents/zip-agent/config` → `./.env`. When `--env-file` is supplied it replaces both file sources. The merged map is passed to `loadAgentConfig`. See ADR-008.
6. **Mutation tools opt-in.** Without `--allow-mutations`, `create`/`extract`/`add`/`remove` adapters are **excluded from the catalog entirely**.
7. **Every log line is redacted** through `redactString()`.
8. **Per-tool byte budget.** Default 16 KiB, configurable via `ZIP_AGENT_PER_TOOL_BUDGET_BYTES`.
9. **Tool errors split recoverable/fatal.** Recoverable (`UsageError`, `UpstreamError`, `IoError`, `CollisionError`) become a JSON tool result so the model can correct. Fatal (`ConfigurationError`, `AuthError`) abort the graph.
10. **ReAct engine is `createAgent` from `langchain` v1.** Termination via `recursionLimit: cfg.maxSteps`. Interactive mode attaches `MemorySaver`.
11. **All code is TypeScript.** CommonJS module emit.
12. **Docs ship in the same delivery** (CLAUDE.md, project-design.md, project-functions.md, configuration-guide.md, README.md, Issues - Pending Items.md, .env.example).

## 7. Provider registry

Each setting is read first from `ZIP_AGENT_<PROVIDER>_<NAME>`; if unset, the loader walks the canonical-alias chain shown in the third column. See `docs/design/configuration-guide.md` for full env tables.

| Provider | Class | Required settings (prefixed → canonical aliases) | Notes |
|---|---|---|---|
| `openai` | `ChatOpenAI` | `ZIP_AGENT_OPENAI_API_KEY` → `OPENAI_API_KEY` | Opt: `OPENAI_BASE_URL`, `OPENAI_ORG_ID`/`OPENAI_ORGANIZATION` |
| `anthropic` | `ChatAnthropic` | `ZIP_AGENT_ANTHROPIC_API_KEY` → `ANTHROPIC_API_KEY` | Opt: `ANTHROPIC_BASE_URL` |
| `google` | `ChatGoogleGenerativeAI` | `ZIP_AGENT_GOOGLE_API_KEY` → `GOOGLE_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_GENAI_API_KEY` | — |
| `azure-openai` | `AzureChatOpenAI` | `..._AZURE_OPENAI_API_KEY` → `AZURE_OPENAI_API_KEY`; `..._ENDPOINT` → `AZURE_OPENAI_ENDPOINT`; `..._DEPLOYMENT` → `AZURE_OPENAI_DEPLOYMENT` / `AZURE_OPENAI_DEPLOYMENT_NAME` | Opt: `AZURE_OPENAI_API_VERSION` / `OPENAI_API_VERSION` |
| `azure-anthropic` | `ChatAnthropic` (Foundry baseURL) | `..._AZURE_AI_INFERENCE_KEY` → `AZURE_AI_INFERENCE_KEY` / `AZURE_INFERENCE_CREDENTIAL`; `..._ENDPOINT` → `AZURE_AI_INFERENCE_ENDPOINT` / `AZURE_INFERENCE_ENDPOINT`; `..._AZURE_ANTHROPIC_MODEL` (no alias) | Foundry `/anthropic` suffix |
| `azure-deepseek` | `ChatOpenAI` (Foundry baseURL) | shared `AZURE_AI_INFERENCE_*` aliases as above; `..._AZURE_DEEPSEEK_MODEL` (no alias) | Foundry `/openai/v1` suffix; denylist enforced |
| `local-openai` | `ChatOpenAI` (custom baseURL) | `ZIP_AGENT_LOCAL_OPENAI_BASE_URL` → `LOCAL_OPENAI_BASE_URL` / `OLLAMA_HOST` | Opt: `ZIP_AGENT_LOCAL_OPENAI_API_KEY` (default `"local"` — ADR-007). No deployment fallback; model from `ZIP_AGENT_MODEL` / `--model`. |

DeepSeek denylist (regex match → `ConfigurationError`): `deepseek-v3.2-speciale`, `deepseek-r1` (except `r1-0528`, which has its own break), `deepseek-reasoner`, `deepseek-r1-0528`, `mai-ds-r1`. Accepted: `DeepSeek-V3`, `DeepSeek-V3.1`, `DeepSeek-V3.2`.

## 8. Tool catalog

| Tool name (LLM-facing) | Wraps | Mutating | Description hint |
|---|---|---|---|
| `list_archive` | `commands/list` | no | Read archive table-of-contents |
| `archive_info` | `commands/info` | no | Detailed entry-level info (zipinfo) |
| `test_archive` | `commands/test` | no | Verify archive integrity |
| `create_archive` | `commands/create` | yes | `[MUTATING]` Build a new archive |
| `extract_archive` | `commands/extract` | yes | `[MUTATING]` Extract files |
| `add_to_archive` | `commands/add` | yes | `[MUTATING]` Add/update entries |
| `remove_from_archive` | `commands/remove` | yes | `[MUTATING]` Delete entries |

## 9. Termination contract

| `meta.terminatedBy` | Cause |
|---|---|
| `final` | Final AIMessage without `tool_calls` (happy path) |
| `maxSteps` | `recursionLimit: cfg.maxSteps` exceeded |
| `error` | Graph threw |
| `interrupted` | SIGINT during interactive REPL |

## 10. Testing strategy

Tests live under `test_scripts/`. One spec per source unit. Vitest. Required fakes:

- `FakeToolCallingModel` from `langchain` for graph/run specs.
- `vi.mock('dotenv', …)` in every spec that drives `commands/agent.ts::run`.
- A stub `ZipRunner` with `vi.fn()` per method for command specs (no real `child_process`).

Acceptance gates per spec §16: `tsc --noEmit` clean, full vitest green, `node dist/cli.js --help` renders, `node dist/cli.js agent` with no config → exit 3, every existing subcommand continues working unchanged.

## 11. Architectural Decision Records

- **ADR-001:** Shell out to OS `zip`/`unzip` instead of using a Node zip library (e.g. `archiver`, `yauzl`). Reason: the user's intent is to converse with the OS toolchain, not a Node reimplementation; OS tools already handle every edge case (encryption, multi-volume, central directory repair).
- **ADR-002:** No-fallback config matches the user's global CLAUDE.md rule and the source spec invariant. Default values exist only for non-required tunables (`maxSteps=10`, `temperature=0`, `perToolBudgetBytes=16384`).
- **ADR-003:** Mutation tools excluded from catalog rather than refused at runtime. Excluding them at catalog-build time means the model literally cannot try to call them — no jailbreak surface.
- **ADR-004:** `createAgent` from `langchain` v1 (not `createReactAgent` from `@langchain/langgraph/prebuilt`). The prebuilt is the v0 API and deprecated.
- **ADR-005:** Azure Foundry uses **shared** auth (`AZURE_AI_INFERENCE_{KEY,ENDPOINT}`) with **per-provider** model env vars. Foundry hosts both Anthropic and DeepSeek behind one resource; only the URL suffix differs.
- **ADR-006:** Provider env vars accept canonical industry names as aliases. The `ZIP_AGENT_<PROVIDER>_*` prefixed name is the project-specific override path; if it isn't set, the loader walks a chain of widely-used canonical names (e.g. `OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT_NAME`, `AZURE_INFERENCE_CREDENTIAL`). This keeps globally-exported keys reusable without duplication, while still allowing per-agent isolation through a dedicated `.env.zip-agent` file passed via `--env-file`. The no-fallback rule still holds: if neither the prefixed name nor any alias is set, missing-required throws `ConfigurationError`. Project-level tunables (PROVIDER, MODEL, MAX_STEPS, etc.) deliberately have **no** aliases — there are no widely-agreed canonical names for them.
- **ADR-007:** `ZIP_AGENT_LOCAL_OPENAI_API_KEY` defaults to `"local"` when unset. This is the **sole exception** to the project's no-fallback-for-required-config rule. Most local inference servers (OLLaMA, LM Studio, etc.) require a non-empty API key string but do not validate it. Requiring an explicit value would create needless friction for an inherently local, unauthenticated server. The setting is optional by design; all other settings retain the no-fallback rule.
- **ADR-008:** Env file sources outrank `process.env`. The layered env builder in `src/util/env-loader.ts` spreads `process.env` first, then `~/.tool-agents/zip-agent/config`, then `./.env` (last-write-wins). This means a value set in `.env` overrides a same-named shell export. Rationale: `.env` and the global config represent deliberate, durable per-project intent; a stale shell export from an unrelated project (e.g. `AZURE_OPENAI_DEPLOYMENT=old-model` left in `~/.zshrc`) must not silently shadow it. Users who need shell to win can set the `ZIP_AGENT_*` prefixed form only in the shell and leave the file source unset, or use `--env-file` to take full control.
- **ADR-009:** Interactive mode uses a raw-mode TUI by default; the legacy plain-readline REPL is kept behind `--legacy-repl` for one release cycle. The TUI lives entirely under `src/agent/tui/` (separate from `src/agent/run.ts`) and re-uses the existing `RunInteractiveArgs` shape so `src/commands/agent.ts:60` can dispatch between the two paths with one conditional. The TUI never modifies the host agent's source tree apart from that single dispatch and the `--legacy-repl` flag in `cli.ts`. Persistence files live under `~/.tool-agents/zip-agent/` alongside the existing `config` file rather than the project cwd, mirroring the existing global-config layout. See plan-004-tui.md.

## 12. Interactive TUI architecture

`src/agent/tui/` — the raw-mode terminal UI bound to `zip-agent agent -i`.

### File map

| File | Purpose |
|---|---|
| `index.ts` | Public re-exports for `commands/agent.ts` and the test suite. |
| `tui.ts` | Entry point: banner, status bar, main loop, ESC-to-abort, `unhandledRejection` recovery. Exports `runInteractiveTui(args)` with the same `RunInteractiveArgs` shape as `run.ts::runInteractive`. |
| `streaming.ts` | Async-iterable adapter that turns LangGraph's v2 event stream into the three-event TuiEvent contract (`token` / `tool_start` / `tool_end`). Handles AbortController plumbing and tool-call breadcrumb truncation. |
| `input.ts` | Raw-mode multiline reader. Implements the spec §5.1 escape-framing table by SHAPE (CSI / SS3 / ESC-prefix), and routes printable bytes through a stateful UTF-8 decoder per spec §5.2. Pure helpers (`replaceInput`, `insertNewline`, `handleBackspace`, `feedEscByte`, …) exported for unit testing. |
| `spinner.ts` | Braille spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, 80 ms tick) wrapped in ANSI save/restore. |
| `ansi.ts` | ANSI constants and cursor helpers used everywhere — no inline escape sequences elsewhere. |
| `utf8.ts` | Stateful `StringDecoder` wrapper. The non-negotiable fix for the Latin-1 mojibake regression. |
| `clipboard.ts` | Cross-platform clipboard dispatcher (`pbcopy`/`wl-copy`/`xclip`/`xsel`/`clip.exe`) with `last-response.txt` fallback. Never silent-fails. |
| `persistence.ts` | All filesystem CRUD: `memory.md`, `last-response.txt`, `tui-config.json`, `threads/<id>.json`. Idempotent bootstrap mirroring `ensureGlobalConfigFile()`. |
| `slash-commands.ts` | One handler per slash command + the dispatcher. Case-sensitive matching. |
| `types.ts` | Shared types (`TuiEvent`, `TuiSession`, `SlashContext`, etc.). No runtime. |

### Event flow per turn

```
user types → input.ts.readInput resolves with text
          → tui.ts pushes to messages, starts spinner("Thinking...")
          → ESC listener attached: ESC | Ctrl+C → AbortController.abort()
          → streaming.ts.streamTuiEvents wraps graph.streamEvents(input, {version:'v2', signal})
              for await (ev of stream):
                token       → spinner.stop() · print Agent header once · stdout.write(text)
                tool_start  → spinner.stop() · print "↳ calling foo(args)"
                tool_end    → write " ✓ → result" · spinner.start("Processing tool result...")
          → spinner.stop() · persist transcript to threads/<id>.json
          → loop
```

### Persistence layout

```
~/.tool-agents/zip-agent/
├─ config                      (existing — global env)
├─ memory.md                   (TUI: long-term notes; /memory edits this in $EDITOR)
├─ last-response.txt           (TUI: rolling, single file; /copy fallback)
├─ tui-config.json             (TUI: defaultMutations, providerOverride, modelOverride)
└─ threads/
   └─ <thread_id>.json         (TUI: per-thread transcript; /history lists & resumes these)
```

Override env vars: `ZIP_AGENT_TUI_HOME` (root override, used in tests),
`ZIP_AGENT_TUI_NO_PERSIST=1` (skip every TUI write — for piped contexts and CI).

### Wiring

`src/commands/agent.ts:60` — single conditional: `if (cfg.interactive) { opts.legacyRepl ? runInteractive(...) : runInteractiveTui(...) }`.
`src/cli.ts` — adds the `--legacy-repl` flag; everything else in the agent subcommand is unchanged.
