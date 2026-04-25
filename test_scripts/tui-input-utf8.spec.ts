/**
 * tui-input-utf8.spec.ts — MANDATORY regression suite (spec §14.2).
 *
 * Protects against spec §18.2 — typing Greek / CJK / emoji must NOT produce
 * Latin-1 mojibake. The reader must route every printable byte through a
 * stateful UTF-8 decoder (StringDecoder) so multi-byte sequences buffer
 * correctly across `data` events.
 *
 * Three cases:
 *   1. Greek string round-trips exactly.
 *   2. 4-byte emoji decodes as a single character.
 *   3. A multi-byte character split across TWO data chunks still decodes.
 *   4. Mixed ASCII + multi-byte + escape sequence in one chunk.
 */

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { createUtf8Decoder, readInput } from '../src/agent/tui';

function makeStreams(): { stdin: PassThrough & Partial<NodeJS.ReadStream>; stdout: PassThrough } {
  const stdin = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
  (stdin as { isTTY?: boolean }).isTTY = true;
  (stdin as { setRawMode?: (b: boolean) => void }).setRawMode = () => undefined;
  const stdout = new PassThrough();
  stdout.on('data', () => {});
  return { stdin, stdout };
}

const ENTER = 0x0d;

describe('UTF-8 decoder unit', () => {
  it('decodes a 2-byte Greek alpha (CE B1) byte by byte', () => {
    const d = createUtf8Decoder();
    expect(d.write(0xce)).toBe(''); // partial — leading byte buffered
    expect(d.write(0xb1)).toBe('α');
  });

  it('decodes a 4-byte emoji (😀, F0 9F 98 80)', () => {
    const d = createUtf8Decoder();
    const bytes = Buffer.from('😀', 'utf8');
    let acc = '';
    for (const b of bytes) acc += d.write(b);
    expect(acc).toBe('😀');
    expect([...acc].length).toBe(1);
  });

  it('returns "" for ASCII bytes that are routed through it', () => {
    const d = createUtf8Decoder();
    expect(d.write(0x41)).toBe('A');
  });
});

describe('readInput UTF-8 regression (end to end)', () => {
  it('round-trips Greek string "test Αναφορά"', async () => {
    const { stdin, stdout } = makeStreams();
    const p = readInput({
      prompt: '> ',
      continuationPrompt: '. ',
      inputHistory: [],
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout,
    });
    const text = 'test Αναφορά';
    setImmediate(() => stdin.write(Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([ENTER])])));
    const result = await p;
    expect(result).toBe(text);
  });

  it('round-trips a 4-byte emoji 😀', async () => {
    const { stdin, stdout } = makeStreams();
    const p = readInput({
      prompt: '> ',
      continuationPrompt: '. ',
      inputHistory: [],
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout,
    });
    setImmediate(() => stdin.write(Buffer.concat([Buffer.from('😀', 'utf8'), Buffer.from([ENTER])])));
    const result = await p;
    expect(result).toBe('😀');
  });

  it('decodes a multi-byte character split across two data chunks (0xCE then 0xB1)', async () => {
    const { stdin, stdout } = makeStreams();
    const p = readInput({
      prompt: '> ',
      continuationPrompt: '. ',
      inputHistory: [],
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout,
    });
    setImmediate(() => {
      stdin.write(Buffer.from([0xce]));
      // Different microtask so the reader's onData fires twice.
      setImmediate(() => {
        stdin.write(Buffer.from([0xb1]));
        setImmediate(() => stdin.write(Buffer.from([ENTER])));
      });
    });
    const result = await p;
    expect(result).toBe('α');
  });

  it('mixed ASCII + Greek + escape sequence in a single chunk produces no leakage', async () => {
    const { stdin, stdout } = makeStreams();
    const p = readInput({
      prompt: '> ',
      continuationPrompt: '. ',
      inputHistory: [],
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout,
    });
    // "αβ" + Left arrow + "γ" + Enter
    // After Left arrow the cursor moves left; "γ" inserts before the existing
    // characters from cursor position. Editor was: αβ (cursor after β).
    // Left arrow → cursor between α and β. Insert γ → αγβ.
    const payload = Buffer.concat([
      Buffer.from('αβ', 'utf8'),
      Buffer.from([0x1b, 0x5b, 0x44]), // Left arrow
      Buffer.from('γ', 'utf8'),
      Buffer.from([ENTER]),
    ]);
    setImmediate(() => stdin.write(payload));
    const result = await p;
    expect(result).toBe('αγβ');
  });

  it('arrow keys emit no Latin-1 letters (proves no byte leaks)', async () => {
    const { stdin, stdout } = makeStreams();
    const p = readInput({
      prompt: '> ',
      continuationPrompt: '. ',
      inputHistory: [],
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout,
    });
    // Press all four arrows alone, then Enter — submitted buffer must be "".
    const payload = Buffer.from([
      0x1b, 0x5b, 0x41, // Up
      0x1b, 0x5b, 0x42, // Down
      0x1b, 0x5b, 0x43, // Right
      0x1b, 0x5b, 0x44, // Left
      ENTER,
    ]);
    setImmediate(() => stdin.write(payload));
    const result = await p;
    expect(result).toBe('');
  });
});
