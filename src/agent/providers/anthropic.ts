import { ChatAnthropic } from '@langchain/anthropic';
import { ConfigurationError } from '../../util/errors';
import { aliasChainFor } from '../../config/agent-config';
import type { ProviderFactory } from './types';

export const createAnthropicModel: ProviderFactory = (cfg) => {
  const env = cfg.providerEnv;
  const apiKey = env['ZIP_AGENT_ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new ConfigurationError(
      'ZIP_AGENT_ANTHROPIC_API_KEY',
      aliasChainFor('ZIP_AGENT_ANTHROPIC_API_KEY'),
    );
  }
  const baseURL = env['ZIP_AGENT_ANTHROPIC_BASE_URL'];
  return new ChatAnthropic({
    model: cfg.model,
    temperature: cfg.temperature,
    apiKey,
    ...(baseURL ? { clientOptions: { baseURL } } : {}),
  });
};
