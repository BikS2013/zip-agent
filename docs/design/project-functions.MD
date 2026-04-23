# Functional Requirements — `zip-agent`

## CLI substrate (FR-CLI-*)

- **FR-CLI-1** The tool ships a single binary `zip-agent` with seven subcommands: `list`, `info`, `test`, `create`, `extract`, `add`, `remove`.
- **FR-CLI-2** Each command shells out to the OS `zip` / `unzip` / `zipinfo` binary. The binary path is resolved via `$PATH` by default and overridable via `ZIP_AGENT_ZIP_BIN`, `ZIP_AGENT_UNZIP_BIN`, `ZIP_AGENT_ZIPINFO_BIN`.
- **FR-CLI-3** All commands accept `--json` (default) and `--table` output modes via the global flag.
- **FR-CLI-4** All commands accept `--quiet` (suppress stderr) and `--verbose` (extra trace) global flags.
- **FR-CLI-5** Errors thrown by command modules map to the exit-code taxonomy in `src/util/exit-codes.ts` (UsageError→2, ConfigurationError→3, AuthError→4, UpstreamError→5, IoError→6, CollisionError→7).
- **FR-CLI-6** `list <archive>` returns `{ archive, entries: [{name, size, compressedSize, modified, crc}] }` parsed from `unzip -l`.
- **FR-CLI-7** `info <archive>` returns the parsed `zipinfo -v` block per entry.
- **FR-CLI-8** `test <archive>` returns `{ archive, ok: boolean, errors: string[] }`.
- **FR-CLI-9** `create <archive> <inputs...>` accepts `-r/--recurse`, `-x/--exclude <pattern>`, `--password <p>`, `--no-clobber`. Refuses to overwrite by default (raises `CollisionError`); `--force` allows overwrite.
- **FR-CLI-10** `extract <archive>` accepts `-d/--dest <dir>`, `--password <p>`, `--include <pattern>`, `--no-clobber`. Refuses to overwrite by default; `--force` allows.
- **FR-CLI-11** `add <archive> <files...>` shells `zip -u` (update) and returns added/updated counts.
- **FR-CLI-12** `remove <archive> <patterns...>` shells `zip -d` and returns removed-entry counts.
- **FR-CLI-13** Every command treats a non-zero exit from the OS binary as an `UpstreamError` carrying stderr.

## Agent subcommand (FR-AGT-*)

- **FR-AGT-1** A new `zip-agent agent [prompt]` subcommand exists, registered through the same commander pipeline.
- **FR-AGT-2** Without `-i/--interactive`, the prompt argument is required (else `UsageError` → exit 2).
- **FR-AGT-3** With `-i/--interactive`, the prompt is ignored and a readline REPL starts. `/exit` ends the session, `/reset` clears memory, SIGINT exits with 130.
- **FR-AGT-4** Six providers are wired: `openai`, `anthropic`, `google`, `azure-openai`, `azure-anthropic`, `azure-deepseek`. New providers are added by extending `PROVIDERS` in `src/agent/providers/registry.ts`.
- **FR-AGT-5** Configuration precedence per setting is `CLI flag > ZIP_AGENT_<PROVIDER>_<NAME> > canonical alias > default (optional only)`. `dotenv.config({override:false})` runs before `loadAgentConfig`.
- **FR-AGT-6** No required setting has a fallback to a default value. Missing required → `ConfigurationError` (exit 3) with `missingSetting` and a `checkedSources` array that lists every alias the loader tried.
- **FR-AGT-7** `loadAgentConfig` falls back from `ZIP_AGENT_MODEL` to provider-specific deployment vars for Azure providers, and within each fallback step also walks the canonical alias chain (`AZURE_OPENAI_DEPLOYMENT_NAME`, `AZURE_OPENAI_DEPLOYMENT`, etc.).
- **FR-AGT-7a** For each provider's API key / endpoint / deployment / api-version setting, the agent accepts the canonical industry env name (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `AZURE_OPENAI_*`, `AZURE_AI_INFERENCE_*`, `AZURE_INFERENCE_CREDENTIAL`) as an alias when the `ZIP_AGENT_*` form is unset. The full alias map lives in `src/config/agent-config.ts` (`PROVIDER_ENV_ALIASES`) and is exposed via `aliasChainFor(canonicalKey)`.
- **FR-AGT-8** Without `--allow-mutations`, the tool catalog excludes `create_archive`, `extract_archive`, `add_to_archive`, `remove_from_archive`.
- **FR-AGT-9** `--tools <csv>` filters the catalog to the named tools after mutation gating.
- **FR-AGT-10** Every tool result is truncated to `cfg.perToolBudgetBytes` (default 16 KiB) before reaching the model. Truncation produces valid JSON wrapped in `{"__truncated": true, …}`.
- **FR-AGT-11** Recoverable tool errors (`UsageError`, `UpstreamError`, `IoError`, `CollisionError`) become a JSON `{error:{code,message,httpStatus?}}` tool result. Fatal errors (`ConfigurationError`, `AuthError`) abort the graph and propagate to CLI exit codes.
- **FR-AGT-12** Every stderr / log-file write passes through `redactString()`. Log files open with mode `0o600`.
- **FR-AGT-13** One-shot mode emits an `AgentResult` JSON envelope: `{answer, provider, model, steps[], usage{}, meta{}}`.
- **FR-AGT-14** Termination is one of `final` | `maxSteps` | `error` | `interrupted`. `maxSteps` is a successful exit (0).
- **FR-AGT-15** DeepSeek model denylist (`deepseek-r1*`, `deepseek-reasoner`, `deepseek-v3.2-speciale`, `mai-ds-r1`) is enforced at config-load time with a clear `ConfigurationError`.
- **FR-AGT-16** Mutating tool descriptions begin with `[MUTATING]` and the default system prompt instructs the model to confirm intent before invoking them.
