import { promises as fs } from 'node:fs';
import { IoError, UsageError } from '../util/errors';
import { resolveUserPath } from '../util/paths';
import { runOrThrow } from '../util/zip-runner';
import type { CommandDeps } from '../types';

export interface RemoveArgs {
  archive: string;
  patterns: string[];
}
export interface RemoveOptions {}

export interface RemoveResult {
  archive: string;
  removed: number;
  raw: string;
}

export async function run(
  deps: CommandDeps,
  args: RemoveArgs,
  _opts: RemoveOptions = {},
): Promise<RemoveResult> {
  if (!args.archive) throw new UsageError('remove: <archive> is required');
  if (!args.patterns?.length) throw new UsageError('remove: at least one pattern is required');
  const archivePath = resolveUserPath(deps.config.cwd, args.archive);
  try {
    await fs.access(archivePath, fs.constants.W_OK | fs.constants.R_OK);
  } catch {
    throw new IoError(`Archive not writable: ${archivePath}`);
  }

  const cliArgs = ['-d', archivePath, ...args.patterns];
  // zip -d exits 12 when nothing matches; surface as removed:0.
  const { stdout, exitCode } = await runOrThrow(
    deps.zipRunner,
    deps.config.zipBin,
    cliArgs,
    { acceptableExitCodes: [0, 12] },
  );

  const removed =
    exitCode === 12 ? 0 : (stdout.match(/^\s*deleting:/gm) ?? []).length;

  return { archive: archivePath, removed, raw: stdout };
}
