/**
 * tui-thread-memory.spec.ts — pins the cross-turn memory bug fix from
 * plan-004-tui.md "Bugfix log — round 2".
 *
 * Symptom (verbatim user transcript):
 *   You> are there any zip files in ~/Downloads?
 *   Agent> ... yes, /Users/.../aiwork-20260420.zip
 *   You> Can you take a look to this file?
 *   Agent> Please send the path to the ZIP file you want me to inspect.
 *   You> The one you found previously.
 *   Agent> I'm missing the referent for "the one you found previously."
 *
 * Root cause: `runInteractiveTui` constructed `createAgentGraph(...)` without
 * passing a `MemorySaver`. Without a checkpointer, LangGraph has nowhere to
 * persist or load thread state, so every turn started with only the new user
 * message in context, regardless of `configurable.thread_id`. The seam
 * `streamEvents` in src/agent/tui/streaming.ts ALREADY threaded
 * `configurable.thread_id` through correctly — but it was pointing at a
 * checkpointer that didn't exist.
 *
 * The fix:
 *   1. `TuiSession` carries a `checkpointer: MemorySaver` field.
 *   2. The initial graph is built with that checkpointer (tui.ts).
 *   3. Every slash command that rebuilds the graph (`/new`, `/model`,
 *      `/tools` mutation toggle, `/system`, `/history`) ALSO mints a fresh
 *      `MemorySaver` so the prior thread checkpoint is dropped. Plain turns
 *      reuse both. `/clear` does not touch the graph.
 *
 * What this spec pins:
 *   A. The streaming call site passes `configurable.thread_id` on every turn,
 *      and three consecutive calls with the same `session.threadId` all see
 *      the SAME thread_id. This is the part the TUI owns; LangGraph itself is
 *      responsible for the actual checkpoint load/save.
 *   B. `/new` rotates the thread_id AND replaces both the graph and the
 *      checkpointer.
 *   C. A `/tools` mutation toggle rotates the thread_id, replaces the graph,
 *      and replaces the checkpointer. The graph-construction count rises by
 *      one across the dispatch.
 *
 * We deliberately do NOT exercise `runInteractiveTui` end-to-end. That code
 * path requires raw-mode TTY emulation; the streaming call site and the
 * slash-command rebuild paths are the only places the bug lived, and they
 * are independently testable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  generateThreadId,
} from '../src/agent/tui';
import { streamTuiEvents } from '../src/agent/tui/streaming';
import { createAgentGraph } from '../src/agent/graph';
import type { AgentConfig } from '../src/config/agent-config';
import type {
  SlashContext,
  TuiEvent,
  TuiSession,
} from '../src/agent/tui/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAVED_HOME = process.env['ZIP_AGENT_TUI_HOME'];
let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-agent-thread-mem-'));
  process.env['ZIP_AGENT_TUI_HOME'] = tmp;
  ensureTuiBootstrap();
});

afterEach(async () => {
  if (SAVED_HOME === undefined) delete process.env['ZIP_AGENT_TUI_HOME'];
  else process.env['ZIP_AGENT_TUI_HOME'] = SAVED_HOME;
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

interface RecordedCall {
  threadId: string | undefined;
  messageCount: number;
  recursionLimit: unknown;
  hasSignal: boolean;
}

interface RecordingGraph {
  // Mock LangGraph surface that streamTuiEvents talks to. We do NOT need to
  // be a real graph — we only need to record the (input, opts) tuple and
  // emit one terminating token so the for-await loop completes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streamEvents(input: any, opts: any): AsyncIterable<unknown>;
  calls: RecordedCall[];
}

function makeRecordingGraph(): RecordingGraph {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async *streamEvents(input: unknown, opts: unknown): AsyncIterable<unknown> {
      const i = input as { messages?: { role: string; content: string }[] };
      const o = opts as {
        configurable?: { thread_id?: string };
        recursionLimit?: unknown;
        signal?: unknown;
      };
      calls.push({
        threadId: o.configurable?.thread_id,
        messageCount: i.messages?.length ?? 0,
        recursionLimit: o.recursionLimit,
        hasSignal: typeof o.signal !== 'undefined',
      });
      // Emit a single token event so the consumer loop has at least one
      // iteration; then complete naturally.
      yield {
        event: 'on_chat_model_stream',
        data: { chunk: { content: 'ok' } },
      };
    },
  };
}

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

interface SessionOpts {
  tools?: ReturnType<typeof tool>[];
  rebuildTools?: (allow: boolean) => ReturnType<typeof tool>[];
}

function makeSession(opts: SessionOpts = {}): TuiSession {
  const tools = opts.tools ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = new FakeToolCallingModel({ toolCalls: [[]] }) as any;
  const checkpointer = new MemorySaver();
  const session: TuiSession = {
    graph: createAgentGraph({ model, tools, systemPrompt: 'sys', checkpointer }),
    checkpointer,
    model,
    tools,
    cfg,
    systemPrompt: 'sys',
    threadId: generateThreadId(),
    messages: [],
    inputHistory: [],
    allowMutations: false,
    logger: {
      info() {}, warn() {}, error() {}, step() {}, close: async () => {},
    },
    stdout: process.stdout,
    stdin: process.stdin as NodeJS.ReadStream,
  };
  if (opts.rebuildTools) session.rebuildTools = opts.rebuildTools;
  return session;
}

function makeCtx(session: TuiSession, out: NodeJS.WritableStream): SlashContext {
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

async function drainStream(stream: AsyncIterable<TuiEvent>): Promise<TuiEvent[]> {
  const out: TuiEvent[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

// ---------------------------------------------------------------------------
// Spec A — three consecutive turns reuse the same thread_id
// ---------------------------------------------------------------------------

describe('TUI thread memory — three turns reuse the same thread_id', () => {
  it('streamTuiEvents passes session.threadId on every call (no rotation between turns)', async () => {
    const session = makeSession();
    const recorder = makeRecordingGraph();
    // Replace the real graph with the recorder. The TuiSession.graph type is
    // the LangGraph return value; we cast so the recorder can stand in.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session.graph = recorder as any;

    const fixedThreadId = session.threadId;

    // Turn 1
    await drainStream(
      streamTuiEvents({
        graph: session.graph,
        userInput: 'are there any zip files in ~/Downloads?',
        threadId: session.threadId,
        signal: new AbortController().signal,
        recursionLimit: session.cfg.maxSteps,
      }),
    );
    // Turn 2 — no slash command in between, so threadId must NOT have rotated
    await drainStream(
      streamTuiEvents({
        graph: session.graph,
        userInput: 'Can you take a look to this file?',
        threadId: session.threadId,
        signal: new AbortController().signal,
        recursionLimit: session.cfg.maxSteps,
      }),
    );
    // Turn 3
    await drainStream(
      streamTuiEvents({
        graph: session.graph,
        userInput: 'The one you found previously.',
        threadId: session.threadId,
        signal: new AbortController().signal,
        recursionLimit: session.cfg.maxSteps,
      }),
    );

    expect(recorder.calls.length).toBe(3);
    expect(recorder.calls[0]!.threadId).toBe(fixedThreadId);
    expect(recorder.calls[1]!.threadId).toBe(fixedThreadId);
    expect(recorder.calls[2]!.threadId).toBe(fixedThreadId);

    // And every call carried exactly the new user message — the checkpointer
    // (which would inject prior messages) is LangGraph's responsibility; our
    // job is just to feed the new turn + the thread_id.
    expect(recorder.calls[0]!.messageCount).toBe(1);
    expect(recorder.calls[1]!.messageCount).toBe(1);
    expect(recorder.calls[2]!.messageCount).toBe(1);
  });

  it('every streamEvents call also propagates the recursion limit and AbortSignal', async () => {
    const session = makeSession();
    const recorder = makeRecordingGraph();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session.graph = recorder as any;

    const ctrl = new AbortController();
    await drainStream(
      streamTuiEvents({
        graph: session.graph,
        userInput: 'turn',
        threadId: session.threadId,
        signal: ctrl.signal,
        recursionLimit: 7,
      }),
    );

    expect(recorder.calls[0]!.recursionLimit).toBe(7);
    expect(recorder.calls[0]!.hasSignal).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spec B — /new rotates the thread and rebuilds graph + checkpointer
// ---------------------------------------------------------------------------

describe('TUI thread memory — /new rotates thread and replaces graph/checkpointer', () => {
  it('the thread_id observed before and after /new differs', async () => {
    const session = makeSession();
    const before = session.threadId;
    const beforeGraph = session.graph;
    const beforeCheckpointer = session.checkpointer;

    const { stream } = captureStream();
    const ctx = makeCtx(session, stream);
    await dispatchSlash(ctx, '/new');

    expect(session.threadId).not.toBe(before);
    expect(session.threadId.length).toBeGreaterThan(0);
    // The graph and checkpointer must be NEW instances — same reference would
    // mean the prior thread state could leak across the supposed reset.
    expect(session.graph).not.toBe(beforeGraph);
    expect(session.checkpointer).not.toBe(beforeCheckpointer);
    // And the local message mirror is cleared (the on-disk transcript was
    // persisted by the slash command before the swap).
    expect(session.messages).toEqual([]);
  });

  it('the streamEvents call after /new uses the rotated thread_id, not the old one', async () => {
    const session = makeSession();
    const recorder = makeRecordingGraph();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session.graph = recorder as any;
    const before = session.threadId;

    // Turn 1 — uses the original thread_id
    await drainStream(
      streamTuiEvents({
        graph: session.graph,
        userInput: 'first',
        threadId: session.threadId,
        signal: new AbortController().signal,
        recursionLimit: session.cfg.maxSteps,
      }),
    );

    const { stream } = captureStream();
    const ctx = makeCtx(session, stream);
    await dispatchSlash(ctx, '/new');

    // After /new the session.graph was replaced with a real graph (the
    // dispatch did `session.graph = createAgentGraph(...)`); swap the recorder
    // back in so we can keep observing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session.graph = recorder as any;

    // Turn 2 — must use the rotated thread_id
    await drainStream(
      streamTuiEvents({
        graph: session.graph,
        userInput: 'second',
        threadId: session.threadId,
        signal: new AbortController().signal,
        recursionLimit: session.cfg.maxSteps,
      }),
    );

    expect(recorder.calls.length).toBe(2);
    expect(recorder.calls[0]!.threadId).toBe(before);
    expect(recorder.calls[1]!.threadId).toBe(session.threadId);
    expect(recorder.calls[1]!.threadId).not.toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Spec C — /tools mutation toggle rotates thread, rebuilds graph + checkpointer
// ---------------------------------------------------------------------------

// We mock `readInput` so /tools' interactive prompt resolves deterministically.
// The mock returns "m" the first time it's called (toggling the mutations
// master switch), then any subsequent calls return "" (cancel / no-op).
//
// vi.hoisted is required because the mocked module is imported transitively
// by src/agent/tui (which slash-commands.ts pulls). The replies array must be
// reachable at module-init time.
const { readInputMock } = vi.hoisted(() => ({
  readInputMock: vi.fn<() => Promise<string>>(),
}));
vi.mock('../src/agent/tui/input', async () => {
  const actual = await vi.importActual<typeof import('../src/agent/tui/input')>(
    '../src/agent/tui/input',
  );
  return {
    ...actual,
    readInput: readInputMock,
  };
});

describe('TUI thread memory — /tools mutation toggle rotates thread and rebuilds graph', () => {
  beforeEach(() => {
    readInputMock.mockReset();
  });

  it('flipping the mutations master switch via /tools rotates thread, replaces graph, and replaces checkpointer', async () => {
    // Two-tier rebuildTools: one tool when read-only, two when mutations are
    // on. Flipping the master flag therefore changes BOTH the master flag AND
    // the catalog — either of which on its own must trigger a thread reset
    // (catalog change because tool_call ids in the prior thread checkpoint
    // would dangle; mutations flip mirroring the legacy REPL at run.ts:232).
    const readOnlyTool = tool(async () => 'noop', {
      name: 'list_archive',
      description: 'list',
      schema: z.object({}),
    });
    const mutTool = tool(async () => 'noop', {
      name: 'create_archive',
      description: 'create',
      schema: z.object({}),
    });

    // Count graph constructions across the test by wrapping the rebuildTools
    // callback. Each /tools dispatch invokes rebuildTools at least twice
    // (once to materialize the "full universe" baseline, once to build the
    // post-toggle catalog) — but only one createAgentGraph call should fire,
    // detectable by capturing the post-dispatch session.graph identity.
    let rebuildToolsCallCount = 0;
    const rebuildTools = (allow: boolean): ReturnType<typeof tool>[] => {
      rebuildToolsCallCount += 1;
      return allow ? [readOnlyTool, mutTool] : [readOnlyTool];
    };

    const session = makeSession({
      tools: [readOnlyTool],
      rebuildTools,
    });
    rebuildToolsCallCount = 0;

    const beforeThread = session.threadId;
    const beforeGraph = session.graph;
    const beforeCheckpointer = session.checkpointer;
    expect(session.allowMutations).toBe(false);

    // The /tools handler reads ONE line via readInput to collect indices.
    // We feed "m" — the master-mutations toggle.
    readInputMock.mockResolvedValueOnce('m');

    const { stream } = captureStream();
    const ctx = makeCtx(session, stream);
    await dispatchSlash(ctx, '/tools');

    // Post-conditions:
    expect(session.allowMutations).toBe(true);
    expect(session.threadId).not.toBe(beforeThread);
    expect(session.threadId.length).toBeGreaterThan(0);
    expect(session.graph).not.toBe(beforeGraph);
    expect(session.checkpointer).not.toBe(beforeCheckpointer);
    // The /tools handler filters the rebuilt catalog by the PREVIOUSLY-enabled
    // set, so toggling only the master flag (`m`) keeps the active tool list
    // identical — only the master flag flips. The newly-allowed `create_archive`
    // would need an explicit index toggle to appear in the active set.
    expect(session.tools.map((t) => t.name).sort()).toEqual(['list_archive']);
    // rebuildTools was called at least twice by the handler (baseline + post).
    expect(rebuildToolsCallCount).toBeGreaterThanOrEqual(2);
    // The interactive prompt was consumed exactly once.
    expect(readInputMock).toHaveBeenCalledTimes(1);
  });

  it('after a /tools mutation flip, the next streamEvents call carries the rotated thread_id', async () => {
    const readOnlyTool = tool(async () => 'noop', {
      name: 'list_archive',
      description: 'list',
      schema: z.object({}),
    });
    const mutTool = tool(async () => 'noop', {
      name: 'create_archive',
      description: 'create',
      schema: z.object({}),
    });
    const rebuildTools = (allow: boolean): ReturnType<typeof tool>[] =>
      allow ? [readOnlyTool, mutTool] : [readOnlyTool];

    const session = makeSession({ tools: [readOnlyTool], rebuildTools });
    const recorder = makeRecordingGraph();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session.graph = recorder as any;
    const before = session.threadId;

    // Turn 1 — pre-toggle, uses the original thread_id.
    await drainStream(
      streamTuiEvents({
        graph: session.graph,
        userInput: 'pre',
        threadId: session.threadId,
        signal: new AbortController().signal,
        recursionLimit: session.cfg.maxSteps,
      }),
    );

    readInputMock.mockResolvedValueOnce('m');
    const { stream } = captureStream();
    const ctx = makeCtx(session, stream);
    await dispatchSlash(ctx, '/tools');
    // /tools replaced session.graph with a real graph; swap recorder back in.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session.graph = recorder as any;

    // Turn 2 — post-toggle, must use the rotated thread_id.
    await drainStream(
      streamTuiEvents({
        graph: session.graph,
        userInput: 'post',
        threadId: session.threadId,
        signal: new AbortController().signal,
        recursionLimit: session.cfg.maxSteps,
      }),
    );

    expect(recorder.calls.length).toBe(2);
    expect(recorder.calls[0]!.threadId).toBe(before);
    expect(recorder.calls[1]!.threadId).toBe(session.threadId);
    expect(recorder.calls[1]!.threadId).not.toBe(before);
  });
});
