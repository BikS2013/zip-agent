import { promises as fs } from 'node:fs';
import { IoError, UsageError } from '../util/errors';
import { resolveUserPath } from '../util/paths';
import { runOrThrow } from '../util/zip-runner';
import type { CommandDeps } from '../types';

export interface AddArgs {
  archive: string;
  files: string[];
}
export interface AddOptions {
  recurse?: boolean;
  password?: string;
}

export interface AddResult {
  archive: string;
  added: number;
  updated: number;
  raw: string;
}

export async function run(
  deps: CommandDeps,
  args: AddArgs,
  opts: AddOptions = {},
): Promise<AddResult> {
  if (!args.archive) throw new UsageError('add: <archive> is required');
  if (!args.files?.length) throw new UsageError('add: at least one file is required');
  const archivePath = resolveUserPath(deps.config.cwd, args.archive);
  try {
    await fs.access(archivePath, fs.constants.W_OK | fs.constants.R_OK);
  } catch {
    throw new IoError(`Archive not writable: ${archivePath}`);
  }

  const cliArgs: string[] = ['-u'];
  if (opts.recurse) cliArgs.push('-r');
  if (opts.password) cliArgs.push('-P', opts.password);
  cliArgs.push(archivePath);
  cliArgs.push(...args.files.map((f) => resolveUserPath(deps.config.cwd, f)));

  // `zip -u` exits 12 when nothing to update — treat as success with zero
  // added/updated.
  const { stdout, exitCode } = await runOrThrow(
    deps.zipRunner,
    deps.config.zipBin,
    cliArgs,
    { acceptableExitCodes: [0, 12] },
  );

  const added = (stdout.match(/^\s*adding:/gm) ?? []).length;
  const updated = (stdout.match(/^\s*updating:/gm) ?? []).length;

  return {
    archive: archivePath,
    added: exitCode === 12 ? 0 : added,
    updated: exitCode === 12 ? 0 : updated,
    raw: stdout,
  };
}
