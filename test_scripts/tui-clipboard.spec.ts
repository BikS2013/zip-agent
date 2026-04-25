/**
 * tui-clipboard.spec.ts — cross-platform clipboard dispatch.
 *
 * The clipboard helper walks a platform-specific candidate list and falls
 * back to writing the text to ~/.tool-agents/zip-agent/last-response.txt
 * when no native binary exists. We mock child_process.spawn so the test
 * never actually invokes pbcopy/xclip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { clipboardCandidates, copyToClipboard } from '../src/agent/tui';

class FakeChild extends EventEmitter {
  stdin = {
    end: vi.fn(),
  };
}

const SAVED_HOME = process.env['ZIP_AGENT_TUI_HOME'];
let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-agent-clip-'));
  process.env['ZIP_AGENT_TUI_HOME'] = tmp;
});

afterEach(async () => {
  if (SAVED_HOME === undefined) delete process.env['ZIP_AGENT_TUI_HOME'];
  else process.env['ZIP_AGENT_TUI_HOME'] = SAVED_HOME;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('clipboardCandidates', () => {
  it('returns pbcopy on darwin', () => {
    const c = clipboardCandidates('darwin');
    expect(c[0]?.bin).toBe('pbcopy');
    expect(c.length).toBe(1);
  });

  it('returns clip on win32', () => {
    const c = clipboardCandidates('win32');
    expect(c[0]?.bin).toBe('clip');
    expect(c.length).toBe(1);
  });

  it('returns wl-copy → xclip → xsel → clip.exe on linux', () => {
    const names = clipboardCandidates('linux').map((c) => c.bin);
    expect(names).toEqual(['wl-copy', 'xclip', 'xsel', '/mnt/c/Windows/System32/clip.exe']);
  });
});

describe('copyToClipboard', () => {
  it('reports copied=true when the first candidate exits 0', async () => {
    const fake = new FakeChild();
    const spawnImpl = vi.fn(() => fake) as unknown as typeof import('node:child_process').spawn;
    setImmediate(() => fake.emit('exit', 0));
    const r = await copyToClipboard('hello', {
      candidates: [{ bin: 'pbcopy', args: [] }],
      spawnImpl,
    });
    expect(r.copied).toBe(true);
    expect(r.via).toBe('pbcopy');
    expect(spawnImpl).toHaveBeenCalledWith('pbcopy', [], expect.any(Object));
  });

  it('falls through to next candidate when the first errors out', async () => {
    let call = 0;
    const fakes: FakeChild[] = [new FakeChild(), new FakeChild()];
    const spawnImpl = vi.fn(() => {
      const f = fakes[call++]!;
      // Fire async — give the awaiter time to subscribe.
      setImmediate(() => {
        if (call === 1) f.emit('error', new Error('ENOENT'));
        else f.emit('exit', 0);
      });
      return f;
    }) as unknown as typeof import('node:child_process').spawn;

    const r = await copyToClipboard('hello', {
      candidates: [
        { bin: 'wl-copy', args: [] },
        { bin: 'xclip', args: ['-selection', 'clipboard'] },
      ],
      spawnImpl,
    });
    expect(r.copied).toBe(true);
    expect(r.via).toBe('xclip');
  });

  it('falls back to last-response.txt when EVERY candidate fails', async () => {
    const spawnImpl = vi.fn(() => {
      const fake = new FakeChild();
      setImmediate(() => fake.emit('error', new Error('ENOENT')));
      return fake;
    }) as unknown as typeof import('node:child_process').spawn;

    const r = await copyToClipboard('payload', {
      candidates: [{ bin: 'totally-missing-thing', args: [] }],
      spawnImpl,
    });
    expect(r.copied).toBe(false);
    expect(r.fallbackPath).toBeDefined();
    const written = await fs.readFile(r.fallbackPath!, 'utf8');
    expect(written).toBe('payload');
  });
});
