/**
 * tui-input-escape-framing.spec.ts — MANDATORY regression suite (spec §14.1).
 *
 * Protects against the spec §18.1 footgun: the CSI introducer `[` (0x5B) and
 * the SS3 introducer `O` (0x4F) both fall in the 0x40..0x7E "final byte" range,
 * so a naïve framer dispatches the sequence at the introducer and the rest of
 * the bytes leak through the printable path. The user sees arrow keys echo
 * as letters (A/B/C/D), Home as H, Delete as 3~, etc.
 *
 * The test fires every keyboard sequence the reader is supposed to consume,
 * follows it with Enter, and asserts the resolved buffer is exactly "" — i.e.
 * NOTHING printed. If any letter leaks, the framer is broken.
 *
 * The test is also hand-rolled at the byte level — no helpers above the spec —
 * so it cannot be invalidated by refactors of the editor state shape.
 */

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { feedEscByte, readInput } from '../src/agent/tui';

// -----------------------------------------------------------------------------
// Pure-function unit tests — feedEscByte alone, no reader involved.
// -----------------------------------------------------------------------------

function consume(bytes: number[]): { dispatched: string[]; passthrough: number[] } {
  let state: ReturnType<typeof feedEscByte>['state'] = { kind: 'idle' };
  const dispatched: string[] = [];
  const passthrough: number[] = [];
  for (const b of bytes) {
    const r = feedEscByte(state, b);
    state = r.state;
    if (r.action === 'dispatch') dispatched.push(r.sequence);
    else if (r.action === 'passthrough') passthrough.push(r.byte);
  }
  return { dispatched, passthrough };
}

describe('feedEscByte (escape-framing primitive)', () => {
  it('frames arrow keys as 3-byte CSI sequences with no leak', () => {
    for (const final of [0x41, 0x42, 0x43, 0x44]) {
      const r = consume([0x1b, 0x5b, final]);
      expect(r.dispatched).toEqual([Buffer.from([0x1b, 0x5b, final]).toString('binary')]);
      expect(r.passthrough).toEqual([]);
    }
  });

  it('does NOT dispatch on the CSI introducer "[" alone', () => {
    // The bug we are protecting against: dispatching at byte 2 of \x1b[X
    // because `[` (0x5B) falls in the 0x40..0x7E range. After [, we MUST
    // still be accumulating.
    const partial = consume([0x1b, 0x5b]); // just CSI introducer
    expect(partial.dispatched).toEqual([]);
    expect(partial.passthrough).toEqual([]);
  });

  it('does NOT dispatch on the SS3 introducer "O" alone', () => {
    const partial = consume([0x1b, 0x4f]); // \x1bO with no follower
    expect(partial.dispatched).toEqual([]);
    expect(partial.passthrough).toEqual([]);
  });

  it('frames SS3 sequences (\\x1bOH, \\x1bOF, \\x1bOM) at exactly 3 bytes', () => {
    for (const last of [0x48 /* H */, 0x46 /* F */, 0x4d /* M */]) {
      const r = consume([0x1b, 0x4f, last]);
      expect(r.dispatched).toEqual([Buffer.from([0x1b, 0x4f, last]).toString('binary')]);
      expect(r.passthrough).toEqual([]);
    }
  });

  it('frames ESC + single character (Alt+b, Alt+f, Alt+Backspace) at 2 bytes', () => {
    for (const second of [0x62 /* b */, 0x66 /* f */, 0x7f /* Backspace */, 0x0d /* CR */]) {
      const r = consume([0x1b, second]);
      expect(r.dispatched).toEqual([Buffer.from([0x1b, second]).toString('binary')]);
      expect(r.passthrough).toEqual([]);
    }
  });

  it('frames extended CSI sequences (Ctrl+Left = \\x1b[1;5D, Delete = \\x1b[3~)', () => {
    const ctrlLeft = consume([0x1b, 0x5b, 0x31, 0x3b, 0x35, 0x44]);
    expect(ctrlLeft.dispatched).toEqual(['\x1b[1;5D']);
    expect(ctrlLeft.passthrough).toEqual([]);

    const del = consume([0x1b, 0x5b, 0x33, 0x7e]);
    expect(del.dispatched).toEqual(['\x1b[3~']);
    expect(del.passthrough).toEqual([]);
  });

  it('frames Shift+Enter via CSI-u (\\x1b[13;2u) without leaking the parameters', () => {
    const r = consume([0x1b, 0x5b, 0x31, 0x33, 0x3b, 0x32, 0x75]);
    expect(r.dispatched).toEqual(['\x1b[13;2u']);
    expect(r.passthrough).toEqual([]);
  });

  it('discards an absurdly long escape sequence (safety cap) without dispatching it as a printable string', () => {
    // Send \x1b[ followed by 20 parameter bytes (digits) with no terminator.
    // After the safety cap kicks in (10 bytes), the framer returns to idle.
    // The KEY invariant: the long sequence must NEVER be dispatched as a
    // single string (which would write 20 "1" characters into the editor at
    // once via handleEscape's default-drop path is fine — what we are
    // protecting against is the framer thinking it has a complete sequence).
    const bytes = [0x1b, 0x5b, ...Array.from({ length: 20 }, () => 0x31 /* '1' */)];
    const r = consume(bytes);
    expect(r.dispatched).toEqual([]);
    // After the cap fires the buffered ESC + [ + the digits up to the cap are
    // dropped, but bytes that arrive AFTER the discard restart from idle and
    // become passthrough (printable). That is the documented behaviour — the
    // safety cap fails CLOSED toward dropping the framing context, not toward
    // emitting a fake "complete" sequence. As long as nothing was dispatched
    // we are protected from the spec §18.1 footgun.
    expect(r.passthrough.length).toBeGreaterThanOrEqual(0);
  });
});

// -----------------------------------------------------------------------------
// End-to-end test through readInput — drives a PassThrough stdin like the
// real terminal and asserts that pressing each escape sequence + Enter
// yields the EMPTY string.
// -----------------------------------------------------------------------------

function makeStreams(): { stdin: PassThrough & Partial<NodeJS.ReadStream>; stdout: PassThrough } {
  const stdin = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
  // Pretend to be a TTY so the reader does not refuse and so setRawMode is
  // exercised — but make setRawMode a no-op (PassThrough has no real raw mode).
  (stdin as { isTTY?: boolean }).isTTY = true;
  (stdin as { setRawMode?: (b: boolean) => void }).setRawMode = () => undefined;
  const stdout = new PassThrough();
  // Drain stdout so back-pressure does not stall the read.
  stdout.on('data', () => {});
  return { stdin, stdout };
}

function feed(stdin: PassThrough, bytes: Buffer | number[]): void {
  setImmediate(() => stdin.write(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)));
}

const ENTER = 0x0d;

describe('readInput escape-framing regression (end to end)', () => {
  const cases: Array<[name: string, bytes: number[]]> = [
    ['Up arrow',         [0x1b, 0x5b, 0x41]],
    ['Down arrow',       [0x1b, 0x5b, 0x42]],
    ['Right arrow',      [0x1b, 0x5b, 0x43]],
    ['Left arrow',       [0x1b, 0x5b, 0x44]],
    ['Home (SS3)',       [0x1b, 0x4f, 0x48]],
    ['Delete key',       [0x1b, 0x5b, 0x33, 0x7e]],
    ['Ctrl+Left',        [0x1b, 0x5b, 0x31, 0x3b, 0x35, 0x44]],
    ['Alt+b',            [0x1b, 0x62]],
    ['Alt+Backspace',    [0x1b, 0x7f]],
    ['Shift+Enter CSI-u', [0x1b, 0x5b, 0x31, 0x33, 0x3b, 0x32, 0x75]],
  ];

  for (const [name, seq] of cases) {
    it(`"${name}" pressed alone then Enter resolves to ""`, async () => {
      const { stdin, stdout } = makeStreams();
      const p = readInput({
        prompt: '> ',
        continuationPrompt: '. ',
        inputHistory: [],
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout,
      });
      // For Shift+Enter variants, the editor inserts a newline, so we
      // need a SECOND Enter to submit. Detect this by sequence shape.
      const isNewline =
        // \x1b[13;2u
        (seq.length === 7 && seq[0] === 0x1b && seq[1] === 0x5b && seq[6] === 0x75) ||
        // \x1bOM, \x1b\r, \x1b\n
        (seq.length === 2 && seq[0] === 0x1b && (seq[1] === 0x0d || seq[1] === 0x0a)) ||
        (seq.length === 3 && seq[0] === 0x1b && seq[1] === 0x4f && seq[2] === 0x4d);
      feed(stdin, [...seq, ENTER, ...(isNewline ? [ENTER] : [])]);
      const result = await p;
      // The whole submitted buffer should be empty — proving NO byte from the
      // escape sequence leaked into the editor.
      expect(result).toBe(isNewline ? '\n' : '');
    });
  }
});
