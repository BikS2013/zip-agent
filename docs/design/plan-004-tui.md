# Plan 004 — Raw-mode terminal UI on top of `zip-agent agent -i`

Status: **draft → ready to implement** (this plan written first per CLAUDE.md rule).
Date: 2026-04-24.
Spec authority: `~/.claude/agents/agent-tui-builder-spec.md` (read in full before this plan was written).

## 1. Detected backend

**cli-agent-builder output (LangGraph v1).** Detection signals:

- `~/.tool-agents/zip-agent/` layout already present (`src/util/env-loader.ts`
  → `GLOBAL_CONFIG_PATH = ~/.tool-agents/zip-agent/config`,
  `ensureGlobalConfigFile()` bootstraps it).
- `src/agent/graph.ts:21` exports `createAgentGraph(...)` which calls
  `createAgent` from the top-level `langchain` v1 package.
- The agent already has the seven-provider registry at
  `src/agent/providers/registry.ts` matching the spec's expected layout.

Streaming seam: **`createAgentGraph(...).streamEvents(input, { version: 'v2', configurable, callbacks, signal })`** — LangGraph natively emits the spec §4 events
(`on_chat_model_stream`, `on_tool_start`, `on_tool_end`). The TUI's
`streaming.ts` layer is a passthrough that filters these three event types
and surfaces them to the renderer, plus a small async-iterator wrapper that
honours an `AbortController` signal.

REPL entry function to wire from: `src/commands/agent.ts:60` —
`if (cfg.interactive) { await runInteractive({...}) }`. We add a sibling
function `runInteractiveTui(args)` (same `RunInteractiveArgs` shape) and
make the dispatch in `commands/agent.ts` call the TUI by default, with a
`--legacy-repl` escape hatch falling back to the existing `runInteractive`.

## 2. Deviations from the spec / standard agent conventions

The user's brief overrides the agent's standard `<standard_conventions>` in
two places. Both deviations are deliberate and recorded here:

| Rule | Standard | Used here | Reason |
|---|---|---|---|
| File location | `src/tui/` | `src/agent/tui/` | User explicitly asked for it under `src/agent/tui/` to keep TUI co-located with the existing agent code. The host agent's source tree remains untouched apart from `commands/agent.ts` (one new conditional dispatch). |
| Persistence root | `<cwd>/.agent-*.json` | `~/.tool-agents/zip-agent/` | Project already uses `~/.tool-agents/zip-agent/` for the global config; reusing the same root means a single backup target. The `tui-config.json`, `memory.md`, `last-response.txt`, `threads/` files all live under that directory. |

Both deviations leave the **invariants** intact: raw-mode stdin only,
byte-level escape framing per spec §5.1, stateful UTF-8 decoder per §5.2,
no fallback for missing config (spec §12 / project CLAUDE.md), token-by-token
streaming, ESC-to-abort.

## 3. Slash command scope

User explicitly listed a superset of the spec's MVP. All are in scope:

| Command | Aliases | In scope | Notes |
|---|---|---|---|
| `/help` | — | yes | Lists all in-scope commands and keybindings. Includes the "Shift+Enter unreliable — use Ctrl+J" note from spec §18.3. |
| `/history` | — | yes | Lists past threads from `~/.tool-agents/zip-agent/threads/`, `<index>` to load. |
| `/memory` | — | yes | Opens `~/.tool-agents/zip-agent/memory.md` in `$EDITOR`; prints inline if `$EDITOR` unset. Reload on close. |
| `/new` | `/reset` | yes | New `thread_id`, fresh checkpointer, keep memory.md. |
| `/quit` | `/exit` | yes | Closes streams, exits. |
| `/last` | `/raw` | yes | Re-prints the last assistant turn from the in-memory transcript. |
| `/copy` | — | yes | Cross-platform: `pbcopy` (darwin) / `wl-copy` / `xclip` / `xsel` (linux) / `clip.exe` (win/wsl). On no-binary: write to `~/.tool-agents/zip-agent/last-response.txt` and print the path. **Never silent-fail** (spec §13). |
| `/model` | — | yes | Two-stage interactive picker: (1) provider from the seven, (2) model id (current pre-filled). Re-uses `getProvider(name)(updatedCfg)` from `src/agent/providers/registry.ts` — no provider logic duplicated in the TUI. Validates required env vars; throws `ConfigurationError` on missing (project rule). Persists to `tui-config.json`. |
| `/tools` | — | yes | Checkbox UI: per-tool on/off + master `--allow-mutations`. Uses `rebuildTools(allow)` callback already in `RunInteractiveArgs`. Resets the thread when `allow-mutations` flips (mirrors the existing `runInteractive` behaviour at `run.ts:232-234`). |
| `/system` | — | yes | View prompt; press `e` to open in `$EDITOR`. Override is in-memory only, never persisted to disk per user instruction. |
| `/clear` | — | yes | Clears terminal; in-memory thread/history intact. |

Spec §2.3 entries omitted: `/state` (LangGraph `getState` returns the same
message array we already track locally — no separate server state to surface
for this agent), `/copy-all` (user listed only `/copy`), `/memory add`/`/memory
remove`/`/memory clear` (user asked for "open in $EDITOR" UX instead of
sub-command CRUD), `/monitor` (the host has no `createMonitoringSession`
seam — spec §11 declares this command optional).

## 4. File creation matrix

All paths absolute under `/Users/giorgosmarinos/aiwork/coding-platform/zip-agent`.

| File | Owner unit | Approx LOC | Purpose |
|---|---|---|---|
| `src/agent/tui/index.ts` | wiring | 30 | Re-export `runInteractiveTui` for `commands/agent.ts`. |
| `src/agent/tui/tui.ts` | entry/loop | 280 | Banner, status bar, main read→stream→render loop, ESC-to-abort wiring, `unhandledRejection` recovery, slash dispatch. |
| `src/agent/tui/streaming.ts` | adapter | 120 | Wrap `graph.streamEvents` into the spec §4 three-event TUI stream. AbortController plumbing. Tool-call breadcrumb truncation. |
| `src/agent/tui/input.ts` | reader | 480 | Raw-mode multiline reader. **Implements the spec §5.1 framing table by shape** + spec §5.2 stateful UTF-8 decoder. Exports `readInput`, plus pure helpers `replaceInput`, `insertNewline`, `handleBackspace`, `redrawCurrentLine` for unit testing. |
| `src/agent/tui/spinner.ts` | renderer | 50 | Spec §6 braille spinner. Exported for unit tests. |
| `src/agent/tui/ansi.ts` | renderer | 40 | ANSI constants from spec §6 + helpers (`clearLine`, `cursorUp/Down/Left/Right`, `saveCursor`, `restoreCursor`). |
| `src/agent/tui/utf8.ts` | reader helper | 25 | Stateful `StringDecoder` wrapper per spec §5.2. Exported for unit tests. |
| `src/agent/tui/clipboard.ts` | I/O | 90 | Cross-platform clipboard dispatcher. Falls back to `~/.tool-agents/zip-agent/last-response.txt`. |
| `src/agent/tui/persistence.ts` | I/O | 200 | All filesystem CRUD. Bootstrap of `memory.md`, `last-response.txt`, `tui-config.json`, `threads/` directory. Per-thread transcript JSON load/save/list. Mirrors `ensureGlobalConfigFile()` idempotent pattern. |
| `src/agent/tui/slash-commands.ts` | dispatcher | 350 | Single dispatcher + one `runX` function per slash command. Each takes a typed `SlashContext` and an `args: string[]`. Case-sensitive matching per spec §18 footgun. |
| `src/agent/tui/types.ts` | types | 60 | `TuiContext`, `TuiEvent`, `LocalMessage`, `SlashContext`, `ThreadTranscript`. |

Test files (under `test_scripts/`):

| File | Mandatory? | Coverage |
|---|---|---|
| `tui-input-escape-framing.spec.ts` | **YES** (spec §14.1) | Every CSI/SS3/ESC-prefix from §5 pressed alone + Enter ⇒ resolves to `""`. |
| `tui-input-utf8.spec.ts` | **YES** (spec §14.2) | Greek string round-trip; emoji round-trip; multi-byte split across chunks; mixed ASCII + multi-byte + escape. |
| `tui-spinner.spec.ts` | recommended | Frame rotation order; ANSI save/restore; `start`/`stop` idempotence. |
| `tui-utf8.spec.ts` | recommended | Decoder unit; split-chunk recovery. |
| `tui-clipboard.spec.ts` | recommended | Platform dispatch via mocked `child_process.spawn`. |
| `tui-persistence.spec.ts` | recommended | Bootstrap; thread save/load/list against `os.tmpdir()`. |
| `tui-streaming.spec.ts` | recommended | Mock LangGraph stream → spec §4 event mapping; abort honour. |
| `tui-slash-commands.spec.ts` | recommended | `/new` creates a fresh thread_id; `/tools` toggle calls `rebuildTools`; `/last` reprints; `/memory` round-trips through an editor stub. |

## 5. Adapter strategy

LangGraph already emits the spec §4 events natively at v2; no translation
needed. `streaming.ts` exposes:

```ts
export interface TuiEvent {
  kind: 'token' | 'tool_start' | 'tool_end';
  text?: string;       // kind === 'token'
  name?: string;       // kind === 'tool_start'
  args?: unknown;      // kind === 'tool_start' (for the breadcrumb)
  result?: string;     // kind === 'tool_end' (truncated)
}

export async function* streamTuiEvents(
  graph: AgentGraph,
  input: { messages: Array<{ role: 'user' | 'assistant'; content: string }> },
  opts: { threadId: string; signal: AbortSignal; recursionLimit: number },
): AsyncIterable<TuiEvent>;
```

Internally this calls `graph.streamEvents(input, { version: 'v2', configurable: { thread_id }, signal, recursionLimit })` and dispatches:

- `on_chat_model_stream` → `{ kind: 'token', text: stringContent(event.data.chunk.content) }`
- `on_tool_start` → `{ kind: 'tool_start', name: event.name, args: event.data?.input }`
- `on_tool_end` → `{ kind: 'tool_end', result: stringContent(event.data?.output) }` (truncated to 120 chars)

`stringContent` is the same helper already used in `run.ts:391-406` —
factored to handle string / array-of-parts / object content shapes.

## 6. Persistence file layout

```
~/.tool-agents/zip-agent/
├─ config                      (existing — global env)
├─ memory.md                   (NEW — long-term notes; edited via /memory)
├─ last-response.txt           (NEW — rolling, single file; /copy fallback)
├─ tui-config.json             (NEW — last-used provider/model, default-mutations)
└─ threads/
   └─ <thread_id>.json         (NEW — per-thread transcript)
```

| Override env var | Purpose |
|---|---|
| `ZIP_AGENT_TUI_HOME` | Override `~/.tool-agents/zip-agent/` for the TUI's persistence root (used in tests; defaults to the existing constant). |
| `ZIP_AGENT_TUI_NO_PERSIST` | When `1`, the TUI runs without writing any persistence files. Useful for piped invocations and tests. |
| `EDITOR` | Used by `/memory` and `/system`. If unset, both commands print inline / read from stdin. |

All four files are bootstrapped on first TUI run with the same idempotent
pattern as `ensureGlobalConfigFile()`. Permission errors warn-but-continue.
Files are created with mode `0o600` for parity with the existing config.

`.gitignore` is **already** configured to ignore the home dir (the project
root never holds these files), so no `.gitignore` update is needed for the
chosen layout. (Standard convention assumed cwd-rooted files; we are using
home-rooted ones.)

## 7. Wiring into `commands/agent.ts`

Single conditional change at line 60:

```ts
if (cfg.interactive) {
  if (opts.legacyRepl) {
    await runInteractive({ ... });   // existing readline path
  } else {
    await runInteractiveTui({ ... }); // new TUI path
  }
  return;
}
```

A new flag `--legacy-repl` is added to `cli.ts`'s `agent` subcommand and
plumbed through `AgentOptions`. No other file in `src/` outside the new
`src/agent/tui/` directory and the two integration touch-points
(`cli.ts`, `commands/agent.ts`) is modified.

## 8. Documentation update list

Per the project's docs convention:

- `CLAUDE.md` — add a `<zip-agent-tui>` tool block; update the existing
  `<zip-agent-agent>` block to reference the new default REPL behaviour
  and the `--legacy-repl` escape hatch.
- `docs/design/project-design.md` — add §12 "Interactive TUI architecture"
  with the file map, the streaming-event flow diagram, and the persistence
  layout.
- `docs/design/project-functions.MD` — add new functional requirements
  `FR-TUI-1`..`FR-TUI-N`.
- `docs/design/configuration-guide.md` — add a §6 "TUI persistence" section
  documenting `ZIP_AGENT_TUI_HOME`, `ZIP_AGENT_TUI_NO_PERSIST`, `EDITOR`,
  and the file layout.
- `README.md` — add `## Interactive TUI` section with quick-start.
- `Issues - Pending Items.md` — record the `/state` and `/monitor` omissions
  (reasons in §3 above) and any smoke-test terminal that wasn't covered.

## 9. Pitfall preemption (spec §18)

| Pitfall | Mitigation in this plan |
|---|---|
| §18.1 CSI/SS3 introducer mis-dispatched | `input.ts` implements the §5.1 framing table by shape with three explicit prefix branches; the regression test `tui-input-escape-framing.spec.ts` covers every case in §14.1. |
| §18.2 Multi-byte UTF-8 mangled | `input.ts` routes every printable byte through `utf8.ts`'s stateful `StringDecoder`. Control bytes and escape sequences bypass the decoder. Regression test `tui-input-utf8.spec.ts` covers §14.2. |
| §18.3 Shift+Enter unreliable | `input.ts` accepts every known sequence (`\x1b[13;2u`, `\x1bOM`, `\x1b\r`, `\x1b\n`, `\x1b[27;2;13~`); `/help` documents the Ctrl+J fallback. |
| §18.4 Stale dist | Phase 5 ends with `npm run build` and a smoke-test against `dist/cli.js`, not `tsx`. |
| Detection false-positive | Confirmed by reading `src/agent/graph.ts` — `createAgent` from `langchain` is the marker. |
| `process.stdin.isTTY` false in pipes | `tui.ts` early-aborts with a clear error if `!process.stdin.isTTY`. |
| Test runner conflict | Project already on vitest; new specs added to existing `test_scripts/` glob. No new runner. |
| Slash-command case sensitivity | Dispatcher does **case-sensitive** match. Documented in `/help` output. |

## 10. Phase gates

- Phase 0 — this plan (DONE on commit).
- Phase 1 — directory + stubs + `cli` script + `.gitignore` review. Gate:
  `npm run typecheck` clean.
- Phase 2 — pure helpers (`utf8.ts`, `ansi.ts`, `spinner.ts`, `input.ts`,
  `clipboard.ts`, `persistence.ts`). Gate: the two **mandatory** regression
  spec files green.
- Phase 3 — streaming adapter (`streaming.ts`). Gate: `tui-streaming.spec.ts`
  green.
- Phase 4 — slash commands (`slash-commands.ts`). Gate: per-command tests
  green.
- Phase 5 — `tui.ts` + `cli.ts`/`commands/agent.ts` wiring. Gate:
  `npm run build`, `node dist/cli.js agent -i` boots and prints the banner
  in iTerm2.
- Phase 6 — docs.

---

## Bugfix log — round 1 (2026-04-24)

After merging the initial TUI plan-004 implementation (215 tests green,
smoke-tested via `script -q`), the user ran the live binary against
`azure-openai/gpt-5.1` in macOS Terminal.app and reported three regressions
that the existing unit tests had not surfaced. All three were in the
streaming render path. This section pins the root causes, the fixes, and
the new specs that guard them. After this round: 226 tests green across
25 files; `tsc --noEmit` clean; `npm run build` produces fresh dist.

### Bug 1 — assistant text was being shredded during streaming

**Symptom.** With Azure OpenAI emitting tokens faster than the spinner's
80 ms tick, the on-screen response was stripped to only the trailing
character of each chunk (`. : " " "`), scattered across blank lines
with extreme indentation. The chunk extraction in `mapEvent` /
`stringifyContent` was correct — it was the renderer that was wiping the
line on every token.

**Root cause.** `spinner.stop()` in
`src/agent/tui/spinner.ts` unconditionally wrote
`SAVE_CURSOR + CLEAR_LINE + RESTORE_CURSOR` on every call, including no-op
calls made when the spinner had already been stopped. The streaming loop
in `src/agent/tui/tui.ts` calls `spinner.stop()` on every token event
without an `isActive()` guard. `CLEAR_LINE` is `"\r\x1b[2K"` — the `\r`
moves the cursor to column 0 and `\x1b[2K` erases the entire line. So
each token write was preceded by a "go to column 0, wipe the line, jump
back" sequence that destroyed everything streamed so far on that line.
Only the final character of each chunk survived because it was the last
thing written before the next token's stop()-cleanup wiped the line again.

**Fix.** Two changes (belt and braces):
- `src/agent/tui/spinner.ts` — `stop()` now early-returns when no timer
  is active; the cleanup ANSI is only written when there's actually a
  paint to clean up.
- `src/agent/tui/tui.ts` — the streaming loop guards every `spinner.stop()`
  call with `if (spinner.isActive())`, so the contract is enforced at the
  call site too.

**New specs in `test_scripts/tui-streaming-render.spec.ts`:**
- `spinner.stop() is a no-op when the spinner is already stopped` — pins
  the spinner contract.
- `does NOT emit a CLEAR_LINE between consecutive token writes` — pins
  the renderer's invariant that no `\r\x1b[2K` may appear after the
  Agent header (i.e. once streamed text begins).
- `emits the spinner cleanup at most ONCE during a streaming response` —
  pins the no-flicker requirement (Symptom 3 acceptance).
- `preserves contiguous tokenized text from array-of-parts chunks` —
  end-to-end check that `foo`, ` bar`, ` baz` chunks land contiguously.

### Bug 2 — tool breadcrumb showed double-encoded args

**Symptom.** The breadcrumb for `find_files` rendered as:

```
↳ calling find_files({"input":"{\"path\":\"~/Downloads\",\"types\":[\"file\"],...) ✓
```

The model's structured args were nested inside an outer `input` wrapper
*as a JSON-encoded string*, and the renderer showed the wrapper.

**Root cause.** When a tool's schema is inferred from a single zod input
field (rather than declared as multiple structured fields), LangGraph's
`on_tool_start.data.input` arrives as `{ input: <args> }` where `<args>`
is either a nested object or a JSON-encoded string. `previewObject()`
ran `JSON.stringify` on the wrapper without unwrapping, so the user
saw the wrapper key plus the escaped JSON string instead of the actual
arguments.

**Fix.** `src/agent/tui/streaming.ts` now exports
`unwrapToolInput(v: unknown): unknown` which detects a single-key
`{ input: ... }` envelope and returns the inner value (parsing it first
if it is a JSON-shaped string). Multi-key arg objects pass through
untouched. `mapEvent`'s `on_tool_start` branch calls it before
`previewObject`.

**New specs in `test_scripts/tui-streaming-render.spec.ts`:**
- `unwraps a single-key { input: <jsonString> } envelope before display`
- `unwraps a single-key { input: <object> } envelope before display`
- `leaves multi-key arg objects alone`

### Bug 3 — tool result showed the raw LangChain envelope

**Symptom.** After a tool ran, the breadcrumb appended:

```
✓ → {"lc":1,"type":"constructor","id":["langchain_core","messages","ToolMessage"],"kwargs":{"stat...
```

i.e. the entire LC serialization envelope instead of the tool's own
output.

**Root cause.** `on_tool_end.data.output` is a `ToolMessage` instance
when the tool returns one (the common case in the langchain v1 createAgent
graph). `previewObject` called `JSON.stringify(toolMessage)` directly,
which invokes `BaseMessage.toJSON()` — that returns the LC `{lc,type,id,kwargs}`
envelope. The actual content was buried inside `kwargs.content`.

**Fix.** `src/agent/tui/streaming.ts` now exports
`extractToolMessageContent(v: unknown): unknown` which detects three
shapes — native `ToolMessage` instance (via `_getType()` / `getType()` /
`type` discriminator), duck-typed `{type:'tool', content:...}`, and
JSON-roundtripped LC envelope (`{lc:1, type:'constructor', id:[..., 'ToolMessage'], kwargs:{content,...}}`)
— and returns `.content` (or `.kwargs.content`). Anything else passes
through untouched. `mapEvent`'s `on_tool_end` branch calls it before
`previewObject`.

**New specs in `test_scripts/tui-streaming-render.spec.ts`:**
- `extracts content from a real ToolMessage instance instead of dumping the LC envelope`
- `extracts content from a JSON-roundtripped ToolMessage envelope`
- `still pretty-prints structured plain objects` (negative — ensures we
  haven't broken the existing pass-through path)
- `handles ToolMessage content that is itself an array of parts`

### Files edited

- `src/agent/tui/spinner.ts` — `stop()` early-returns when no timer.
- `src/agent/tui/tui.ts` — `if (spinner.isActive()) spinner.stop()` at
  every call site in the streaming loop (token / tool_start branches).
- `src/agent/tui/streaming.ts` — added `unwrapToolInput`,
  `extractToolMessageContent`; wired them into `mapEvent`.
- `test_scripts/tui-streaming-render.spec.ts` — new file, 11 specs.

### Files deliberately NOT changed

- `src/agent/tui/streaming.ts > stringifyContent` — already handled the
  array-of-parts shape from the initial implementation; no changes needed
  for Symptom 1 once the spinner was fixed. Tests confirm.
- The existing `tui-streaming.spec.ts` — left as-is. The new spec file
  pins the bugfixes; the existing one continues to pin the original
  contract.
- No status-bar / scroll-region change. Symptom 3 was a downstream effect
  of Symptom 1 (the spinner-stop write was the source of the flicker
  during streaming), not an independent flicker bug. The status bar is
  written exactly once per turn (after the response completes) — that
  was already correct.

## Bugfix log — round 2 (2026-04-24, against `azure-openai/gpt-5.1`)

Three turns into a session the agent had no recollection of prior turns —
even simple referents like "the one you found previously" failed to resolve.
The status bar showed the same `thread_id` across all three turns, so the
TUI was correctly *displaying* a stable thread, but the LLM saw zero
context.

### Bug 1 — no MemorySaver attached to the session graph

**Symptom (verbatim user transcript).**

```
You> are there any zip files in the ~/Downloads folder ?
Agent> ... yes — I found 1 zip file: /Users/.../aiwork-20260420.zip

You> Can you take a look to this file and tell me what is inside?
Agent> Please send the path to the ZIP file you want me to inspect.

You> The one you found previously.
Agent> I'm missing the referent for "the one you found previously."
```

`thread_id` was identical (`im2l6i`) on all three turns per the status bar.

**Root cause.** `tui.ts` constructed `createAgentGraph({ model, tools,
systemPrompt })` without passing a `checkpointer`. `streaming.ts` already
threaded `configurable.thread_id` correctly into every `streamEvents`
call (line 52) — but it was pointing at a checkpointer that didn't exist.
With no `MemorySaver`, LangGraph has nowhere to load or persist thread
state, so every turn arrived at the model with only the new user message
in context, regardless of the `thread_id` config flag.

The legacy REPL at `src/agent/run.ts:145-147` does this correctly: it
constructs `let checkpointer = new MemorySaver()` once per session and
passes it to `createAgentGraph(...)`. The TUI bring-up missed this step.

**Fix.** A `checkpointer: MemorySaver` field was added to `TuiSession`
and is constructed once at session start in `tui.ts`. The session's
`graph` is built against that checkpointer. Every slash command that
rebuilds the graph for a reason that resets the thread (`/new`, `/model`,
`/tools` mutation toggle OR catalog change, `/system` edit, `/history`
load) now ALSO mints a fresh `MemorySaver` so the prior thread checkpoint
is dropped and prior tool_call ids cannot dangle. Plain turns reuse both
graph and checkpointer, so `streamEvents` can load the prior thread state
on every call.

A defensive invariant was added at the streaming call site in `tui.ts`:
if `session.threadId` is ever empty before `streamEvents`, throw rather
than silently start a zero-context turn.

### Rebuild rules (codified in slash-commands.ts)

| Slash command | thread_id | checkpointer | graph | local messages |
|---|---|---|---|---|
| `/new` (alias `/reset`) | rotated | new MemorySaver | rebuilt | cleared |
| `/model` | rotated | new MemorySaver | rebuilt | cleared (prior persisted) |
| `/tools` (mutation flip OR catalog change) | rotated | new MemorySaver | rebuilt | cleared (prior persisted) |
| `/tools` (no effective change) | kept | kept | rebuilt with same catalog | kept |
| `/system` (prompt edit accepted) | rotated | new MemorySaver | rebuilt | cleared (prior persisted) |
| `/history` (thread loaded) | swapped to loaded id | new MemorySaver | rebuilt | replaced with loaded transcript |
| `/clear` | kept | kept | kept | kept |
| any other slash (no graph touch) | kept | kept | kept | kept |
| plain user turn | kept | kept | kept | appended |

### Files edited

- `src/agent/tui/types.ts` — added `checkpointer: MemorySaver` to `TuiSession`.
- `src/agent/tui/tui.ts` — imports `MemorySaver`, constructs one at session
  start, passes it to the initial `createAgentGraph`, adds the empty-threadId
  invariant guard before the streaming loop.
- `src/agent/tui/slash-commands.ts` — `/new`, `/model`, `/system`, `/history`,
  and `/tools` (mutation flip OR catalog change) now construct a new
  `MemorySaver` and pass it into `createAgentGraph`. Catalog-change detection
  added to `/tools` (previously only the mutations master flip triggered a
  thread reset; a tool subset change without a master flip would have left
  dangling tool_call ids).
- `test_scripts/tui-slash-commands.spec.ts` — `makeSession` now constructs a
  real `MemorySaver` and passes it through, matching the new required field.
- `test_scripts/tui-thread-memory.spec.ts` — new file, 6 specs (see below).

### New specs in `test_scripts/tui-thread-memory.spec.ts`

- `streamTuiEvents passes session.threadId on every call (no rotation between turns)`
- `every streamEvents call also propagates the recursion limit and AbortSignal`
- `the thread_id observed before and after /new differs`
- `the streamEvents call after /new uses the rotated thread_id, not the old one`
- `flipping the mutations master switch via /tools rotates thread, replaces graph, and replaces checkpointer`
- `after a /tools mutation flip, the next streamEvents call carries the rotated thread_id`

The /tools specs use a `vi.mock` of `readInput` so the handler's interactive
prompt resolves deterministically to `"m"` (toggle mutations master) without
needing a real TTY.

### Files deliberately NOT changed

- `src/agent/run.ts` — out of scope (legacy REPL works correctly already).
- `src/agent/graph.ts` — already accepted an optional `checkpointer` param;
  no change needed.
- `src/agent/providers/registry.ts` and any provider/tool code — not the
  source of the bug.
- `src/agent/tui/streaming.ts` — the `configurable.thread_id` was already
  threaded correctly; the bug was upstream (no checkpointer to load from).

### Verification

- 6 new specs added; full suite 232 tests across 26 files, all green.
- `tsc --noEmit` clean.
- `npm run build` produces fresh `dist/agent/tui/*.js`.
