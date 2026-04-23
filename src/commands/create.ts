import { promises as fs } from 'node:fs';
import { CollisionError, UsageError } from '../util/errors';
import { resolveUserPath } from '../util/paths';
import { runOrThrow } from '../util/zip-runner';
import type { CommandDeps } from '../types';

export interface CreateArgs {
  archive: string;
  inputs: string[];
}
export interface CreateOptions {
  recurse?: boolean;        // -r (default true)
  exclude?: string[];       // -x patterns
  password?: string;        // -P  (NOTE: visible in process listings; warn user)
  force?: boolean;          // overwrite existing archive
  /** Idempotent re-create: if true and archive exists, delete then recreate. */
  idempotent?: boolean;
}

export interface CreateResult {
  archive: string;
  filesAdded: number;
  bytesIn: number;
  bytesOut: number;
  raw: string;
}

export async function run(
  deps: CommandDeps,
  args: CreateArgs,
  opts: CreateOptions = {},
): Promise<CreateResult> {
  if (!args.archive) throw new UsageError('create: <archive> is required');
  if (!args.inputs?.length) throw new UsageError('create: at least one input path is required');
  const archivePath = resolveUserPath(deps.config.cwd, args.archive);

  const exists = await fileExists(archivePath);
  if (exists) {
    if (opts.idempotent || opts.force) {
      await fs.rm(archivePath, { force: true });
    } else {
      throw new CollisionError(
        `Archive already exists: ${archivePath}. Re-run with --force or --idempotent.`,
      );
    }
  }

  const cliArgs: string[] = [];
  if (opts.recurse !== false) cliArgs.push('-r');
  if (opts.password) cliArgs.push('-P', opts.password);
  cliArgs.push(archivePath);
  cliArgs.push(...args.inputs.map((i) => resolveUserPath(deps.config.cwd, i)));
  if (opts.exclude?.length) {
    cliArgs.push('-x', ...opts.exclude);
  }

  const { stdout } = await runOrThrow(deps.zipRunner, deps.config.zipBin, cliArgs);

  const filesAdded = (stdout.match(/^\s*adding:/gm) ?? []).length;
  const stats = await fs.stat(archivePath).catch(() => null);
  return {
    archive: archivePath,
    filesAdded,
    bytesIn: 0,
    bytesOut: stats?.size ?? 0,
    raw: stdout,
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
