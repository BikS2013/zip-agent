import { promises as fs } from 'node:fs';
import { IoError, UsageError } from '../util/errors';
import { resolveUserPath } from '../util/paths';
import { runOrThrow } from '../util/zip-runner';
import type { CommandDeps } from '../types';

export interface TestArgs {
  archive: string;
}
export interface TestOptions {}

export interface TestResult {
  archive: string;
  ok: boolean;
  errors: string[];
  raw: string;
}

export async function run(
  deps: CommandDeps,
  args: TestArgs,
  _opts: TestOptions = {},
): Promise<TestResult> {
  if (!args.archive) throw new UsageError('test: <archive> is required');
  const archivePath = resolveUserPath(deps.config.cwd, args.archive);
  try {
    await fs.access(archivePath, fs.constants.R_OK);
  } catch {
    throw new IoError(`Archive not readable: ${archivePath}`);
  }

  // unzip -t exits 0 on success; 1 if warnings; 2+ on real errors. Accept
  // 0 and 1 as "we got output we can summarize" — the parser decides ok.
  const { stdout, exitCode } = await runOrThrow(
    deps.zipRunner,
    deps.config.unzipBin,
    ['-t', archivePath],
    { acceptableExitCodes: [0, 1, 2] },
  );

  const lines = stdout.split('\n');
  const errors: string[] = [];
  for (const line of lines) {
    // The summary line "No errors detected in compressed data of …" is a
    // success signal, not an error — skip lines that explicitly negate.
    if (/no errors? detected/i.test(line)) continue;
    if (/error|bad|incorrect|cannot/i.test(line)) errors.push(line.trim());
  }
  const ok = exitCode === 0 && errors.length === 0;

  return { archive: archivePath, ok, errors, raw: stdout };
}
