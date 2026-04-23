import { describe, it, expect } from 'vitest';
import { truncateToolResult } from '../src/agent/tools/truncate';

describe('truncateToolResult', () => {
  it('passes through small payloads unchanged', () => {
    const out = truncateToolResult({ a: 1 }, 1024);
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it('drops tail entries from arrays until under budget', () => {
    const arr = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}` }));
    const out = truncateToolResult(arr, 256);
    const parsed = JSON.parse(out);
    expect(parsed.__truncated).toBe(true);
    expect(parsed.items.length).toBeLessThan(arr.length);
    expect(parsed.original).toBe(100);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(256);
  });

  it('hard-truncates large objects with a __truncated wrapper', () => {
    const obj = { big: 'x'.repeat(10_000) };
    const out = truncateToolResult(obj, 256);
    const parsed = JSON.parse(out);
    expect(parsed.__truncated).toBe(true);
    expect(parsed.raw).toContain('TRUNCATED');
  });

  it('always returns valid JSON', () => {
    const out = truncateToolResult([{ x: 1 }, { x: 2 }], 32);
    expect(() => JSON.parse(out)).not.toThrow();
  });
});
