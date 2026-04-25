import { UsageError } from '../../util/errors';
import type { ProviderName } from '../../config/agent-config';
import type { ProviderFactory } from './types';
import { createOpenaiModel } from './openai';
import { createAnthropicModel } from './anthropic';
import { createGoogleModel } from './google';
import { createAzureOpenaiModel } from './azure-openai';
import { createAzureAnthropicModel } from './azure-anthropic';
import { createAzureDeepseekModel } from './azure-deepseek';
import { createLocalOpenaiModel } from './local-openai';

export const PROVIDERS: Readonly<Record<ProviderName, ProviderFactory>> = Object.freeze({
  openai: createOpenaiModel,
  anthropic: createAnthropicModel,
  google: createGoogleModel,
  'azure-openai': createAzureOpenaiModel,
  'azure-anthropic': createAzureAnthropicModel,
  'azure-deepseek': createAzureDeepseekModel,
  'local-openai': createLocalOpenaiModel,
});

export function getProvider(name: ProviderName): ProviderFactory {
  const f = PROVIDERS[name];
  if (!f) throw new UsageError(`Unknown provider: ${name}`);
  return f;
}
