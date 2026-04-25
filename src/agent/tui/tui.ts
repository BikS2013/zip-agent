/**
 * tui.ts — main entry point for the raw-mode TUI.
 *
 * Drop-in replacement for `runInteractive` in src/agent/run.ts. Same
 * `RunInteractiveArgs`-shaped input so `src/commands/agent.ts` can switch
 * between the two with a single conditional and a `--legacy-repl` escape
 * hatch for one release cycle.
 *
 * The execution loop matches spec §8 verbatim:
 *
 *   1. read user input via the raw-mode reader
 *   2. trim; if empty, loop. If starts with /, dispatch slash command.
 *   3. mark turn start; spinner.start("Thinking...")
 *   4. for each TuiEvent from streaming.ts:
 *        on token   → spinner.stop(); print Agent header once; write text
 *        on tool_start → spinner.stop(); print "↳ calling foo(...)"
 *        on tool_end   → write " ✓"; spinner.start("Processing tool result...")
 *   5. spinner.stop(); newline; persist transcript; loop.
 *
 *   ESC and Ctrl+C during execution abort via AbortController. ESC at the
 *   prompt clears the in-progress input (handled inside readInput by the
 *   user typing Ctrl+U instead — ESC at idle here is a no-op so it does
 *   not exit the TUI). Ctrl+D on empty input rejects with EOF → quit.
 *
 * `unhandledRejection` is captured globally to swallow the "stream closed"
 * errors several providers emit when the user aborts mid-token.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { MemorySaver } from '@langchain/langgraph';

import type { AgentConfig } from '../../config/agent-config';
import type { AgentLogger } from '../logging';
import { createAgentGraph } from '../graph';

import {
  BOLD,
  CYAN,
  DIM,
  GREEN,
  RED,
  RESET,
  YELLOW,
} from './ansi';
import {
  DEFAULT_CONTINUATION_PROMPT,
  DEFAULT_PROMPT,
  readInput,
} from './input';
import { ensureTuiBootstrap, readTuiConfig, saveTranscript } from './persistence';
import { createSpinner } from './spinner';
import { streamTuiEvents } from './streaming';
import {
  dispatchSlash,
  generateThreadId,
} from './slash-commands';
import type { SlashContext, TuiSession } from './types';

export interface RunInteractiveTuiArgs {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  cfg: AgentConfig;
  logger: AgentLogger;
  rebuildTools?: (allowMutations: boolean) => StructuredToolInterface[];
  /** Test seam — defaults to process.stdin. */
  stdin?: NodeJS.ReadStream;
  /** Test seam — defaults to process.stdout. */
  stdout?: NodeJS.WritableStream;
  /** Test seam — when true, never call setRawMode (used in PassThrough tests). */
  bypassTtyCheck?: boolean;
}

export async function runInteractiveTui(args: RunInteractiveTuiArgs): Promise<void> {
  const stdin = args.stdin ?? (process.stdin as NodeJS.ReadStream);
  const stdout = args.stdout ?? process.stdout;

  // Spec §13: refuse to start in non-TTY contexts (piped stdin) — the raw-mode
  // reader cannot operate without a TTY. The test harness explicitly opts out.
  if (!args.bypassTtyCheck && !stdin.isTTY) {
    stdout.write(`${RED}error:${RESET} interactive TUI requires a TTY (stdin is piped).\n`);
    stdout.write(
      `${DIM}Tip: drop -i to use one-shot mode, or pipe via a PTY (script -q ...).${RESET}\n`,
    );
    return;
  }

  // Bootstrap persistence; warnings are non-fatal.
  const boot = ensureTuiBootstrap();
  for (const w of boot.warnings) {
    stdout.write(`${YELLOW}[warn]${RESET} ${w}\n`);
  }

  // Apply persisted preferences (mutations default; the actual provider/model
  // override has already been resolved by loadAgentConfig before we got here,
  // so we only honour defaultMutations here).
  const tcfg = await readTuiConfig();
  const initialAllowMut = tcfg.defaultMutations || args.cfg.allowMutations;
  let tools = args.tools;
  if (initialAllowMut !== args.cfg.allowMutations && args.rebuildTools) {
    tools = args.rebuildTools(initialAllowMut);
  }

  // Build the per-session checkpointer ONCE and pair it with the initial
  // graph. Both are replaced in lockstep by /new, /model, /system, /history,
  // and a /tools mutation toggle (see slash-commands.ts). Plain turns reuse
  // both so LangGraph's checkpointer can load prior thread state on every
  // streamEvents call. Bug fixed in plan-004-tui.md round 2.
  const initialCheckpointer = new MemorySaver();
  const session: TuiSession = {
    graph: createAgentGraph({
      model: args.model,
      tools,
      systemPrompt: args.systemPrompt,
      checkpointer: initialCheckpointer,
    }),
    checkpointer: initialCheckpointer,
    model: args.model,
    tools,
    cfg: { ...args.cfg, allowMutations: initialAllowMut } as AgentConfig,
    systemPrompt: args.systemPrompt,
    threadId: generateThreadId(),
    messages: [],
    inputHistory: [],
    allowMutations: initialAllowMut,
    ...(args.rebuildTools ? { rebuildTools: args.rebuildTools } : {}),
    logger: args.logger,
    stdout,
    stdin,
  };

  // ---- banner -----------------------------------------------------------
  stdout.write(
    `${BOLD}zip-agent TUI${RESET} ${DIM}(LangGraph; raw-mode)${RESET}\n` +
      `${DIM}LLM:${RESET} ${session.cfg.provider}/${session.cfg.model}` +
      `${DIM} · temperature=${session.cfg.temperature}${RESET}\n` +
      `${DIM}Mode:${RESET} ${session.allowMutations ? `${YELLOW}[MUTATIONS ENABLED]${RESET}` : `${GREEN}[READ-ONLY]${RESET}`}\n` +
      `${DIM}Thread:${RESET} ${session.threadId}\n` +
      `${DIM}Tools (${session.tools.length}):${RESET} ${session.tools.map((t) => t.name).join(', ') || '(none)'}\n` +
      `${DIM}Commands: /help /history /memory /tools /model /system /new /last /copy /clear /quit${RESET}\n` +
      `${DIM}Shift+Enter inserts a newline; Ctrl+J is the universal fallback. ESC aborts a streaming turn.${RESET}\n`,
  );

  // Print the status bar once — see writeStatusBar for the layout.
  writeStatusBar(stdout, session);

  // ---- unhandledRejection guard ----------------------------------------
  const onUnhandled = (reason: unknown): void => {
    const msg = reason instanceof Error ? reason.message : String(reason ?? '');
    if (
      /Error reading from the stream/i.test(msg) ||
      /GoogleGenerativeAI/i.test(msg) ||
      /aborted/i.test(msg) ||
      /AbortError/i.test(msg)
    ) {
      // Provider-specific abort/stream-close noise. Swallow.
      return;
    }
    // Real surprise — surface it but don't crash the TUI.
    stdout.write(`${RED}[unhandledRejection]${RESET} ${msg}\n`);
  };
  process.on('unhandledRejection', onUnhandled);

  // ---- main loop --------------------------------------------------------
  try {
    while (true) {
      let line: string;
      try {
        line = await readInput({
          prompt: DEFAULT_PROMPT,
          continuationPrompt: DEFAULT_CONTINUATION_PROMPT,
          inputHistory: session.inputHistory,
          stdin,
          stdout,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (reason === 'EOF') {
          stdout.write(`${DIM}bye.${RESET}\n`);
          return;
        }
        if (reason === 'SIGINT') {
          stdout.write(`${DIM}(input cancelled)${RESET}\n`);
          continue;
        }
        throw err;
      }

      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      // Push to input history (suppress consecutive duplicates).
      if (session.inputHistory[session.inputHistory.length - 1] !== trimmed) {
        session.inputHistory.push(trimmed);
      }

      if (trimmed.startsWith('/')) {
        const ctx: SlashContext = makeSlashContext(session);
        const result = await dispatchSlash(ctx, trimmed);
        writeStatusBar(stdout, session);
        if (result.kind === 'quit') {
          // Persist before leaving.
          await persistOnExit(session);
          return;
        }
        continue;
      }

      // ---- agent turn -------------------------------------------------
      session.messages.push({
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      });

      const abort = new AbortController();
      const escListener = makeAbortListener(stdin, abort);
      stdin.on('data', escListener);
      // The reader has cleaned up raw mode; re-enable it here so ESC is a
      // single byte (0x1b) we can detect immediately. We must restore on
      // exit of this block.
      let restoreRaw = false;
      if (typeof stdin.setRawMode === 'function' && stdin.isTTY) {
        stdin.setRawMode(true);
        restoreRaw = true;
      }
      stdin.resume();

      const spinner = createSpinner('Thinking...', { out: stdout });
      // Move the cursor to a fresh line — the reader leaves the cursor at the
      // end of the prompt block.
      stdout.write('\n');
      spinner.start();

      let agentText = '';
      let headerPrinted = false;
      let lastWasToken = false;

      const printHeaderOnce = (): void => {
        if (headerPrinted) return;
        headerPrinted = true;
        stdout.write(`${BOLD}${CYAN}Agent${RESET} `);
      };

      // Invariant: every turn must carry a thread_id so the checkpointer
      // can load the prior state. If this is ever empty something earlier
      // in the slash-command flow forgot to rotate it — fail loud rather
      // than starting a silent zero-context turn.
      if (!session.threadId) {
        throw new Error(
          'TUI invariant violated: session.threadId is empty before streamEvents — ' +
            'a slash command must have cleared it without rotating in a new id.',
        );
      }

      try {
        for await (const ev of streamTuiEvents({
          graph: session.graph,
          userInput: trimmed,
          threadId: session.threadId,
          signal: abort.signal,
          recursionLimit: session.cfg.maxSteps,
        })) {
          if (abort.signal.aborted) break;

          if (ev.kind === 'token') {
            // Stop the spinner only when it's actually running. Without this
            // guard every token incurred a SAVE/CLEAR/RESTORE write that
            // wiped the streamed line under the cursor (bugfix round 1).
            if (spinner.isActive()) spinner.stop();
            printHeaderOnce();
            stdout.write(ev.text);
            agentText += ev.text;
            lastWasToken = true;
          } else if (ev.kind === 'tool_start') {
            if (spinner.isActive()) spinner.stop();
            printHeaderOnce();
            const argSnip = ev.argsPreview ? `(${ev.argsPreview})` : '(...)';
            stdout.write(`\n  ${DIM}↳ calling ${ev.name}${argSnip}${RESET}`);
            lastWasToken = false;
          } else if (ev.kind === 'tool_end') {
            const resSnip = ev.resultPreview ? ` → ${ev.resultPreview}` : '';
            stdout.write(` ${GREEN}✓${RESET}${DIM}${resSnip}${RESET}`);
            spinner.setLabel('Processing tool result...');
            spinner.start();
            lastWasToken = false;
          }
        }

        spinner.stop();
        if (abort.signal.aborted) {
          stdout.write(`\n${YELLOW}[interrupted]${RESET}\n`);
        } else {
          stdout.write(lastWasToken || headerPrinted ? '\n' : '');
          if (!headerPrinted) {
            // No content at all — surface that explicitly so the user
            // doesn't think the TUI is hung.
            stdout.write(`${DIM}(no response)${RESET}\n`);
          }
        }

        if (agentText.length > 0) {
          session.messages.push({
            role: 'assistant',
            content: agentText,
            timestamp: Date.now(),
          });
          // Roll the last-response sidecar so /copy and external tools have it.
          await rollLastResponseSafely(agentText);
        }
        // Best-effort persist after every turn so /history works across crashes.
        await persistOnExit(session);
      } catch (err) {
        spinner.stop();
        if (abort.signal.aborted) {
          stdout.write(`\n${YELLOW}[interrupted]${RESET}\n`);
        } else {
          const message = err instanceof Error ? err.message : String(err);
          stdout.write(`\n${RED}error:${RESET} ${message}\n`);
        }
      } finally {
        stdin.off('data', escListener);
        if (restoreRaw && typeof stdin.setRawMode === 'function') {
          stdin.setRawMode(false);
        }
        stdin.pause();
      }

      writeStatusBar(stdout, session);
    }
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSlashContext(session: TuiSession): SlashContext {
  return {
    session,
    printSystem(message: string) {
      session.stdout.write(`${YELLOW}[system]${RESET} ${DIM}${message}${RESET}\n`);
    },
    println(message: string) {
      session.stdout.write(message + '\n');
    },
  };
}

function writeStatusBar(out: NodeJS.WritableStream, session: TuiSession): void {
  const mode = session.allowMutations ? `${YELLOW}[MUTATIONS]${RESET}` : `${GREEN}[READ-ONLY]${RESET}`;
  const shortThread = session.threadId.split('-').pop() ?? session.threadId;
  out.write(
    `${DIM}${session.cfg.provider}/${session.cfg.model} · ${mode} ${DIM}· tools:${session.tools.length} · ` +
      `thread:${shortThread} · ESC=abort  /help${RESET}\n`,
  );
}

function makeAbortListener(stdin: NodeJS.ReadStream, abort: AbortController) {
  return (data: Buffer): void => {
    for (const b of data) {
      if (b === 0x1b /* ESC */ || b === 0x03 /* Ctrl+C */) {
        if (!abort.signal.aborted) abort.abort();
        return;
      }
    }
  };
}

async function persistOnExit(session: TuiSession): Promise<void> {
  if (session.messages.length === 0) return;
  try {
    await saveTranscript({
      threadId: session.threadId,
      createdAt: session.messages[0]!.timestamp,
      updatedAt: Date.now(),
      provider: session.cfg.provider,
      model: session.cfg.model,
      messages: session.messages,
    });
  } catch {
    /* persistence is best-effort */
  }
}

async function rollLastResponseSafely(text: string): Promise<void> {
  try {
    const { writeLastResponse } = await import('./persistence');
    await writeLastResponse(text);
  } catch {
    /* best-effort */
  }
}
