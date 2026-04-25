/**
 * slash-commands.ts — every slash command the TUI understands lives here.
 *
 * Each handler implements `SlashCommandHandler` and is registered in the
 * `SLASH_COMMANDS` array at the bottom of the file. The dispatcher (also
 * here) does case-sensitive matching on the leading token; everything after
 * is split on whitespace and passed as `args`.
 *
 * Per spec §18: case-sensitive — `/Help` is unknown, not a typo accepted as
 * `/help`. This matches the reference implementation; user reports of
 * "/Quit was sent as a prompt" are by design.
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { MemorySaver } from '@langchain/langgraph';

import { ConfigurationError } from '../../util/errors';
import { createAgentGraph } from '../graph';
import { getProvider } from '../providers/registry';
import type { AgentConfig, ProviderName } from '../../config/agent-config';
import { copyToClipboard } from './clipboard';
import {
  listThreads,
  loadTranscript,
  memoryPath,
  readMemory,
  saveTranscript,
  writeTuiConfig,
  readTuiConfig,
  writeMemory,
} from './persistence';
import { CYAN, DIM, GREEN, RED, RESET, YELLOW } from './ansi';
import type { SlashCommandHandler, SlashContext, SlashResult } from './types';
import { readInput } from './input';

// ---------------------------------------------------------------------------
// Helper used by /new, /history → fresh thread id
// ---------------------------------------------------------------------------

export function generateThreadId(): string {
  return `zip-agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// /help
// ---------------------------------------------------------------------------

const HELP: SlashCommandHandler = {
  name: '/help',
  description: 'Show this help text.',
  async run(ctx: SlashContext): Promise<SlashResult> {
    const out = ctx.session.stdout;
    out.write(`${DIM}Slash commands (case-sensitive):${RESET}\n`);
    for (const c of SLASH_COMMANDS) {
      const aliases = c.aliases?.length ? ` (alias ${c.aliases.join(' ')})` : '';
      out.write(`  ${c.name.padEnd(12)}${aliases.padEnd(18)} ${c.description}\n`);
    }
    out.write(
      `\n${DIM}Keybindings:\n` +
        `  Enter             submit\n` +
        `  Shift+Enter       newline (terminal-dependent — see note below)\n` +
        `  Ctrl+J            newline (universal fallback — works on every terminal)\n` +
        `  Arrow keys        cursor / history\n` +
        `  Ctrl+A / Ctrl+E   start / end of line\n` +
        `  Ctrl+W            delete word back\n` +
        `  Ctrl+U / Ctrl+K   delete to start / end of line\n` +
        `  Ctrl+L            clear screen\n` +
        `  ESC (idle)        clear current input (no-op when empty)\n` +
        `  ESC (streaming)   abort the in-flight turn\n` +
        `  Ctrl+C            cancel input / abort turn\n` +
        `  Ctrl+D            exit on empty input${RESET}\n`,
    );
    out.write(
      `\n${DIM}Note: Shift+Enter is unreliable across terminals — most send plain CR.\n` +
        `If Shift+Enter submits instead of inserting a newline, use Ctrl+J.${RESET}\n`,
    );
    return { kind: 'continue' };
  },
};

// ---------------------------------------------------------------------------
// /quit (alias /exit)
// ---------------------------------------------------------------------------

const QUIT: SlashCommandHandler = {
  name: '/quit',
  aliases: ['/exit'],
  description: 'Leave the TUI.',
  async run(ctx: SlashContext): Promise<SlashResult> {
    ctx.session.stdout.write(`${DIM}bye.${RESET}\n`);
    return { kind: 'quit' };
  },
};

// ---------------------------------------------------------------------------
// /new (alias /reset)
// ---------------------------------------------------------------------------

const NEW: SlashCommandHandler = {
  name: '/new',
  aliases: ['/reset'],
  description: 'Start a fresh thread (new thread_id, clean checkpointer; memory.md kept).',
  async run(ctx: SlashContext): Promise<SlashResult> {
    const { session } = ctx;
    // Persist the OLD thread before discarding it, so /history can find it later.
    await persistCurrentThread(session.threadId, session);

    const newId = generateThreadId();
    session.threadId = newId;
    session.messages = [];
    // Rebuild graph with a fresh checkpointer so prior tool_calls don't leak.
    // The checkpointer field on the session must be replaced too, otherwise
    // the next turn would still load the OLD thread state from the OLD saver
    // (the old saver is bound by reference to session.graph until we swap it).
    session.checkpointer = new MemorySaver();
    session.graph = createAgentGraph({
      model: session.model,
      tools: session.tools,
      systemPrompt: session.systemPrompt,
      checkpointer: session.checkpointer,
    });
    ctx.printSystem(`new thread ${newId} (memory.md kept; previous transcript saved)`);
    return { kind: 'continue' };
  },
};

// ---------------------------------------------------------------------------
// /clear
// ---------------------------------------------------------------------------

const CLEAR: SlashCommandHandler = {
  name: '/clear',
  description: 'Clear the visible terminal (in-memory thread is kept).',
  async run(ctx: SlashContext): Promise<SlashResult> {
    ctx.session.stdout.write('\x1b[2J\x1b[H');
    return { kind: 'continue' };
  },
};

// ---------------------------------------------------------------------------
// /last (alias /raw)
// ---------------------------------------------------------------------------

const LAST: SlashCommandHandler = {
  name: '/last',
  aliases: ['/raw'],
  description: 'Re-print the last assistant message in full.',
  async run(ctx: SlashContext): Promise<SlashResult> {
    const last = [...ctx.session.messages].reverse().find((m) => m.role === 'assistant');
    if (!last) {
      ctx.printSystem('no assistant turn yet');
      return { kind: 'continue' };
    }
    ctx.session.stdout.write(`${DIM}---${RESET}\n${last.content}\n${DIM}---${RESET}\n`);
    return { kind: 'continue' };
  },
};

// ---------------------------------------------------------------------------
// /copy
// ---------------------------------------------------------------------------

const COPY: SlashCommandHandler = {
  name: '/copy',
  description: 'Copy the last assistant response to the system clipboard.',
  async run(ctx: SlashContext): Promise<SlashResult> {
    const last = [...ctx.session.messages].reverse().find((m) => m.role === 'assistant');
    if (!last) {
      ctx.printSystem('nothing to copy — no assistant turn yet');
      return { kind: 'continue' };
    }
    const result = await copyToClipboard(last.content);
    if (result.copied) {
      ctx.printSystem(`copied to clipboard via ${result.via}`);
    } else if (result.fallbackPath) {
      ctx.printSystem(
        `clipboard not available; wrote response to ${result.fallbackPath} (cat to read).`,
      );
    } else {
      ctx.printSystem(`copy failed: ${result.error ?? 'unknown error'}`);
    }
    return { kind: 'continue' };
  },
};

// ---------------------------------------------------------------------------
// /memory
// ---------------------------------------------------------------------------

const MEMORY: SlashCommandHandler = {
  name: '/memory',
  description: 'Open ~/.tool-agents/zip-agent/memory.md in $EDITOR (or print inline).',
  async run(ctx: SlashContext): Promise<SlashResult> {
    const file = memoryPath();
    const editor = process.env['EDITOR'] ?? process.env['VISUAL'];
    if (!editor) {
      const content = await readMemory();
      ctx.session.stdout.write(
        `${DIM}--- ${file} (\$EDITOR not set; printing inline) ---${RESET}\n` +
          (content || `(empty)\n`) +
          `${DIM}---${RESET}\n`,
      );
      return { kind: 'continue' };
    }
    // Hand the terminal over to $EDITOR. We're inside the slash dispatcher;
    // the reader has paused stdin already (cleanup in input.ts).
    await spawnEditor(editor, file);
    // Reload (the editor may have changed it).
    const content = await readMemory();
    ctx.printSystem(`memory.md reloaded (${content.length} bytes)`);
    return { kind: 'continue' };
  },
};

// ---------------------------------------------------------------------------
// /system
// ---------------------------------------------------------------------------

const SYSTEM: SlashCommandHandler = {
  name: '/system',
  description: 'View the current system prompt; press e to edit (in-memory only).',
  async run(ctx: SlashContext): Promise<SlashResult> {
    const out = ctx.session.stdout;
    out.write(`${DIM}--- system prompt (${ctx.session.systemPrompt.length} chars) ---${RESET}\n`);
    out.write(ctx.session.systemPrompt + '\n');
    out.write(`${DIM}---${RESET}\n`);
    out.write(`${DIM}Press e then Enter to edit in \$EDITOR (in-memory only); any other key skips.${RESET} `);
    const text = await readInput({
      prompt: '',
      continuationPrompt: '',
      inputHistory: [],
      stdin: ctx.session.stdin,
      stdout: ctx.session.stdout,
    }).catch(() => '');
    if (text.trim() !== 'e') return { kind: 'continue' };

    const editor = process.env['EDITOR'] ?? process.env['VISUAL'];
    if (!editor) {
      ctx.printSystem('$EDITOR is not set; cannot open an editor.');
      return { kind: 'continue' };
    }
    // Write current prompt to a tmp file, edit, read back. NEVER persist to disk
    // beyond the tmp file (which lives in os.tmpdir()).
    const tmp = path.join(os.tmpdir(), `zip-agent-system-${Date.now()}.md`);
    await fs.writeFile(tmp, ctx.session.systemPrompt, { mode: 0o600 });
    await spawnEditor(editor, tmp);
    try {
      const next = await fs.readFile(tmp, 'utf8');
      ctx.session.systemPrompt = next;
      // Rebuild the graph so the new prompt takes effect on the next turn.
      // Rotate the checkpointer + thread id too: the prior checkpointed
      // messages were produced under the OLD system prompt, and replaying
      // them under the new one would be semantically inconsistent (and the
      // first turn after the edit would still see the old context).
      await persistCurrentThread(ctx.session.threadId, ctx.session);
      ctx.session.checkpointer = new MemorySaver();
      ctx.session.graph = createAgentGraph({
        model: ctx.session.model,
        tools: ctx.session.tools,
        systemPrompt: next,
        checkpointer: ctx.session.checkpointer,
      });
      ctx.session.threadId = generateThreadId();
      ctx.session.messages = [];
      ctx.printSystem(
        `system prompt updated in-memory (${next.length} chars). ` +
          `NOT saved to disk. Thread reset (memory reset).`,
      );
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
    return { kind: 'continue' };
  },
};

// ---------------------------------------------------------------------------
// /tools
// ---------------------------------------------------------------------------

const TOOLS: SlashCommandHandler = {
  name: '/tools',
  description: 'Toggle individual tools / mutations master. Type indices to flip; Enter to confirm.',
  async run(ctx: SlashContext): Promise<SlashResult> {
    const { session } = ctx;
    const out = session.stdout;
    if (!session.rebuildTools) {
      ctx.printSystem('rebuildTools callback not provided — tool toggles unavailable.');
      return { kind: 'continue' };
    }

    out.write(`${DIM}Current catalog (master mutations: ${session.allowMutations ? 'ON' : 'OFF'}):${RESET}\n`);
    const baseline = session.rebuildTools(true); // get the full universe
    const enabled = new Set(session.tools.map((t) => t.name));

    baseline.forEach((t, i) => {
      const mark = enabled.has(t.name) ? `${GREEN}[x]${RESET}` : `${DIM}[ ]${RESET}`;
      const desc = (t.description ?? '').split('\n')[0] ?? '';
      out.write(`  ${String(i + 1).padStart(2)}. ${mark} ${t.name.padEnd(22)} ${DIM}${desc}${RESET}\n`);
    });
    out.write(
      `   m. ${session.allowMutations ? `${GREEN}[x]${RESET}` : `${DIM}[ ]${RESET}`} ` +
        `${YELLOW}--allow-mutations${RESET} (master switch for create/extract/add/remove)\n`,
    );
    out.write(
      `${DIM}Type space-separated indices to toggle (e.g. "1 3 m"), or Enter to keep as-is.${RESET}\n`,
    );

    const reply = await readInput({
      prompt: `${GREEN}toggle>${RESET} `,
      continuationPrompt: `${GREEN}     ..${RESET} `,
      inputHistory: [],
      stdin: session.stdin,
      stdout: session.stdout,
    }).catch(() => '');

    const tokens = reply.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      ctx.printSystem('no changes.');
      return { kind: 'continue' };
    }

    let nextAllowMut = session.allowMutations;
    for (const tk of tokens) {
      if (tk === 'm') {
        nextAllowMut = !nextAllowMut;
        continue;
      }
      const idx = Number.parseInt(tk, 10);
      if (!Number.isFinite(idx) || idx < 1 || idx > baseline.length) {
        ctx.printSystem(`ignored token "${tk}" (not a valid index)`);
        continue;
      }
      const name = baseline[idx - 1]!.name;
      if (enabled.has(name)) enabled.delete(name);
      else enabled.add(name);
    }

    // Rebuild the catalog using the master switch + the enabled set.
    let nextCatalog = session.rebuildTools(nextAllowMut);
    nextCatalog = nextCatalog.filter((t) => enabled.has(t.name));

    // Detect whether the catalog actually changed (set inequality on the
    // tool-name multiset), and whether the master switch flipped. ANY change
    // means we MUST reset the thread because checkpointed assistant turns
    // may reference tool_call ids whose tool no longer exists in the catalog
    // — LangGraph would surface that as a dangling tool_call on the next
    // turn. Bug fixed in plan-004-tui.md round 2.
    const prevNames = new Set(session.tools.map((t) => t.name));
    const nextNames = new Set(nextCatalog.map((t) => t.name));
    const catalogChanged =
      prevNames.size !== nextNames.size ||
      [...prevNames].some((n) => !nextNames.has(n));
    const mutationsFlipped = nextAllowMut !== session.allowMutations;
    const mustReset = catalogChanged || mutationsFlipped;

    if (mustReset) {
      await persistCurrentThread(session.threadId, session);
      session.threadId = generateThreadId();
      session.messages = [];
      session.checkpointer = new MemorySaver();
    }

    session.tools = nextCatalog;
    session.allowMutations = nextAllowMut;
    session.graph = createAgentGraph({
      model: session.model,
      tools: nextCatalog,
      systemPrompt: session.systemPrompt,
      checkpointer: session.checkpointer,
    });

    // Persist mutations preference to tui-config.json (model override is
    // handled by /model).
    const tc = await readTuiConfig();
    tc.defaultMutations = nextAllowMut;
    await writeTuiConfig(tc);

    ctx.printSystem(
      `tools now: ${nextCatalog.map((t) => t.name).join(', ') || '(none)'} ` +
        `[${nextAllowMut ? 'MUTATIONS ENABLED' : 'READ-ONLY'}]` +
        (mustReset ? ' — thread reset (memory reset)' : ''),
    );
    return { kind: 'continue' };
  },
};

// ---------------------------------------------------------------------------
// /history
// ---------------------------------------------------------------------------

const HISTORY: SlashCommandHandler = {
  name: '/history',
  description: 'List past threads; type the index to load one.',
  async run(ctx: SlashContext): Promise<SlashResult> {
    const summaries = await listThreads();
    if (summaries.length === 0) {
      ctx.printSystem('no past threads on disk yet.');
      return { kind: 'continue' };
    }
    const out = ctx.session.stdout;
    summaries.forEach((s, i) => {
      const date = new Date(s.updatedAt).toISOString().slice(0, 16).replace('T', ' ');
      out.write(
        `  ${String(i + 1).padStart(2)}. ${date}  ${DIM}${s.provider}/${s.model}${RESET}  ` +
          `${CYAN}${s.threadId}${RESET}  (${s.messageCount} msgs)\n` +
          `      ${DIM}${s.firstPrompt || '(no prompt)'}${RESET}\n`,
      );
    });
    out.write(`${DIM}Type the index to load (Enter for none):${RESET} `);
    const reply = await readInput({
      prompt: '',
      continuationPrompt: '',
      inputHistory: [],
      stdin: ctx.session.stdin,
      stdout: ctx.session.stdout,
    }).catch(() => '');
    const idx = Number.parseInt(reply.trim(), 10);
    if (!Number.isFinite(idx) || idx < 1 || idx > summaries.length) {
      ctx.printSystem('no thread loaded.');
      return { kind: 'continue' };
    }
    const target = summaries[idx - 1]!;
    const t = await loadTranscript(target.threadId);
    if (!t) {
      ctx.printSystem(`could not load thread ${target.threadId}`);
      return { kind: 'continue' };
    }
    // Persist current thread, swap to the loaded one. The LangGraph
    // checkpointer is in-process MemorySaver-bound; we mint a FRESH one
    // (so the new thread id has no leftover checkpoint from the old one)
    // and rebuild the graph against it. The loaded local-message mirror
    // is what /last and /copy serve from; the LLM context for the next
    // turn starts empty (documented in the printed hint below).
    await persistCurrentThread(ctx.session.threadId, ctx.session);
    ctx.session.threadId = t.threadId;
    ctx.session.messages = [...t.messages];
    ctx.session.checkpointer = new MemorySaver();
    ctx.session.graph = createAgentGraph({
      model: ctx.session.model,
      tools: ctx.session.tools,
      systemPrompt: ctx.session.systemPrompt,
      checkpointer: ctx.session.checkpointer,
    });
    ctx.printSystem(
      `loaded ${t.threadId} (${t.messages.length} msgs). ` +
        `Note: LLM-side checkpointer state is not restored; the next turn starts fresh ` +
        `but your local transcript is intact. Use /last to reprint the prior reply.`,
    );
    return { kind: 'continue' };
  },
};

// ---------------------------------------------------------------------------
// /model
// ---------------------------------------------------------------------------

const PROVIDER_NAMES: readonly ProviderName[] = [
  'openai',
  'anthropic',
  'google',
  'azure-openai',
  'azure-anthropic',
  'azure-deepseek',
  'local-openai',
];

const MODEL: SlashCommandHandler = {
  name: '/model',
  description: 'Switch provider/model at runtime. Validates required env vars.',
  async run(ctx: SlashContext): Promise<SlashResult> {
    const out = ctx.session.stdout;
    const cur = ctx.session.cfg;
    out.write(
      `${DIM}Current: ${cur.provider}/${cur.model} (temperature=${cur.temperature}).${RESET}\n` +
        `${DIM}Pick a provider:${RESET}\n`,
    );
    PROVIDER_NAMES.forEach((p, i) => {
      const marker = p === cur.provider ? `${GREEN}*${RESET}` : ' ';
      out.write(`  ${marker} ${String(i + 1).padStart(2)}. ${p}\n`);
    });
    out.write(`${DIM}Enter the number (or Enter to cancel):${RESET} `);

    const pickRaw = await readInput({
      prompt: '',
      continuationPrompt: '',
      inputHistory: [],
      stdin: ctx.session.stdin,
      stdout: ctx.session.stdout,
    }).catch(() => '');
    const pickIdx = Number.parseInt(pickRaw.trim(), 10);
    if (!Number.isFinite(pickIdx) || pickIdx < 1 || pickIdx > PROVIDER_NAMES.length) {
      ctx.printSystem('cancelled.');
      return { kind: 'continue' };
    }
    const provider = PROVIDER_NAMES[pickIdx - 1]!;

    out.write(`${DIM}Model id (current "${cur.model}"; Enter to keep):${RESET} `);
    const modelRaw = await readInput({
      prompt: '',
      continuationPrompt: '',
      inputHistory: [],
      stdin: ctx.session.stdin,
      stdout: ctx.session.stdout,
    }).catch(() => '');
    const model = modelRaw.trim() || cur.model;

    // Build a candidate config with the same providerEnv snapshot as the
    // current session — we don't re-read env mid-session, so the user's
    // existing env vars carry over.
    const nextCfg: AgentConfig = Object.freeze({
      ...cur,
      provider,
      model,
    }) as AgentConfig;

    let nextModel;
    try {
      nextModel = getProvider(provider)(nextCfg);
    } catch (err) {
      if (err instanceof ConfigurationError) {
        // Hard project rule: NEVER fall back. Surface and bail.
        ctx.printSystem(
          `${RED}cannot switch:${RESET} ${err.message}\n` +
            `Fix the missing env var and retry. The current model is unchanged.`,
        );
        return { kind: 'continue' };
      }
      throw err;
    }

    // Persist the new model + its provider for next session — but ONLY the
    // override fields. Env vars stay where the user keeps them.
    const tc = await readTuiConfig();
    tc.providerOverride = provider;
    tc.modelOverride = model;
    await writeTuiConfig(tc);

    // Save the prior thread, then swap. The model handle changes, so the
    // checkpointer must rotate too: prior message ids in the saver were
    // produced by the old model and re-feeding them as context would
    // misattribute. Mirrors the legacy REPL at run.ts:232 / 249.
    await persistCurrentThread(ctx.session.threadId, ctx.session);
    ctx.session.cfg = nextCfg;
    ctx.session.model = nextModel;
    ctx.session.checkpointer = new MemorySaver();
    ctx.session.graph = createAgentGraph({
      model: nextModel,
      tools: ctx.session.tools,
      systemPrompt: ctx.session.systemPrompt,
      checkpointer: ctx.session.checkpointer,
    });
    ctx.session.threadId = generateThreadId();
    ctx.session.messages = [];
    ctx.printSystem(
      `model switched to ${provider}/${model}. Thread reset (memory reset).`,
    );
    return { kind: 'continue' };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SLASH_COMMANDS: readonly SlashCommandHandler[] = Object.freeze([
  HELP,
  HISTORY,
  MEMORY,
  NEW,
  QUIT,
  LAST,
  COPY,
  MODEL,
  TOOLS,
  SYSTEM,
  CLEAR,
]);

/**
 * Look up a handler by typed slash-token. Case-sensitive — `/Help` returns
 * undefined. Aliases are honoured.
 */
export function findSlashCommand(token: string): SlashCommandHandler | undefined {
  for (const c of SLASH_COMMANDS) {
    if (c.name === token) return c;
    if (c.aliases?.includes(token)) return c;
  }
  return undefined;
}

/**
 * Dispatch a typed line that begins with `/`. Returns a SlashResult; when
 * the token is unknown, prints a [system] hint and returns `{kind:'continue'}`.
 */
export async function dispatchSlash(ctx: SlashContext, line: string): Promise<SlashResult> {
  const trimmed = line.trim();
  const parts = trimmed.split(/\s+/);
  const token = parts[0]!;
  const args = parts.slice(1);
  const handler = findSlashCommand(token);
  if (!handler) {
    ctx.printSystem(`unknown slash command "${token}". Try /help.`);
    return { kind: 'continue' };
  }
  return handler.run(ctx, args);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function persistCurrentThread(
  threadId: string,
  session: SlashContext['session'],
): Promise<void> {
  if (session.messages.length === 0) return;
  try {
    await saveTranscript({
      threadId,
      createdAt: session.messages[0]!.timestamp,
      updatedAt: Date.now(),
      provider: session.cfg.provider,
      model: session.cfg.model,
      messages: session.messages,
    });
  } catch {
    // Persistence is best-effort.
  }
}

/** Open `file` in `editor`, inheriting the current TTY so the editor can paint. */
function spawnEditor(editor: string, file: string): Promise<void> {
  return new Promise<void>((resolve) => {
    // The editor takes over stdin/stdout/stderr — once it exits we get them
    // back. The caller is expected to be between input.ts read calls.
    const child = spawn(editor, [file], { stdio: 'inherit' });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
}

// Re-export so consumers can also call writeMemory directly without
// importing from persistence.ts.
export { writeMemory };
