/**
 * Truncate any tool result to fit a byte budget while keeping the output
 * valid JSON. Arrays drop tail entries; objects fall back to a hard
 * prefix wrapped with `__truncated: true` so the model sees the cut.
 */
export function truncateToolResult(obj: unknown, maxBytes: number): string {
  const full = JSON.stringify(obj);
  if (full === undefined) return JSON.stringify({ __truncated: true, raw: '' });
  if (Buffer.byteLength(full, 'utf8') <= maxBytes) return full;

  if (Array.isArray(obj)) {
    const arr = [...obj];
    while (arr.length > 0) {
      arr.pop();
      const candidate = JSON.stringify({
        __truncated: true,
        kept: arr.length,
        original: obj.length,
        items: arr,
      });
      if (Buffer.byteLength(candidate, 'utf8') <= maxBytes) return candidate;
    }
    return JSON.stringify({
      __truncated: true,
      kept: 0,
      original: obj.length,
      items: [],
    });
  }

  // Object or scalar fallback: hard slice the serialized form, leaving
  // headroom for the wrapper.
  const headroom = 64;
  const prefix = full.slice(0, Math.max(0, maxBytes - headroom));
  return JSON.stringify({ __truncated: true, raw: prefix + '…TRUNCATED' });
}
