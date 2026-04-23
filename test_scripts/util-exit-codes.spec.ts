import { describe, it, expect } from 'vitest';
import {
  AuthError,
  CollisionError,
  ConfigurationError,
  IoError,
  UpstreamError,
  UsageError,
} from '../src/util/errors';
import { exitCodeFor } from '../src/util/exit-codes';

describe('exitCodeFor', () => {
  it('maps each error class to its dedicated code', () => {
    expect(exitCodeFor(new UsageError('x'))).toBe(2);
    expect(exitCodeFor(new ConfigurationError('A', ['env']))).toBe(3);
    expect(exitCodeFor(new AuthError('x'))).toBe(4);
    expect(exitCodeFor(new UpstreamError('x'))).toBe(5);
    expect(exitCodeFor(new IoError('x'))).toBe(6);
    expect(exitCodeFor(new CollisionError('x'))).toBe(7);
  });

  it('falls back to 1 for unknown errors', () => {
    expect(exitCodeFor(new Error('x'))).toBe(1);
    expect(exitCodeFor('plain string')).toBe(1);
  });
});

describe('ConfigurationError', () => {
  it('builds a helpful message including checked sources', () => {
    const err = new ConfigurationError('FOO', ['--foo', 'FOO_ENV'], 'try docs');
    expect(err.message).toContain('FOO');
    expect(err.message).toContain('--foo');
    expect(err.message).toContain('FOO_ENV');
    expect(err.message).toContain('try docs');
    expect(err.code).toBe('CONFIG_MISSING');
  });
});
