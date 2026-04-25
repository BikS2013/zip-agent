/**
 * global-config-template.ts — embedded copy of .env.example used to seed
 * `~/.tool-agents/zip-agent/config` on first agent invocation.
 *
 * IMPORTANT: this constant must remain byte-for-byte identical to the
 * project root `.env.example`. A vitest drift test
 * (test_scripts/agent-env-loader.spec.ts) asserts equality so any update to
 * one file fails CI until the other is brought back in sync.
 */
export const GLOBAL_CONFIG_TEMPLATE = `# =============================================================================
# zip-agent — environment variables (template)
# Copy to .env and fill in. .env is gitignored; only .env.example is checked in.
#
# Precedence chain (highest to lowest):
#
#   1. --env-file <path>   When supplied, REPLACES both file sources below.
#                          Chain becomes: --env-file > process.env > defaults.
#   2. CLI flag            (--provider, --model, etc. — handled by loadAgentConfig)
#   3. ./.env              This file (project-local, cwd). Wins over global config.
#   4. ~/.tool-agents/zip-agent/config
#                          Global per-tool config (dotenv KEY=VALUE format).
#                          Created automatically on first agent run if absent.
#   5. process.env         Existing shell exports (lowest before built-in defaults).
#   6. NONE                Required values → ConfigurationError (exit 3).
#                          Optional tunables → built-in default (see §3 below).
#
# NOTE: file sources (.env and the global config) WIN OVER process.env.
# This means a value set here overrides a shell-exported variable of the same
# name. To use your shell's value for a specific key, do not set that key in
# either file. To use a different value just for zip-agent, set it here (or in
# the global config).
#
# Aliases: The agent first reads ZIP_AGENT_<PROVIDER>_<NAME>. If unset, it
# falls back to the canonical industry name (e.g. OPENAI_API_KEY) so keys you
# already export globally work without duplication.
#
# Required values have NO default fallback — missing both names →
# ConfigurationError (exit 3) listing every source checked.
# =============================================================================

# ---- CLI substrate (optional binary path overrides) -----------------------
# ZIP_AGENT_ZIP_BIN=/usr/bin/zip
# ZIP_AGENT_UNZIP_BIN=/usr/bin/unzip
# ZIP_AGENT_ZIPINFO_BIN=/usr/bin/zipinfo
# ZIP_AGENT_LOG_FILE=/tmp/zip-agent.log

# ---- Agent — global (project-specific; no aliases) ------------------------
# ZIP_AGENT_PROVIDER=azure-openai
# ZIP_AGENT_MODEL=gpt-4o-mini
# ZIP_AGENT_MAX_STEPS=10
# ZIP_AGENT_TEMPERATURE=0
# ZIP_AGENT_PER_TOOL_BUDGET_BYTES=16384
# ZIP_AGENT_ALLOW_MUTATIONS=false
# ZIP_AGENT_TOOLS=
# ZIP_AGENT_SYSTEM_PROMPT=
# ZIP_AGENT_SYSTEM_PROMPT_FILE=

# ---- Provider: openai -----------------------------------------------------
#   Canonical aliases (used when ZIP_AGENT_OPENAI_* is unset):
#     OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_ORG_ID, OPENAI_ORGANIZATION
# ZIP_AGENT_OPENAI_API_KEY=
# ZIP_AGENT_OPENAI_BASE_URL=
# ZIP_AGENT_OPENAI_ORG=
# ZIP_AGENT_OPENAI_API_KEY_EXPIRES_AT=

# ---- Provider: anthropic --------------------------------------------------
#   Canonical aliases:
#     ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL
# ZIP_AGENT_ANTHROPIC_API_KEY=
# ZIP_AGENT_ANTHROPIC_BASE_URL=
# ZIP_AGENT_ANTHROPIC_API_KEY_EXPIRES_AT=

# ---- Provider: google -----------------------------------------------------
#   Canonical aliases:
#     GOOGLE_API_KEY, GEMINI_API_KEY, GOOGLE_GENAI_API_KEY
# ZIP_AGENT_GOOGLE_API_KEY=
# ZIP_AGENT_GOOGLE_API_KEY_EXPIRES_AT=

# ---- Provider: azure-openai -----------------------------------------------
#   Canonical aliases:
#     AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT,
#     AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_DEPLOYMENT_NAME,
#     AZURE_OPENAI_API_VERSION, OPENAI_API_VERSION
# ZIP_AGENT_AZURE_OPENAI_API_KEY=
# ZIP_AGENT_AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
# ZIP_AGENT_AZURE_OPENAI_DEPLOYMENT=
# ZIP_AGENT_AZURE_OPENAI_API_VERSION=2024-10-21
# ZIP_AGENT_AZURE_OPENAI_API_KEY_EXPIRES_AT=

# ---- Provider: azure-anthropic (Microsoft Foundry) ------------------------
#   Canonical aliases (shared with azure-deepseek):
#     AZURE_AI_INFERENCE_KEY, AZURE_INFERENCE_CREDENTIAL,
#     AZURE_AI_INFERENCE_ENDPOINT, AZURE_INFERENCE_ENDPOINT
# ZIP_AGENT_AZURE_AI_INFERENCE_KEY=
# ZIP_AGENT_AZURE_AI_INFERENCE_ENDPOINT=https://<your-foundry>.services.ai.azure.com
# ZIP_AGENT_AZURE_ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
# ZIP_AGENT_AZURE_AI_INFERENCE_KEY_EXPIRES_AT=

# ---- Provider: azure-deepseek (Microsoft Foundry) -------------------------
#   Same shared inference aliases as azure-anthropic above.
#   Accepted models: DeepSeek-V3, DeepSeek-V3.1, DeepSeek-V3.2.
#   Denied (no working tool calling): DeepSeek-R1*, DeepSeek-V3.2-Speciale, MAI-DS-R1.
# ZIP_AGENT_AZURE_DEEPSEEK_MODEL=DeepSeek-V3.1

# ---- Provider: local-openai -----------------------------------------------
#   For local OpenAI-wire-compatible servers: OLLaMA, LM Studio, MLX-LM,
#   LightLLM, vLLM, LLaMA.CPP's llama-server, etc.
#
#   Required:
#     ZIP_AGENT_LOCAL_OPENAI_BASE_URL  — the local server endpoint.
#     Canonical aliases: LOCAL_OPENAI_BASE_URL, OLLAMA_HOST
#
#   Optional:
#     ZIP_AGENT_LOCAL_OPENAI_API_KEY   — most local servers ignore the key;
#     defaults to "local" when unset. Last-resort alias: OPENAI_API_KEY.
#     (This is the only setting with a built-in default; see ADR-007.)
#
#   Model is set via ZIP_AGENT_MODEL / --model; no provider-level deployment
#   fallback exists (local servers don't use Azure-style deployments).
#
#   Common base URL examples:
#     OLLaMA:    http://localhost:11434/v1
#     LM Studio: http://localhost:1234/v1
#     vLLM:      http://localhost:8000/v1
# ZIP_AGENT_LOCAL_OPENAI_BASE_URL=http://localhost:11434/v1
# ZIP_AGENT_LOCAL_OPENAI_API_KEY=local
`;
