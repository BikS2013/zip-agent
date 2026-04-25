/**
 * clipboard.ts — cross-platform clipboard write.
 *
 * Spec §13: never silent-fail. If no native clipboard binary is found, fall
 * back to writing the text to ~/.tool-agents/zip-agent/last-response.txt
 * (the same file `/copy` always rolls) and return that path so the caller
 * can tell the user where to grab it from.
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tuiHomePath } from './persistence';

export interface CopyResult {
  /** True when a native clipboard binary accepted the text. */
  copied: boolean;
  /** Path to the fallback file when copied=false. Always set when copied=false. */
  fallbackPath?: string;
  /** Name of the binary that was invoked when copied=true. */
  via?: string;
  /** Human-readable error message when copied=false and no fallback path either. */
  error?: string;
}

interface CmdSpec {
  bin: string;
  args: readonly string[];
}

/**
 * Determine which clipboard binary to use for the current platform. Returns
 * an ordered list — the dispatcher tries each in turn until one succeeds.
 *
 * macOS: pbcopy.
 * Linux: wl-copy (Wayland) → xclip → xsel (any of the three).
 * Windows / WSL: clip.exe (with absolute fallback for WSL).
 */
export function clipboardCandidates(platform: NodeJS.Platform = process.platform): CmdSpec[] {
  if (platform === 'darwin') {
    return [{ bin: 'pbcopy', args: [] }];
  }
  if (platform === 'win32') {
    return [{ bin: 'clip', args: [] }];
  }
  // Linux + WSL (which presents as 'linux' but has clip.exe in PATH).
  return [
    { bin: 'wl-copy', args: [] },
    { bin: 'xclip', args: ['-selection', 'clipboard'] },
    { bin: 'xsel', args: ['--clipboard', '--input'] },
    // WSL fallback — clip.exe at its absolute Windows path. Only reached
    // when none of the Linux clipboards work.
    { bin: '/mnt/c/Windows/System32/clip.exe', args: [] },
  ];
}

/**
 * Try to copy `text` to the system clipboard. Walks the platform candidate
 * list; on the first success, returns `{ copied: true, via }`. If every
 * candidate fails or is missing, writes the text to the rolling fallback
 * file and returns `{ copied: false, fallbackPath }`.
 *
 * Pure I/O — never throws. Spec §13: no silent failure.
 */
export async function copyToClipboard(
  text: string,
  opts: {
    candidates?: CmdSpec[];
    /** Inject a custom spawn for testing. */
    spawnImpl?: typeof spawn;
    /** Override the persistence root (used by tests). */
    fallbackDir?: string;
  } = {},
): Promise<CopyResult> {
  const candidates = opts.candidates ?? clipboardCandidates();
  const spawnFn = opts.spawnImpl ?? spawn;

  for (const cand of candidates) {
    try {
      const ok = await tryCopyVia(spawnFn, cand, text);
      if (ok) return { copied: true, via: cand.bin };
    } catch {
      // Fall through to next candidate.
    }
  }

  // All native binaries failed — write to the fallback file.
  const dir = opts.fallbackDir ?? tuiHomePath();
  const fallbackPath = path.join(dir, 'last-response.txt');
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fallbackPath, text, { mode: 0o600 });
    return { copied: false, fallbackPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { copied: false, error: `clipboard not available and fallback write failed: ${message}` };
  }
}

function tryCopyVia(
  spawnFn: typeof spawn,
  cmd: CmdSpec,
  text: string,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let child: ReturnType<typeof spawnFn>;
    try {
      child = spawnFn(cmd.bin, [...cmd.args], { stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      resolve(false);
      return;
    }
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
    try {
      child.stdin?.end(text, 'utf8');
    } catch {
      resolve(false);
    }
  });
}
