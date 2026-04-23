import { ChatOpenAI } from '@langchain/openai';
import { ConfigurationError } from '../../util/errors';
import { aliasChainFor } from '../../config/agent-config';
import { normalizeFoundryEndpoint } from './util';
import type { ProviderFactory } from './types';

/**
 * Models that fundamentally do not work as ReAct tool callers via the
 * Foundry/OpenAI-compatible path. See ADR-005 in project-design.md.
 */
const DEEPSEEK_DENYLIST: readonly RegExp[] = [
  /deepseek-v3\.2-speciale/i,
  /deepseek-r1(?!-0528)/i,
  /deepseek-reasoner/i,
  /deepseek-r1-0528/i,
  /mai-ds-r1/i,
];

const ACCEPTED_HINT = 'Accepted models: DeepSeek-V3, DeepSeek-V3.1, DeepSeek-V3.2.';

export const createAzureDeepseekModel: ProviderFactory = (cfg) => {
  const env = cfg.providerEnv;
  const apiKey = env['ZIP_AGENT_AZURE_AI_INFERENCE_KEY'];
  const endpoint = env['ZIP_AGENT_AZURE_AI_INFERENCE_ENDPOINT'];
  const model = env['ZIP_AGENT_AZURE_DEEPSEEK_MODEL'] ?? cfg.model;

  if (!apiKey)
    throw new ConfigurationError(
      'ZIP_AGENT_AZURE_AI_INFERENCE_KEY',
      aliasChainFor('ZIP_AGENT_AZURE_AI_INFERENCE_KEY'),
    );
  if (!endpoint)
    throw new ConfigurationError(
      'ZIP_AGENT_AZURE_AI_INFERENCE_ENDPOINT',
      aliasChainFor('ZIP_AGENT_AZURE_AI_INFERENCE_ENDPOINT'),
    );
  if (!model)
    throw new ConfigurationError('ZIP_AGENT_AZURE_DEEPSEEK_MODEL', [
      'ZIP_AGENT_AZURE_DEEPSEEK_MODEL',
      'ZIP_AGENT_MODEL',
    ]);

  for (const re of DEEPSEEK_DENYLIST) {
    if (re.test(model)) {
      throw new ConfigurationError(
        'ZIP_AGENT_AZURE_DEEPSEEK_MODEL',
        ['ZIP_AGENT_AZURE_DEEPSEEK_MODEL', 'ZIP_AGENT_MODEL'],
        `Model "${model}" cannot reliably perform tool calls. ${ACCEPTED_HINT}`,
      );
    }
  }

  return new ChatOpenAI({
    model,
    temperature: cfg.temperature,
    apiKey,
    configuration: {
      baseURL: normalizeFoundryEndpoint(endpoint, '/openai/v1'),
    },
  });
};
