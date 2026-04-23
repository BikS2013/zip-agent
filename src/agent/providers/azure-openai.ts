import { AzureChatOpenAI } from '@langchain/openai';
import { ConfigurationError } from '../../util/errors';
import { aliasChainFor } from '../../config/agent-config';
import type { ProviderFactory } from './types';

const DEFAULT_API_VERSION = '2024-10-21';

export const createAzureOpenaiModel: ProviderFactory = (cfg) => {
  const env = cfg.providerEnv;
  const apiKey = env['ZIP_AGENT_AZURE_OPENAI_API_KEY'];
  const endpoint = env['ZIP_AGENT_AZURE_OPENAI_ENDPOINT'];
  const deployment = env['ZIP_AGENT_AZURE_OPENAI_DEPLOYMENT'] ?? cfg.model;
  const apiVersion = env['ZIP_AGENT_AZURE_OPENAI_API_VERSION'] ?? DEFAULT_API_VERSION;

  if (!apiKey)
    throw new ConfigurationError(
      'ZIP_AGENT_AZURE_OPENAI_API_KEY',
      aliasChainFor('ZIP_AGENT_AZURE_OPENAI_API_KEY'),
    );
  if (!endpoint)
    throw new ConfigurationError(
      'ZIP_AGENT_AZURE_OPENAI_ENDPOINT',
      aliasChainFor('ZIP_AGENT_AZURE_OPENAI_ENDPOINT'),
    );
  if (!deployment)
    throw new ConfigurationError('ZIP_AGENT_AZURE_OPENAI_DEPLOYMENT', [
      ...aliasChainFor('ZIP_AGENT_AZURE_OPENAI_DEPLOYMENT'),
      'ZIP_AGENT_MODEL',
    ]);

  return new AzureChatOpenAI({
    azureOpenAIApiKey: apiKey,
    azureOpenAIEndpoint: endpoint,
    azureOpenAIApiDeploymentName: deployment,
    azureOpenAIApiVersion: apiVersion,
    temperature: cfg.temperature,
  });
};
