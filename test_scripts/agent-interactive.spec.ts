import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { FakeToolCallingModel } from 'langchain';
import { runInteractive } from '../src/agent/run';
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
  verbose: false,
  interactive: true,
  providerEnv: Object.freeze({}),
}) as AgentConfig;

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  step() {},
  close: async () => {},
};

function makeStreams(input: string): { stdin: PassThrough; stdout: PassThrough; out: () => string } {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let buf = '';
  stdout.on('data', (chunk: Buffer | string) => {
    buf += chunk.toString();
  });
  // Write everything synchronously, then signal EOF so readline closes.
  setImmediate(() => {
    stdin.write(input);
    stdin.end();
  });
  return { stdin, stdout, out: () => buf };
}

describe('runInteractive', () => {
  it('shows the banner with provider, model and tool list', async () => {
    const noopTool = tool(async () => 'x', {
      name: 'noop',
      description: 'noop',
      schema: z.object({}),
    });
    const { stdin, stdout, out } = makeStreams('/exit\n');
    await runInteractive({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: new FakeToolCallingModel({ toolCalls: [[]] }) as any,
      tools: [noopTool],
      systemPrompt: 'sys',
      cfg,
      logger: noopLogger,
      stdin,
      stdout,
    });
    const text = out();
    expect(text).toContain('zip-agent interactive');
    expect(text).toContain('openai/gpt');
    expect(text).toContain('noop');
  });

  it('/help prints slash command reference', async () => {
    const { stdin, stdout, out } = makeStreams('/help\n/exit\n');
    await runInteractive({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: new FakeToolCallingModel({ toolCalls: [[]] }) as any,
      tools: [],
      systemPrompt: 'sys',
      cfg,
      logger: noopLogger,
      stdin,
      stdout,
    });
    const text = out();
    expect(text).toContain('/help');
    expect(text).toContain('/reset');
    expect(text).toContain('/tools');
  });

  it('/tools lists tool names', async () => {
    const t = tool(async () => 'r', {
      name: 'echo_tool',
      description: 'Echoes input back',
      schema: z.object({ q: z.string() }),
    });
    const { stdin, stdout, out } = makeStreams('/tools\n/exit\n');
    await runInteractive({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: new FakeToolCallingModel({ toolCalls: [[]] }) as any,
      tools: [t],
      systemPrompt: 'sys',
      cfg,
      logger: noopLogger,
      stdin,
      stdout,
    });
    const text = out();
    expect(text).toContain('echo_tool');
    expect(text).toContain('Echoes input back');
  });

  it('/reset announces memory reset', async () => {
    const { stdin, stdout, out } = makeStreams('/reset\n/exit\n');
    await runInteractive({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: new FakeToolCallingModel({ toolCalls: [[]] }) as any,
      tools: [],
      systemPrompt: 'sys',
      cfg,
      logger: noopLogger,
      stdin,
      stdout,
    });
    expect(out()).toContain('memory reset');
  });

  it('banner labels READ-ONLY when allowMutations=false', async () => {
    const { stdin, stdout, out } = makeStreams('/exit\n');
    await runInteractive({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: new FakeToolCallingModel({ toolCalls: [[]] }) as any,
      tools: [],
      systemPrompt: 'sys',
      cfg,
      logger: noopLogger,
      stdin,
      stdout,
    });
    expect(out()).toContain('[READ-ONLY]');
  });

  it('banner labels MUTATIONS ENABLED when allowMutations=true', async () => {
    const mutCfg = { ...cfg, allowMutations: true } as AgentConfig;
    const { stdin, stdout, out } = makeStreams('/exit\n');
    await runInteractive({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: new FakeToolCallingModel({ toolCalls: [[]] }) as any,
      tools: [],
      systemPrompt: 'sys',
      cfg: mutCfg,
      logger: noopLogger,
      stdin,
      stdout,
    });
    expect(out()).toContain('[MUTATIONS ENABLED]');
  });

  it('/mutations on rebuilds the catalog through the rebuildTools callback', async () => {
    const readOnly = tool(async () => 'r', {
      name: 'list_archive',
      description: 'read only',
      schema: z.object({}),
    });
    const mutating = tool(async () => 'm', {
      name: 'create_archive',
      description: '[MUTATING] create',
      schema: z.object({ archive: z.string() }),
    });
    const calls: boolean[] = [];
    const { stdin, stdout, out } = makeStreams('/mutations on\n/exit\n');
    await runInteractive({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: new FakeToolCallingModel({ toolCalls: [[]] }) as any,
      tools: [readOnly],
      systemPrompt: 'sys',
      cfg,
      logger: noopLogger,
      rebuildTools: (allow) => {
        calls.push(allow);
        return allow ? [readOnly, mutating] : [readOnly];
      },
      stdin,
      stdout,
    });
    expect(calls).toContain(true);
    const text = out();
    expect(text).toContain('mutations enabled');
    expect(text).toContain('create_archive');
  });

  it('/mutations on without rebuildTools surfaces a clear message', async () => {
    const { stdin, stdout, out } = makeStreams('/mutations on\n/exit\n');
    await runInteractive({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: new FakeToolCallingModel({ toolCalls: [[]] }) as any,
      tools: [],
      systemPrompt: 'sys',
      cfg,
      logger: noopLogger,
      stdin,
      stdout,
    });
    expect(out()).toContain('mutations toggle unavailable');
  });

  it('processes a real prompt and prints the model answer', async () => {
    const { stdin, stdout, out } = makeStreams('hello there\n/exit\n');
    await runInteractive({
      // FakeToolCallingModel echoes the last message content back.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: new FakeToolCallingModel({ toolCalls: [[]] }) as any,
      tools: [],
      systemPrompt: 'sys',
      cfg,
      logger: noopLogger,
      stdin,
      stdout,
    });
    const text = out();
    expect(text).toContain('hello there');
  });
});
