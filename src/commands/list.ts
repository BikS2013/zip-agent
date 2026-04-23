import { promises as fs } from 'node:fs';
import { IoError, UsageError } from '../util/errors';
import { resolveUserPath } from '../util/paths';
import { runOrThrow } from '../util/zip-runner';
import type { CommandDeps } from '../types';

export interface ListArgs {
  archive: string;
}
export interface ListOptions {
  /** When true, only return entry count without the entries array. */
  justCount?: boolean;
}

export interface ListEntry {
  name: string;
  size: number;
  compressedSize: number | null;
  modified: string | null;
  crc: string | null;
}

export interface ListResult {
  archive: string;
  entryCount: number;
  totalUncompressedSize: number;
  entries?: ListEntry[];
}

export async function run(
  deps: CommandDeps,
  args: ListArgs,
  opts: ListOptions = {},
): Promise<ListResult> {
  if (!args.archive) throw new UsageError('list: <archive> is required');
  const archivePath = resolveUserPath(deps.config.cwd, args.archive);
  await assertReadable(archivePath);

  const { stdout } = await runOrThrow(deps.zipRunner, deps.config.unzipBin, ['-l', archivePath]);
  const entries = parseUnzipL(stdout);
  const totalUncompressedSize = entries.reduce((acc, e) => acc + e.size, 0);

  const result: ListResult = {
    archive: archivePath,
    entryCount: entries.length,
    totalUncompressedSize,
  };
  if (!opts.justCount) result.entries = entries;
  return result;
}

async function assertReadable(p: string): Promise<void> {
  try {
    await fs.access(p, fs.constants.R_OK);
  } catch {
    throw new IoError(`Archive not readable: ${p}`);
  }
}

/**
 * Parse `unzip -l` output. The format:
 *   Archive:  foo.zip
 *     Length      Date    Time    Name
 *   ---------  ---------- -----   ----
 *         123  2026-01-02 03:04   path/to/file
 *   ...
 *   ---------                     -------
 *         123                     1 file
 */
export function parseUnzipL(stdout: string): ListEntry[] {
  const lines = stdout.split('\n');
  const entries: ListEntry[] = [];
  let inBody = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (/^---------/.test(line)) {
      inBody = !inBody;
      continue;
    }
    if (!inBody) continue;
    // Two date orderings exist in the wild: macOS unzip emits `MM-DD-YYYY`,
    // Info-ZIP on Linux emits `YYYY-MM-DD`. Accept either by matching the
    // generic shape `\d+-\d+-\d+ HH:MM`.
    const m = line.match(/^\s*(\d+)\s+(\d{2,4}-\d{2}-\d{2,4}\s+\d{2}:\d{2})\s+(.+?)\s*$/);
    if (!m) continue;
    entries.push({
      name: m[3]!,
      size: Number(m[1]!),
      compressedSize: null,
      modified: m[2]!,
      crc: null,
    });
  }
  return entries;
}
