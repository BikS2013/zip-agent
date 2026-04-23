import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentLogger } from '../src/agent/logging';
import type { AgentConfig } from '../src/config/agent-config';

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
  verbose: true,
  interactive: false,
  providerEnv: Object.freeze({}),
}) as AgentConfig;

class CapturingStream {
  public buffer = '';
  write(chunk: string | Buffer): boolean {
    this.buffer += chunk.toString();
    return true;
  }
}

let tmpFile: string | null = null;
beforeEach(async () => {
  tmpFile = path.join(tmpdir(), `zip-agent-log-${Date.now()}-${Math.random()}.log`);
});
afterEach(async () => {
  if (tmpFile) await fs.rm(tmpFile, { force: true });
});

describe('agent logger', () => {
  it('redacts secrets in stderr writes', async () => {
    const stream = new CapturingStream();
    const logger = await createAgentLogger(cfg, {
      stderr: stream as unknown as NodeJS.WritableStream,
    });
    logger.info('user supplied api_key=ABCDEFGHIJK');
    await logger.close();
    expect(stream.buffer).toContain('api_key=[REDACTED]');
  });

  it('writes to file with mode 0600 when logFilePath is set', async () => {
    const logger = await createAgentLogger(
      { ...cfg, verbose: false } as AgentConfig,
      { logFilePath: tmpFile!, quiet: true },
    );
    logger.info('hello');
    await logger.close();
    const stats = await fs.stat(tmpFile!);
    expect(stats.mode & 0o777).toBe(0o600);
    const content = await fs.readFile(tmpFile!, 'utf8');
    expect(content).toContain('hello');
  });

  it('quiet=true suppresses stderr but still writes to file', async () => {
    const stream = new CapturingStream();
    const logger = await createAgentLogger(cfg, {
      stderr: stream as unknown as NodeJS.WritableStream,
      logFilePath: tmpFile!,
      quiet: true,
    });
    logger.info('quiet message');
    await logger.close();
    expect(stream.buffer).toBe('');
    const content = await fs.readFile(tmpFile!, 'utf8');
    expect(content).toContain('quiet message');
  });
});
