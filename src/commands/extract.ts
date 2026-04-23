import { promises as fs } from 'node:fs';
import { CollisionError, IoError, UsageError } from '../util/errors';
import { resolveUserPath } from '../util/paths';
import { runOrThrow } from '../util/zip-runner';
import type { CommandDeps } from '../types';

export interface ExtractArgs {
  archive: string;
}
export interface ExtractOptions {
  dest?: string;            // -d <dir>
  password?: string;        // -P
  include?: string[];       // positional file patterns to include
  force?: boolean;          // -o : overwrite existing files
  /** When true, allow overwrite (-o); when false, refuse on collision (-n). */
  noClobber?: boolean;
}

export interface ExtractResult {
  archive: string;
  dest: string;
  filesExtracted: number;
  raw: string;
}

export async function run(
  deps: CommandDeps,
  args: ExtractArgs,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  if (!args.archive) throw new UsageError('extract: <archive> is required');
  const archivePath = resolveUserPath(deps.config.cwd, args.archive);
  try {
    await fs.access(archivePath, fs.constants.R_OK);
  } catch {
    throw new IoError(`Archive not readable: ${archivePath}`);
  }
  const dest = resolveUserPath(deps.config.cwd, opts.dest ?? '.');
  await fs.mkdir(dest, { recursive: true });

  const cliArgs: string[] = [];
  if (opts.password) cliArgs.push('-P', opts.password);
  if (opts.force) {
    cliArgs.push('-o');
  } else if (opts.noClobber) {
    cliArgs.push('-n');
  }
  cliArgs.push(archivePath);
  if (opts.include?.length) cliArgs.push(...opts.include);
  cliArgs.push('-d', dest);

  // unzip exits 0 on success; 11 = "no matching files"; 80 = "user said no
  // to overwrite". Treat 80 as a collision when not forced.
  const { stdout, exitCode } = await runOrThrow(
    deps.zipRunner,
    deps.config.unzipBin,
    cliArgs,
    { acceptableExitCodes: [0, 11, 80] },
  );

  if (exitCode === 80 && !opts.force) {
    throw new CollisionError(
      `Existing files in ${dest} would be overwritten. Re-run with --force.`,
    );
  }

  const filesExtracted =
    (stdout.match(/^\s*(?:inflating|extracting):/gm) ?? []).length;

  return { archive: archivePath, dest, filesExtracted, raw: stdout };
}
