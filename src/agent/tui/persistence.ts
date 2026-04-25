/**
 * persistence.ts — filesystem CRUD for the TUI's per-user state.
 *
 * Files live under ~/.tool-agents/zip-agent/ alongside the existing
 * `config` file (see src/util/env-loader.ts → GLOBAL_CONFIG_PATH).
 *
 *   memory.md                   long-term notes; opened in $EDITOR by /memory
 *   last-response.txt           rolling, single file; /copy fallback
 *   tui-config.json             last-used provider/model + default mutations
 *   threads/<thread_id>.json    per-thread transcript (load/list/save)
 *
 * Bootstrap is idempotent and follows the same warn-but-continue pattern
 * as `ensureGlobalConfigFile()` — permission errors never crash the TUI.
 *
 * The persistence root is overridable via the `ZIP_AGENT_TUI_HOME` env
 * var; setting `ZIP_AGENT_TUI_NO_PERSIST=1` makes every write a no-op
 * (used for piped invocations and the test harness).
 */

import { promises as fs, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ProviderName } from '../../config/agent-config';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Default root: ~/.tool-agents/zip-agent/ — same as the global config file. */
export function tuiHomePath(): string {
  const override = process.env['ZIP_AGENT_TUI_HOME'];
  if (override && override.length > 0) return override;
  return path.join(os.homedir(), '.tool-agents', 'zip-agent');
}

export function memoryPath(): string {
  return path.join(tuiHomePath(), 'memory.md');
}

export function lastResponsePath(): string {
  return path.join(tuiHomePath(), 'last-response.txt');
}

export function tuiConfigPath(): string {
  return path.join(tuiHomePath(), 'tui-config.json');
}

export function threadsDir(): string {
  return path.join(tuiHomePath(), 'threads');
}

export function threadFile(threadId: string): string {
  // Defensive: never let a thread id contain path separators.
  const safe = threadId.replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(threadsDir(), `${safe}.json`);
}

function persistenceDisabled(): boolean {
  return process.env['ZIP_AGENT_TUI_NO_PERSIST'] === '1';
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export interface BootstrapResult {
  readonly home: string;
  readonly created: string[];
  readonly warnings: string[];
}

const MEMORY_TEMPLATE = `# zip-agent memory

This file is your long-term scratchpad. The TUI does NOT inject it into the
LLM system prompt automatically — it is a place for YOU to keep notes about
how you want the agent to behave, references you frequently paste, etc.

Open this file from the TUI with /memory. Save and quit your editor; the
TUI will reload it on the next slash dispatch.
`;

const DEFAULT_TUI_CONFIG: TuiConfig = {
  defaultMutations: false,
  providerOverride: null,
  modelOverride: null,
};

/**
 * Ensure ~/.tool-agents/zip-agent/{memory.md,last-response.txt,tui-config.json,threads/}
 * exist. Idempotent: re-running on a fully-bootstrapped install is a few
 * cheap stat calls. Permission errors are collected as warnings, never thrown.
 */
export function ensureTuiBootstrap(): BootstrapResult {
  const home = tuiHomePath();
  const created: string[] = [];
  const warnings: string[] = [];

  if (persistenceDisabled()) {
    return { home, created, warnings };
  }

  const safeMkdir = (dir: string): void => {
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        created.push(dir);
      }
    } catch (err) {
      warnings.push(`could not create ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const safeSeed = (file: string, content: string): void => {
    if (existsSync(file)) return;
    try {
      // Use fs sync API + 'wx' so we never overwrite a concurrently-created file.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsSync = require('node:fs') as typeof import('node:fs');
      fsSync.writeFileSync(file, content, { mode: 0o600, flag: 'wx' });
      created.push(file);
    } catch (err) {
      // EEXIST = lost a race; treat as already there, not as a warning.
      if (err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') return;
      warnings.push(`could not seed ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  safeMkdir(home);
  safeMkdir(threadsDir());
  safeSeed(memoryPath(), MEMORY_TEMPLATE);
  safeSeed(lastResponsePath(), '');
  safeSeed(tuiConfigPath(), JSON.stringify(DEFAULT_TUI_CONFIG, null, 2) + '\n');

  return { home, created, warnings };
}

// ---------------------------------------------------------------------------
// memory.md
// ---------------------------------------------------------------------------

export async function readMemory(): Promise<string> {
  try {
    return await fs.readFile(memoryPath(), 'utf8');
  } catch {
    return '';
  }
}

export async function writeMemory(content: string): Promise<void> {
  if (persistenceDisabled()) return;
  await fs.mkdir(tuiHomePath(), { recursive: true });
  await fs.writeFile(memoryPath(), content, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// last-response.txt
// ---------------------------------------------------------------------------

export async function writeLastResponse(text: string): Promise<void> {
  if (persistenceDisabled()) return;
  await fs.mkdir(tuiHomePath(), { recursive: true });
  await fs.writeFile(lastResponsePath(), text, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// tui-config.json
// ---------------------------------------------------------------------------

export interface TuiConfig {
  defaultMutations: boolean;
  providerOverride: ProviderName | null;
  modelOverride: string | null;
}

export async function readTuiConfig(): Promise<TuiConfig> {
  try {
    const raw = await fs.readFile(tuiConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<TuiConfig>;
    return {
      defaultMutations: parsed.defaultMutations ?? DEFAULT_TUI_CONFIG.defaultMutations,
      providerOverride: parsed.providerOverride ?? DEFAULT_TUI_CONFIG.providerOverride,
      modelOverride: parsed.modelOverride ?? DEFAULT_TUI_CONFIG.modelOverride,
    };
  } catch {
    return { ...DEFAULT_TUI_CONFIG };
  }
}

export async function writeTuiConfig(cfg: TuiConfig): Promise<void> {
  if (persistenceDisabled()) return;
  await fs.mkdir(tuiHomePath(), { recursive: true });
  await fs.writeFile(tuiConfigPath(), JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Per-thread transcripts
// ---------------------------------------------------------------------------

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ThreadTranscript {
  threadId: string;
  createdAt: number;
  updatedAt: number;
  /** Provider/model snapshot at creation time, for /history display. */
  provider: string;
  model: string;
  messages: TranscriptMessage[];
}

export async function saveTranscript(t: ThreadTranscript): Promise<void> {
  if (persistenceDisabled()) return;
  await fs.mkdir(threadsDir(), { recursive: true });
  await fs.writeFile(threadFile(t.threadId), JSON.stringify(t, null, 2) + '\n', { mode: 0o600 });
}

export async function loadTranscript(threadId: string): Promise<ThreadTranscript | null> {
  try {
    const raw = await fs.readFile(threadFile(threadId), 'utf8');
    return JSON.parse(raw) as ThreadTranscript;
  } catch {
    return null;
  }
}

export interface ThreadSummary {
  threadId: string;
  updatedAt: number;
  provider: string;
  model: string;
  /** First user message, truncated to 80 chars. Empty if no messages. */
  firstPrompt: string;
  messageCount: number;
}

export async function listThreads(): Promise<ThreadSummary[]> {
  let names: string[];
  try {
    names = await fs.readdir(threadsDir());
  } catch {
    return [];
  }
  const out: ThreadSummary[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -'.json'.length);
    const t = await loadTranscript(id);
    if (!t) continue;
    const firstUser = t.messages.find((m) => m.role === 'user');
    out.push({
      threadId: t.threadId,
      updatedAt: t.updatedAt,
      provider: t.provider,
      model: t.model,
      firstPrompt: firstUser ? truncate(firstUser.content, 80) : '',
      messageCount: t.messages.length,
    });
  }
  // Newest first.
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

function truncate(s: string, n: number): string {
  const collapsed = s.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= n) return collapsed;
  return collapsed.slice(0, n - 1) + '…';
}
