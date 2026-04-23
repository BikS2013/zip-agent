import { describe, it, expect } from 'vitest';
import { parseUnzipL } from '../src/commands/list';

describe('parseUnzipL', () => {
  it('parses macOS unzip output (MM-DD-YYYY)', () => {
    const sample = `Archive:  out.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
        6  04-23-2026 08:29   private/tmp/a.txt
        5  04-23-2026 08:29   private/tmp/b.txt
---------                     -------
       11                     2 files
`;
    const entries = parseUnzipL(sample);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.name).toBe('private/tmp/a.txt');
    expect(entries[0]?.size).toBe(6);
  });

  it('parses Linux Info-ZIP output (YYYY-MM-DD)', () => {
    const sample = `Archive:  out.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
        6  2026-04-23 08:29   a.txt
---------                     -------
        6                     1 file
`;
    const entries = parseUnzipL(sample);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('a.txt');
  });
});
