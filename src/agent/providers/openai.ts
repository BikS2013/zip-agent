import { ChatOpenAI } from '@langchain/openai';
import { ConfigurationError } from '../../util/errors';
import { aliasChainFor } from '../../config/agent-config';
import type { ProviderFactory } from './types';

export const createOpenaiModel: ProviderFactory = (cfg) => {
  const env = cfg.providerEnv;
  const apiKey = env['ZIP_AGENT_OPENAI_API_KEY'];
  if (!apiKey) {
    throw new ConfigurationError(
      'ZIP_AGENT_OPENAI_API_KEY',
      aliasChainFor('ZIP_AGENT_OPENAI_API_KEY'),
    );
  }
  const baseURL = env['ZIP_AGENT_OPENAI_BASE_URL'];
  const organization = env['ZIP_AGENT_OPENAI_ORG'];
  return new ChatOpenAI({
    model: cfg.model,
    temperature: cfg.temperature,
    apiKey,
    configuration: {
      ...(baseURL ? { baseURL } : {}),
      ...(organization ? { organization } : {}),
    },
  });
};
