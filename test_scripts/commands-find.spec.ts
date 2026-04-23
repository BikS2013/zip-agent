import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as findCmd from '../src/commands/find';
import { globToRegex } from '../src/commands/find';
import { IoError, UsageError } from '../src/util/errors';
import type { CommandDeps } from '../src/types';
import type { ZipRunner } from '../src/util/zip-runner';

function makeDeps(cwd: string): CommandDeps {
  const fakeRunner: ZipRunner = {
    async run() {
      throw new Error('find should not shell out');
    },
  };
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
    zipRunner: fakeRunner,
    now: () => new Date(),
    logger: { info() {}, warn() {}, error() {} },
  };
}

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'zip-agent-find-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function setupTree(): Promise<void> {
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
  await fs.mkdir(path.join(root, '.hidden'), { recursive: true });
  await fs.writeFile(path.join(root, 'README.md'), 'hi');
  await fs.writeFile(path.join(root, 'src', 'a.ts'), 'a');
  await fs.writeFile(path.join(root, 'src', 'nested', 'b.ts'), 'b');
  await fs.writeFile(path.join(root, 'src', 'app.log'), 'log');
  await fs.writeFile(path.join(root, 'node_modules', 'pkg.json'), '{}');
  await fs.writeFile(path.join(root, '.hidden', 'secret'), 'x');
}

describe('find command', () => {
  it('throws UsageError when path is missing', async () => {
    await expect(findCmd.run(makeDeps(root), { path: '' })).rejects.toThrow(UsageError);
  });

  it('throws IoError when path does not exist', async () => {
    await expect(
      findCmd.run(makeDeps(root), { path: '/no/such/dir/zzz' }),
    ).rejects.toThrow(IoError);
  });

  it('lists every regular file in a tree', async () => {
    await setupTree();
    const r = await findCmd.run(makeDeps(root), { path: root }, { types: ['file'] });
    const names = r.matches.map((m) => path.basename(m.path)).sort();
    // Hidden dir is skipped by default, so "secret" isn't here.
    expect(names).toEqual(['README.md', 'a.ts', 'app.log', 'b.ts', 'pkg.json']);
  });

  it('respects excludeDirs', async () => {
    await setupTree();
    const r = await findCmd.run(
      makeDeps(root),
      { path: root },
      { types: ['file'], excludeDirs: ['node_modules'] },
    );
    const names = r.matches.map((m) => path.basename(m.path));
    expect(names).not.toContain('pkg.json');
  });

  it('honors a name glob', async () => {
    await setupTree();
    const r = await findCmd.run(
      makeDeps(root),
      { path: root },
      { types: ['file'], name: '*.ts' },
    );
    const names = r.matches.map((m) => path.basename(m.path)).sort();
    expect(names).toEqual(['a.ts', 'b.ts']);
  });

  it('honors maxDepth', async () => {
    await setupTree();
    const r = await findCmd.run(
      makeDeps(root),
      { path: root },
      { types: ['file'], maxDepth: 1 },
    );
    const names = r.matches.map((m) => path.basename(m.path)).sort();
    expect(names).toEqual(['README.md']);
  });

  it('truncates when matchCount exceeds maxResults', async () => {
    for (let i = 0; i < 30; i++) {
      await fs.writeFile(path.join(root, `f${i}.txt`), '.');
    }
    const r = await findCmd.run(
      makeDeps(root),
      { path: root },
      { types: ['file'], maxResults: 5 },
    );
    expect(r.truncated).toBe(true);
    expect(r.matches).toHaveLength(5);
  });

  it('detects Unix sockets', async () => {
    const sockPath = path.join(root, 'app.sock');
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(sockPath, () => resolve());
    });
    try {
      const r = await findCmd.run(
        makeDeps(root),
        { path: root },
        { types: ['socket'] },
      );
      expect(r.matchCount).toBe(1);
      expect(r.matches[0]?.type).toBe('socket');
      expect(path.basename(r.matches[0]!.path)).toBe('app.sock');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('skips hidden directories by default', async () => {
    await setupTree();
    const r = await findCmd.run(makeDeps(root), { path: root }, { types: ['file'] });
    expect(r.matches.find((m) => m.path.includes('.hidden'))).toBeUndefined();
  });

  it('descends into hidden directories when includeHidden=true', async () => {
    await setupTree();
    const r = await findCmd.run(
      makeDeps(root),
      { path: root },
      { types: ['file'], includeHidden: true },
    );
    expect(r.matches.find((m) => path.basename(m.path) === 'secret')).toBeDefined();
  });
});

describe('globToRegex', () => {
  it('matches *.sock', () => {
    const re = globToRegex('*.sock');
    expect(re.test('app.sock')).toBe(true);
    expect(re.test('app.txt')).toBe(false);
  });
  it('matches with ? wildcard', () => {
    expect(globToRegex('a?.txt').test('ab.txt')).toBe(true);
    expect(globToRegex('a?.txt').test('abc.txt')).toBe(false);
  });
  it('escapes regex metacharacters', () => {
    const re = globToRegex('a.b+c');
    expect(re.test('a.b+c')).toBe(true);
    expect(re.test('aXbXc')).toBe(false);
  });
});
