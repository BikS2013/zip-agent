/**
 * tui-persistence.spec.ts — file-system CRUD for the TUI's per-user state.
 *
 * Every test points ZIP_AGENT_TUI_HOME at an os.tmpdir() subdir so the
 * real ~/.tool-agents/zip-agent/ is never touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ensureTuiBootstrap,
  listThreads,
  loadTranscript,
  memoryPath,
  readMemory,
  readTuiConfig,
  saveTranscript,
  threadFile,
  threadsDir,
  tuiConfigPath,
  tuiHomePath,
  writeMemory,
  writeTuiConfig,
} from '../src/agent/tui';

const SAVED_HOME = process.env['ZIP_AGENT_TUI_HOME'];
const SAVED_NO_PERSIST = process.env['ZIP_AGENT_TUI_NO_PERSIST'];

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-agent-tui-'));
  process.env['ZIP_AGENT_TUI_HOME'] = tmp;
  delete process.env['ZIP_AGENT_TUI_NO_PERSIST'];
});

afterEach(async () => {
  if (SAVED_HOME === undefined) delete process.env['ZIP_AGENT_TUI_HOME'];
  else process.env['ZIP_AGENT_TUI_HOME'] = SAVED_HOME;
  if (SAVED_NO_PERSIST === undefined) delete process.env['ZIP_AGENT_TUI_NO_PERSIST'];
  else process.env['ZIP_AGENT_TUI_NO_PERSIST'] = SAVED_NO_PERSIST;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('ensureTuiBootstrap', () => {
  it('creates memory.md, last-response.txt, tui-config.json, threads/ on first call', () => {
    const r = ensureTuiBootstrap();
    expect(r.warnings).toEqual([]);
    expect(existsSync(memoryPath())).toBe(true);
    expect(existsSync(tuiConfigPath())).toBe(true);
    expect(existsSync(threadsDir())).toBe(true);
    // mkdtemp pre-created `tmp`, so the home dir itself is NOT in `created`.
    // What MUST be in `created` is the threads/ directory and the seeded files.
    expect(r.created).toContain(threadsDir());
    expect(r.created).toContain(memoryPath());
    expect(r.created).toContain(tuiConfigPath());
  });

  it('is idempotent — second call creates nothing', () => {
    ensureTuiBootstrap();
    const r2 = ensureTuiBootstrap();
    expect(r2.created).toEqual([]);
    expect(r2.warnings).toEqual([]);
  });

  it('returns no warnings for the happy path', () => {
    expect(ensureTuiBootstrap().warnings).toEqual([]);
  });

  it('respects ZIP_AGENT_TUI_HOME override', () => {
    expect(tuiHomePath()).toBe(tmp);
  });
});

describe('memory.md CRUD', () => {
  it('write then read round-trips', async () => {
    await writeMemory('hello world');
    expect(await readMemory()).toBe('hello world');
  });

  it('readMemory returns "" on missing file', async () => {
    // No bootstrap, no write — file does not exist.
    expect(await readMemory()).toBe('');
  });
});

describe('tui-config.json CRUD', () => {
  it('returns defaults when file is absent', async () => {
    const cfg = await readTuiConfig();
    expect(cfg.defaultMutations).toBe(false);
    expect(cfg.providerOverride).toBeNull();
    expect(cfg.modelOverride).toBeNull();
  });

  it('write then read round-trips', async () => {
    await writeTuiConfig({ defaultMutations: true, providerOverride: 'openai', modelOverride: 'gpt-4o' });
    const cfg = await readTuiConfig();
    expect(cfg.defaultMutations).toBe(true);
    expect(cfg.providerOverride).toBe('openai');
    expect(cfg.modelOverride).toBe('gpt-4o');
  });
});

describe('thread transcripts', () => {
  it('saveTranscript then loadTranscript round-trips', async () => {
    await saveTranscript({
      threadId: 'thread-abc',
      createdAt: 1,
      updatedAt: 2,
      provider: 'openai',
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'hi', timestamp: 1 },
        { role: 'assistant', content: 'hello!', timestamp: 2 },
      ],
    });
    expect(existsSync(threadFile('thread-abc'))).toBe(true);
    const loaded = await loadTranscript('thread-abc');
    expect(loaded?.threadId).toBe('thread-abc');
    expect(loaded?.messages.length).toBe(2);
    expect(loaded?.messages[1]?.content).toBe('hello!');
  });

  it('listThreads returns nothing when threads/ is empty', async () => {
    expect(await listThreads()).toEqual([]);
  });

  it('listThreads sorts newest first and previews the first user message', async () => {
    await saveTranscript({
      threadId: 'older',
      createdAt: 1,
      updatedAt: 100,
      provider: 'openai',
      model: 'gpt',
      messages: [{ role: 'user', content: 'old prompt', timestamp: 1 }],
    });
    await saveTranscript({
      threadId: 'newer',
      createdAt: 2,
      updatedAt: 200,
      provider: 'openai',
      model: 'gpt',
      messages: [{ role: 'user', content: 'new prompt', timestamp: 2 }],
    });
    const list = await listThreads();
    expect(list.map((t) => t.threadId)).toEqual(['newer', 'older']);
    expect(list[0]!.firstPrompt).toBe('new prompt');
    expect(list[0]!.messageCount).toBe(1);
  });

  it('refuses to escape the threads/ directory via path-separator chars in id', async () => {
    // saveTranscript sanitises the id, so writing should land inside threadsDir.
    await saveTranscript({
      threadId: '../etc/passwd',
      createdAt: 1,
      updatedAt: 1,
      provider: 'p',
      model: 'm',
      messages: [{ role: 'user', content: 'x', timestamp: 1 }],
    });
    const sanitisedFile = threadFile('../etc/passwd');
    expect(sanitisedFile.startsWith(threadsDir())).toBe(true);
    expect(existsSync(sanitisedFile)).toBe(true);
  });
});

describe('ZIP_AGENT_TUI_NO_PERSIST=1', () => {
  it('makes writeMemory a no-op', async () => {
    process.env['ZIP_AGENT_TUI_NO_PERSIST'] = '1';
    await writeMemory('should not write');
    expect(existsSync(memoryPath())).toBe(false);
  });
});
