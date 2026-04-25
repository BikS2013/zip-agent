/**
 * spinner.ts — animated braille spinner used between the user pressing
 * Enter and the first model token arriving (or while a tool call is in
 * flight). Spec §2.2 + §6.
 *
 * Frames are the ten-frame braille animation; tick is 80 ms. Every paint
 * is wrapped in ANSI save/restore so the spinner does not disturb the
 * surrounding prompt or partially-streamed text. The label is mutable —
 * the streaming loop swaps it from "Thinking..." to "Processing tool
 * result..." between an `on_tool_end` and the next `on_chat_model_stream`.
 */

import { CLEAR_LINE, DIM, RESET, RESTORE_CURSOR, SAVE_CURSOR } from './ansi';

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
export const SPINNER_TICK_MS = 80;

export interface Spinner {
  setLabel(s: string): void;
  start(): void;
  stop(): void;
  isActive(): boolean;
}

export interface CreateSpinnerOptions {
  out?: NodeJS.WritableStream;
  intervalMs?: number;
}

/**
 * Build a spinner. Only one spinner should be active at a time per output
 * stream; the consumer is responsible for that. The spinner draws on its
 * own line; the caller should issue a `process.stdout.write('\n')` before
 * the first `start()` if the cursor is mid-line.
 */
export function createSpinner(initialLabel: string, opts: CreateSpinnerOptions = {}): Spinner {
  const out = opts.out ?? process.stdout;
  const intervalMs = opts.intervalMs ?? SPINNER_TICK_MS;
  let label = initialLabel;
  let frame = 0;
  let timer: NodeJS.Timeout | null = null;

  const paint = (): void => {
    const f = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    out.write(`${SAVE_CURSOR}${CLEAR_LINE}${DIM}${f} ${label}${RESET}${RESTORE_CURSOR}`);
    frame += 1;
  };

  return {
    setLabel(s: string) {
      label = s;
    },
    start() {
      if (timer) return;
      // Paint immediately so the user sees the first frame even before the
      // first tick fires. Without this there is a visible blank gap.
      paint();
      timer = setInterval(paint, intervalMs);
      // Don't keep the event loop alive purely for the spinner — when the
      // process is otherwise idle we want it to exit cleanly.
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      // BUGFIX (round 1): the previous implementation wrote the cleanup ANSI
      // (`SAVE_CURSOR + CLEAR_LINE + RESTORE_CURSOR`) on EVERY stop() call,
      // including no-op ones. The TUI's streaming loop in tui.ts calls
      // `spinner.stop()` on every token event without an isActive() guard, so
      // each token write was preceded by a `\r\x1b[2K` that wiped the line of
      // streamed text the cursor was sitting on. Result: the user only saw
      // the trailing character of each chunk, scattered across blank lines.
      //
      // The contract is now: stop() only emits the cleanup if a timer was
      // actually running (i.e. the spinner had painted something). Repeated
      // stop() calls after the first are no-ops and produce zero bytes —
      // pinned by `tui-streaming-render.spec.ts > spinner.stop() is a no-op
      // when the spinner is already stopped`.
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      // Clear the spinner's line and restore so the surrounding text can
      // continue from where the cursor was before start().
      out.write(`${SAVE_CURSOR}${CLEAR_LINE}${RESTORE_CURSOR}`);
    },
    isActive() {
      return timer !== null;
    },
  };
}
