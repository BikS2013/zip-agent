import { ChatAnthropic } from '@langchain/anthropic';
import { ConfigurationError } from '../../util/errors';
import { aliasChainFor } from '../../config/agent-config';
import { normalizeFoundryEndpoint } from './util';
import type { ProviderFactory } from './types';

export const createAzureAnthropicModel: ProviderFactory = (cfg) => {
  const env = cfg.providerEnv;
  const apiKey = env['ZIP_AGENT_AZURE_AI_INFERENCE_KEY'];
  const endpoint = env['ZIP_AGENT_AZURE_AI_INFERENCE_ENDPOINT'];
  const model = env['ZIP_AGENT_AZURE_ANTHROPIC_MODEL'] ?? cfg.model;

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
    throw new ConfigurationError('ZIP_AGENT_AZURE_ANTHROPIC_MODEL', [
      'ZIP_AGENT_AZURE_ANTHROPIC_MODEL',
      'ZIP_AGENT_MODEL',
    ]);

  return new ChatAnthropic({
    model,
    temperature: cfg.temperature,
    apiKey,
    clientOptions: {
      baseURL: normalizeFoundryEndpoint(endpoint, '/anthropic'),
    },
  });
};
