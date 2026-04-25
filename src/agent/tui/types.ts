/**
 * types.ts — shared TUI types. No runtime, no behaviour.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { MemorySaver } from '@langchain/langgraph';
import type { AgentConfig } from '../../config/agent-config';
import type { AgentLogger } from '../logging';
import type { AgentGraph } from '../graph';
import type { TranscriptMessage } from './persistence';

/**
 * The three TUI events the renderer cares about. Maps 1:1 onto the spec
 * §4 LangGraph v2 events; `streaming.ts` produces these so the renderer
 * never sees raw LangGraph types.
 */
export type TuiEvent =
  | { kind: 'token'; text: string }
  | { kind: 'tool_start'; name: string; argsPreview: string }
  | { kind: 'tool_end'; resultPreview: string };

/** Live local mirror of the conversation, used for /last and /copy. */
export interface LocalMessage extends TranscriptMessage {}

/**
 * Mutable session state owned by `tui.ts` and threaded into every slash
 * command. Slash commands mutate it in place via `setX` setters; the main
 * loop re-reads from it after each dispatch.
 */
export interface TuiSession {
  /** Current LangGraph agent. Replaced by /model and /tools. */
  graph: AgentGraph;
  /**
   * In-process checkpointer that backs `graph` for cross-turn memory inside
   * the session. The graph and checkpointer are paired: any time the graph
   * is rebuilt for a reason that resets the thread (`/new`, `/model`,
   * `/tools` mutation toggle, `/system` edit, `/history` load), a NEW
   * `MemorySaver` is constructed alongside it. Plain turns reuse both.
   *
   * Without this, every turn looks like a brand-new conversation to the LLM
   * — see plan-004-tui.md "Bugfix log — round 2".
   */
  checkpointer: MemorySaver;
  /** Current model handle. Replaced by /model. */
  model: BaseChatModel;
  /** Current tool catalog. Replaced by /tools. */
  tools: StructuredToolInterface[];
  /** Resolved config — frozen elsewhere; copied here so /model can mutate. */
  cfg: AgentConfig;
  /** System prompt currently in use; /system mutates this. */
  systemPrompt: string;
  /** Identifier passed to LangGraph as `configurable.thread_id`. */
  threadId: string;
  /** Local message mirror — the source of truth for /last, /copy, /history. */
  messages: LocalMessage[];
  /** In-memory readline-style history of submitted user inputs. */
  inputHistory: string[];
  /** Whether mutating tools are currently in the catalog. */
  allowMutations: boolean;
  /** Optional rebuild callback so /tools can swap the catalog. */
  rebuildTools?: (allowMutations: boolean) => StructuredToolInterface[];
  /** Logger from the host agent — info/warn/error are forwarded. */
  logger: AgentLogger;
  /** Stream descriptor — also used by /clear and the renderer. */
  stdout: NodeJS.WritableStream;
  stdin: NodeJS.ReadStream;
}

export interface SlashContext {
  session: TuiSession;
  /** Print a [system] line. */
  printSystem(message: string): void;
  /** Print a plain message (no [system] decoration). */
  println(message: string): void;
}

/**
 * Result of a slash dispatch. `quit` ends the loop. Anything else loops
 * back to the prompt.
 */
export type SlashResult = { kind: 'continue' } | { kind: 'quit' };

export interface SlashCommandHandler {
  /** Canonical name including the leading slash, e.g. "/help". */
  name: string;
  aliases?: readonly string[];
  /** One-line description for /help. */
  description: string;
  run(ctx: SlashContext, args: string[]): Promise<SlashResult>;
}
