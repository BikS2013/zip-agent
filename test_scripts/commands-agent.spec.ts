import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env-loader so real dotenv files in cwd / home never leak into tests.
// buildEffectiveEnv returns process.env unmodified so the tests that set
// process.env keys get deterministic behaviour.
vi.mock('../src/util/env-loader', () => ({
  buildEffectiveEnv: vi.fn(() => process.env),
  readDotenvFile: vi.fn(() => ({})),
  GLOBAL_CONFIG_PATH: '/dev/null',
  // Stub the bootstrap so tests do not touch the real $HOME.
  ensureGlobalConfigFile: vi.fn(() => ({ path: '/dev/null', created: false })),
}));

import * as agentCmd from '../src/commands/agent';
import { ConfigurationError, UsageError } from '../src/util/errors';
import type { ZipRunner } from '../src/util/zip-runner';
import type { CommandDeps } from '../src/types';

const fakeRunner: ZipRunner = {
  async run() {
    return { exitCode: 0, stdout: '', stderr: '' };
  },
};

function makeDeps(): CommandDeps {
  return {
    config: {
      zipBin: 'zip',
      unzipBin: 'unzip',
      zipinfoBin: 'zipinfo',
      logFile: null,
      outputMode: 'json',
      quiet: true,
      verbose: false,
      cwd: '/tmp',
    },
    zipRunner: fakeRunner,
    now: () => new Date(),
    logger: { info() {}, warn() {}, error() {} },
  };
}

const ENV_KEYS = [
  // Project-prefixed
  'ZIP_AGENT_PROVIDER',
  'ZIP_AGENT_MODEL',
  'ZIP_AGENT_OPENAI_API_KEY',
  'ZIP_AGENT_OPENAI_BASE_URL',
  'ZIP_AGENT_OPENAI_ORG',
  'ZIP_AGENT_ANTHROPIC_API_KEY',
  'ZIP_AGENT_ANTHROPIC_BASE_URL',
  'ZIP_AGENT_GOOGLE_API_KEY',
  'ZIP_AGENT_AZURE_OPENAI_API_KEY',
  'ZIP_AGENT_AZURE_OPENAI_ENDPOINT',
  'ZIP_AGENT_AZURE_OPENAI_DEPLOYMENT',
  'ZIP_AGENT_AZURE_AI_INFERENCE_KEY',
  'ZIP_AGENT_AZURE_AI_INFERENCE_ENDPOINT',
  'ZIP_AGENT_LOCAL_OPENAI_BASE_URL',
  'ZIP_AGENT_LOCAL_OPENAI_API_KEY',
  // Canonical aliases — must also be cleared so the developer's globally
  // exported keys don't leak into "missing API key" assertions.
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_ORGANIZATION',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_GENAI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_DEPLOYMENT',
  'AZURE_OPENAI_DEPLOYMENT_NAME',
  'AZURE_OPENAI_API_VERSION',
  'OPENAI_API_VERSION',
  'AZURE_AI_INFERENCE_KEY',
  'AZURE_AI_INFERENCE_ENDPOINT',
  'AZURE_INFERENCE_CREDENTIAL',
  'AZURE_INFERENCE_ENDPOINT',
  'LOCAL_OPENAI_BASE_URL',
  'OLLAMA_HOST',
];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  return () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
});

describe('agent command', () => {
  it('throws ConfigurationError when no provider is configured', async () => {
    await expect(agentCmd.run(makeDeps(), 'hi', {})).rejects.toThrow(ConfigurationError);
  });

  it('throws ConfigurationError when provider set but API key missing', async () => {
    await expect(
      agentCmd.run(makeDeps(), 'hi', { provider: 'openai', model: 'gpt-x' }),
    ).rejects.toThrow(ConfigurationError);
  });

  it('throws UsageError for an unknown provider', async () => {
    await expect(
      agentCmd.run(makeDeps(), 'hi', { provider: 'bogus', model: 'x' }),
    ).rejects.toThrow(UsageError);
  });

  it('throws UsageError when no prompt and not interactive', async () => {
    process.env['ZIP_AGENT_OPENAI_API_KEY'] = 'sk-test';
    await expect(
      agentCmd.run(makeDeps(), null, { provider: 'openai', model: 'gpt-x' }),
    ).rejects.toThrow(UsageError);
  });
});
