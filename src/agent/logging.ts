import { promises as fs } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { redactString } from '../util/redact';
import type { AgentConfig } from '../config/agent-config';

export interface AgentStep {
  index: number;
  tool?: string;
  args?: unknown;
  result?: string;
  reasoning?: string;
}

export interface AgentLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  step(s: AgentStep): void;
  close(): Promise<void>;
}

export interface AgentLoggerOptions {
  logFilePath?: string | null;
  quiet?: boolean;
  /** Stream to use for stderr-like writes (testability). */
  stderr?: NodeJS.WritableStream;
}

const PROMPT_INLINE_LIMIT = 2048;

export async function createAgentLogger(
  cfg: AgentConfig,
  opts: AgentLoggerOptions = {},
): Promise<AgentLogger> {
  const stderr = opts.stderr ?? process.stderr;
  const quiet = opts.quiet ?? false;
  const verbose = cfg.verbose;

  let fileHandle: FileHandle | null = null;
  if (opts.logFilePath) {
    // Ensure file exists with mode 0o600 before appending.
    await fs.writeFile(opts.logFilePath, '', { mode: 0o600, flag: 'a' });
    fileHandle = await open(opts.logFilePath, 'a');
  }

  const writeBoth = (line: string): void => {
    const safe = redactString(line);
    if (!quiet) stderr.write(safe + '\n');
    if (fileHandle) {
      fileHandle.write(safe + '\n').catch(() => {
        /* swallow — logging must not throw */
      });
    }
  };

  const stamp = (): string => `[${new Date().toISOString()}]`;

  return {
    info: (msg, meta) => writeBoth(`${stamp()} info ${formatLine(msg, meta)}`),
    warn: (msg, meta) => writeBoth(`${stamp()} warn ${formatLine(msg, meta)}`),
    error: (msg, meta) => writeBoth(`${stamp()} error ${formatLine(msg, meta)}`),
    step: (s) => {
      if (!verbose && !fileHandle) return;
      const argsStr = trimSerialized(s.args, 512);
      const resultStr = trimSerialized(s.result, 512);
      writeBoth(
        `${stamp()} step #${s.index} tool=${s.tool ?? '<none>'} args=${argsStr} result=${resultStr}`,
      );
    },
    close: async () => {
      if (fileHandle) {
        await fileHandle.close().catch(() => {
          /* ignore */
        });
        fileHandle = null;
      }
    },
  };
}

function formatLine(msg: string, meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return msg;
  return `${msg} ${trimSerialized(meta, 512)}`;
}

function trimSerialized(v: unknown, max: number): string {
  if (v === undefined) return '';
  let s: string;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(+${s.length - max} chars)`;
}

export function summarizePromptForLog(prompt: string): string {
  if (prompt.length <= PROMPT_INLINE_LIMIT) return prompt;
  return `<${PROMPT_INLINE_LIMIT}+B prompt, ${prompt.length} chars>`;
}
