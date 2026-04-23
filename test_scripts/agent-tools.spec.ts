import { describe, it, expect, vi } from 'vitest';
import { createListTool } from '../src/agent/tools/list-tool';
import { createTestTool } from '../src/agent/tools/test-tool';
import { handleToolError } from '../src/agent/tools/types';
import {
  AuthError,
  ConfigurationError,
  IoError,
  UpstreamError,
  UsageError,
} from '../src/util/errors';
import type { ZipRunner } from '../src/util/zip-runner';
import type { CommandDeps } from '../src/types';
import type { AgentConfig } from '../src/config/agent-config';

function makeDeps(runner: Partial<ZipRunner> = {}): CommandDeps {
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
    zipRunner: { run: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })), ...runner },
    now: () => new Date(),
    logger: { info() {}, warn() {}, error() {} },
  };
}

const cfg: AgentConfig = Object.freeze({
  provider: 'openai',
  model: 'gpt',
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
  providerEnv: Object.freeze({}),
}) as AgentConfig;

describe('handleToolError', () => {
  it('returns recoverable errors as JSON tool result', () => {
    const out = handleToolError(new UsageError('bad arg'));
    expect(JSON.parse(out)).toEqual({
      error: { code: 'USAGE', message: 'bad arg', httpStatus: null },
    });
  });

  it.each([
    new UpstreamError('boom'),
    new IoError('disk'),
  ])('returns a JSON envelope for %s', (err) => {
    const out = handleToolError(err);
    expect(JSON.parse(out).error.message).toBeTruthy();
  });

  it('rethrows ConfigurationError', () => {
    expect(() => handleToolError(new ConfigurationError('K', ['env']))).toThrow(ConfigurationError);
  });

  it('rethrows AuthError', () => {
    expect(() => handleToolError(new AuthError('nope'))).toThrow(AuthError);
  });
});

describe('list adapter', () => {
  it('routes recoverable IoError into a JSON tool result', async () => {
    const tool = createListTool(makeDeps(), cfg);
    const out = (await tool.invoke({ archive: '/nonexistent/path.zip' })) as string;
    const parsed = JSON.parse(out);
    expect(parsed.error.code).toBe('IO');
  });
});

describe('test adapter', () => {
  it('returns a JSON envelope for missing archives', async () => {
    const tool = createTestTool(makeDeps(), cfg);
    const out = (await tool.invoke({ archive: '/nonexistent/zzzz.zip' })) as string;
    expect(JSON.parse(out).error.code).toBe('IO');
  });
});
