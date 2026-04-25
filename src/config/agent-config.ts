import { ConfigurationError, UsageError } from '../util/errors';

export type ProviderName =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'azure-openai'
  | 'azure-anthropic'
  | 'azure-deepseek'
  | 'local-openai';

const PROVIDER_NAMES: readonly ProviderName[] = [
  'openai',
  'anthropic',
  'google',
  'azure-openai',
  'azure-anthropic',
  'azure-deepseek',
  'local-openai',
];

export interface AgentConfigFlags {
  provider?: string;
  model?: string;
  maxSteps?: number;
  temperature?: number;
  systemPrompt?: string;
  systemPromptFile?: string;
  tools?: string;
  perToolBudgetBytes?: number;
  allowMutations?: boolean;
  envFile?: string;
  verbose?: boolean;
  interactive?: boolean;
}

export interface AgentConfig {
  readonly provider: ProviderName;
  readonly model: string;
  readonly temperature: number;
  readonly maxSteps: number;
  readonly perToolBudgetBytes: number;
  readonly systemPrompt: string | null;
  readonly systemPromptFile: string | null;
  readonly toolsAllowlist: readonly string[] | null;
  readonly allowMutations: boolean;
  readonly envFilePath: string | null;
  readonly verbose: boolean;
  readonly interactive: boolean;
  readonly providerEnv: Readonly<Record<string, string>>;
}

const DEFAULTS = Object.freeze({
  maxSteps: 10,
  temperature: 0,
  perToolBudgetBytes: 16_384,
});

const PROVIDER_MODEL_FALLBACK_ENV: Partial<Record<ProviderName, string>> = {
  'azure-openai': 'ZIP_AGENT_AZURE_OPENAI_DEPLOYMENT',
  'azure-anthropic': 'ZIP_AGENT_AZURE_ANTHROPIC_MODEL',
  'azure-deepseek': 'ZIP_AGENT_AZURE_DEEPSEEK_MODEL',
  // local-openai: no provider-specific deployment env; model must be set via
  // --model / ZIP_AGENT_MODEL directly.
};

/**
 * Per-provider env var prefixes captured into the providerEnv snapshot.
 * The Azure Foundry providers also pull in the shared AZURE_AI_INFERENCE
 * block.
 */
const PROVIDER_ENV_PREFIXES: Record<ProviderName, readonly string[]> = {
  openai: ['ZIP_AGENT_OPENAI_'],
  anthropic: ['ZIP_AGENT_ANTHROPIC_'],
  google: ['ZIP_AGENT_GOOGLE_'],
  'azure-openai': ['ZIP_AGENT_AZURE_OPENAI_'],
  'azure-anthropic': ['ZIP_AGENT_AZURE_ANTHROPIC_', 'ZIP_AGENT_AZURE_AI_INFERENCE_'],
  'azure-deepseek': ['ZIP_AGENT_AZURE_DEEPSEEK_', 'ZIP_AGENT_AZURE_AI_INFERENCE_'],
  'local-openai': ['ZIP_AGENT_LOCAL_OPENAI_'],
};

/**
 * Canonical industry env-var aliases for each `ZIP_AGENT_*` provider key.
 *
 * Resolution order for any given setting:
 *   1. ZIP_AGENT_<PROVIDER>_<NAME>   (explicit project override)
 *   2. each entry in this alias list (canonical names already exported
 *      globally for use by other agents on this machine)
 *
 * If neither source is set, the provider factory throws ConfigurationError.
 *
 * Project-specific tunables (PROVIDER, MODEL, MAX_STEPS, TEMPERATURE,
 * ALLOW_MUTATIONS, TOOLS, SYSTEM_PROMPT) intentionally have NO aliases —
 * there are no widely-agreed canonical names for them.
 */
const PROVIDER_ENV_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ZIP_AGENT_OPENAI_API_KEY: ['OPENAI_API_KEY'],
  ZIP_AGENT_OPENAI_BASE_URL: ['OPENAI_BASE_URL'],
  ZIP_AGENT_OPENAI_ORG: ['OPENAI_ORG_ID', 'OPENAI_ORGANIZATION'],

  ZIP_AGENT_ANTHROPIC_API_KEY: ['ANTHROPIC_API_KEY'],
  ZIP_AGENT_ANTHROPIC_BASE_URL: ['ANTHROPIC_BASE_URL'],

  ZIP_AGENT_GOOGLE_API_KEY: ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENAI_API_KEY'],

  ZIP_AGENT_AZURE_OPENAI_API_KEY: ['AZURE_OPENAI_API_KEY'],
  ZIP_AGENT_AZURE_OPENAI_ENDPOINT: ['AZURE_OPENAI_ENDPOINT'],
  ZIP_AGENT_AZURE_OPENAI_DEPLOYMENT: [
    'AZURE_OPENAI_DEPLOYMENT',
    'AZURE_OPENAI_DEPLOYMENT_NAME',
  ],
  ZIP_AGENT_AZURE_OPENAI_API_VERSION: ['AZURE_OPENAI_API_VERSION', 'OPENAI_API_VERSION'],

  ZIP_AGENT_AZURE_AI_INFERENCE_KEY: [
    'AZURE_AI_INFERENCE_KEY',
    'AZURE_INFERENCE_CREDENTIAL',
  ],
  ZIP_AGENT_AZURE_AI_INFERENCE_ENDPOINT: [
    'AZURE_AI_INFERENCE_ENDPOINT',
    'AZURE_INFERENCE_ENDPOINT',
  ],

  // local-openai: BASE_URL is required; API_KEY is optional (many local
  // servers ignore it but the SDK requires a non-empty string).
  // No canonical alias for BASE_URL — it is inherently project-local.
  // OPENAI_API_KEY is a last-resort alias for API_KEY only.
  ZIP_AGENT_LOCAL_OPENAI_BASE_URL: ['LOCAL_OPENAI_BASE_URL', 'OLLAMA_HOST'],
  ZIP_AGENT_LOCAL_OPENAI_API_KEY: ['OPENAI_API_KEY'],
});

export function loadAgentConfig(
  flags: AgentConfigFlags,
  env: NodeJS.ProcessEnv = process.env,
): AgentConfig {
  if (flags.systemPrompt && flags.systemPromptFile) {
    throw new UsageError('agent: --system and --system-file are mutually exclusive.');
  }

  const providerRaw = flags.provider ?? env['ZIP_AGENT_PROVIDER'];
  if (!providerRaw) {
    throw new ConfigurationError(
      'ZIP_AGENT_PROVIDER',
      ['--provider', 'ZIP_AGENT_PROVIDER'],
      `Example: --provider azure-openai or ZIP_AGENT_PROVIDER=azure-openai. Known providers: ${PROVIDER_NAMES.join(', ')}.`,
    );
  }
  const provider = providerRaw as ProviderName;
  if (!PROVIDER_NAMES.includes(provider)) {
    throw new UsageError(
      `agent: unknown provider "${providerRaw}". Known: ${PROVIDER_NAMES.join(', ')}.`,
    );
  }

  const fallbackVar = PROVIDER_MODEL_FALLBACK_ENV[provider];
  // The model can come from: explicit flag, ZIP_AGENT_MODEL, the
  // provider-specific deployment env, or any of that env's canonical
  // aliases (e.g. AZURE_OPENAI_DEPLOYMENT_NAME).
  const fallbackChain = fallbackVar ? aliasChainFor(fallbackVar) : [];
  let modelFromFallback: string | undefined;
  for (const name of fallbackChain) {
    const v = env[name];
    if (v) {
      modelFromFallback = v;
      break;
    }
  }
  const model = flags.model ?? env['ZIP_AGENT_MODEL'] ?? modelFromFallback;
  if (!model) {
    const sources = ['--model', 'ZIP_AGENT_MODEL', ...fallbackChain];
    throw new ConfigurationError('ZIP_AGENT_MODEL', sources);
  }

  const maxSteps = pickPositiveInt(
    flags.maxSteps,
    env['ZIP_AGENT_MAX_STEPS'],
    DEFAULTS.maxSteps,
    'ZIP_AGENT_MAX_STEPS',
  );

  const temperature = pickFloat(
    flags.temperature,
    env['ZIP_AGENT_TEMPERATURE'],
    DEFAULTS.temperature,
    'ZIP_AGENT_TEMPERATURE',
  );

  const perToolBudgetBytes = pickPositiveInt(
    flags.perToolBudgetBytes,
    env['ZIP_AGENT_PER_TOOL_BUDGET_BYTES'],
    DEFAULTS.perToolBudgetBytes,
    'ZIP_AGENT_PER_TOOL_BUDGET_BYTES',
    1024,
  );

  const allowMutations =
    flags.allowMutations ?? parseBool(env['ZIP_AGENT_ALLOW_MUTATIONS']) ?? false;

  const toolsAllowlist =
    parseCsv(flags.tools ?? env['ZIP_AGENT_TOOLS']) ?? null;

  const systemPrompt = flags.systemPrompt ?? env['ZIP_AGENT_SYSTEM_PROMPT'] ?? null;
  const systemPromptFile =
    flags.systemPromptFile ?? env['ZIP_AGENT_SYSTEM_PROMPT_FILE'] ?? null;

  const providerEnv = snapshotProviderEnv(provider, env);

  return Object.freeze({
    provider,
    model,
    temperature,
    maxSteps,
    perToolBudgetBytes,
    systemPrompt,
    systemPromptFile,
    toolsAllowlist,
    allowMutations,
    envFilePath: flags.envFile ?? null,
    verbose: flags.verbose ?? false,
    interactive: flags.interactive ?? false,
    providerEnv,
  });
}

// ---- helpers ---------------------------------------------------------

function snapshotProviderEnv(
  provider: ProviderName,
  env: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};

  // 1. Capture every ZIP_AGENT_<PROVIDER>_* key (explicit override surface).
  for (const prefix of PROVIDER_ENV_PREFIXES[provider]) {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) continue;
      if (k.startsWith(prefix)) out[k] = v;
    }
  }

  // 2. For every alias-eligible canonical key that belongs to one of this
  //    provider's prefixes, fill in from the canonical env names IFF the
  //    explicit ZIP_AGENT_* key wasn't already set.
  const prefixes = PROVIDER_ENV_PREFIXES[provider];
  for (const [canonicalKey, aliases] of Object.entries(PROVIDER_ENV_ALIASES)) {
    if (!prefixes.some((p) => canonicalKey.startsWith(p))) continue;
    if (out[canonicalKey] !== undefined) continue;
    for (const alias of aliases) {
      const v = env[alias];
      if (v !== undefined && v !== '') {
        out[canonicalKey] = v;
        break;
      }
    }
  }

  return Object.freeze(out);
}

/**
 * The full alias chain for a given canonical ZIP_AGENT_* key, ordered by
 * resolution priority. Used by error messages to tell the user every name
 * that was searched.
 */
export function aliasChainFor(canonicalKey: string): readonly string[] {
  const aliases = PROVIDER_ENV_ALIASES[canonicalKey] ?? [];
  return [canonicalKey, ...aliases];
}

function pickPositiveInt(
  flag: number | undefined,
  envVal: string | undefined,
  fallback: number,
  envName: string,
  min = 1,
): number {
  if (flag !== undefined) {
    if (!Number.isFinite(flag) || flag < min) {
      throw new UsageError(`agent: invalid value for --${envName.toLowerCase()}: ${flag}`);
    }
    return Math.floor(flag);
  }
  if (envVal !== undefined) {
    const n = Number.parseInt(envVal, 10);
    if (!Number.isFinite(n) || n < min) {
      throw new UsageError(`agent: invalid value for ${envName}: ${envVal}`);
    }
    return n;
  }
  return fallback;
}

function pickFloat(
  flag: number | undefined,
  envVal: string | undefined,
  fallback: number,
  envName: string,
): number {
  if (flag !== undefined) {
    if (!Number.isFinite(flag)) {
      throw new UsageError(`agent: invalid value for --${envName.toLowerCase()}: ${flag}`);
    }
    return flag;
  }
  if (envVal !== undefined) {
    const n = Number.parseFloat(envVal);
    if (!Number.isFinite(n)) {
      throw new UsageError(`agent: invalid value for ${envName}: ${envVal}`);
    }
    return n;
  }
  return fallback;
}

function parseBool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  const t = v.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(t)) return true;
  if (['0', 'false', 'no', 'off', ''].includes(t)) return false;
  return undefined;
}

function parseCsv(v: string | undefined): string[] | null {
  if (v === undefined) return null;
  const items = v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : null;
}
