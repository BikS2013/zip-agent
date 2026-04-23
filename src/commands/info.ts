import { promises as fs } from 'node:fs';
import { IoError, UsageError } from '../util/errors';
import { resolveUserPath } from '../util/paths';
import { runOrThrow } from '../util/zip-runner';
import type { CommandDeps } from '../types';

export interface InfoArgs {
  archive: string;
}
export interface InfoOptions {
  /** Pass `-v` (verbose). Default true; false yields the short table. */
  verboseInfo?: boolean;
}

export interface InfoResult {
  archive: string;
  raw: string;
  /** Best-effort top header (line(s) before the per-entry blocks). */
  header: string;
  /** Total entry count parsed from the trailer line. */
  entryCount: number | null;
}

export async function run(
  deps: CommandDeps,
  args: InfoArgs,
  opts: InfoOptions = {},
): Promise<InfoResult> {
  if (!args.archive) throw new UsageError('info: <archive> is required');
  const archivePath = resolveUserPath(deps.config.cwd, args.archive);
  try {
    await fs.access(archivePath, fs.constants.R_OK);
  } catch {
    throw new IoError(`Archive not readable: ${archivePath}`);
  }

  const flags = opts.verboseInfo === false ? [] : ['-v'];
  const { stdout } = await runOrThrow(deps.zipRunner, deps.config.zipinfoBin, [
    ...flags,
    archivePath,
  ]);

  return {
    archive: archivePath,
    raw: stdout,
    header: extractHeader(stdout),
    entryCount: extractEntryCount(stdout),
  };
}

function extractHeader(stdout: string): string {
  const lines = stdout.split('\n');
  const header: string[] = [];
  for (const line of lines) {
    if (/^\s*$/.test(line)) {
      if (header.length) break;
      continue;
    }
    header.push(line);
    if (header.length >= 4) break;
  }
  return header.join('\n');
}

function extractEntryCount(stdout: string): number | null {
  // zipinfo trailer typically ends with: "5 files, 12345 bytes uncompressed, ..."
  const m = stdout.match(/(\d+)\s+files?,\s+\d+\s+bytes/i);
  return m ? Number(m[1]!) : null;
}
