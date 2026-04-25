# zip-agent

A TypeScript CLI that wraps the operating system's `zip` / `unzip` / `zipinfo`
binaries, plus a LangGraph ReAct **agent** subcommand that lets you talk to
those operations in natural language.

```
$ zip-agent agent "list everything in release.zip larger than 1 MB"
$ zip-agent agent "zip ./reports into reports.zip but skip *.DS_Store" --allow-mutations
$ zip-agent agent -i      # raw-mode TUI: streaming, multiline, slash commands
```

---

## Install

```sh
npm install
npm run build
```

Then either link the binary (`npm link` → `zip-agent`) or run via `node dist/cli.js`.

Requires:
- Node ≥ 20
- The OS `zip`, `unzip`, and `zipinfo` binaries on `$PATH` (default macOS/Linux install).

## Plain CLI

| Subcommand | Wraps | Mutating? |
|---|---|---|
| `zip-agent list <archive>` | `unzip -l` | no |
| `zip-agent info <archive>` | `zipinfo -v` | no |
| `zip-agent test <archive>` | `unzip -t` | no |
| `zip-agent create <archive> <inputs...>` | `zip -r` | yes |
| `zip-agent extract <archive>` | `unzip` | yes |
| `zip-agent add <archive> <files...>` | `zip -u` | yes |
| `zip-agent remove <archive> <patterns...>` | `zip -d` | yes |

Global flags: `--json` (default) / `--table` / `--quiet` / `--verbose` / `--log-file <path>`.

Exit codes: 0 OK · 1 unexpected · 2 usage · 3 config · 4 auth · 5 upstream · 6 io · 7 collision · 130 SIGINT.

## Agent mode

`zip-agent agent [prompt] [flags]` runs a LangGraph ReAct agent with the seven
zip operations available as tools. Mutation tools (`create`, `extract`, `add`,
`remove`) are excluded from the catalog unless `--allow-mutations` is set.

### Quick-start by provider

The agent reuses canonical industry env-var names (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `AZURE_OPENAI_*`,
`AZURE_AI_INFERENCE_*`). Only `ZIP_AGENT_PROVIDER` and `ZIP_AGENT_MODEL`
are project-specific and have to be set explicitly.

```sh
# Azure OpenAI — one-shot, canonical env-var names
export ZIP_AGENT_PROVIDER=azure-openai
export ZIP_AGENT_MODEL=gpt-4o-mini        # or set AZURE_OPENAI_DEPLOYMENT
export AZURE_OPENAI_API_KEY=<your-key>
export AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
zip-agent agent "what's the largest entry in release.zip?"

# Azure OpenAI — interactive REPL with in-process memory
export ZIP_AGENT_PROVIDER=azure-openai
export ZIP_AGENT_MODEL=gpt-4o-mini
zip-agent agent -i

# OLLaMA (local-openai) — no API key needed, model pulled from OLLaMA
export ZIP_AGENT_PROVIDER=local-openai
export ZIP_AGENT_MODEL=llama3
export ZIP_AGENT_LOCAL_OPENAI_BASE_URL=http://localhost:11434/v1
zip-agent agent "is downloaded.zip corrupted?"
```

### Env-var precedence

The agent uses a layered resolution with an unusual ordering: dotenv **files
win over shell exports** so that a deliberately-set project value is never
silently overridden by a stale shell export from another project.

```
1. --env-file <path>       Replaces both file sources below.
2. CLI flag                --provider, --model, etc.
3. ./.env                  Project-local dotenv (wins over global config & shell).
4. ~/.tool-agents/zip-agent/config   Global per-tool config (wins over shell).
5. process.env             Existing shell exports (lowest before defaults).
6. NONE                    Required → ConfigurationError (exit 3).
                           Optional tunables → built-in default.
```

Examples:
- `OPENAI_API_KEY` is read automatically when `ZIP_AGENT_OPENAI_API_KEY` isn't set.
- `AZURE_OPENAI_DEPLOYMENT_NAME` satisfies `ZIP_AGENT_AZURE_OPENAI_DEPLOYMENT`.
- `GEMINI_API_KEY` and `GOOGLE_GENAI_API_KEY` both satisfy `ZIP_AGENT_GOOGLE_API_KEY`.

If you need this agent to use a *different* value than your other agents,
set the `ZIP_AGENT_<PROVIDER>_*` variant in a dedicated env file and run
with `--env-file ./.env.zip-agent`. The prefixed name always wins over the
canonical alias.

There is **no fallback for required values**. Missing `ZIP_AGENT_PROVIDER`,
`ZIP_AGENT_MODEL`, or any required provider key (under either name) → exit
code **3** with a `Mandatory setting "..." was not provided. Checked: ...`
message that lists every name that was searched.

### `--allow-mutations` safety

Without `--allow-mutations`, the LLM sees only the three read-only tools
(`list_archive`, `archive_info`, `test_archive`). Even if the user asks the
agent to create or delete an archive, the agent literally cannot — there is no
tool in its catalog. Set the flag (or `ZIP_AGENT_ALLOW_MUTATIONS=true`) to
expose `create_archive`, `extract_archive`, `add_to_archive`,
`remove_from_archive`. Their descriptions begin with `[MUTATING]` and the
default system prompt instructs the model to confirm with the user before
calling them.

See `docs/design/configuration-guide.md` for the full env-variable matrix and
`docs/design/project-design.md` for the architecture and ADRs.

## Interactive TUI

`zip-agent agent -i` launches a single-process raw-mode terminal UI. It
streams the model's response token by token, shows tool-call breadcrumbs
inline (`↳ calling list_archive(...) ✓`), and accepts ESC to abort an
in-flight turn. Multiline editing, UTF-8 input (Greek, CJK, emoji), and
input history all work — no `readline`.

Quick-start:

```sh
npm install
npm run build
ZIP_AGENT_PROVIDER=openai ZIP_AGENT_MODEL=gpt-4o-mini OPENAI_API_KEY=... \
  node dist/cli.js agent -i
```

Slash commands (case-sensitive):

| | |
|---|---|
| `/help` | List every command and keybinding |
| `/history` | Pick a past thread to resume |
| `/memory` | Edit `~/.tool-agents/zip-agent/memory.md` in `$EDITOR` |
| `/new` (alias `/reset`) | Fresh thread (memory.md kept) |
| `/quit` (alias `/exit`) | Leave the TUI |
| `/last` | Re-print the last assistant message |
| `/copy` | Copy the last response to the system clipboard |
| `/model` | Pick a provider + model id at runtime |
| `/tools` | Toggle individual tools / `--allow-mutations` master |
| `/system` | View / `e` to edit the system prompt (in-memory only) |
| `/clear` | Clear the screen, keep the conversation |

Keybindings: `Enter` submits, `Ctrl+J` inserts a newline (universal),
`Shift+Enter` inserts a newline on terminals that opt into CSI-u (kitty,
Ghostty, recent iTerm2/Alacritty). On older terminals `Shift+Enter` falls
through to a plain submit; use `Ctrl+J`. Arrow keys move the cursor and
navigate input history at top/bottom edges; `Ctrl+A`/`Ctrl+E`/`Ctrl+W`
work as expected; `Ctrl+L` clears the screen.

Persistence files live under `~/.tool-agents/zip-agent/` (`memory.md`,
`last-response.txt`, `tui-config.json`, `threads/<id>.json`) and are
auto-bootstrapped on first run. Override the root with
`ZIP_AGENT_TUI_HOME=...` or skip writes entirely with
`ZIP_AGENT_TUI_NO_PERSIST=1`.

Need to pipe input or escape to the previous behaviour? Use
`zip-agent agent -i --legacy-repl` for one release cycle.

## Development

```sh
npm run typecheck       # tsc --noEmit
npm run test            # vitest run
npm run test:watch
npm run smoke:cjs       # verify langchain CJS interop
```

Test scripts live under `test_scripts/`. Plans and design docs under
`docs/design/`. Issues and pending items in the root-level
`Issues - Pending Items.md`.
