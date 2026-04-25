/**
 * tui-spinner.spec.ts — sanity-check the braille spinner.
 *
 * The spinner draws on its own line wrapped in ANSI save/restore. Test that:
 *   - start() emits the first frame immediately
 *   - subsequent ticks rotate through the ten-frame cycle
 *   - stop() clears the line via CLEAR_LINE
 *   - setLabel() takes effect on the next paint
 *   - isActive() flips correctly
 */

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { createSpinner, SPINNER_FRAMES } from '../src/agent/tui';

function makeOut(): { stream: PassThrough; output: () => string } {
  const stream = new PassThrough();
  let buf = '';
  stream.on('data', (c: Buffer | string) => {
    buf += typeof c === 'string' ? c : c.toString();
  });
  return { stream, output: () => buf };
}

describe('createSpinner', () => {
  it('paints the first frame immediately on start()', () => {
    const { stream, output } = makeOut();
    const sp = createSpinner('Thinking...', { out: stream, intervalMs: 1_000 });
    expect(sp.isActive()).toBe(false);
    sp.start();
    expect(sp.isActive()).toBe(true);
    const text = output();
    // Save, clear-line, dim, frame, label, reset, restore.
    expect(text).toContain(SPINNER_FRAMES[0]);
    expect(text).toContain('Thinking...');
    sp.stop();
  });

  it('rotates frames on each tick', async () => {
    const { stream, output } = makeOut();
    const sp = createSpinner('x', { out: stream, intervalMs: 5 });
    sp.start();
    await new Promise((r) => setTimeout(r, 30));
    sp.stop();
    const text = output();
    // Should have at least the first 3 frames in order.
    const idx0 = text.indexOf(SPINNER_FRAMES[0]);
    const idx1 = text.indexOf(SPINNER_FRAMES[1], idx0 + 1);
    const idx2 = text.indexOf(SPINNER_FRAMES[2], idx1 + 1);
    expect(idx0).toBeGreaterThanOrEqual(0);
    expect(idx1).toBeGreaterThan(idx0);
    expect(idx2).toBeGreaterThan(idx1);
  });

  it('stop() emits a clear-line sequence', () => {
    const { stream, output } = makeOut();
    const sp = createSpinner('x', { out: stream, intervalMs: 1_000 });
    sp.start();
    const before = output().length;
    sp.stop();
    const after = output().slice(before);
    // CLEAR_LINE is "\r\x1b[2K"
    expect(after).toContain('\r\x1b[2K');
    expect(sp.isActive()).toBe(false);
  });

  it('setLabel() takes effect on next paint', async () => {
    const { stream, output } = makeOut();
    const sp = createSpinner('first', { out: stream, intervalMs: 5 });
    sp.start();
    await new Promise((r) => setTimeout(r, 10));
    sp.setLabel('second');
    await new Promise((r) => setTimeout(r, 20));
    sp.stop();
    const text = output();
    expect(text).toContain('first');
    expect(text).toContain('second');
    // "second" must appear AFTER the first occurrence of "first".
    expect(text.indexOf('second')).toBeGreaterThan(text.indexOf('first'));
  });

  it('start() is idempotent (calling twice does not double-tick)', () => {
    const { stream, output } = makeOut();
    const sp = createSpinner('x', { out: stream, intervalMs: 1_000 });
    sp.start();
    const len1 = output().length;
    sp.start(); // no-op
    const len2 = output().length;
    expect(len2).toBe(len1);
    sp.stop();
  });
});
