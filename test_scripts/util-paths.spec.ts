import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { resolveUserPath } from '../src/util/paths';

describe('resolveUserPath', () => {
  const cwd = '/some/cwd';

  it('returns home dir for bare "~"', () => {
    expect(resolveUserPath(cwd, '~')).toBe(os.homedir());
  });

  it('expands "~/foo/bar" to homedir/foo/bar', () => {
    expect(resolveUserPath(cwd, '~/foo/bar')).toBe(path.resolve(os.homedir(), 'foo/bar'));
  });

  it('expands "~/" to homedir', () => {
    expect(resolveUserPath(cwd, '~/')).toBe(path.resolve(os.homedir()));
  });

  it('leaves absolute paths alone', () => {
    expect(resolveUserPath(cwd, '/etc/hosts')).toBe('/etc/hosts');
  });

  it('resolves relative paths against cwd', () => {
    expect(resolveUserPath(cwd, 'foo/bar')).toBe('/some/cwd/foo/bar');
  });

  it('does NOT expand tilde in the middle of a path', () => {
    // "/foo/~/bar" is intentionally left as a literal — only leading tilde
    // is treated as home, matching shell behavior.
    expect(resolveUserPath(cwd, '/foo/~/bar')).toBe('/foo/~/bar');
  });

  it('handles empty input', () => {
    expect(resolveUserPath(cwd, '')).toBe('');
  });
});
