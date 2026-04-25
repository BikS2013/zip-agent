# Issues — Pending Items

## Pending

- **OLLAMA_HOST alias caveat (documentation only):** The `OLLAMA_HOST` canonical alias for `ZIP_AGENT_LOCAL_OPENAI_BASE_URL` is accepted as-is. OLLaMA typically sets `OLLAMA_HOST=http://localhost:11434` (without `/v1`). The agent does not append `/v1` automatically — the user must ensure the URL includes the full OpenAI-compatible path. This is documented in the configuration guide but not enforced programmatically. A future enhancement could detect the missing `/v1` suffix and warn.

- **TUI: only smoke-tested against macOS Terminal.app via `script -q` PTY.** The full keyboard-protocol matrix (Shift+Enter via CSI-u on kitty/Ghostty/iTerm2-with-modifier-reporting; Cmd+Backspace `\x1b[3;9~` on macOS-native iTerm2) was implemented per the spec §5/§18.3 byte tables but not interactively verified on every terminal. Users on Linux (Alacritty, kitty, Ghostty) and on Windows Terminal should report any keybinding that does not behave as `/help` claims.

- **TUI: spec §2.3 commands intentionally omitted from the initial scope:**
  - `/state` — LangGraph's `getState()` returns the same message array we already mirror locally, so a separate "server state" view would just duplicate `/last`/`/history`. Add when there's a real domain state field worth exposing.
  - `/copy-all` — user brief listed only `/copy`. The `last-response.txt` fallback file already gives a "copy everything" workaround via shell.
  - `/memory add` / `/memory remove` / `/memory clear` — replaced with the `$EDITOR`-based `/memory` per the user's brief. The CRUD subcommands could be re-added if the inline editor flow proves too heavy.
  - `/monitor` — the host agent has no `createMonitoringSession(threadId)` seam (spec §11). The command is optional per the spec; revisit if/when monitoring is wired in `src/agent/`.

- **TUI: thread-resume does NOT restore LangGraph checkpointer state.** `/history` reloads the local transcript (used by `/last`, `/copy`, `/copy-all`) but the LangGraph in-process checkpointer starts fresh — the next turn after a resume will not have access to prior tool_call IDs. Resolving this requires a file-backed `Checkpointer` implementation (`@langchain/langgraph` doesn't ship one for SQLite/JSON yet); a transcript-based message replay was traded off as overkill for a TUI session.

## Completed

- 2026-04-24 — TUI bugfix round 2 against `azure-openai/gpt-5.1` (plan-004-tui.md "Bugfix log — round 2"):
  - **Cross-turn memory broken inside a single TUI session** — three turns into a session the agent could not resolve referents like "the one you found previously", despite the status bar showing the same `thread_id` across all three turns.
  - **Root cause.** `tui.ts` constructed `createAgentGraph(...)` WITHOUT passing a `checkpointer`. `streaming.ts` correctly threaded `configurable.thread_id` into every `streamEvents` call (line 52), but with no `MemorySaver` LangGraph had nowhere to load or persist thread state — every turn arrived at the model with only the new user message, regardless of the thread_id flag. Legacy REPL at `src/agent/run.ts:145` does it correctly; the TUI bring-up missed this step.
  - **Fix.** Added `checkpointer: MemorySaver` to `TuiSession`, constructed once at session start in `tui.ts`, and passed to the initial `createAgentGraph`. Every slash command that rebuilds the graph for a reason that resets the thread (`/new`, `/model`, `/tools` mutation flip OR catalog change, `/system` edit, `/history` load) now ALSO mints a fresh `MemorySaver`. Plain turns reuse both, so the checkpointer can load prior thread state on every call. Defensive invariant added at the streaming call site: throw if `session.threadId` is empty rather than starting a silent zero-context turn.
  - **Side fix.** `/tools` previously reset the thread only when the mutations master flag flipped; a tool subset change without a master flip would have left dangling tool_call ids in the checkpoint. Now ANY catalog change (set inequality on tool names) OR a mutations flip triggers a reset.
  - 6 new specs in `test_scripts/tui-thread-memory.spec.ts` pin the contract: same thread_id across consecutive turns; `/new` rotates thread + replaces graph + checkpointer; `/tools` mutation flip same. Full suite 232 tests across 26 files, all green; `tsc --noEmit` clean; `npm run build` produces fresh dist.

- 2026-04-24 — TUI bugfix round 1 against `azure-openai/gpt-5.1` (plan-004-tui.md "Bugfix log — round 1"):
  - **Streaming text shredded** — `spinner.stop()` wrote `SAVE_CURSOR + CLEAR_LINE + RESTORE_CURSOR` on every call, including no-op stops; the streaming loop called `stop()` on every token. Fix: `stop()` early-returns when no timer is active, and the loop guards every call with `if (spinner.isActive())`. Pinned by `tui-streaming-render.spec.ts > spinner.stop() is a no-op when the spinner is already stopped` and `does NOT emit a CLEAR_LINE between consecutive token writes`.
  - **Tool args double-encoded** — `previewObject` did not unwrap LangGraph's single-key `{input: <jsonString|object>}` envelope. Fix: new `unwrapToolInput()` helper in `streaming.ts` detects single-`input`-key wrappers and parses JSON-encoded inner strings. Pinned by three specs under `tui-streaming-render.spec.ts > streaming render: tool-start args preview`.
  - **Tool result showed raw LC envelope** — `JSON.stringify(toolMessage)` invokes `BaseMessage.toJSON()` which returns `{lc:1,type:"constructor",id:[...],kwargs:{...}}`. Fix: new `extractToolMessageContent()` helper extracts `.content` from native `ToolMessage` instances, duck-typed messages, and JSON-roundtripped LC envelopes. Pinned by four specs under `tui-streaming-render.spec.ts > streaming render: tool-end result preview`.
  - 11 new specs added; full suite 226 green across 25 files; `tsc --noEmit` clean; `npm run build` produces fresh dist.

- 2026-04-24 — Raw-mode TUI on top of `zip-agent agent -i` (plan-004-tui.md):
  - Added 11 new files under `src/agent/tui/` (`tui.ts`, `streaming.ts`, `input.ts` with the spec §5.1 escape framer + §5.2 UTF-8 decoder, `spinner.ts`, `ansi.ts`, `utf8.ts`, `clipboard.ts`, `persistence.ts`, `slash-commands.ts`, `types.ts`, `index.ts` re-exports).
  - 11 slash commands: `/help /history /memory /new /quit /last /copy /model /tools /system /clear` (case-sensitive matching; aliases `/exit /reset /raw`).
  - Wired into `src/commands/agent.ts` with a `--legacy-repl` flag in `src/cli.ts` for one release cycle of escape-hatch.
  - Persistence under `~/.tool-agents/zip-agent/`: `memory.md`, `last-response.txt`, `tui-config.json`, `threads/<id>.json`. Bootstrap is idempotent and mirrors `ensureGlobalConfigFile()`.
  - 7 new test files in `test_scripts/` totalling 74 new tests. The two MANDATORY regression suites — `tui-input-escape-framing.spec.ts` (18 tests, spec §14.1) and `tui-input-utf8.spec.ts` (8 tests, spec §14.2) — both pass. Full suite: 215 tests across 24 files, all green.
  - `tsc --noEmit` clean. `npm run build` produces fresh `dist/agent/tui/*.js`. Smoke-tested via `script -q` PTY on macOS Terminal.app: banner renders, status bar appears, `/quit` exits cleanly, piped-stdin path correctly refuses with the TTY required message.
  - Documentation: `<zip-agent-tui>` block in `CLAUDE.md`, `## Interactive TUI` in `README.md`, §12 in `project-design.md`, FR-TUI-1..18 in `project-functions.MD`, §6 in `configuration-guide.md`. ADR-009 recorded.

- 2026-04-24 — Auto-bootstrap of global config:
  - `src/util/global-config-template.ts` — embedded `.env.example` as `GLOBAL_CONFIG_TEMPLATE` string constant.
  - `src/util/env-loader.ts` — added `ensureGlobalConfigFile({ configPath? })` returning `{ path, created, warning? }`. Idempotent, never overwrites, swallows write errors as warnings.
  - `src/commands/agent.ts` — calls `ensureGlobalConfigFile()` at top of `run()`. On creation, writes a one-line note to stderr; suppressed by `--quiet`. Permission errors warn but never crash.
  - `test_scripts/agent-env-loader.spec.ts` — added 6 tests (creation, no-op-when-exists, idempotence, write-error path, default-path sanity, drift guard against `.env.example`). Total: 18 in this spec, 141 across the suite.
  - `test_scripts/commands-agent.spec.ts` — extended `vi.mock('../src/util/env-loader', ...)` to stub `ensureGlobalConfigFile` so tests do not touch the real `$HOME`.
  - Docs updated: `CLAUDE.md` `<zip-agent-agent>` block now describes auto-bootstrap; `docs/design/configuration-guide.md` §1 expanded with the bootstrap algorithm + drift-guard reference.

- 2026-04-23 — Authored design (`docs/design/project-design.md`), functional requirements (`project-functions.MD`), configuration guide (`configuration-guide.md`), and two phase plans (`plan-001-zip-cli-substrate.md`, `plan-002-langgraph-agent.md`). Initial scope confirmed: all 7 zip operations, all 6 LLM providers, TypeScript/commander/vitest stack.

- 2026-04-24 — Builder alignment (plan-003-builder-alignment.md):
  - Added `local-openai` provider (7th provider): `src/agent/providers/local-openai.ts`, registered in `registry.ts`, `agent-config.ts`, `.env.example`.
  - ADR-007 recorded: `ZIP_AGENT_LOCAL_OPENAI_API_KEY` defaults to `"local"` — sole exception to no-fallback rule.
  - Implemented new layered env precedence chain in `src/util/env-loader.ts` (files beat process.env; ADR-008).
  - Updated `src/commands/agent.ts` to use `buildEffectiveEnv` instead of `dotenv.config`.
  - Updated error hint for missing `ZIP_AGENT_PROVIDER` to suggest `azure-openai` as example.
  - Updated all documentation: `CLAUDE.md`, `configuration-guide.md`, `project-design.md`, `README.md`, `.env.example`.
  - Added 23 new tests (17 in agent-env-loader.spec.ts, 6 in agent-provider-registry.spec.ts local-openai section, 6 in agent-config.spec.ts); updated 1 existing test (provider count 6→7). All 135 tests pass. `tsc --noEmit` clean.
