import readline from 'node:readline';
import { MemorySaver } from '@langchain/langgraph';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { AgentConfig } from '../config/agent-config';
import { createAgentGraph } from './graph';
import type { AgentLogger, AgentStep } from './logging';
import { summarizePromptForLog } from './logging';

export interface AgentUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

export interface AgentMeta {
  maxSteps: number;
  stepsUsed: number;
  durationMs: number;
  terminatedBy: 'final' | 'maxSteps' | 'error' | 'interrupted';
}

export interface AgentResult {
  answer: string;
  provider: string;
  model: string;
  steps: AgentStep[];
  usage: AgentUsage;
  meta: AgentMeta;
}

interface RunOneShotArgs {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  cfg: AgentConfig;
  prompt: string;
  logger: AgentLogger;
}

export async function runOneShot(args: RunOneShotArgs): Promise<AgentResult> {
  const { model, tools, systemPrompt, cfg, prompt, logger } = args;
  logger.info('agent: oneshot starting', {
    provider: cfg.provider,
    model: cfg.model,
    promptPreview: summarizePromptForLog(prompt),
    toolCount: tools.length,
  });

  const graph = createAgentGraph({ model, tools, systemPrompt });
  const start = Date.now();
  let terminatedBy: AgentMeta['terminatedBy'] = 'final';
  let finalState: unknown;

  try {
    finalState = await graph.invoke(
      { messages: [{ role: 'user', content: prompt }] },
      { recursionLimit: cfg.maxSteps },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/recursion limit/i.test(message) || /max steps/i.test(message)) {
      terminatedBy = 'maxSteps';
      finalState = { messages: [] };
    } else {
      logger.error('agent: graph error', { message });
      throw err;
    }
  }

  const durationMs = Date.now() - start;
  const { steps, usage, answer } = extractStateSummary(finalState);
  for (const step of steps) logger.step(step);

  const meta: AgentMeta = {
    maxSteps: cfg.maxSteps,
    stepsUsed: steps.length,
    durationMs,
    terminatedBy: terminatedBy === 'maxSteps' ? 'maxSteps' : answer ? 'final' : 'maxSteps',
  };

  return {
    answer: answer ?? '',
    provider: cfg.provider,
    model: cfg.model,
    steps,
    usage,
    meta,
  };
}

interface RunInteractiveArgs {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  cfg: AgentConfig;
  logger: AgentLogger;
  /**
   * Optional callback to rebuild the tool catalog with a different
   * `allowMutations` setting. When provided, the `/mutations on|off` slash
   * command becomes available. When omitted, the catalog is fixed for the
   * lifetime of the session.
   */
  rebuildTools?: (allowMutations: boolean) => StructuredToolInterface[];
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

const SLASH_HELP = `\
Slash commands:
  /help              Show this help.
  /tools             List loaded tools (name + 1-line description).
  /mutations on|off  Toggle mutation tools (create/extract/add/remove).
  /reset             Clear conversation memory and start a fresh thread.
  /clear             Clear the screen.
  /exit              Leave the REPL (Ctrl+D also works).
`;

function modeLabel(allowMutations: boolean): string {
  return allowMutations ? '[MUTATIONS ENABLED]' : '[READ-ONLY]';
}

function renderBanner(
  cfg: AgentConfig,
  allowMutations: boolean,
  tools: StructuredToolInterface[],
): string {
  const toolList = tools.map((t) => t.name).join(', ') || '(none)';
  return (
    `zip-agent interactive ${modeLabel(allowMutations)} ` +
    `(${cfg.provider}/${cfg.model})\n` +
    `  tools: ${toolList}\n` +
    `  Type "/help" for slash commands, "/exit" to quit.\n`
  );
}

export async function runInteractive(args: RunInteractiveArgs): Promise<void> {
  const { model, systemPrompt, cfg, logger } = args;
  const stdin = args.stdin ?? process.stdin;
  const stdout = args.stdout ?? process.stdout;

  let allowMutations = cfg.allowMutations;
  let tools = args.tools;

  let checkpointer = new MemorySaver();
  let graph = createAgentGraph({ model, tools, systemPrompt, checkpointer });
  let threadId = `zip-agent-${process.pid}-${Date.now()}`;

  stdout.write(renderBanner(cfg, allowMutations, tools));

  const rl = readline.createInterface({ input: stdin, output: stdout });
  rl.setPrompt('> ');
  rl.prompt();

  let closed = false;
  const safePrompt = (): void => {
    if (closed) return;
    try {
      rl.prompt();
    } catch {
      /* readline already closed — ignore. */
    }
  };

  let interrupted = false;
  const onSigint = (): void => {
    interrupted = true;
    stdout.write('\n^C\n');
    closed = true;
    rl.close();
  };
  process.on('SIGINT', onSigint);

  // Serialize line handling so a slow model invocation finishes before the
  // next user input is processed (matches what users expect in a TTY REPL
  // and prevents the second line from racing past the first).
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>): void => {
    queue = queue.then(work).catch(() => {
      /* per-line errors are written inside the handler */
    });
  };

  await new Promise<void>((resolve) => {
    rl.on('line', (line) => enqueue(async () => {
      const text = line.trim();
      if (!text) {
        safePrompt();
        return;
      }
      if (text === '/exit') {
        rl.close();
        return;
      }
      if (text === '/help') {
        stdout.write(SLASH_HELP);
        safePrompt();
        return;
      }
      if (text === '/clear') {
        // ANSI: clear screen + move cursor home.
        stdout.write('\x1b[2J\x1b[H');
        safePrompt();
        return;
      }
      if (text === '/tools') {
        if (tools.length === 0) {
          stdout.write('(no tools loaded — perhaps an --tools allowlist with zero matches)\n');
        } else {
          for (const t of tools) {
            const desc = (t.description ?? '').split('\n')[0] ?? '';
            stdout.write(`  ${t.name.padEnd(22)} ${desc}\n`);
          }
        }
        safePrompt();
        return;
      }
      if (text === '/mutations on' || text === '/mutations off') {
        const want = text.endsWith('on');
        if (!args.rebuildTools) {
          stdout.write(
            '(mutations toggle unavailable — caller did not provide a rebuildTools callback)\n',
          );
        } else if (want === allowMutations) {
          stdout.write(`(mutations already ${want ? 'on' : 'off'})\n`);
        } else {
          allowMutations = want;
          tools = args.rebuildTools(allowMutations);
          // Rebuild the graph so the model sees the new catalog. Reset the
          // thread so prior messages don't claim mutating tools that no
          // longer exist (or vice versa).
          checkpointer = new MemorySaver();
          graph = createAgentGraph({ model, tools, systemPrompt, checkpointer });
          threadId = `zip-agent-${process.pid}-${Date.now()}`;
          stdout.write(
            `(mutations ${want ? 'enabled' : 'disabled'} ${modeLabel(allowMutations)} — ` +
              `tools now: ${tools.map((t) => t.name).join(', ') || '(none)'}; memory reset)\n`,
          );
        }
        safePrompt();
        return;
      }
      if (text === '/mutations') {
        stdout.write(`(usage: /mutations on  |  /mutations off — currently ${modeLabel(allowMutations)})\n`);
        safePrompt();
        return;
      }
      if (text === '/reset') {
        checkpointer = new MemorySaver();
        graph = createAgentGraph({ model, tools, systemPrompt, checkpointer });
        threadId = `zip-agent-${process.pid}-${Date.now()}`;
        stdout.write('(memory reset)\n');
        safePrompt();
        return;
      }
      try {
        if (cfg.verbose) {
          stdout.write(
            `  · invoking with ${tools.length} tool(s) bound: ` +
              `${tools.map((t) => t.name).join(', ') || '(none)'}\n`,
          );
        }
        const final = await graph.invoke(
          { messages: [{ role: 'user', content: text }] },
          { recursionLimit: cfg.maxSteps, configurable: { thread_id: threadId } },
        );
        const summary = extractStateSummary(final);
        for (const step of summary.steps) logger.step(step);
        if (cfg.verbose && summary.steps.length > 0) {
          for (const step of summary.steps) {
            stdout.write(
              `  · step ${step.index} ${step.tool ?? '<no-tool>'}` +
                (step.result ? ` → ${truncateInline(step.result, 120)}` : '') +
                '\n',
            );
          }
        }
        stdout.write(`${summary.answer ?? '(no answer)'}\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stdout.write(`(error: ${message})\n`);
      }
      safePrompt();
    }));
    rl.on('close', () => {
      closed = true;
      process.removeListener('SIGINT', onSigint);
      // Wait for any in-flight line work to drain so its output isn't
      // truncated before resolving.
      queue.finally(() => resolve());
    });
  });

  if (interrupted) {
    process.exit(130);
  }
}

function truncateInline(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(+${s.length - max} chars)`;
}

// ---- shared state extraction --------------------------------------

interface MessageLike {
  role?: string;
  type?: string;
  name?: string;
  content?: unknown;
  tool_calls?: Array<{ name?: string; args?: unknown; id?: string }>;
  usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  response_metadata?: {
    tokenUsage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  };
  tool_call_id?: string;
}

interface StateSummary {
  steps: AgentStep[];
  usage: AgentUsage;
  answer: string | null;
}

function extractStateSummary(state: unknown): StateSummary {
  const messages: MessageLike[] = (state as { messages?: MessageLike[] })?.messages ?? [];
  const steps: AgentStep[] = [];
  const usage: AgentUsage = { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0 };
  let answer: string | null = null;
  let stepIndex = 0;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    accumulateUsage(usage, m);
    const isAi = m.type === 'ai' || m.role === 'assistant' || m.role === 'ai';
    const isTool = m.type === 'tool' || m.role === 'tool';

    if (isAi && m.tool_calls?.length) {
      for (const tc of m.tool_calls) {
        stepIndex += 1;
        steps.push({
          index: stepIndex,
          tool: tc.name ?? '<unknown>',
          args: tc.args,
        });
      }
    } else if (isTool) {
      const open = steps[steps.length - 1];
      if (open && open.result === undefined) {
        open.result = stringContent(m.content);
      } else {
        stepIndex += 1;
        steps.push({
          index: stepIndex,
          tool: m.name,
          result: stringContent(m.content),
        });
      }
    } else if (isAi && !m.tool_calls?.length) {
      answer = stringContent(m.content);
    }
  }

  return { steps, usage, answer };
}

function accumulateUsage(usage: AgentUsage, m: MessageLike): void {
  const u1 = m.usage_metadata;
  if (u1) {
    usage.totalInputTokens += u1.input_tokens ?? 0;
    usage.totalOutputTokens += u1.output_tokens ?? 0;
    usage.totalTokens += u1.total_tokens ?? 0;
    return;
  }
  const u2 = m.response_metadata?.tokenUsage;
  if (u2) {
    usage.totalInputTokens += u2.promptTokens ?? 0;
    usage.totalOutputTokens += u2.completionTokens ?? 0;
    usage.totalTokens += u2.totalTokens ?? 0;
  }
}

function stringContent(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text ?? '');
        }
        return JSON.stringify(part);
      })
      .join('');
  }
  return JSON.stringify(content);
}
