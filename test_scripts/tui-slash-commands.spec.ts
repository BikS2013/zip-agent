/**
 * tui-slash-commands.spec.ts — selected slash commands.
 *
 * /new must produce a fresh thread_id and rebuild the graph.
 * /tools must call rebuildTools(allow) and update the catalog.
 * /last must reprint the last assistant message.
 * /help must list every command.
 *
 * We do NOT test /memory or /system through $EDITOR — those rely on
 * spawning an external process; the /memory inline-print branch IS tested.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { FakeToolCallingModel } from 'langchain';
import { MemorySaver } from '@langchain/langgraph';

import {
  dispatchSlash,
  ensureTuiBootstrap,
  findSlashCommand,
  generateThreadId,
  SLASH_COMMANDS,
} from '../src/agent/tui';
import { createAgentGraph } from '../src/agent/graph';
import type { AgentConfig } from '../src/config/agent-config';
import type { SlashContext, TuiSession } from '../src/agent/tui/types';

const SAVED_HOME = process.env['ZIP_AGENT_TUI_HOME'];
const SAVED_EDITOR = process.env['EDITOR'];
const SAVED_VISUAL = process.env['VISUAL'];

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-agent-slash-'));
  process.env['ZIP_AGENT_TUI_HOME'] = tmp;
  // Force the inline branch of /memory by clearing $EDITOR.
  delete process.env['EDITOR'];
  delete process.env['VISUAL'];
  ensureTuiBootstrap();
});

afterEach(async () => {
  if (SAVED_HOME === undefined) delete process.env['ZIP_AGENT_TUI_HOME'];
  else process.env['ZIP_AGENT_TUI_HOME'] = SAVED_HOME;
  if (SAVED_EDITOR === undefined) delete process.env['EDITOR'];
  else process.env['EDITOR'] = SAVED_EDITOR;
  if (SAVED_VISUAL === undefined) delete process.env['VISUAL'];
  else process.env['VISUAL'] = SAVED_VISUAL;
  await fs.rm(tmp, { recursive: true, force: true });
});

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

function captureStream(): { stream: NodeJS.WritableStream; output: () => string } {
  let buf = '';
  const stream = {
    write(chunk: string | Buffer) {
      buf += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    },
  } as NodeJS.WritableStream;
  return { stream, output: () => buf };
}

function makeSession(opts: { tools?: ReturnType<typeof tool>[] } = {}): TuiSession {
  const tools = opts.tools ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = new FakeToolCallingModel({ toolCalls: [[]] }) as any;
  const checkpointer = new MemorySaver();
  return {
    graph: createAgentGraph({ model, tools, systemPrompt: 'sys', checkpointer }),
    checkpointer,
    model,
    tools,
    cfg,
    systemPrompt: 'sys',
    threadId: 'thread-init',
    messages: [],
    inputHistory: [],
    allowMutations: false,
    logger: {
      info() {}, warn() {}, error() {}, step() {}, close: async () => {},
    },
    stdout: process.stdout,
    stdin: process.stdin as NodeJS.ReadStream,
  };
}

function makeCtx(session: TuiSession, out: NodeJS.WritableStream): SlashContext {
  // Replace stdout with the capture stream so [system] writes are observable.
  session.stdout = out;
  return {
    session,
    printSystem(message: string) {
      out.write(`[system] ${message}\n`);
    },
    println(message: string) {
      out.write(message + '\n');
    },
  };
}

describe('SLASH_COMMANDS registry', () => {
  it('exposes every named command from the plan', () => {
    const names = SLASH_COMMANDS.map((c) => c.name).sort();
    expect(names).toEqual(
      ['/clear', '/copy', '/help', '/history', '/last', '/memory', '/model', '/new', '/quit', '/system', '/tools'].sort(),
    );
  });

  it('findSlashCommand is case-sensitive', () => {
    expect(findSlashCommand('/help')).toBeDefined();
    expect(findSlashCommand('/Help')).toBeUndefined();
    expect(findSlashCommand('/HELP')).toBeUndefined();
  });

  it('aliases are honoured', () => {
    expect(findSlashCommand('/exit')?.name).toBe('/quit');
    expect(findSlashCommand('/reset')?.name).toBe('/new');
    expect(findSlashCommand('/raw')?.name).toBe('/last');
  });
});

describe('/help', () => {
  it('lists every command with its description', async () => {
    const session = makeSession();
    const { stream, output } = captureStream();
    const ctx = makeCtx(session, stream);
    const r = await dispatchSlash(ctx, '/help');
    expect(r.kind).toBe('continue');
    const text = output();
    for (const c of SLASH_COMMANDS) {
      expect(text).toContain(c.name);
    }
    expect(text).toContain('Ctrl+J');
  });
});

describe('/quit', () => {
  it('returns kind:"quit"', async () => {
    const session = makeSession();
    const { stream } = captureStream();
    const ctx = makeCtx(session, stream);
    const r = await dispatchSlash(ctx, '/quit');
    expect(r.kind).toBe('quit');
  });
});

describe('/new', () => {
  it('replaces the thread id and clears the local message mirror', async () => {
    const session = makeSession();
    session.messages = [
      { role: 'user', content: 'hi', timestamp: 1 },
      { role: 'assistant', content: 'hello', timestamp: 2 },
    ];
    const oldId = session.threadId;
    const { stream, output } = captureStream();
    const ctx = makeCtx(session, stream);
    await dispatchSlash(ctx, '/new');
    expect(session.threadId).not.toBe(oldId);
    expect(session.messages.length).toBe(0);
    expect(output()).toContain('new thread');
  });
});

describe('/last', () => {
  it('reprints the most recent assistant message', async () => {
    const session = makeSession();
    session.messages = [
      { role: 'user', content: 'q', timestamp: 1 },
      { role: 'assistant', content: 'an answer to q', timestamp: 2 },
      { role: 'user', content: 'q2', timestamp: 3 },
      { role: 'assistant', content: 'second answer', timestamp: 4 },
    ];
    const { stream, output } = captureStream();
    const ctx = makeCtx(session, stream);
    await dispatchSlash(ctx, '/last');
    expect(output()).toContain('second answer');
    expect(output()).not.toContain('an answer to q');
  });

  it('says "no assistant turn yet" when transcript is empty', async () => {
    const session = makeSession();
    const { stream, output } = captureStream();
    const ctx = makeCtx(session, stream);
    await dispatchSlash(ctx, '/last');
    expect(output()).toContain('no assistant turn yet');
  });
});

describe('/clear', () => {
  it('writes the ANSI clear-screen sequence', async () => {
    const session = makeSession();
    const { stream, output } = captureStream();
    const ctx = makeCtx(session, stream);
    await dispatchSlash(ctx, '/clear');
    expect(output()).toContain('\x1b[2J\x1b[H');
  });
});

describe('/memory (inline path, no $EDITOR)', () => {
  it('prints the current memory.md contents inline', async () => {
    const session = makeSession();
    const { stream, output } = captureStream();
    const ctx = makeCtx(session, stream);
    await dispatchSlash(ctx, '/memory');
    expect(output()).toContain('memory.md');
  });
});

describe('/tools', () => {
  it('reports unavailable when no rebuildTools callback is provided', async () => {
    const session = makeSession({ tools: [] });
    // session.rebuildTools intentionally undefined.
    const { stream, output } = captureStream();
    const ctx = makeCtx(session, stream);
    // We need to feed a reply for the prompt — but the early-return path
    // never reaches the prompt, so empty stdin is fine.
    await dispatchSlash(ctx, '/tools');
    expect(output()).toContain('rebuildTools callback not provided');
  });
});

describe('dispatchSlash unknown', () => {
  it('emits a system hint for unknown commands', async () => {
    const session = makeSession();
    const { stream, output } = captureStream();
    const ctx = makeCtx(session, stream);
    const r = await dispatchSlash(ctx, '/madeup');
    expect(r.kind).toBe('continue');
    expect(output()).toContain('unknown slash command');
  });
});

describe('generateThreadId', () => {
  it('produces unique ids on each call', () => {
    const a = generateThreadId();
    const b = generateThreadId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^zip-agent-/);
  });
});
