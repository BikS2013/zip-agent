import { describe, it, expect } from 'vitest';
import { normalizeFoundryEndpoint } from '../src/agent/providers/util';

describe('normalizeFoundryEndpoint', () => {
  it('appends /openai/v1 to a clean endpoint', () => {
    expect(normalizeFoundryEndpoint('https://x.services.ai.azure.com', '/openai/v1')).toBe(
      'https://x.services.ai.azure.com/openai/v1',
    );
  });

  it('appends /anthropic and strips trailing slashes', () => {
    expect(normalizeFoundryEndpoint('https://x/', '/anthropic')).toBe('https://x/anthropic');
  });

  it('strips a trailing /models segment (case-insensitive)', () => {
    expect(normalizeFoundryEndpoint('https://x/Models', '/openai/v1')).toBe(
      'https://x/openai/v1',
    );
  });

  it('handles trimming whitespace', () => {
    expect(normalizeFoundryEndpoint('  https://x  ', '/anthropic')).toBe('https://x/anthropic');
  });
});
