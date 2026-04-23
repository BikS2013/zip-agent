# zip-agent

A TypeScript CLI that wraps the operating system's `zip` / `unzip` / `zipinfo`
binaries, plus a LangGraph ReAct **agent** subcommand that lets you talk to
those operations in natural language.

```
$ zip-agent agent "list everything in release.zip larger than 1 MB"
$ zip-agent agent "zip ./reports into reports.zip but skip *.DS_Store" --allow-mutations
$ zip-agent agent -i      # interactive REPL with in-process memory
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
# OpenAI — uses your already-exported OPENAI_API_KEY
export ZIP_AGENT_PROVIDER=openai
export ZIP_AGENT_MODEL=gpt-4o-mini
zip-agent agent "what's the largest entry in release.zip?"

# Azure OpenAI — interactive REPL, picks up AZURE_OPENAI_*
export ZIP_AGENT_PROVIDER=azure-openai
export ZIP_AGENT_MODEL=gpt-4o-mini
zip-agent agent -i

# Azure DeepSeek via Microsoft Foundry — picks up AZURE_AI_INFERENCE_*
export ZIP_AGENT_PROVIDER=azure-deepseek
export ZIP_AGENT_AZURE_DEEPSEEK_MODEL=DeepSeek-V3.1
zip-agent agent "is release.zip corrupted?"
```

### Env-var precedence

For each provider setting (API key / endpoint / deployment / api-version):

```
CLI flag  >  ZIP_AGENT_<PROVIDER>_<NAME>  >  canonical alias  >  default (optional only)
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
