import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as listCmd from '../src/commands/list';
import { IoError } from '../src/util/errors';
import type { ZipRunner } from '../src/util/zip-runner';
import type { CommandDeps } from '../src/types';

function makeDeps(runner: Partial<ZipRunner>, cwd: string): CommandDeps {
  return {
    config: {
      zipBin: 'zip',
      unzipBin: 'unzip',
      zipinfoBin: 'zipinfo',
      logFile: null,
      outputMode: 'json',
      quiet: true,
      verbose: false,
      cwd,
    },
    zipRunner: {
      run: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
      ...runner,
    },
    now: () => new Date(),
    logger: { info() {}, warn() {}, error() {} },
  };
}

const SAMPLE = `Archive:  test.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
       12  04-23-2026 08:30   a.txt
      120  04-23-2026 08:31   b/c.txt
---------                     -------
      132                     2 files
`;

describe('list command', () => {
  it('parses unzip -l output into structured entries', async () => {
    const tmp = await fs.mkdtemp(path.join(tmpdir(), 'zip-agent-'));
    const archive = path.join(tmp, 'test.zip');
    await fs.writeFile(archive, 'placeholder', { mode: 0o644 });

    const deps = makeDeps(
      { run: vi.fn(async () => ({ exitCode: 0, stdout: SAMPLE, stderr: '' })) },
      tmp,
    );

    const result = await listCmd.run(deps, { archive });
    expect(result.entryCount).toBe(2);
    expect(result.totalUncompressedSize).toBe(132);
    expect(result.entries?.[0]?.name).toBe('a.txt');
    expect(result.entries?.[1]?.name).toBe('b/c.txt');
  });

  it('throws IoError for an unreadable archive', async () => {
    const deps = makeDeps({}, '/tmp');
    await expect(listCmd.run(deps, { archive: '/nonexistent/file.zip' })).rejects.toThrow(IoError);
  });

  it('justCount=true omits the entries array', async () => {
    const tmp = await fs.mkdtemp(path.join(tmpdir(), 'zip-agent-'));
    const archive = path.join(tmp, 'test.zip');
    await fs.writeFile(archive, 'placeholder');

    const deps = makeDeps(
      { run: vi.fn(async () => ({ exitCode: 0, stdout: SAMPLE, stderr: '' })) },
      tmp,
    );

    const result = await listCmd.run(deps, { archive }, { justCount: true });
    expect(result.entries).toBeUndefined();
    expect(result.entryCount).toBe(2);
  });
});
