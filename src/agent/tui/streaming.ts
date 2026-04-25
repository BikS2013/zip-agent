/**
 * streaming.ts — adapter that turns LangGraph's v2 event stream into the
 * three-event TuiEvent contract from spec §4. LangGraph already emits these
 * events natively, so this layer is mostly filtering + type-narrowing +
 * AbortController plumbing.
 *
 * The TUI never imports LangGraph types directly outside this file; the
 * renderer in tui.ts only sees the TuiEvent shape from types.ts.
 */

import type { AgentGraph } from '../graph';
import type { TuiEvent } from './types';

const TOOL_PREVIEW_MAX = 120;

export interface StreamArgs {
  graph: AgentGraph;
  /** Just the new user message; the checkpointer carries history. */
  userInput: string;
  threadId: string;
  /** Aborts the underlying graph stream when the user presses ESC. */
  signal: AbortSignal;
  /** Recursion limit (== max ReAct steps). */
  recursionLimit: number;
}

interface RawEvent {
  event?: string;
  name?: string;
  data?: {
    chunk?: { content?: unknown };
    input?: unknown;
    output?: unknown;
  };
}

/**
 * Yield TuiEvents for a single agent turn. The caller awaits the iterator
 * and renders each event as it arrives.
 *
 * Termination: the iterator completes when the LangGraph stream completes
 * naturally, when `signal.aborted` flips true (ESC), or when LangGraph
 * throws. Errors are re-raised — the caller's try/catch is responsible for
 * surfacing them.
 */
export async function* streamTuiEvents(args: StreamArgs): AsyncIterable<TuiEvent> {
  const { graph, userInput, threadId, signal, recursionLimit } = args;

  const input = { messages: [{ role: 'user' as const, content: userInput }] };
  const opts = {
    version: 'v2' as const,
    configurable: { thread_id: threadId },
    recursionLimit,
    signal,
  };

  // langchain v1's createAgent return value isn't strictly typed for
  // streamEvents in our wrapper; cast through unknown to the contract we
  // actually depend on.
  const stream = (
    graph as unknown as {
      streamEvents(input: unknown, opts: unknown): AsyncIterable<RawEvent>;
    }
  ).streamEvents(input, opts);

  for await (const ev of stream) {
    if (signal.aborted) return;
    const tui = mapEvent(ev);
    if (tui) yield tui;
  }
}

/**
 * Map one LangGraph v2 event to a TuiEvent (or null to drop). Extracted as
 * a pure function so tests can drive it with crafted event objects.
 */
export function mapEvent(ev: RawEvent): TuiEvent | null {
  switch (ev.event) {
    case 'on_chat_model_stream': {
      const text = stringifyContent(ev.data?.chunk?.content);
      if (text.length === 0) return null;
      return { kind: 'token', text };
    }
    case 'on_tool_start': {
      const name = ev.name ?? '<unknown>';
      const argsPreview = previewObject(unwrapToolInput(ev.data?.input));
      return { kind: 'tool_start', name, argsPreview };
    }
    case 'on_tool_end': {
      const resultPreview = previewObject(extractToolMessageContent(ev.data?.output));
      return { kind: 'tool_end', resultPreview };
    }
    default:
      return null;
  }
}

/**
 * Coerce a chat-message content value to a plain string. LangChain emits
 * either a string or an array of `{type:'text',text:...}` parts (Anthropic
 * tool-use uses the array shape). Same logic as src/agent/run.ts; kept local
 * so the TUI doesn't reach into another module's internals.
 */
export function stringifyContent(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const obj = part as { text?: unknown; content?: unknown };
          if (typeof obj.text === 'string') return obj.text;
          if (typeof obj.content === 'string') return obj.content;
        }
        return '';
      })
      .join('');
  }
  if (typeof content === 'object') {
    const obj = content as { text?: unknown; content?: unknown };
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.content === 'string') return obj.content;
  }
  return '';
}

/**
 * Unwrap a single-key `{ input: <args> }` wrapper that LangGraph emits for
 * tools whose schema was inferred from a single zod input field. The
 * structured args may live inside that wrapper either as a nested object or
 * as a JSON-encoded string. Both shapes show up in `on_tool_start.data.input`.
 *
 * Without this unwrap the breadcrumb shows e.g.
 *   `find_files({"input":"{\"path\":\"~/Downloads\",\"types\":...`
 * — i.e. the user sees the wrapper key plus an escaped JSON string instead of
 * the actual arguments. Pinned by `tui-streaming-render.spec.ts > unwraps a
 * single-key { input: <jsonString> | <object> } envelope before display`.
 *
 * Multi-key arg objects (the common case for tools with structured schemas)
 * pass through untouched.
 *
 * Exported for test isolation.
 */
export function unwrapToolInput(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'object') return v;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1 || keys[0] !== 'input') return v;
  const inner = obj['input'];
  // If inner is a JSON-shaped string, parse it. Strings that don't parse
  // as JSON are returned as-is — better to surface the raw string than to
  // throw away information.
  if (typeof inner === 'string') {
    const trimmed = inner.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        return inner;
      }
    }
    return inner;
  }
  return inner;
}

/**
 * If `v` looks like a LangChain `ToolMessage` (either a real instance or a
 * JSON-roundtripped LC envelope), return the message content. Otherwise
 * return `v` unchanged.
 *
 * The previous implementation called `JSON.stringify(toolMessage)` directly,
 * which invokes `BaseMessage.toJSON()` and produces the LC serialization
 * envelope `{lc:1,type:"constructor",id:["langchain_core","messages","ToolMessage"],kwargs:{...}}`.
 * That envelope shows up verbatim in the TUI breadcrumb, drowning the actual
 * tool result. Pinned by `tui-streaming-render.spec.ts > extracts content from
 * a real ToolMessage instance | JSON-roundtripped ToolMessage envelope`.
 *
 * Detection logic, in order:
 *   1. Native ToolMessage / BaseMessage (has `_getType()` returning "tool")
 *      → return `.content`.
 *   2. Plain object with `.content` and a `getType()`-like discriminator
 *      (`type === 'tool'` or `_getType` method) → return `.content`.
 *   3. LC envelope (`{lc:1, type:"constructor", id:[..., "ToolMessage"], kwargs:{content,...}}`)
 *      → return `.kwargs.content`.
 *   4. Anything else → return as-is.
 *
 * Exported for test isolation.
 */
export function extractToolMessageContent(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'object') return v;
  const obj = v as Record<string, unknown>;

  // Case 1+2: native or duck-typed BaseMessage with type='tool'. Both expose
  // `.content` directly. The LC class exposes `_getType()` (the canonical
  // API) and `getType()` (the wrapper). Some adapters surface `.type`.
  // Any of the three is enough to confirm this is a ToolMessage.
  const _getType = (obj as { _getType?: () => unknown })._getType;
  const getType = (obj as { getType?: () => unknown }).getType;
  const type = (obj as { type?: unknown }).type;
  const isToolMessage =
    (typeof _getType === 'function' && _getType.call(obj) === 'tool') ||
    (typeof getType === 'function' && getType.call(obj) === 'tool') ||
    type === 'tool';
  if ('content' in obj && isToolMessage) {
    return obj['content'];
  }

  // Case 3: LC serialization envelope.
  if (
    obj['lc'] === 1 &&
    obj['type'] === 'constructor' &&
    Array.isArray(obj['id']) &&
    (obj['id'] as unknown[]).includes('ToolMessage') &&
    obj['kwargs'] &&
    typeof obj['kwargs'] === 'object'
  ) {
    const kwargs = obj['kwargs'] as Record<string, unknown>;
    if ('content' in kwargs) return kwargs['content'];
  }

  return v;
}

/**
 * Render an arbitrary tool-call argument or result as a single-line preview,
 * truncated to TOOL_PREVIEW_MAX. JSON-shaped values get JSON.stringify;
 * primitives get String().
 *
 * For a `ToolMessage`-like value the caller must first run
 * `extractToolMessageContent()` so we don't end up serializing the LC
 * envelope. Likewise, single-key `{input: ...}` wrappers must be unwrapped
 * by the caller via `unwrapToolInput()` first.
 */
function previewObject(v: unknown): string {
  if (v === undefined || v === null) return '';
  let s: string;
  if (typeof v === 'string') {
    s = v;
  } else {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= TOOL_PREVIEW_MAX) return s;
  return s.slice(0, TOOL_PREVIEW_MAX - 1) + '…';
}
