# Configuration Guide — `zip-agent`

## 1. Sources & precedence

The agent resolves each configuration value through a layered chain. The chain
is **unusual**: dotenv file sources outrank `process.env`. This means a value
set in `.env` (or the global per-tool config) overrides a same-named shell
export. See ADR-008 in `project-design.md` for the rationale.

### Full precedence chain (highest to lowest)

```
1. --env-file <path>
      When supplied via CLI, REPLACES both file sources (steps 3 & 4).
      Chain becomes: --env-file > process.env > defaults.

2. CLI flag
      --provider, --model, --max-steps, --temperature, etc.
      Always wins for the specific flag it controls.

3. ./.env  (project-local dotenv file, cwd)
      Wins over the global config and over process.env.

4. ~/.tool-agents/zip-agent/config  (global per-tool config)
      A plain dotenv KEY=VALUE file. Created automatically with placeholder
      comments on first agent run if absent. Wins over process.env.

5. process.env  (existing shell exports)
      Consulted only after all file sources are checked.

6. NONE
      For required settings (ZIP_AGENT_PROVIDER, ZIP_AGENT_MODEL, required
      provider keys): ConfigurationError (exit 3) listing every source
      checked. For optional tunables: built-in defaults apply.
```

### `--env-file` semantics

When `--env-file <path>` is provided, the agent reads that file instead of
`./.env` and `~/.tool-agents/zip-agent/config`. It does **not** combine the
three sources — `--env-file` is a complete replacement for the file layer.
The resulting env map is: `{ ...process.env, ...parseFile(envFile) }`.

Typical use: keep a provider-specific file and swap it at runtime:
```sh
zip-agent agent --env-file ~/.env.azure-openai "list the files in release.zip"
```

### Aliases — why they exist

`ZIP_AGENT_<PROVIDER>_*` is the project-specific override surface. If that key
is not set, the loader falls back to the standard industry name (e.g.
`OPENAI_API_KEY`) so keys already exported globally for other tools on the
machine work without duplication.

If you need this agent to use a *different* value than your other tools, set
the `ZIP_AGENT_*` form in `.env` or in `--env-file`. The `ZIP_AGENT_*` value
always wins over the canonical alias.

This is **not** a default fallback — it accepts two equivalent names for the
same explicit user input. If neither name is set, missing required values still
throw `ConfigurationError` (exit 3).

### Global config file — `~/.tool-agents/zip-agent/config`

**Auto-bootstrapped on first `agent` invocation.** When `zip-agent agent ...`
runs and the file does not exist, the agent:

1. Creates the directory tree `~/.tool-agents/zip-agent/` (`mkdir -p`).
2. Writes the file with a fully-commented copy of `.env.example` — every key
   is prefixed with `#`, so the new file contributes **zero** values to the
   precedence chain. Bootstrap never changes runtime behavior.
3. Prints a one-line note to stderr:
   `[zip-agent] created global config template at /Users/<you>/.tool-agents/zip-agent/config (all keys commented; edit to enable)`
   Suppress the note with the global `--quiet` flag.

Subsequent runs are silent — the bootstrap is a single `existsSync` call.
**Existing files are never overwritten**, so your edits are safe across
upgrades. If the agent cannot create the file (permission denied, ENOSPC,
etc.) it prints a `[zip-agent] warning:` line and continues — the global
config layer simply contributes nothing for that invocation.

Format is plain dotenv:

```dotenv
# ZIP_AGENT_PROVIDER=azure-openai
# ZIP_AGENT_MODEL=gpt-4o-mini
```

Edit it with any text editor. Secrets (API keys) can go here if you prefer a
durable location over repeated shell exports; the file should have mode `0600`
(`chmod 0600 ~/.tool-agents/zip-agent/config`).

The **embedded template** is kept byte-for-byte identical to `.env.example` —
a vitest drift guard (`test_scripts/agent-env-loader.spec.ts`) fails CI if the
two diverge.

---

## 2. CLI substrate (`ZIP_AGENT_*` non-agent vars)

| Variable | Purpose | Required | Default | How to obtain |
|---|---|---|---|---|
| `ZIP_AGENT_ZIP_BIN` | Override path to `zip` binary | no | `zip` from `$PATH` | `which zip` |
| `ZIP_AGENT_UNZIP_BIN` | Override path to `unzip` binary | no | `unzip` from `$PATH` | `which unzip` |
| `ZIP_AGENT_ZIPINFO_BIN` | Override path to `zipinfo` binary | no | `zipinfo` from `$PATH` | `which zipinfo` |
| `ZIP_AGENT_LOG_FILE` | Path to append redacted logs | no | _none_ (stderr only) | choose any writable path |

**Storage:** export from the shell or place in `.env`. No expiring tokens here.

---

## 3. Agent — global vars (`ZIP_AGENT_*`)

| Variable | Purpose | Required | Default | How to obtain |
|---|---|---|---|---|
| `ZIP_AGENT_PROVIDER` | LLM provider name | yes | _no fallback_ | one of `openai`, `anthropic`, `google`, `azure-openai`, `azure-anthropic`, `azure-deepseek`, `local-openai` |
| `ZIP_AGENT_MODEL` | Model id (or Azure deployment if provider-specific fallback unset) | yes ¹ | _no fallback_ | the provider's model catalog |
| `ZIP_AGENT_MAX_STEPS` | ReAct iteration cap | no | `10` | integer |
| `ZIP_AGENT_TEMPERATURE` | Sampling temperature | no | `0` | float `[0,2]` |
| `ZIP_AGENT_PER_TOOL_BUDGET_BYTES` | Per-tool-result byte cap | no | `16384` | integer ≥ 1024 |
| `ZIP_AGENT_ALLOW_MUTATIONS` | Enable mutation tools | no | `false` | `true` / `false` |
| `ZIP_AGENT_TOOLS` | CSV allowlist of tool names | no | _all_ | e.g. `list_archive,test_archive` |
| `ZIP_AGENT_SYSTEM_PROMPT` | Inline system prompt | no | built-in | any string |
| `ZIP_AGENT_SYSTEM_PROMPT_FILE` | Path to system prompt | no | _none_ | path to readable file |

¹ For `azure-openai`, `azure-anthropic`, `azure-deepseek`, `ZIP_AGENT_MODEL` falls back to the provider-specific deployment var (see §4). For `local-openai` there is no such fallback — model must be set explicitly.

**Recommended storage:** secrets in shell exports or `~/.tool-agents/zip-agent/config` (mode 0600); non-secret tunables in `.env`. Always gitignore `.env`; commit only `.env.example`.

---

## 4. Agent — per-provider vars

Each row lists the project-prefixed name first, then the canonical alias chain (lower priority — only consulted if the prefixed name is unset).

### `openai`
| Variable (prefixed) | Canonical aliases | Required | Default | How to obtain |
|---|---|---|---|---|
| `ZIP_AGENT_OPENAI_API_KEY` | `OPENAI_API_KEY` | yes | _no fallback_ | https://platform.openai.com/api-keys |
| `ZIP_AGENT_OPENAI_BASE_URL` | `OPENAI_BASE_URL` | no | OpenAI default | for proxies / OpenAI-compatible gateways |
| `ZIP_AGENT_OPENAI_ORG` | `OPENAI_ORG_ID`, `OPENAI_ORGANIZATION` | no | _none_ | OpenAI organization id |

Optional `ZIP_AGENT_OPENAI_API_KEY_EXPIRES_AT` (ISO-8601 date) — the agent warns within 7 days of expiry and refuses to start past the date.

### `anthropic`
| Variable (prefixed) | Canonical aliases | Required | Default | How to obtain |
|---|---|---|---|---|
| `ZIP_AGENT_ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | yes | _no fallback_ | https://console.anthropic.com/settings/keys |
| `ZIP_AGENT_ANTHROPIC_BASE_URL` | `ANTHROPIC_BASE_URL` | no | Anthropic default | for proxies |

Optional `ZIP_AGENT_ANTHROPIC_API_KEY_EXPIRES_AT`.

### `google`
| Variable (prefixed) | Canonical aliases | Required | Default | How to obtain |
|---|---|---|---|---|
| `ZIP_AGENT_GOOGLE_API_KEY` | `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_GENAI_API_KEY` | yes | _no fallback_ | https://aistudio.google.com/app/apikey |

Optional `ZIP_AGENT_GOOGLE_API_KEY_EXPIRES_AT`.

### `azure-openai`
| Variable (prefixed) | Canonical aliases | Required | Default | How to obtain |
|---|---|---|---|---|
| `ZIP_AGENT_AZURE_OPENAI_API_KEY` | `AZURE_OPENAI_API_KEY` | yes | _no fallback_ | Azure portal → resource → Keys |
| `ZIP_AGENT_AZURE_OPENAI_ENDPOINT` | `AZURE_OPENAI_ENDPOINT` | yes | _no fallback_ | e.g. `https://my-resource.openai.azure.com` |
| `ZIP_AGENT_AZURE_OPENAI_DEPLOYMENT` | `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_DEPLOYMENT_NAME` | yes ² | _no fallback_ | the deployment name in your resource |
| `ZIP_AGENT_AZURE_OPENAI_API_VERSION` | `AZURE_OPENAI_API_VERSION`, `OPENAI_API_VERSION` | no | `2024-10-21` | match Azure docs for the model family |

² `ZIP_AGENT_MODEL` falls back to this when not set explicitly.

Optional `ZIP_AGENT_AZURE_OPENAI_API_KEY_EXPIRES_AT`. Azure keys expire; setting this is strongly recommended.

### `azure-anthropic` (Microsoft Foundry)
| Variable (prefixed) | Canonical aliases | Required | Default | How to obtain |
|---|---|---|---|---|
| `ZIP_AGENT_AZURE_AI_INFERENCE_KEY` | `AZURE_AI_INFERENCE_KEY`, `AZURE_INFERENCE_CREDENTIAL` | yes | _no fallback_ | Azure portal → Foundry resource → Keys |
| `ZIP_AGENT_AZURE_AI_INFERENCE_ENDPOINT` | `AZURE_AI_INFERENCE_ENDPOINT`, `AZURE_INFERENCE_ENDPOINT` | yes | _no fallback_ | Foundry resource endpoint (without `/models` suffix) |
| `ZIP_AGENT_AZURE_ANTHROPIC_MODEL` | _none_ | yes ² | _no fallback_ | model id, e.g. `claude-3-5-sonnet-20241022` |

The agent appends `/anthropic` to the endpoint automatically (`normalizeFoundryEndpoint`).

Optional `ZIP_AGENT_AZURE_AI_INFERENCE_KEY_EXPIRES_AT`.

### `azure-deepseek` (Microsoft Foundry)
| Variable (prefixed) | Canonical aliases | Required | Default | How to obtain |
|---|---|---|---|---|
| `ZIP_AGENT_AZURE_AI_INFERENCE_KEY` | `AZURE_AI_INFERENCE_KEY`, `AZURE_INFERENCE_CREDENTIAL` | yes (shared with azure-anthropic) | _no fallback_ | same as above |
| `ZIP_AGENT_AZURE_AI_INFERENCE_ENDPOINT` | `AZURE_AI_INFERENCE_ENDPOINT`, `AZURE_INFERENCE_ENDPOINT` | yes (shared) | _no fallback_ | same as above |
| `ZIP_AGENT_AZURE_DEEPSEEK_MODEL` | _none_ | yes ² | _no fallback_ | accepted: `DeepSeek-V3`, `DeepSeek-V3.1`, `DeepSeek-V3.2`. Reasoning models (`DeepSeek-R1*`, `DeepSeek-V3.2-Speciale`, `MAI-DS-R1`) are denied — see ADR-005. |

The agent appends `/openai/v1` to the endpoint automatically.

### `local-openai` (local OpenAI-wire-compatible servers)

For local inference servers that speak the OpenAI wire format: OLLaMA, LM Studio, MLX-LM, LightLLM, vLLM, LLaMA.CPP's `llama-server`, etc.

| Variable (prefixed) | Canonical aliases | Required | Default | How to obtain |
|---|---|---|---|---|
| `ZIP_AGENT_LOCAL_OPENAI_BASE_URL` | `LOCAL_OPENAI_BASE_URL`, `OLLAMA_HOST` | yes | _no fallback_ | URL of the local server's OpenAI-compatible endpoint |
| `ZIP_AGENT_LOCAL_OPENAI_API_KEY` | `OPENAI_API_KEY` (last resort) | no | `"local"` ³ | any non-empty string; most local servers ignore it |

³ `ZIP_AGENT_LOCAL_OPENAI_API_KEY` is the **only** setting in this project that has a built-in default value. This is intentional — most local servers require a non-empty string but do not validate it. See ADR-007 in `project-design.md`. The no-fallback rule applies to all other settings.

Model must be supplied via `--model` or `ZIP_AGENT_MODEL`. There is no provider-specific deployment fallback for local servers.

**Common base URL examples:**
```
OLLaMA:    http://localhost:11434/v1
LM Studio: http://localhost:1234/v1
vLLM:      http://localhost:8000/v1
```

**OLLaMA OLLAMA_HOST note:** `OLLAMA_HOST` is typically set to `http://localhost:11434` (without `/v1`). The agent expects the full OpenAI-compatible path including `/v1`. If your `OLLAMA_HOST` does not include `/v1`, set `ZIP_AGENT_LOCAL_OPENAI_BASE_URL` explicitly.

---

## 5. CLI flags (highest precedence for their setting)

Every agent env var has a corresponding flag on `zip-agent agent`:

| Flag | Maps to |
|---|---|
| `-p, --provider <name>` | `ZIP_AGENT_PROVIDER` |
| `-m, --model <id>` | `ZIP_AGENT_MODEL` |
| `--max-steps <n>` | `ZIP_AGENT_MAX_STEPS` |
| `--temperature <t>` | `ZIP_AGENT_TEMPERATURE` |
| `--per-tool-budget <bytes>` | `ZIP_AGENT_PER_TOOL_BUDGET_BYTES` |
| `--allow-mutations` | `ZIP_AGENT_ALLOW_MUTATIONS=true` |
| `--tools <csv>` | `ZIP_AGENT_TOOLS` |
| `--system <text>` | `ZIP_AGENT_SYSTEM_PROMPT` |
| `--system-file <path>` | `ZIP_AGENT_SYSTEM_PROMPT_FILE` |
| `--env-file <path>` | replaces `./.env` + global config in the file layer |
| `--verbose` | per-step trace to stderr |

---

## 6. Token expiry policy

For variables marked with an optional `*_EXPIRES_AT` companion: store an ISO-8601 date (`2026-09-30`). At startup, the agent compares to today and:

- > 7 days away: silent
- ≤ 7 days away: warn on stderr (`[zip-agent] warn: ZIP_AGENT_OPENAI_API_KEY expires in 5 day(s)`)
- past: hard error (`ConfigurationError` exit 3) — refuses to start

This mechanism is opt-in; if the `*_EXPIRES_AT` var is unset, no check runs.

---

## 7. `~/.tool-agents/zip-agent/config` reference

The global per-tool config file is a dotenv KEY=VALUE file. The directory
tree and a fully-commented skeleton (a copy of `.env.example`) are written
automatically on the first `zip-agent agent ...` invocation; subsequent
runs are silent and never overwrite your edits. See §1 for the full
bootstrap behavior. Typical content after editing:

```dotenv
# zip-agent global config — ~/.tool-agents/zip-agent/config
# Edit this file to set persistent defaults for this tool.
# Values here OVERRIDE same-named process.env exports (see §1 precedence).

ZIP_AGENT_PROVIDER=azure-openai
ZIP_AGENT_MODEL=gpt-4o-mini

# Secrets — set these here only if you prefer durability over shell exports.
# Keep file mode 0600: chmod 0600 ~/.tool-agents/zip-agent/config
# ZIP_AGENT_AZURE_OPENAI_API_KEY=...
# ZIP_AGENT_AZURE_OPENAI_ENDPOINT=https://...
# ZIP_AGENT_AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
```

To use a non-default provider temporarily without editing the file:

```sh
zip-agent agent -p openai -m gpt-4o-mini "list release.zip"
```

CLI flags always win over the global config.

## 6. Interactive TUI configuration

The raw-mode TUI (`zip-agent agent -i`) reads the same provider/model
configuration as the rest of the agent — no parallel resolution chain. It
adds three TUI-only env vars and four persistence files.

### TUI-only env vars

| Variable | Purpose | Default |
|---|---|---|
| `ZIP_AGENT_TUI_HOME` | Override the persistence root. Useful for sandboxing the TUI in a test directory or a containerised home. | `~/.tool-agents/zip-agent/` (same dir as the global config file) |
| `ZIP_AGENT_TUI_NO_PERSIST` | When `1`, every TUI-side write is a no-op. Use it for piped invocations and CI runs where you do not want a stray transcript on disk. | unset (persistence on) |
| `EDITOR` / `VISUAL` | Used by `/memory` and `/system` to spawn an external editor. Without them, `/memory` prints inline and `/system` can only display. | unset → inline mode |

These follow the project's no-fallback rule: they are all **optional**
toggles. Missing them does not throw — it just selects the alternative
behaviour described above.

### TUI persistence files

```
~/.tool-agents/zip-agent/
├─ config                      (existing — global env; Section 5 above)
├─ memory.md                   (long-term notes; /memory edits this in $EDITOR)
├─ last-response.txt           (rolling, single file; /copy fallback target)
├─ tui-config.json             ({defaultMutations, providerOverride, modelOverride})
└─ threads/
   └─ <thread_id>.json         (per-thread transcript; /history lists & resumes)
```

| File | Format | Mode | Auto-created? |
|---|---|---|---|
| `memory.md` | Markdown text (free-form) | 0600 | yes, with template comment |
| `last-response.txt` | Plain text (last assistant message) | 0600 | yes, empty |
| `tui-config.json` | JSON `{defaultMutations: bool, providerOverride: string\|null, modelOverride: string\|null}` | 0600 | yes, with defaults |
| `threads/<id>.json` | JSON `{threadId, createdAt, updatedAt, provider, model, messages: [...]}` | 0600 | per-thread on first turn |

Bootstrap is **idempotent** and mirrors the existing
`ensureGlobalConfigFile()` pattern: existing files are NEVER overwritten,
permission errors warn-but-continue, the agent keeps working without
persistence if disk is unavailable.

### `--legacy-repl` escape hatch

`zip-agent agent -i --legacy-repl` falls back to the previous
plain-readline REPL implemented in `src/agent/run.ts::runInteractive`.
This flag is kept for one release cycle — it is the recovery path if
the raw-mode TUI breaks for a user. The legacy REPL is unchanged from
its previous behaviour (no streaming, no slash commands beyond
`/help /tools /mutations /reset /clear /exit`).

### Why no expiry-tracking knobs for the TUI

The TUI itself has no expiring secrets. Its persistence files are local
state, not credentials. Provider API keys still live in the existing
`ZIP_AGENT_*_API_KEY_EXPIRES_AT` slots described in Section 3 — those
are checked by the model factories, not by the TUI.
