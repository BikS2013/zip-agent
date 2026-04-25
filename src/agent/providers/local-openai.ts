import { ChatOpenAI } from '@langchain/openai';
import { ConfigurationError, UpstreamError } from '../../util/errors';
import { aliasChainFor } from '../../config/agent-config';
import type { ProviderFactory } from './types';

/**
 * Provider factory for local OpenAI-wire-compatible endpoints.
 *
 * Supported local servers: OLLaMA (`http://localhost:11434/v1`),
 * LM Studio (`http://localhost:1234/v1`), MLX-LM, LightLLM, vLLM,
 * LLaMA.CPP's `llama-server`, etc.
 *
 * Required env: ZIP_AGENT_LOCAL_OPENAI_BASE_URL (or canonical aliases
 *   LOCAL_OPENAI_BASE_URL / OLLAMA_HOST).
 * Optional env: ZIP_AGENT_LOCAL_OPENAI_API_KEY (most local servers ignore
 *   the key; defaults to "local" when not provided).
 * Model: must be supplied via --model / ZIP_AGENT_MODEL. No provider-level
 *   deployment fallback exists for local servers.
 *
 * If the endpoint is unreachable at invocation time, the SDK surfaces a
 * connection error; this factory wraps missing-config cases into
 * ConfigurationError so the user sees which source was checked.
 */
export const createLocalOpenaiModel: ProviderFactory = (cfg) => {
  const env = cfg.providerEnv;

  const baseURL = env['ZIP_AGENT_LOCAL_OPENAI_BASE_URL'];
  if (!baseURL) {
    throw new ConfigurationError(
      'ZIP_AGENT_LOCAL_OPENAI_BASE_URL',
      aliasChainFor('ZIP_AGENT_LOCAL_OPENAI_BASE_URL'),
      'Set this to your local server endpoint, e.g. http://localhost:11434/v1 for OLLaMA.',
    );
  }

  // Validate the URL is parseable so we can surface a clear error before
  // attempting a connection.
  try {
    new URL(baseURL);
  } catch {
    throw new ConfigurationError(
      'ZIP_AGENT_LOCAL_OPENAI_BASE_URL',
      aliasChainFor('ZIP_AGENT_LOCAL_OPENAI_BASE_URL'),
      `Value "${baseURL}" is not a valid URL. Expected e.g. http://localhost:11434/v1.`,
    );
  }

  // Most local servers accept any non-empty string as an API key.
  // We default to "local" rather than throwing — this is an intentional
  // exception to the no-fallback rule, recorded in project-design.md ADR-007.
  const apiKey = env['ZIP_AGENT_LOCAL_OPENAI_API_KEY'] ?? 'local';

  return new ChatOpenAI({
    model: cfg.model,
    temperature: cfg.temperature,
    apiKey,
    configuration: {
      baseURL,
    },
  });
};
