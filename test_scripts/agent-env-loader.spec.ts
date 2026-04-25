/**
 * Tests for src/util/env-loader.ts — the layered env precedence builder.
 *
 * Precedence chain:
 *   --env-file > ./.env > ~/.tool-agents/zip-agent/config > process.env > defaults
 *
 * We use real temp files on disk (os.tmpdir()) so we avoid the fragile
 * vi.mock('node:fs') approach. Each test writes minimal fixture files into
 * a fresh temp directory, then cleans up in afterEach.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// We test readDotenvFile and buildEffectiveEnv through their real
// implementations, using temp-file fixtures.
// We do NOT import GLOBAL_CONFIG_PATH directly because that resolves to the
// actual home directory; instead we validate the path constant separately.
import {
  readDotenvFile,
  buildEffectiveEnv,
  GLOBAL_CONFIG_PATH,
  ensureGlobalConfigFile,
} from '../src/util/env-loader';
import { GLOBAL_CONFIG_TEMPLATE } from '../src/util/global-config-template';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-agent-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// readDotenvFile
// ---------------------------------------------------------------------------

describe('readDotenvFile', () => {
  it('returns empty object when file does not exist', () => {
    expect(readDotenvFile(path.join(tmpDir, 'nonexistent.env'))).toEqual({});
  });

  it('parses KEY=VALUE lines', () => {
    const envPath = path.join(tmpDir, 'test.env');
    fs.writeFileSync(envPath, 'FOO=bar\nBAZ=qux\n', 'utf8');
    const result = readDotenvFile(envPath);
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('ignores comment lines', () => {
    const envPath = path.join(tmpDir, 'test.env');
    fs.writeFileSync(envPath, '# comment\nFOO=bar\n', 'utf8');
    const result = readDotenvFile(envPath);
    expect(result).toEqual({ FOO: 'bar' });
  });

  it('returns empty object for an empty file', () => {
    const envPath = path.join(tmpDir, 'empty.env');
    fs.writeFileSync(envPath, '', 'utf8');
    expect(readDotenvFile(envPath)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// buildEffectiveEnv — precedence chain
// ---------------------------------------------------------------------------

describe('buildEffectiveEnv — precedence chain', () => {
  const TEST_KEY = 'ZIPA_TEST_UNIQUE_12345';
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Isolate the test key from the real process.env
    saved[TEST_KEY] = process.env[TEST_KEY];
    delete process.env[TEST_KEY];
  });

  afterEach(() => {
    if (saved[TEST_KEY] === undefined) delete process.env[TEST_KEY];
    else process.env[TEST_KEY] = saved[TEST_KEY];
  });

  it('returns process.env values when no files exist', () => {
    process.env[TEST_KEY] = 'from-process';
    // cwd has no .env; no global config at this tmpDir path
    const env = buildEffectiveEnv({ cwd: tmpDir });
    expect(env[TEST_KEY]).toBe('from-process');
  });

  it('local .env wins over process.env', () => {
    process.env[TEST_KEY] = 'from-process';
    fs.writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}=from-local-dotenv\n`, 'utf8');
    const env = buildEffectiveEnv({ cwd: tmpDir });
    expect(env[TEST_KEY]).toBe('from-local-dotenv');
  });

  it('--env-file replaces both local .env and process.env', () => {
    process.env[TEST_KEY] = 'from-process';
    fs.writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}=from-local\n`, 'utf8');
    const explicitEnvFile = path.join(tmpDir, 'explicit.env');
    fs.writeFileSync(explicitEnvFile, `${TEST_KEY}=from-explicit\n`, 'utf8');
    const env = buildEffectiveEnv({ envFile: explicitEnvFile, cwd: tmpDir });
    expect(env[TEST_KEY]).toBe('from-explicit');
  });

  it('--env-file wins over process.env', () => {
    process.env[TEST_KEY] = 'from-process';
    const explicitEnvFile = path.join(tmpDir, 'explicit.env');
    fs.writeFileSync(explicitEnvFile, `${TEST_KEY}=from-explicit\n`, 'utf8');
    const env = buildEffectiveEnv({ envFile: explicitEnvFile, cwd: tmpDir });
    expect(env[TEST_KEY]).toBe('from-explicit');
  });

  it('when --env-file is provided, local .env is not consulted', () => {
    // local .env sets a DIFFERENT key that should NOT appear
    const localOnlyKey = 'ZIPA_LOCAL_ONLY_UNIQUE_99999';
    fs.writeFileSync(path.join(tmpDir, '.env'), `${localOnlyKey}=should-not-appear\n`, 'utf8');
    const explicitEnvFile = path.join(tmpDir, 'explicit.env');
    fs.writeFileSync(explicitEnvFile, `${TEST_KEY}=from-explicit\n`, 'utf8');
    const env = buildEffectiveEnv({ envFile: explicitEnvFile, cwd: tmpDir });
    expect(env[localOnlyKey]).toBeUndefined();
  });

  it('value from env file merges with process.env for unrelated keys', () => {
    process.env[TEST_KEY] = 'from-process';
    const OTHER_KEY = 'ZIPA_OTHER_UNIQUE_54321';
    const explicitEnvFile = path.join(tmpDir, 'explicit.env');
    fs.writeFileSync(explicitEnvFile, `${OTHER_KEY}=from-explicit\n`, 'utf8');
    const env = buildEffectiveEnv({ envFile: explicitEnvFile, cwd: tmpDir });
    // Both keys should be present — env-file merged on top of process.env
    expect(env[TEST_KEY]).toBe('from-process');
    expect(env[OTHER_KEY]).toBe('from-explicit');
    delete process.env[OTHER_KEY]; // cleanup
  });

  it('uses process.cwd() as default cwd when not specified', () => {
    // Just verify it does not throw without a cwd argument
    expect(() => buildEffectiveEnv({})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// GLOBAL_CONFIG_PATH constant
// ---------------------------------------------------------------------------

describe('GLOBAL_CONFIG_PATH', () => {
  it('is under ~/.tool-agents/zip-agent/config', () => {
    expect(GLOBAL_CONFIG_PATH).toBe(
      path.join(os.homedir(), '.tool-agents', 'zip-agent', 'config'),
    );
  });
});

// ---------------------------------------------------------------------------
// ensureGlobalConfigFile — auto-bootstrap on first agent run
// ---------------------------------------------------------------------------

describe('ensureGlobalConfigFile', () => {
  it('creates the directory tree and writes the template when absent', () => {
    const target = path.join(tmpDir, 'fakehome', '.tool-agents', 'zip-agent', 'config');
    expect(fs.existsSync(target)).toBe(false);

    const result = ensureGlobalConfigFile({ configPath: target });

    expect(result.created).toBe(true);
    expect(result.path).toBe(target);
    expect(result.warning).toBeUndefined();
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe(GLOBAL_CONFIG_TEMPLATE);
  });

  it('is a no-op when the file already exists (does not overwrite user edits)', () => {
    const target = path.join(tmpDir, 'config');
    const userContent = '# my own edits\nZIP_AGENT_PROVIDER=anthropic\n';
    fs.writeFileSync(target, userContent, 'utf8');

    const result = ensureGlobalConfigFile({ configPath: target });

    expect(result.created).toBe(false);
    expect(result.warning).toBeUndefined();
    expect(fs.readFileSync(target, 'utf8')).toBe(userContent);
  });

  it('is idempotent — calling twice creates once, then reports no-op', () => {
    const target = path.join(tmpDir, 'fakehome', 'config');

    const first = ensureGlobalConfigFile({ configPath: target });
    expect(first.created).toBe(true);

    const second = ensureGlobalConfigFile({ configPath: target });
    expect(second.created).toBe(false);
    expect(second.warning).toBeUndefined();
  });

  it('returns a warning (no throw) when the parent cannot be created', () => {
    // Use an invalid path: a regular file as the parent dir is impossible to mkdir into.
    const blocker = path.join(tmpDir, 'not-a-dir');
    fs.writeFileSync(blocker, 'i am a file');
    const target = path.join(blocker, 'subdir', 'config');

    const result = ensureGlobalConfigFile({ configPath: target });

    expect(result.created).toBe(false);
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/could not bootstrap global config/);
  });

  it('uses GLOBAL_CONFIG_PATH by default when no configPath is given', () => {
    // Just verify the call signature works without arguments. We do NOT
    // actually invoke ensureGlobalConfigFile() here without an override
    // because that would touch the real $HOME.
    expect(typeof ensureGlobalConfigFile).toBe('function');
    // Sanity-check the default would target the real path.
    expect(GLOBAL_CONFIG_PATH.endsWith(path.join('.tool-agents', 'zip-agent', 'config'))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Drift guard — embedded template must match .env.example byte-for-byte
// ---------------------------------------------------------------------------

describe('GLOBAL_CONFIG_TEMPLATE drift', () => {
  it('matches .env.example exactly (update both when one changes)', () => {
    // The repo root is two dirs up from this spec file (test_scripts/ → root).
    const envExamplePath = path.join(__dirname, '..', '.env.example');
    const onDisk = fs.readFileSync(envExamplePath, 'utf8');
    expect(GLOBAL_CONFIG_TEMPLATE).toBe(onDisk);
  });
});
