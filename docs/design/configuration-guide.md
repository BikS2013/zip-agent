# Configuration Guide — `zip-agent`

## 1. Sources & precedence

For every provider setting (API key / endpoint / deployment / api-version):

```
CLI flag  >  ZIP_AGENT_<PROVIDER>_<NAME>  >  canonical alias  >  default (optional only)
```

For every project-specific setting (PROVIDER, MODEL, MAX_STEPS, TEMPERATURE, ALLOW_MUTATIONS, TOOLS, SYSTEM_PROMPT, PER_TOOL_BUDGET_BYTES):

```
CLI flag  >  ZIP_AGENT_<NAME>  >  default (optional only)
```

`dotenv.config({ override: false })` runs in `src/commands/agent.ts::run` **before** `loadAgentConfig`, so any variable already exported in the shell wins over the file.

### Aliases — why they exist

The `ZIP_AGENT_<PROVIDER>_*` form is the project-specific override surface. If you don't set it, the agent transparently falls back to the canonical industry env name (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.). That means: keys you've already exported globally for use by other agents on the machine work without duplication.

If you need this agent to use a *different* value than your other agents, set the `ZIP_AGENT_*` form — typically inside a dedicated `.env.zip-agent` file passed via `--env-file`. The `ZIP_AGENT_*` value always wins over the canonical alias.

This is **not** a fallback to a default value (the no-fallback rule still applies). It's accepting two equivalent names for the same explicit user input. If neither name is set, missing required values still throw `ConfigurationError` (exit 3).

## 2. CLI substrate (`ZIP_AGENT_*` non-agent vars)

| Variable | Purpose | Required | Default | How to obtain |
|---|---|---|---|---|
| `ZIP_AGENT_ZIP_BIN` | Override path to `zip` binary | no | `zip` from `$PATH` | `which zip` |
| `ZIP_AGENT_UNZIP_BIN` | Override path to `unzip` binary | no | `unzip` from `$PATH` | `which unzip` |
| `ZIP_AGENT_ZIPINFO_BIN` | Override path to `zipinfo` binary | no | `zipinfo` from `$PATH` | `which zipinfo` |
| `ZIP_AGENT_LOG_FILE` | Path to append redacted logs | no | _none_ (stderr only) | choose any writable path |

**Storage:** export from the shell or place in a project-local `.env`. No expiring tokens here.

## 3. Agent — global vars (`ZIP_AGENT_*`)

| Variable | Purpose | Required | Default | How to obtain |
|---|---|---|---|---|
| `ZIP_AGENT_PROVIDER` | LLM provider name | yes | _no fallback_ | one of `openai`, `anthropic`, `google`, `azure-openai`, `azure-anthropic`, `azure-deepseek` |
| `ZIP_AGENT_MODEL` | Model id (or Azure deployment if provider-specific fallback unset) | yes ¹ | _no fallback_ | the provider's model catalog |
| `ZIP_AGENT_MAX_STEPS` | ReAct iteration cap | no | `10` | integer |
| `ZIP_AGENT_TEMPERATURE` | Sampling temperature | no | `0` | float `[0,2]` |
| `ZIP_AGENT_PER_TOOL_BUDGET_BYTES` | Per-tool-result byte cap | no | `16384` | integer ≥ 1024 |
| `ZIP_AGENT_ALLOW_MUTATIONS` | Enable mutation tools | no | `false` | `true` / `false` |
| `ZIP_AGENT_TOOLS` | CSV allowlist of tool names | no | _all_ | e.g. `list_archive,test_archive` |
| `ZIP_AGENT_SYSTEM_PROMPT` | Inline system prompt | no | built-in | any string |
| `ZIP_AGENT_SYSTEM_PROMPT_FILE` | Path to system prompt | no | _none_ | path to readable file |

¹ For `azure-openai`, `azure-anthropic`, `azure-deepseek`, `ZIP_AGENT_MODEL` falls back to the provider-specific deployment var (see §4).

**Recommended storage:** secrets in shell exports (or a vault); non-secret tunables in `.env`. Always ignore `.env`; commit only `.env.example`.

## 4. Agent — per-provider vars

Each row lists the project-prefixed name first, then the canonical alias chain (lower priority — only consulted if the prefixed name is unset).

### `openai`
| Variable (prefixed) | Canonical aliases | Required | Default | How to obtain |
|---|---|---|---|---|
| `ZIP_AGENT_OPENAI_API_KEY` | `OPENAI_API_KEY` | yes | _no fallback_ | https://platform.openai.com/api-keys |
| `ZIP_AGENT_OPENAI_BASE_URL` | `OPENAI_BASE_URL` | no | OpenAI default | for proxies / OpenAI-compatible gateways |
| `ZIP_AGENT_OPENAI_ORG` | `OPENAI_ORG_ID`, `OPENAI_ORGANIZATION` | no | _none_ | OpenAI organization id |

**Token expiry tracking:** OpenAI keys do not expire automatically, but rotation is recommended. Optional `ZIP_AGENT_OPENAI_API_KEY_EXPIRES_AT` (ISO-8601 date) is read by the agent and a warning is printed within 7 days of expiry.

### `anthropic`
| Variable (prefixed) | Canonical aliases | Required | Default | How to obtain |
|---|---|---|---|---|
| `ZIP_AGENT_ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | yes | _no fallback_ | https://console.anthropic.com/settings/keys |
| `ZIP_AGENT_ANTHROPIC_BASE_URL` | `ANTHROPIC_BASE_URL` | no | Anthropic default | for proxies |

Optional `ZIP_AGENT_ANTHROPIC_API_KEY_EXPIRES_AT` for proactive rotation warnings.

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

Optional `ZIP_AGENT_AZURE_OPENAI_API_KEY_EXPIRES_AT`.

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

## 5. CLI flags (highest precedence)

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
| `--env-file <path>` | path to load with dotenv |
| `--verbose` | per-step trace to stderr |

## 6. Token expiry policy

For variables marked with an optional `*_EXPIRES_AT` companion: store an ISO-8601 date (`2026-09-30`). At startup, the agent compares to today and:

- > 7 days away: silent
- ≤ 7 days away: warn on stderr (`[zip-agent] warn: ZIP_AGENT_OPENAI_API_KEY expires in 5 day(s)`)
- past: hard error (`ConfigurationError` exit 3) — refuses to start

This mechanism is opt-in; if the `*_EXPIRES_AT` var is unset, no check runs.
