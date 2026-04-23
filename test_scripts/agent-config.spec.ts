import { describe, it, expect } from 'vitest';
import { loadAgentConfig } from '../src/config/agent-config';
import { ConfigurationError, UsageError } from '../src/util/errors';

const ENV_BASE = {
  ZIP_AGENT_OPENAI_API_KEY: 'sk-test',
};

describe('loadAgentConfig', () => {
  it('throws ConfigurationError if provider is missing', () => {
    expect(() => loadAgentConfig({}, {})).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError if model is missing', () => {
    expect(() => loadAgentConfig({ provider: 'openai' }, {})).toThrow(ConfigurationError);
  });

  it('rejects unknown providers as UsageError', () => {
    expect(() => loadAgentConfig({ provider: 'bogus', model: 'x' }, {})).toThrow(UsageError);
  });

  it('flag wins over env for provider/model', () => {
    const cfg = loadAgentConfig(
      { provider: 'openai', model: 'gpt-flag' },
      { ZIP_AGENT_PROVIDER: 'anthropic', ZIP_AGENT_MODEL: 'claude-env', ...ENV_BASE },
    );
    expect(cfg.provider).toBe('openai');
    expect(cfg.model).toBe('gpt-flag');
  });

  it('falls back to provider-specific deployment for azure-openai', () => {
    const cfg = loadAgentConfig(
      { provider: 'azure-openai' },
      {
        ZIP_AGENT_AZURE_OPENAI_DEPLOYMENT: 'my-dep',
        ZIP_AGENT_AZURE_OPENAI_API_KEY: 'k',
        ZIP_AGENT_AZURE_OPENAI_ENDPOINT: 'https://x',
      },
    );
    expect(cfg.model).toBe('my-dep');
  });

  it('parses bool, int, float and CSV correctly', () => {
    const cfg = loadAgentConfig(
      { provider: 'openai', model: 'gpt-x' },
      {
        ...ENV_BASE,
        ZIP_AGENT_MAX_STEPS: '7',
        ZIP_AGENT_TEMPERATURE: '0.3',
        ZIP_AGENT_PER_TOOL_BUDGET_BYTES: '8192',
        ZIP_AGENT_ALLOW_MUTATIONS: 'true',
        ZIP_AGENT_TOOLS: 'list_archive, test_archive',
      },
    );
    expect(cfg.maxSteps).toBe(7);
    expect(cfg.temperature).toBe(0.3);
    expect(cfg.perToolBudgetBytes).toBe(8192);
    expect(cfg.allowMutations).toBe(true);
    expect(cfg.toolsAllowlist).toEqual(['list_archive', 'test_archive']);
  });

  it('rejects mutually exclusive --system + --system-file', () => {
    expect(() =>
      loadAgentConfig(
        { provider: 'openai', model: 'x', systemPrompt: 'a', systemPromptFile: '/tmp/x' },
        ENV_BASE,
      ),
    ).toThrow(UsageError);
  });

  it('snapshots only matching provider env keys', () => {
    const cfg = loadAgentConfig(
      { provider: 'openai', model: 'x' },
      {
        ...ENV_BASE,
        ZIP_AGENT_OPENAI_BASE_URL: 'https://api.openai.com',
        ZIP_AGENT_ANTHROPIC_API_KEY: 'should-not-leak',
      },
    );
    expect(cfg.providerEnv['ZIP_AGENT_OPENAI_API_KEY']).toBe('sk-test');
    expect(cfg.providerEnv['ZIP_AGENT_OPENAI_BASE_URL']).toBe('https://api.openai.com');
    expect(cfg.providerEnv['ZIP_AGENT_ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('foundry providers capture both their own and shared inference vars', () => {
    const cfg = loadAgentConfig(
      { provider: 'azure-anthropic', model: 'claude-x' },
      {
        ZIP_AGENT_AZURE_AI_INFERENCE_KEY: 'k',
        ZIP_AGENT_AZURE_AI_INFERENCE_ENDPOINT: 'https://foundry',
        ZIP_AGENT_AZURE_ANTHROPIC_MODEL: 'claude-x',
      },
    );
    expect(cfg.providerEnv['ZIP_AGENT_AZURE_AI_INFERENCE_KEY']).toBe('k');
    expect(cfg.providerEnv['ZIP_AGENT_AZURE_ANTHROPIC_MODEL']).toBe('claude-x');
  });

  // ---- canonical env-name aliases ----------------------------------

  it('falls back to OPENAI_API_KEY when ZIP_AGENT_OPENAI_API_KEY is unset', () => {
    const cfg = loadAgentConfig(
      { provider: 'openai', model: 'gpt' },
      { OPENAI_API_KEY: 'sk-canonical' },
    );
    expect(cfg.providerEnv['ZIP_AGENT_OPENAI_API_KEY']).toBe('sk-canonical');
  });

  it('ZIP_AGENT_OPENAI_API_KEY wins over OPENAI_API_KEY (project override)', () => {
    const cfg = loadAgentConfig(
      { provider: 'openai', model: 'gpt' },
      {
        OPENAI_API_KEY: 'sk-canonical',
        ZIP_AGENT_OPENAI_API_KEY: 'sk-project',
      },
    );
    expect(cfg.providerEnv['ZIP_AGENT_OPENAI_API_KEY']).toBe('sk-project');
  });

  it('falls back to ANTHROPIC_API_KEY for the anthropic provider', () => {
    const cfg = loadAgentConfig(
      { provider: 'anthropic', model: 'claude' },
      { ANTHROPIC_API_KEY: 'sk-ant' },
    );
    expect(cfg.providerEnv['ZIP_AGENT_ANTHROPIC_API_KEY']).toBe('sk-ant');
  });

  it.each(['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENAI_API_KEY'])(
    'falls back to %s for the google provider',
    (envName) => {
      const cfg = loadAgentConfig(
        { provider: 'google', model: 'gemini' },
        { [envName]: 'g-key' },
      );
      expect(cfg.providerEnv['ZIP_AGENT_GOOGLE_API_KEY']).toBe('g-key');
    },
  );

  it('falls back to AZURE_OPENAI_* canonical names', () => {
    const cfg = loadAgentConfig(
      { provider: 'azure-openai' },
      {
        AZURE_OPENAI_API_KEY: 'k',
        AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com',
        AZURE_OPENAI_DEPLOYMENT_NAME: 'my-dep',
      },
    );
    expect(cfg.providerEnv['ZIP_AGENT_AZURE_OPENAI_API_KEY']).toBe('k');
    expect(cfg.providerEnv['ZIP_AGENT_AZURE_OPENAI_ENDPOINT']).toBe(
      'https://x.openai.azure.com',
    );
    expect(cfg.providerEnv['ZIP_AGENT_AZURE_OPENAI_DEPLOYMENT']).toBe('my-dep');
  });

  it('falls back to AZURE_AI_INFERENCE_* and AZURE_INFERENCE_CREDENTIAL', () => {
    const cfg = loadAgentConfig(
      { provider: 'azure-anthropic', model: 'claude' },
      {
        AZURE_INFERENCE_CREDENTIAL: 'k',
        AZURE_AI_INFERENCE_ENDPOINT: 'https://foundry',
      },
    );
    expect(cfg.providerEnv['ZIP_AGENT_AZURE_AI_INFERENCE_KEY']).toBe('k');
    expect(cfg.providerEnv['ZIP_AGENT_AZURE_AI_INFERENCE_ENDPOINT']).toBe('https://foundry');
  });
});
