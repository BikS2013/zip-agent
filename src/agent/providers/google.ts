import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ConfigurationError } from '../../util/errors';
import { aliasChainFor } from '../../config/agent-config';
import type { ProviderFactory } from './types';

export const createGoogleModel: ProviderFactory = (cfg) => {
  const env = cfg.providerEnv;
  const apiKey = env['ZIP_AGENT_GOOGLE_API_KEY'];
  if (!apiKey) {
    throw new ConfigurationError(
      'ZIP_AGENT_GOOGLE_API_KEY',
      aliasChainFor('ZIP_AGENT_GOOGLE_API_KEY'),
    );
  }
  return new ChatGoogleGenerativeAI({
    model: cfg.model,
    temperature: cfg.temperature,
    apiKey,
  });
};
