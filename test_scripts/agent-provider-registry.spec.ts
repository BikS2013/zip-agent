import { describe, it, expect } from 'vitest';
import { ChatOpenAI, AzureChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { getProvider, PROVIDERS } from '../src/agent/providers/registry';
import { ConfigurationError } from '../src/util/errors';
import type { AgentConfig, ProviderName } from '../src/config/agent-config';

function makeCfg(provider: ProviderName, env: Record<string, string>, model = 'm'): AgentConfig {
  return Object.freeze({
    provider,
    model,
    temperature: 0,
    maxSteps: 10,
    perToolBudgetBytes: 16384,
    systemPrompt: null,
    systemPromptFile: null,
    toolsAllowlist: null,
    allowMutations: false,
    envFilePath: null,
    verbose: false,
    interactive: false,
    providerEnv: Object.freeze({ ...env }),
  }) as AgentConfig;
}

describe('PROVIDERS map', () => {
  it('exposes exactly 6 providers', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([
      'anthropic',
      'azure-anthropic',
      'azure-deepseek',
      'azure-openai',
      'google',
      'openai',
    ]);
  });

  it('getProvider rejects unknown names', () => {
    expect(() => getProvider('zzz' as ProviderName)).toThrow();
  });
});

describe('openai factory', () => {
  it('builds a ChatOpenAI instance with apiKey', () => {
    const m = getProvider('openai')(makeCfg('openai', { ZIP_AGENT_OPENAI_API_KEY: 'sk-x' }));
    expect(m).toBeInstanceOf(ChatOpenAI);
  });
  it('throws ConfigurationError without ZIP_AGENT_OPENAI_API_KEY', () => {
    expect(() => getProvider('openai')(makeCfg('openai', {}))).toThrow(ConfigurationError);
  });
});

describe('anthropic factory', () => {
  it('builds a ChatAnthropic instance', () => {
    const m = getProvider('anthropic')(
      makeCfg('anthropic', { ZIP_AGENT_ANTHROPIC_API_KEY: 'sk-x' }),
    );
    expect(m).toBeInstanceOf(ChatAnthropic);
  });
  it('throws without ZIP_AGENT_ANTHROPIC_API_KEY', () => {
    expect(() => getProvider('anthropic')(makeCfg('anthropic', {}))).toThrow(ConfigurationError);
  });
});

describe('google factory', () => {
  it('builds a ChatGoogleGenerativeAI instance', () => {
    const m = getProvider('google')(makeCfg('google', { ZIP_AGENT_GOOGLE_API_KEY: 'key' }));
    expect(m).toBeInstanceOf(ChatGoogleGenerativeAI);
  });
  it('throws without ZIP_AGENT_GOOGLE_API_KEY', () => {
    expect(() => getProvider('google')(makeCfg('google', {}))).toThrow(ConfigurationError);
  });
});

describe('azure-openai factory', () => {
  const env = {
    ZIP_AGENT_AZURE_OPENAI_API_KEY: 'k',
    ZIP_AGENT_AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com',
    ZIP_AGENT_AZURE_OPENAI_DEPLOYMENT: 'dep',
  };
  it('builds an AzureChatOpenAI instance', () => {
    const m = getProvider('azure-openai')(makeCfg('azure-openai', env));
    expect(m).toBeInstanceOf(AzureChatOpenAI);
  });
  // DEPLOYMENT is allowed to fall back to cfg.model — only missing API_KEY
  // and ENDPOINT are unrecoverable.
  it.each(['ZIP_AGENT_AZURE_OPENAI_API_KEY', 'ZIP_AGENT_AZURE_OPENAI_ENDPOINT'])(
    'throws when %s is missing',
    (key) => {
      const partial = { ...env } as Record<string, string>;
      delete partial[key];
      expect(() => getProvider('azure-openai')(makeCfg('azure-openai', partial))).toThrow(
        ConfigurationError,
      );
    },
  );
});

describe('azure-anthropic factory (Foundry)', () => {
  const env = {
    ZIP_AGENT_AZURE_AI_INFERENCE_KEY: 'k',
    ZIP_AGENT_AZURE_AI_INFERENCE_ENDPOINT: 'https://foundry',
    ZIP_AGENT_AZURE_ANTHROPIC_MODEL: 'claude-3-5-sonnet',
  };
  it('builds a ChatAnthropic instance', () => {
    const m = getProvider('azure-anthropic')(makeCfg('azure-anthropic', env, 'claude-3-5-sonnet'));
    expect(m).toBeInstanceOf(ChatAnthropic);
  });
  // ANTHROPIC_MODEL falls back to cfg.model — only the shared inference
  // KEY/ENDPOINT have no recoverable fallback.
  it.each(['ZIP_AGENT_AZURE_AI_INFERENCE_KEY', 'ZIP_AGENT_AZURE_AI_INFERENCE_ENDPOINT'])(
    'throws when %s is missing',
    (key) => {
      const partial = { ...env } as Record<string, string>;
      delete partial[key];
      expect(() =>
        getProvider('azure-anthropic')(makeCfg('azure-anthropic', partial)),
      ).toThrow(ConfigurationError);
    },
  );
});

describe('azure-deepseek factory (Foundry)', () => {
  const baseEnv = {
    ZIP_AGENT_AZURE_AI_INFERENCE_KEY: 'k',
    ZIP_AGENT_AZURE_AI_INFERENCE_ENDPOINT: 'https://foundry',
  };
  it('builds a ChatOpenAI for an accepted model', () => {
    const m = getProvider('azure-deepseek')(
      makeCfg('azure-deepseek', { ...baseEnv, ZIP_AGENT_AZURE_DEEPSEEK_MODEL: 'DeepSeek-V3.1' }, 'DeepSeek-V3.1'),
    );
    expect(m).toBeInstanceOf(ChatOpenAI);
  });

  it.each([
    'DeepSeek-R1',
    'deepseek-reasoner',
    'DeepSeek-R1-0528',
    'DeepSeek-V3.2-Speciale',
    'MAI-DS-R1',
  ])('rejects %s via denylist', (model) => {
    expect(() =>
      getProvider('azure-deepseek')(
        makeCfg('azure-deepseek', { ...baseEnv, ZIP_AGENT_AZURE_DEEPSEEK_MODEL: model }, model),
      ),
    ).toThrow(ConfigurationError);
  });

  it.each(['DeepSeek-V3', 'DeepSeek-V3.1', 'DeepSeek-V3.2'])('accepts %s', (model) => {
    expect(() =>
      getProvider('azure-deepseek')(
        makeCfg('azure-deepseek', { ...baseEnv, ZIP_AGENT_AZURE_DEEPSEEK_MODEL: model }, model),
      ),
    ).not.toThrow();
  });
});
