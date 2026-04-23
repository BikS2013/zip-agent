import { describe, it, expect } from 'vitest';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
// FakeToolCallingModel ships from the langchain top-level package; the
// older FakeListChatModel in @langchain/core has no tool-calling support.
import { FakeToolCallingModel } from 'langchain';
import { runOneShot } from '../src/agent/run';
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
  interactive: false,
  providerEnv: Object.freeze({}),
}) as AgentConfig;

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  step() {},
  close: async () => {},
};

describe('runOneShot', () => {
  it('terminates on a final AIMessage without tool_calls', async () => {
    const fakeTool = tool(async () => 'tool-result', {
      name: 'noop',
      description: 'no-op',
      schema: z.object({}),
    });
    // Empty toolCalls list at every round → no tool call made → final.
    const model = new FakeToolCallingModel({ toolCalls: [[]] });

    const result = await runOneShot({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: model as any,
      tools: [fakeTool],
      systemPrompt: 'sys',
      cfg,
      prompt: 'hi',
      logger: noopLogger,
    });

    expect(result.meta.terminatedBy).toBe('final');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt');
  });

  it('captures a tool round-trip in steps[]', async () => {
    const fakeTool = tool(async () => 'echoed', {
      name: 'echo',
      description: 'echo',
      schema: z.object({ text: z.string() }),
    });
    // Round 1: ask for a tool call. Round 2: no calls → final.
    const model = new FakeToolCallingModel({
      toolCalls: [
        [{ name: 'echo', args: { text: 'hi' }, id: 'call_1' }],
        [],
      ],
    });

    const result = await runOneShot({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: model as any,
      tools: [fakeTool],
      systemPrompt: 'sys',
      cfg,
      prompt: 'echo this',
      logger: noopLogger,
    });

    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.steps[0]?.tool).toBe('echo');
  });
});
