import { spawn } from 'node:child_process';
import { IoError, UpstreamError } from './errors';

export interface ZipRunOptions {
  cwd?: string;
  /** stdin payload to pipe to the binary. Used by `zip -d` (rare). */
  stdin?: string;
  /** Hard byte cap on stdout/stderr buffers; default 64 MiB. */
  maxBufferBytes?: number;
}

export interface ZipRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Thin abstraction over child_process so commands stay testable. Production
 * implementation calls `spawn`; specs swap a fake.
 */
export interface ZipRunner {
  run(bin: string, args: readonly string[], opts?: ZipRunOptions): Promise<ZipRunResult>;
}

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

export class SpawnZipRunner implements ZipRunner {
  async run(bin: string, args: readonly string[], opts: ZipRunOptions = {}): Promise<ZipRunResult> {
    const maxBuffer = opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER;
    return new Promise<ZipRunResult>((resolve, reject) => {
      const child = spawn(bin, [...args], {
        cwd: opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdoutBytes = 0;
      let stderrBytes = 0;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const fail = (err: Error): void => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        reject(err);
      };

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > maxBuffer) {
          fail(new IoError(`stdout exceeded ${maxBuffer} bytes from ${bin}`));
          return;
        }
        stdoutChunks.push(chunk);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > maxBuffer) {
          fail(new IoError(`stderr exceeded ${maxBuffer} bytes from ${bin}`));
          return;
        }
        stderrChunks.push(chunk);
      });

      child.on('error', (err) => {
        // ENOENT etc. — binary not found.
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          fail(new IoError(`Binary not found: ${bin} (${err.message})`));
        } else {
          fail(new UpstreamError(`spawn ${bin} failed: ${err.message}`));
        }
      });

      child.on('close', (code) => {
        resolve({
          exitCode: code ?? -1,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
        });
      });

      if (opts.stdin !== undefined) {
        child.stdin.write(opts.stdin);
        child.stdin.end();
      } else {
        child.stdin.end();
      }
    });
  }
}

/**
 * Helper used by every command: run, then translate non-zero exit into
 * UpstreamError unless the caller declares the exit code is acceptable.
 */
export async function runOrThrow(
  runner: ZipRunner,
  bin: string,
  args: readonly string[],
  opts: ZipRunOptions & { acceptableExitCodes?: readonly number[] } = {},
): Promise<ZipRunResult> {
  const accept = opts.acceptableExitCodes ?? [0];
  const result = await runner.run(bin, args, opts);
  if (!accept.includes(result.exitCode)) {
    const stderr = (result.stderr || result.stdout || '').trim();
    throw new UpstreamError(
      `${bin} exited ${result.exitCode}${stderr ? `: ${stderr}` : ''}`,
    );
  }
  return result;
}
